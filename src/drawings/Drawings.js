/**
 * The drawings controller: one ChartPlugin per chart, and the public API a
 * host drives (§7).
 *
 * Everything else under src/drawings is a pure part with one job: the model
 * normalises and stores, the state machine decides what a gesture means, the
 * snap pipeline decides where a point lands, the tools project and paint, the
 * scene composes, Motion animates. This file is the only one that holds state
 * across events, and it does four things with it:
 *
 *   1. Adapts the core's plugin hooks into MachineEvents, and runs the
 *      machine's effects against the store, the scene and the host.
 *   2. Keeps one Slot per drawing — the resolved fractional bar indices
 *      (`u`), the last projected geometry — and re-resolves it lazily, on
 *      every read, whenever the data under it changed (§3.3).
 *   3. Commits: every document change goes through _apply(), which records one
 *      history entry and queues one `change` for the operation, whatever made
 *      it (a gesture, an API call, a batch, an undo).
 *   4. Emits: listeners never run in the middle of an operation. Events are
 *      queued and flushed once the operation's state is fully committed, in
 *      the order change → history → select → tool, and from frame hooks only
 *      in afterFrame (the core's "safe place to emit").
 *
 * A note on the effect lines written as `if (eff.type === …)`: several of them
 * are mutation-test anchors (test/mutants/drawings-controller.js), so their
 * text is load-bearing.
 */
import { reduce, initialState, ownsPress } from './interaction/machine.js'
import { pickHit } from './interaction/hit.js'
import { snapPoint, collectSnapTargets } from './interaction/snap.js'
import { keyEvent } from './interaction/keys.js'
import { openTextEditor } from './interaction/textEditor.js'
import { DrawingStore, diff } from './model/store.js'
import { History } from './model/history.js'
import {
  normalizeEntries, normalizeInput, applyPatch, toJSON, sameDrawing, makeIdFactory, makeRegistry,
} from './model/schema.js'
import { pointIndex, pointFromIndex, indexToTime, timeToIndex } from './model/time.js'
import { Motion, fwdOf, invOf } from './render/motion.js'
import { projectSlots, paintScene } from './render/scene.js'
import { drawingTheme } from './render/theme.js'
import { fontSized } from './render/paint.js'
import { makeContext } from './context.js'
import { resolvePreset } from './presets.js'

/**
 * Charts with drawings enabled. A second enable on the same chart throws
 * (D22): two controllers would both claim every press. The entry is dropped
 * on destroy, so React StrictMode's effect → cleanup → effect gets a fresh
 * controller rather than a destroyed one.
 */
const ENABLED = new WeakMap()

/**
 * Ids of the things painted that are not in the document. The NUL keeps them
 * out of any id a host could store (ids are 1–128 printable characters in
 * practice), because the scene treats a draft whose id matches a committed
 * drawing as that drawing being dragged.
 */
const DRAFT_ID = '\u0000draft'
const MEASURE_ID = '\u0000measure'

const EVENTS = ['change', 'drawing', 'select', 'box', 'tool', 'history', 'edit', 'contextmenu']
const STATE_EVENTS = new Set(['select', 'box', 'tool', 'history'])
const MAGNETS = new Set(['inherit', 'off', 'weak', 'strong'])
const MOTION_MODES = new Set(['auto', 'full', 'reduced', 'none'])
const MODIFIER_KEYS = new Set(['Shift', 'Alt', 'Control', 'Meta'])
/** States in which keys.js must not treat Delete/Enter/arrows as edits. */
const GESTURE_STATES = new Set(['PRESSED', 'DRAG_HANDLE', 'DRAG_BODY', 'PRESS_CREATE', 'CREATE_DRAG', 'PLACING', 'QM_DRAG'])
/** States in which the armed tool is still "the tool" for the `tool` event. */
const ARMED_STATES = new Set(['ARMED', 'PRESS_CREATE', 'CREATE_DRAG', 'PLACING'])
/** A snap worth a ring when it engages: something the point locked ONTO. */
const RING_KINDS = new Set(['anchor', 'level', 'align', 'fit', 'ohlc', 'series'])
const NO_GUIDES = []
const ONE = [null]
const CLIP = { x: 0, y: 0, w: 0, h: 0 }

const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/**
 * Whether a snap changed in a way the reader should SEE glide: its kind, the
 * thing it locked onto, or the tag it shows. A new bar slot with the same
 * kind is not a change (D8): drags jump, or the drawing trails the pointer.
 */
function snapChanged(a, b) {
  const ak = a ? a.kind : 'slot'
  const bk = b ? b.kind : 'slot'
  if (ak !== bk) return true
  if (!a || !b) return false
  return a.targetId !== b.targetId || a.tag !== b.tag
}

/** Whether a box moved by half a pixel or more on any side (or appeared, or went). */
function boxMoved(last, box) {
  if (!last || last.box === undefined) return true
  const a = last.box
  if (!a || !box) return a !== box
  return Math.abs(a.x - box.x) >= 0.5 || Math.abs(a.y - box.y) >= 0.5 ||
    Math.abs(a.x + a.w - box.x - box.w) >= 0.5 || Math.abs(a.y + a.h - box.y - box.h) >= 0.5
}

/** Per-listener dedupe of the state events: is `b` the same state as `a`? */
function sameState(event, a, b) {
  if (event === 'select') return a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i])
  if (event === 'history') {
    return a.canUndo === b.canUndo && a.canRedo === b.canRedo && a.undoSize === b.undoSize && a.redoSize === b.redoSize
  }
  if (event === 'tool') return a.tool === b.tool && a.sticky === b.sticky
  if (event === 'box') return a.id === b.id && !boxMoved(a, b.box)
  return false
}

/** A fresh Slot (§11, "Shared shape owned by F"). `rd` is the drawing `u` was resolved for. */
function newSlot(id, tool) {
  return {
    id, d: null, tool, pane: null, u: new Float64Array(0),
    rp: undefined, gen: -1, n: -1, t0: 0, tN: 0, tf: 0, rd: null,
    geom: null, drawn: false, broken: null, inert: false, anchors: null,
  }
}

/** The platform's magnet-invert modifier (§5.1). Read inside createDrawings, never at module scope. */
function detectMac() {
  if (typeof navigator === 'undefined' || !navigator) return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')
}

/** A point at a new price, keeping its time, offset and tf exactly. */
function atPrice(pt, price) {
  const o = { time: pt.time, price }
  if (pt.offset !== undefined) o.offset = pt.offset
  if (pt.tf !== undefined) o.tf = pt.tf
  return o
}

export class Drawings {
  constructor(chart, options) {
    if (!chart || typeof chart.addPlugin !== 'function') {
      throw new Error('enableDrawings: needs an Emberwick >= 0.12 chart (no addPlugin)')
    }
    if (ENABLED.has(chart)) {
      throw new Error('enableDrawings: drawings are already enabled on this chart — call destroy() first')
    }
    const o = isPlainObject(options) ? options : {}
    if (!Array.isArray(o.tools)) throw new TypeError('createDrawings: options.tools must be an array of ToolDefs')
    /** Vue must never deep-proxy the controller (Chart sets the same flag). */
    this.__v_skip = true
    this.chart = chart
    this._registry = makeRegistry(o.tools)
    this._opts = {
      magnet: 'inherit', stickyTools: false, quickMeasure: true, keyboard: true, textEditor: true,
      historyLimit: 100, motion: 'auto', prefersReducedMotion: null, readOnly: false, theme: null,
      maxDrawings: 5000,
    }
    this._defaults = Object.create(null)
    this._idFactory = makeIdFactory()
    this._invertKey = detectMac() ? 'metaKey' : 'ctrlKey'
    this._applyOptions(o)

    this._store = new DrawingStore()
    this._history = new History(this._opts.historyLimit)
    this._slots = []
    this._slotById = new Map()
    this._listRef = null
    this._selection = Object.freeze([])
    this._state = initialState()
    this._host = null
    this._view = { host: null }
    this._destroyed = false
    /** Counted where re-resolution actually happens, so tests never spy on an ES binding (§9 rule 4). */
    this._resolveCount = 0
    this._dataRev = 0
    this._rev = { bump: true, n: -1, bar: null, h: NaN, l: NaN, c: NaN, v: NaN }
    this._contexts = new WeakMap()
    this._ctxFor = (pane) => this._context(pane)
    this._clipRect = (s) => this._clipOf(s)
    this._measureCtx = null
    this._theme = null
    this._themeSrc = undefined
    this._scratch = []
    this._targets = []

    // Gesture and view state the machine does not own.
    this._drag = null
    this._dragSlot = null
    this._preview = null
    this._qm = null
    this._snapShown = null
    this._hoverId = null
    this._hoverCursor = null
    this._lastHover = null
    this._touch = false
    this._pointerType = 'mouse'
    this._hidden = false
    this._editor = null
    this._editingId = null
    this._fxPaneId = null
    this._hoverOut = null
    this._noFocus = false
    this._justCreated = false
    this._streamDirty = false
    this._streamSnap = null
    this._toolName = null
    this._toolSticky = false
    this._inTick = false
    this._painting = false
    this._fullFrame = false
    this._batch = null
    this.lastLoadReport = null

    // Events.
    this._listeners = Object.create(null)
    this._seen = Object.create(null)
    for (const ev of EVENTS) {
      this._listeners[ev] = new Set()
      if (STATE_EVENTS.has(ev)) this._seen[ev] = new Map()
    }
    this._queue = []
    this._dirty = new Set()
    this._depth = 0
    this._flushing = false
    this._lastBox = { id: null, box: undefined }

    this._motion = new Motion({ mode: this._resolveMode(chart.options && chart.options.animate !== false), onWake: () => {
      if (this._host) this._host.invalidate()
    } })
    this._env = this._makeEnv()
    this._scene = {
      host: null, info: null, slots: null, motion: this._motion, ctxFor: this._ctxFor,
      selectedId: null, hoverId: null, editingId: null, draft: null, snap: null, guides: NO_GUIDES,
      quickMeasure: null, touch: false, hidden: false,
    }
    this._draftRef = { tool: null, d: null, slot: null }

    // prefers-reduced-motion, read inside createDrawings (never at module
    // scope, which runs during SSR) and followed while attached.
    this._mq = null
    this._onMq = null
    this._mqReduced = false
    if (!this._opts.prefersReducedMotion && typeof window !== 'undefined' && window && typeof window.matchMedia === 'function') {
      try {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
        this._mqReduced = !!(mq && mq.matches)
        this._onMq = (ev) => {
          this._mqReduced = !!(ev && ev.matches)
          if (this._host) this._host.invalidate()
        }
        if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', this._onMq)
        else if (mq && typeof mq.addListener === 'function') mq.addListener(this._onMq)
        this._mq = mq
      } catch (_) {
        this._mq = null
      }
    }

    // Throws on a destroyed chart; attach() has not run then, so nothing leaks.
    chart.addPlugin(this)
    ENABLED.set(chart, this)

    if (o.drawings !== undefined) {
      const report = this._load(o.drawings)
      if (report.rejected.length) {
        console.warn(`[Emberwick] drawings: ${report.rejected.length} stored drawing(s) were rejected on load; see lastLoadReport`, report.rejected)
      }
    }
  }

  // ================================================================ plugin hooks

  attach(host) {
    this._host = host
    this._view.host = host
    this._scene.host = host
    const el = host.chart.container
    // The core has no keyup hook and does not listen to keyup: releasing a
    // modifier with the mouse held still must still drop its constraint (D9).
    this._onKeyUp = (e) => { this._setMods(e); this._dispatch({ type: 'rederive' }) }
    this._onBlur = () => {
      this._setMods({ shiftKey: false, altKey: false, ctrlKey: false, metaKey: false })
      this._dispatch({ type: 'rederive' })
    }
    this._styleSaved = null
    if (el) {
      if (typeof el.addEventListener === 'function') {
        el.addEventListener('keyup', this._onKeyUp)
        el.addEventListener('blur', this._onBlur)
      }
      // A Shift+press quick measure would extend the page's text selection, a
      // drag near the edge would select page text, and iOS shows its callout
      // on a long press. Only while drawings are enabled; restored on detach.
      const st = el.style
      if (st) {
        this._styleSaved = { userSelect: st.userSelect, webkitUserSelect: st.webkitUserSelect, webkitTouchCallout: st.webkitTouchCallout }
        st.userSelect = 'none'
        st.webkitUserSelect = 'none'
        st.webkitTouchCallout = 'none'
      }
    }
    this._syncTheme()
  }

  detach() {
    if (this._destroyed) return
    const el = this.chart.container
    if (this._editor) {
      const ed = this._editor
      this._editor = null
      ed.handle.close()
    }
    if (el && typeof el.removeEventListener === 'function') {
      el.removeEventListener('keyup', this._onKeyUp)
      el.removeEventListener('blur', this._onBlur)
    }
    if (el && el.style && this._styleSaved) {
      el.style.userSelect = this._styleSaved.userSelect
      el.style.webkitUserSelect = this._styleSaved.webkitUserSelect
      el.style.webkitTouchCallout = this._styleSaved.webkitTouchCallout
    }
    if (this._mq && this._onMq) {
      if (typeof this._mq.removeEventListener === 'function') this._mq.removeEventListener('change', this._onMq)
      else if (typeof this._mq.removeListener === 'function') this._mq.removeListener(this._onMq)
    }
    this._mq = null
    this._motion.setMode('none')
    this._motion.finishAll()
    this._drag = null
    this._dragSlot = null
    this._preview = null
    this._qm = null
    this._editingId = null
    this._state = initialState()
    this._host = null
    this._view.host = null
    this._scene.host = null
    // The store stays: getDrawings() still returns the last document.
    this._destroyed = true
    ENABLED.delete(this.chart)
  }

  /**
   * §5.3 order: resolve (and bump dataRev) → re-derive or re-test hover from
   * the stored pointer → Motion. Motion ticks LAST so a glide seeded by this
   * very frame's re-derive counts toward this frame's keep-alive.
   */
  tick(dt, info) {
    if (!this._host) return false
    this._frameInput(info)
    const busy = this._motion.tick(dt, this._view)
    return busy || this._motion.active
  }

  /**
   * The input half of a frame. Events it queues wait for afterFrame, and it
   * never invalidates: this very frame paints what it changed.
   */
  _frameInput(info) {
    this._inTick = true
    this._depth++
    try {
      this._fullFrame = !!info.full
      this._syncTheme()
      this._resolveAll()
      this._resolveDrafts()
      this._bumpRev()
      this._syncMode()
      // Hit tests and snap targets read the last projection. On a frame where
      // the view moved under a still pointer, that is the PREVIOUS view:
      // project now, so the re-test and re-derive see what this frame paints.
      if (info.full && (this._ptr || this._lastHover)) projectSlots(this._slots, this._ctxFor, this._motion, false)
      this._rederive(info)
    } finally {
      this._depth--
      this._inTick = false
    }
  }

  /**
   * D9: a held anchor, a preview reticle or an exact crosshair is re-snapped
   * from the stored pointer on every full frame, so a wheel zoom, an
   * autoscale ease, a live tick or a prepend never pulls it off a still
   * pointer; with no gesture, the hover highlight is re-tested (§5.4).
   */
  _rederive(info) {
    if (info.full && this._ptr) this._dispatch({ type: 'rederive' })
    if (info.full && this._lastHover && !this._gestureActive()) this._retestHover()
  }

  draw(c, info) {
    if (!this._host) return
    const exporting = !!info.exporting
    if (!exporting) this._measureCtx = c
    this._painting = true
    try {
      // Live frames project here (geometry also feeds hit testing between
      // frames); the export pass re-projects at rest inside paintScene.
      if (!exporting) projectSlots(this._slots, this._ctxFor, this._motion, false)
      const sc = this._scene
      sc.info = info
      sc.slots = this._slots
      sc.selectedId = this._selection.length ? this._selection[0] : null
      sc.hoverId = this._hoverId
      sc.editingId = this._editingId
      const draft = this._dragSlot || this._preview
      if (draft) {
        this._draftRef.tool = draft.tool
        this._draftRef.d = draft.d
        this._draftRef.slot = draft
        sc.draft = this._draftRef
      } else sc.draft = null
      sc.snap = this._snapShown
      sc.quickMeasure = this._qm
      sc.touch = this._touch
      sc.hidden = this._hidden
      paintScene(c, sc)
    } finally {
      this._painting = false
    }
  }

  afterFrame() {
    if (!this._host) return
    this._feedback()
    // Queued events first: a selection made in tick is announced before the
    // box that follows it.
    this._flush()
    this._stream()
    const id = this._selection.length ? this._selection[0] : null
    const box = id ? this._boxOf(id) : null
    if (id !== this._lastBox.id) this._lastBox = { id: this._lastBox.id, box: undefined }
    if (boxMoved(this._lastBox, box)) this._emitState('box', { id, box })
    // Glued (§5.8): in the same rAF as the canvas, so a live autoscale or a
    // wheel zoom never leaves the text out from under its textarea.
    if (this._editor && this._fullFrame) {
      const box2 = this._editorBox()
      if (box2) this._editor.handle.reposition(box2)
    }
    this._flush()
  }

  hover(e, reason) {
    if (!this._host) return null
    const out = { cursor: null, crosshair: null }
    this._begin()
    try {
      if (e) {
        this._pointerType = e.pointerType
        this._touch = false
        this._lastHover = {
          x: e.x, y: e.y, pointerId: e.pointerId, pointerType: e.pointerType, button: 0, buttons: 0,
          shiftKey: !!e.shiftKey, altKey: !!e.altKey, ctrlKey: !!e.ctrlKey, metaKey: !!e.metaKey,
          region: e.region, pane: e.pane, timeStamp: 0, event: null,
        }
      } else {
        // 'leave' drops the stored point; 'pan' and 'occluded' too: a hover
        // re-test on the pan's own frames would re-highlight what the
        // reader is dragging the chart through.
        this._lastHover = null
      }
      this._hoverOut = out
      this._dispatch({ type: 'hover', e: e || null, reason })
    } finally {
      this._hoverOut = null
      this._end()
    }
    this._hoverCursor = out.cursor
    if (!e || (!out.cursor && !out.crosshair)) return null
    return out
  }

  pointerDown(e) {
    if (!this._host) return false
    this._justCreated = false
    this._notePointer(e)
    let r
    this._begin()
    try {
      r = this._dispatch({ type: 'down', e })
    } finally {
      this._end()
    }
    // After the flush: a host 'select' listener may have removed the drawing
    // this press took, and the core must not record an owner that is gone.
    return !!r.result && ownsPress(this._state)
  }

  pointerMove(e) {
    if (!this._host) return
    this._op(() => this._dispatch({ type: 'move', e }))
  }

  pointerUp(e) {
    if (!this._host) return
    this._op(() => this._dispatch({ type: 'up', e }))
  }

  pointerCancel() {
    if (!this._host) return
    this._op(() => this._dispatch({ type: 'cancel' }))
  }

  tap(e) {
    if (!this._host) return false
    this._notePointer(e)
    return this._op(() => this._dispatch({ type: 'tap', e }).result === true)
  }

  doubleClick(e) {
    if (!this._host) return false
    // The second click of a click-click creation IS the double-click the
    // browser reports: the drawing it just made must not open for editing.
    if (this._justCreated) { this._justCreated = false; return true }
    return this._op(() => this._dispatch({ type: 'dblclick', e }).result === true)
  }

  contextMenu(e) {
    if (!this._host || this._state.name !== 'IDLE') return false
    return this._op(() => {
      const hit = this._hitAt(e.x, e.y, e.pointerType)
      if (!hit) return false
      this._setSelection([hit.id])
      const d = this._store.get(hit.id)
      // The native menu is prevented only for a host that shows its own.
      if (!this._listeners.contextmenu.size || !d) return false
      this._queue.push({ event: 'contextmenu', payload: { id: hit.id, drawing: toJSON(d), part: hit.part === 'move' ? 'handle' : hit.part, x: e.x, y: e.y, event: e.event } })
      return true
    })
  }

  keyDown(e) {
    if (!this._host || !e) return false
    return this._op(() => {
      if (MODIFIER_KEYS.has(e.key)) {
        // Not consumed: modifiers belong to the core too.
        this._setMods(e)
        this._dispatch({ type: 'rederive' })
        return false
      }
      if (!this._opts.keyboard) return false
      const s = this._state
      const ev = keyEvent(e, {
        hasSelection: this._selection.length > 0,
        gesture: GESTURE_STATES.has(s.name),
        placing: s.name === 'PLACING',
        editing: s.name === 'EDITING' || s.name === 'EDITING_NEW',
      })
      if (!ev) return false
      return this._dispatch(ev).result === true
    })
  }

  // ================================================================ public API

  get destroyed() { return this._destroyed }
  get selection() { return this._selection }
  get tool() { return this._toolName }
  get hidden() { return this._hidden }
  get magnet() { return this._opts.magnet }
  get canUndo() { return this._history.canUndo }
  get canRedo() { return this._history.canRedo }

  /** z-ascending deep clones, inert (carried) rows verbatim, unknown keys re-emitted. */
  getDrawings() {
    return this._store.list.map(toJSON)
  }

  get(id) {
    const e = this._store.get(String(id))
    return e ? toJSON(e) : null
  }

  setDrawings(input) {
    if (this._destroyed) return null
    return this._op(() => {
      // Normalise first: a document that does not parse throws with nothing applied.
      const loaded = normalizeEntries(input, this._registry, { maxDrawings: this._opts.maxDrawings })
      this._external(null)
      return this._install(loaded)
    })
  }

  add(input, opts) {
    if (this._destroyed) return null
    const o = isPlainObject(opts) ? opts : {}
    return this._op(() => {
      if (!isPlainObject(input)) throw new Error('not an object')
      let id
      const raw = input.id
      if (raw !== undefined && raw !== null) {
        if (typeof raw === 'string' ? !(raw.length > 0 && raw.length <= 128) : !(typeof raw === 'number' && Number.isFinite(raw))) {
          throw new Error('bad id')
        }
        id = String(raw)
        if (this._store.has(id)) throw new Error(`duplicate id "${id}"`)
      } else {
        id = this._freshId()
      }
      const d = normalizeInput(input, this._registry, id, this._store.maxZ() + 1)
      this._assertPane(d.pane)
      this._apply(new Map([[id, d]]), 'create', 'api', { history: o.history, select: o.select ? [id] : null })
      if (o.animate) this._motion.appear(id)
      return id
    })
  }

  update(id, patch, opts) {
    if (this._destroyed) return false
    const o = isPlainObject(opts) ? opts : {}
    return this._op(() => this._update(String(id), patch, o.history, o.animate, 'api', null))
  }

  remove(idOrIds, opts) {
    if (this._destroyed) return 0
    const o = isPlainObject(opts) ? opts : {}
    const ids = Array.isArray(idOrIds) ? idOrIds.map(String) : [String(idOrIds)]
    return this._op(() => this._remove(ids, 'api', 'remove', o.history))
  }

  clear(opts) {
    if (this._destroyed) return 0
    const o = isPlainObject(opts) ? opts : {}
    return this._op(() => {
      // Inert rows are a newer build's drawings: a save-on-change host must
      // never delete them because this build cannot read them (D12).
      const ids = this._store.list.filter((e) => !e.inert).map((e) => e.id)
      if (!ids.length) return 0
      this._external(null)
      return this._remove(ids, 'api', 'clear', o.history)
    })
  }

  duplicate(id, opts) {
    if (this._destroyed) return null
    const o = isPlainObject(opts) ? opts : {}
    const off = Number.isFinite(o.offsetBars) ? o.offsetBars : 5
    return this._op(() => this._duplicate(String(id), off, 'api', false))
  }

  bringToFront(id) {
    if (this._destroyed) return false
    return this._op(() => this._reorder(String(id), true))
  }

  sendToBack(id) {
    if (this._destroyed) return false
    return this._op(() => this._reorder(String(id), false))
  }

  setLocked(id, on) {
    if (this._destroyed) return false
    return this._op(() => this._update(String(id), { locked: !!on }, true, false, 'api', 'lock'))
  }

  setVisible(id, on) {
    if (this._destroyed) return false
    return this._op(() => this._update(String(id), { visible: !!on }, true, false, 'api', 'visibility'))
  }

  setHidden(on) {
    this._hidden = !!on
    if (this._host) this._host.invalidate()
    return this
  }

  select(ids, opts) {
    if (this._destroyed) return this
    const o = isPlainObject(opts) ? opts : {}
    const list = ids == null ? [] : Array.isArray(ids) ? ids : [ids]
    this._op(() => {
      this._setSelection(list.map(String))
      if (o.focus !== false && this._selection.length) this._focus()
    })
    return this
  }

  drawingAt(x, y) {
    if (!this._host) return null
    this._resolveAll()
    const sel = this._selection.length ? this._selection[0] : null
    const hit = pickHit(this._slots, x, y, 'mouse', sel, this._scratch, this._clipRect)
    if (!hit) return null
    const handle = hit.part === 'handle' || hit.part === 'move'
    return { id: hit.id, part: handle ? 'handle' : hit.part, handle: handle ? hit.index : -1, locked: hit.locked }
  }

  screenBox(id) {
    if (!this._host) return null
    return this._boxOf(String(id))
  }

  priceAt(id, time) {
    if (!this._host) return null
    const s = this._slotById.get(String(id))
    const h = this._host
    if (!s || !h.source.length) return null
    this._ensureResolved(s)
    const u = timeToIndex(h.source, time, h.timeframeMs)
    if (!Number.isFinite(u)) return null
    if (typeof s.tool.priceAt === 'function') {
      const pane = s.pane || h.panes[0]
      let p = null
      try { p = s.tool.priceAt(s.d, u, this._context(pane)) } catch (_) { p = null }
      return Number.isFinite(p) ? p : null
    }
    return null
  }

  setTool(tool, opts) {
    if (this._destroyed) return this
    const o = isPlainObject(opts) ? opts : {}
    this._op(() => {
      let spec = null
      if (tool != null) {
        const p = resolvePreset(tool, this._registry)
        if (!p) throw new Error(`drawings: unknown tool "${tool}"`)
        spec = {
          type: p.type,
          preset: p.preset,
          options: Object.assign(p.options, isPlainObject(o.options) ? o.options : null),
          style: isPlainObject(o.style) ? Object.assign({}, o.style) : undefined,
          sticky: typeof o.sticky === 'boolean' ? o.sticky : undefined,
        }
      }
      this._noFocus = o.focus === false
      try {
        this._dispatch({ type: 'setTool', tool: spec })
      } finally {
        this._noFocus = false
      }
    })
    return this
  }

  cancel() {
    if (this._destroyed) return this
    this._op(() => this._dispatch({ type: 'key', intent: 'escape' }))
    return this
  }

  undo() {
    if (this._destroyed) return false
    return this._op(() => {
      this._external(null)
      return this._undoRedo(true)
    })
  }

  redo() {
    if (this._destroyed) return false
    return this._op(() => {
      this._external(null)
      return this._undoRedo(false)
    })
  }

  clearHistory() {
    this._op(() => {
      this._history.clear()
      this._dirty.add('history')
    })
  }

  /**
   * Atomic (§7.3): one history entry and one `change` for everything `fn`
   * does, or — if it throws — nothing at all. The snapshot is O(1): drawings
   * are immutable, so holding the list IS the snapshot.
   */
  batch(fn) {
    if (this._destroyed) return
    if (this._batch) { fn(this); return }
    this._op(() => {
      this._external(null)
      const snapshot = this._store.list
      const selBefore = this._selection
      const rec = { before: new Map() }
      this._batch = rec
      try {
        fn(this)
      } catch (err) {
        this._batch = null
        this._store.replaceAll(snapshot)
        this._sync()
        this._setSelection(selBefore)
        throw err
      }
      this._batch = null
      const after = new Map()
      for (const id of rec.before.keys()) after.set(id, this._store.get(id))
      const ch = diff(rec.before, after)
      if (!ch.created.length && !ch.updated.length && !ch.removed.length) return
      this._history.push({ before: rec.before, after, selBefore, selAfter: this._selection, reason: 'batch' })
      this._dirty.add('history')
      this._emitChange('api', 'batch', ch.created, ch.updated, ch.removed)
    })
  }

  setMagnet(mode) {
    if (MAGNETS.has(mode)) this._opts.magnet = mode
    return this
  }

  setDefaults(type, def) {
    if (typeof type !== 'string' || !isPlainObject(def)) return this
    const cur = this._defaults[type] || {}
    this._defaults[type] = {
      style: Object.assign({}, cur.style, isPlainObject(def.style) ? def.style : null),
      options: Object.assign({}, cur.options, isPlainObject(def.options) ? def.options : null),
    }
    return this
  }

  setOptions(partial) {
    if (!isPlainObject(partial)) return this
    this._applyOptions(partial)
    this._history.limit = this._opts.historyLimit
    if ('theme' in partial) this._themeSrc = undefined
    if (this._host) this._host.invalidate()
    return this
  }

  orphans() {
    if (this._host) this._resolveAll()
    return this._slots.filter((s) => !s.pane).map((s) => s.id)
  }

  editText(id) {
    if (this._destroyed) return false
    const key = String(id)
    const d = this._store.get(key)
    if (!d || d.inert || d.type !== 'text' || d.locked || this._opts.readOnly) return false
    return this._op(() => {
      if (this._state.name !== 'IDLE') this._dispatch({ type: 'key', intent: 'escape' })
      this._setSelection([key])
      if (this._selection[0] !== key) return false
      this._dispatch({ type: 'key', intent: 'edit' })
      return this._opts.textEditor ? this._editingId === key : true
    })
  }

  subscribe(event, fn) {
    const set = this._listeners[event]
    if (!set) throw new Error(`drawings: unknown event "${event}"`)
    if (typeof fn !== 'function') throw new TypeError('drawings: subscribe() needs a function')
    set.add(fn)
    if (STATE_EVENTS.has(event)) {
      const payload = this._statePayload(event)
      this._seen[event].set(fn, payload)
      // Wrapped: a throw here would escape before the unsubscriber is returned.
      this._call(event, fn, payload)
    }
    return () => {
      set.delete(fn)
      if (this._seen[event]) this._seen[event].delete(fn)
    }
  }

  destroy() {
    if (this._destroyed) return
    this.chart.removePlugin(this)
    // Not attached (the chart dropped it already): tear down directly.
    if (!this._destroyed) this.detach()
  }

  // ================================================================ dispatch

  get _ptr() { return this._state.ptr }

  /**
   * Run one MachineEvent: reduce, commit the new state, run its effects in
   * order. The state is stored BEFORE the effects run, so a listener that
   * re-enters the API from an effect sees the transition as done.
   */
  _dispatch(ev) {
    const before = this._state
    const r = reduce(before, ev, this._env)
    this._state = r.state
    // The pane a creation's effects belong to: the machine forgets it on the
    // transition that completes the creation, which is exactly when the
    // `create` effect needs it.
    this._fxPaneId = r.state.paneId || before.paneId || null
    for (let i = 0; i < r.effects.length; i++) this._run(r.effects[i])
    if (this._state.name === 'IDLE') {
      this._snapShown = null
      if (this._preview && !this._editor) this._preview = null
    }
    this._syncTool()
    // Inside tick the same frame paints; invalidating there would keep an
    // armed tool under a still mouse repainting forever.
    if (r.effects.length && !this._inTick && this._host) this._host.invalidate()
    return r
  }

  _run(eff) {
    const h = this._host
    if (!h) return
    if (eff.type === 'dragTo') { this._draft(eff); return }
    if (eff.type === 'crosshairRaw') { this._host.setCrosshair({ x: eff.x, y: eff.y }); return }
    if (eff.type === 'release') { this._host.release(); this._host.setCursor(null); return }
    switch (eff.type) {
      case 'claim': return
      case 'select': this._setSelection(eff.ids); return
      case 'hover':
        this._hoverId = eff.id
        this._motion.hover(eff.id)
        return
      case 'cursor':
        if (this._hoverOut) this._hoverOut.cursor = eff.css
        else if (eff.css !== this._hoverCursor) { this._hoverCursor = eff.css; h.setHover(eff.css) }
        return
      case 'setCursor': h.setCursor(eff.css); return
      case 'crosshair': this._crosshair(eff); return
      case 'beginDrag': this._beginDrag(eff); return
      case 'endDrag': this._endDrag(); return
      case 'revert': this._revertDrag(); return
      case 'preview': this._previewFx(eff); return
      case 'create': this._create(eff); return
      case 'abortCreate': this._abortCreate(eff); return
      case 'openEditor': this._openEditor(eff); return
      case 'commitEditor': this._commitEditor(eff); return
      case 'cancelEditor': this._cancelEditor(); return
      case 'remove': this._remove(eff.ids, 'user', 'remove', true); return
      case 'duplicate':
        for (const id of eff.ids) this._duplicate(id, 5, 'user', true)
        return
      case 'nudge': this._nudge(eff.du, eff.dv); return
      case 'undo': this._undoRedo(true); return
      case 'redo': this._undoRedo(false); return
      case 'emitEdit': this._emitEdit(eff.id); return
      case 'focus': if (!this._noFocus) this._focus(); return
      case 'tool':
        if (!eff.tool) {
          this._preview = null
          this._snapShown = null
          if (this._hoverCursor === 'crosshair') { this._hoverCursor = null; h.setHover(null) }
        }
        return
      case 'shake': this._motion.shake(eff.id); return
      case 'ripple': this._motion.ripple(eff.u, eff.price, eff.paneId); return
      case 'dismissMeasure': this._qm = null; return
      default:
    }
  }

  /**
   * The crosshair during drawing gestures (§5.10): exactly on the SNAPPED
   * point, with the point's own tags suppressed while the scene draws them.
   * From the hover hook it is returned to the core instead.
   */
  _crosshair(eff) {
    const s = eff.s
    this._snapShown = s || null
    if (this._hoverOut) {
      // The same point the crosshair effect would set, tags flag included:
      // dropping it here put a second tag on the axis for every mouse hover.
      this._hoverOut.crosshair = s
        ? (eff.tags === false
          ? { x: s.x, y: s.y, exact: true, price: s.point.price, tags: false }
          : { x: s.x, y: s.y, exact: true, price: s.point.price })
        : null
      return
    }
    if (!s) return
    this._host.setCrosshair(eff.tags === false
      ? { x: s.x, y: s.y, exact: true, price: s.point.price, tags: false }
      : { x: s.x, y: s.y, exact: true, price: s.point.price })
  }

  _op(fn) {
    this._begin()
    try {
      return fn()
    } finally {
      this._end()
    }
  }

  _begin() { this._depth++ }

  _end() {
    if (--this._depth === 0 && !this._inTick) this._flush()
  }

  _gestureActive() {
    return this._state.name !== 'IDLE'
  }

  _retestHover() {
    this._dispatch({ type: 'hover', e: this._lastHover })
  }

  /** The stored pointer's modifier keys, from a key event (§5.3). */
  _setMods(e) {
    const mods = { shiftKey: !!e.shiftKey, altKey: !!e.altKey, ctrlKey: !!e.ctrlKey, metaKey: !!e.metaKey }
    const p = this._state.ptr
    if (p) this._state = Object.assign({}, this._state, { ptr: Object.assign({}, p, mods) })
    if (this._lastHover) Object.assign(this._lastHover, mods)
  }

  _notePointer(e) {
    this._pointerType = e.pointerType
    this._touch = e.pointerType === 'touch'
    this._motion.handleSize(this._touch)
  }

  _focus() {
    const el = this.chart.container
    if (el && typeof el.focus === 'function') el.focus({ preventScroll: true })
  }

  _makeEnv() {
    const self = this
    return {
      get tools() { return self._registry },
      get selection() { return self._selection },
      get readOnly() { return self._opts.readOnly },
      get quickMeasure() { return self._opts.quickMeasure && self._registry.has('measure') },
      get sticky() { return self._opts.stickyTools },
      get textEditor() { return self._opts.textEditor },
      get invertKey() { return self._invertKey },
      get hasBars() { return !!self._host && self._host.bars.length > 0 },
      hitAt: (x, y, pointerType) => self._hitAt(x, y, pointerType),
      paneReady: (pane) => !!self._readyPane(pane),
      snap: (p, opts) => self._snap(p, opts),
      anchorsOf: (id) => self._anchorsOf(id),
      drawing: (id) => {
        const d = self._store.get(id)
        return d && !d.inert ? d : null
      },
      paneAt: (y) => (self._host ? self._host.paneAt(y) : null),
    }
  }

  // ================================================================ resolution

  /**
   * Re-resolve `s.u` when the drawing or anything it resolves against
   * changed (§3.3). The key is compared field by field, so an unchanged slot
   * costs a handful of comparisons and builds nothing.
   *
   * Replay: keyed on the Replay object and the source length. Every scrub
   * bumps barGen but never changes the source, so gen is not part of the key
   * then, and seeking never moves a drawing.
   */
  _ensureResolved(s) {
    const h = this._host
    const src = h.source
    const rp = h.replay || null
    const n = src.length
    const t0 = n ? +src[0].time : 0
    const tN = n ? +src[n - 1].time : 0
    const tf = h.timeframeMs
    let stale = s.rd !== s.d || s.rp !== rp || s.n !== n || s.tf !== tf
    if (!rp && (
      s.gen !== h.barGen ||
      s.t0 !== t0 ||
      s.tN !== tN)) stale = true
    if (!stale) return false
    const pts = s.d.points
    if (s.u.length !== pts.length) s.u = new Float64Array(pts.length)
    for (let k = 0; k < pts.length; k++) s.u[k] = pointIndex(src, pts[k], tf)
    s.rd = s.d
    s.rp = rp
    s.gen = h.barGen
    s.n = n
    s.t0 = t0
    s.tN = tN
    s.tf = tf
    this._resolveCount++
    this._rev.bump = true
    // Pointer events read PROJECTED anchors (the grab offset, an angle
    // origin): an async prepend between two events must not leave them one
    // history page behind until the next frame.
    if (!this._inTick && !this._painting && s.pane) {
      ONE[0] = s
      projectSlots(ONE, this._ctxFor, this._motion, false)
      ONE[0] = null
    }
    return true
  }

  /** Every slot's pane (orphaned when it is gone, §3.5) and its resolution. */
  _resolveAll() {
    const h = this._host
    if (!h) return
    for (const s of this._slots) {
      let pane = h.paneById(s.d.pane)
      if (!pane) { s.pane = null; continue }
      s.pane = pane
      this._ensureResolved(s)
    }
    const sel = this._selection.length ? this._slotById.get(this._selection[0]) : null
    if (sel && (!sel.pane || sel.d.visible === false)) this._setSelection([])
  }

  _resolveDrafts() {
    if (this._preview && this._preview.pane) this._ensureResolved(this._preview)
    if (this._dragSlot && this._dragSlot.pane) this._ensureResolved(this._dragSlot)
    if (this._qm && this._qm.pane) this._ensureResolved(this._qm)
  }

  /**
   * dataRev (§3.3): bumped when a slot re-resolved, or when the revealed data
   * a cache reads may differ — a new bar count, a new last-bar object, or
   * that bar's high/low/close/volume mutated in place.
   */
  _bumpRev() {
    const bars = this._host.bars
    const r = this._rev
    const last = bars.length ? bars[bars.length - 1] : null
    const changed = r.bump || bars.length !== r.n || last !== r.bar ||
      (last && (last.high !== r.h || last.low !== r.l || last.close !== r.c || last.volume !== r.v))
    if (!changed) return
    this._dataRev++
    r.bump = false
    r.n = bars.length
    r.bar = last
    r.h = last ? last.high : NaN
    r.l = last ? last.low : NaN
    r.c = last ? last.close : NaN
    r.v = last ? last.volume : NaN
  }

  _anchorsOf(id) {
    const slot = this._slotById.get(id)
    if (!slot || !slot.pane) return []
    this._ensureResolved(slot)
    return slot.anchors || []
  }

  /** The tools' view of one pane, rewritten with this frame's mutable fields on every call. */
  _context(pane) {
    let ctx = this._contexts.get(pane)
    if (!ctx) {
      ctx = makeContext(this._host, pane, this._theme, () => this._measureCtx)
      this._contexts.set(pane, ctx)
    }
    ctx.theme = this._theme
    ctx.dataRev = this._dataRev
    ctx.pointerType = this._pointerType
    return ctx
  }

  _syncTheme() {
    const h = this._host
    if (!h) return
    const t = h.theme
    if (t === this._themeSrc && this._theme) return
    this._themeSrc = t
    this._theme = drawingTheme(t, this._opts.theme || undefined)
  }

  _clipOf(s) {
    const r = s.pane.rect
    if (s.geom && s.geom.clip === 'plot') {
      const bottom = this._host.plotBottom
      CLIP.x = 0; CLIP.y = 0; CLIP.w = r.w; CLIP.h = bottom > 0 ? bottom : r.y + r.h
      return CLIP
    }
    return r
  }

  _readyPane(pane) {
    const h = this._host
    if (!pane || !pane.ps.primed || !h.bars.length) return null
    return pane
  }

  // ================================================================ hit, snap

  _hitAt(x, y, pointerType) {
    if (this._hidden || !this._host) return null
    this._resolveAll()
    const sel = this._selection.length ? this._selection[0] : null
    const hit = pickHit(this._slots, x, y, pointerType, sel, this._scratch, this._clipRect)
    // D24: a fill yields to a trade marker under it; strokes and handles win.
    if (hit && hit.part === 'fill' && this.chart.markerAt(x, y)) return null
    return hit
  }

  /** env.snap (§11 contract C): the machine names the gesture, this supplies the world. */
  _snap(p, opts) {
    const h = this._host
    if (!h) return null
    const pane = this._readyPane(h.paneById(opts.paneId))
    if (!pane) return null
    const exclude = opts.excludeId == null ? null : opts.excludeId
    for (const s of this._slots) if (s.pane === pane && s.id !== exclude) this._ensureResolved(s)
    const ctx = this._context(pane)
    const targets = collectSnapTargets(this._slots, pane.id, exclude, this._ctxFor, this._targets)
    const tool = opts.tool || null
    let fit = opts.fit || null
    const placing = opts.placing != null ? opts.placing : opts.handle
    if (!fit && placing === 2 && tool && typeof tool.fitTarget === 'function') {
      // The channel's width point: its fit is measured from the baseline,
      // P0→P1 of the drawing being created (or the one whose P2 is dragged).
      const d = opts.handle === 2 ? this._env.drawing(exclude) : this._creationBase()
      if (d) {
        try { fit = tool.fitTarget(d, 2, p.y, ctx) || null } catch (_) { fit = null }
      }
    }
    return snapPoint({
      x: p.x,
      y: p.y,
      pane,
      pointerType: p.pointerType,
      shift: !!p.shift,
      alt: !!p.alt,
      invert: !!p.invert,
      origin: opts.origin,
      excludeId: exclude == null ? undefined : exclude,
      prefs: tool ? tool.snapPrefs : null,
      prefBoost: tool ? tool.prefBoost : 1,
      prev: opts.prev || null,
      allowAngle: !!opts.allowAngle,
      fit,
    }, { host: h, ctx, targets, magnet: this._opts.magnet })
  }

  /** P0 and P1 of the creation in progress, for the channel fit. */
  _creationBase() {
    const pts = this._state.points
    if (!pts || pts.length < 2) return null
    return { id: DRAFT_ID, points: pts.slice(0, 2) }
  }

  // ================================================================ selection

  _setSelection(ids) {
    const next = []
    for (const id of ids || []) {
      const s = this._slotById.get(id)
      // Single selection in 0.12 (D15); the API is plural for later.
      if (s && s.pane && s.d.visible !== false) { next.push(id); break }
    }
    const cur = this._selection
    if (cur.length === next.length && cur.every((id, i) => id === next[i])) return
    this._selection = Object.freeze(next)
    this._motion.select(next)
    this._history.breakCoalescing()
    this._dirty.add('select')
    if (this._host) this._host.invalidate()
  }

  // ================================================================ drafts

  /** A slot for something painted but not stored (a creation, a drag, quick measure). */
  _slotFor(prev, id, d, tool, pane) {
    const s = prev && prev.tool === tool && prev.id === id ? prev : newSlot(id, tool)
    s.d = d
    s.pane = pane
    if (this._host) this._ensureResolved(s)
    return s
  }

  _specOptions(spec) {
    const def = this._defaults[spec.type]
    return Object.assign({}, def && def.options, spec.options)
  }

  _specStyle(spec) {
    const def = this._defaults[spec.type]
    return Object.assign({}, def && def.style, spec.style)
  }

  /**
   * The points of a creation as the tool would store them: a single-click
   * tool expands its one point (position's smart brackets), a multi-point
   * tool with points still to place repeats its last one, so the preview is
   * the drawing as it stands.
   */
  _creationPoints(tool, points, drag, ctx, options) {
    if (!points.length) return null
    if (points.length < tool.anchors && typeof tool.complete === 'function') {
      let norm = options
      try { norm = tool.normalizeOptions(options) } catch (_) { norm = options }
      const out = tool.complete(points, ctx, drag || null, norm)
      return Array.isArray(out) && out.length >= tool.anchors ? out : null
    }
    const out = points.slice(0, tool.anchors)
    while (out.length < tool.anchors) out.push(out[out.length - 1])
    return out
  }

  _previewFx(eff) {
    const h = this._host
    if (eff.ephemeral) {
      const tool = this._registry.get('measure')
      const pane = h.paneById(this._fxPaneId)
      if (!tool || !pane || !eff.points || eff.points.length < 2) return
      let d
      try {
        d = normalizeInput({ type: 'measure', pane: pane.id, points: eff.points }, this._registry, MEASURE_ID, 0)
      } catch (_) { return }
      this._qm = this._slotFor(this._qm, MEASURE_ID, d, tool, pane)
      return
    }
    if (eff.hidden) {
      if (!eff.editing) this._preview = null
      this._snapShown = null
      return
    }
    const spec = eff.spec
    const tool = spec ? this._registry.get(spec.type) : null
    const pane = h.paneById(this._fxPaneId)
    if (!tool || !pane) { this._preview = null; return }
    const ctx = this._context(pane)
    const options = this._specOptions(spec)
    let points = null
    try { points = this._creationPoints(tool, eff.points || [], eff.drag, ctx, options) } catch (_) { points = null }
    if (!points) {
      // ARMED: nothing placed yet. The reticle is the exact crosshair plus
      // the snap marker; there is no drawing to preview.
      this._preview = null
      return
    }
    let d
    try {
      d = normalizeInput({ type: spec.type, pane: pane.id, points, style: this._specStyle(spec), options },
        this._registry, DRAFT_ID, this._store.maxZ() + 1)
    } catch (_) { return }
    const prevD = this._preview && this._preview.tool === tool ? this._preview.d : null
    if (prevD && this._preview.pane === pane && sameDrawing(prevD, d)) return
    this._preview = this._slotFor(this._preview, DRAFT_ID, d, tool, pane)
    this._streamDirty = true
    this._streamSnap = eff.s || null
    // A snap-kind change on the point being placed glides (D8); a new slot does not.
    const s = eff.s
    if (s && prevD && snapChanged(eff.prev, s)) {
      // From where the pointer lands with no snap, at this view (see _snapGlide):
      // the previous frame's point would count a view jump as the snap's pull.
      const k = Math.min((eff.points || []).length, tool.anchors) - 1
      const flat = this._unsnapped(s)
      if (k >= 0 && flat && d.points[k]) this._glidePoint(DRAFT_ID, k, flat.point, d.points[k], pane, 'snapGlide')
      if (RING_KINDS.has(s.kind)) this._motion.ring(s.u, s.point.price, pane.id, s.tag)
    }
  }

  _abortCreate(eff) {
    if (eff.ghost && this._preview) this._motion.ghost(this._preview)
    // Dropped, never reused: the ghost keeps painting this slot object.
    this._preview = null
    this._snapShown = null
    this._streamDirty = false
  }

  _create(eff) {
    const h = this._host
    const spec = eff.spec
    const tool = spec ? this._registry.get(spec.type) : null
    const pane = h.paneById(this._fxPaneId) || (this._preview && this._preview.pane)
    this._preview = null
    this._snapShown = null
    this._streamDirty = false
    if (!tool || !pane) return
    const ctx = this._context(pane)
    const options = this._specOptions(spec)
    let points = null
    try { points = this._creationPoints(tool, eff.points || [], eff.drag, ctx, options) } catch (_) { points = null }
    if (!points) return
    const id = this._freshId()
    let d
    try {
      d = normalizeInput({ type: spec.type, pane: pane.id, points, style: this._specStyle(spec), options },
        this._registry, id, this._store.maxZ() + 1)
    } catch (err) {
      h.reportError(err, 'create ' + spec.type)
      return
    }
    this._justCreated = true
    this._apply(new Map([[id, d]]), 'create', 'user', { select: [id] })
    this._motion.commit(id)
    if (spec.type === 'horizontalLine') this._motion.reveal(id, 'hline', pointIndex(h.source, d.points[0], h.timeframeMs))
    else if (spec.type === 'position') this._motion.reveal(id, 'position')
    else if (spec.type === 'fibRetracement') this._motion.reveal(id, 'fib')
    if (eff.edit) this._emitEdit(id)
  }

  // ================================================================ drags

  _beginDrag(eff) {
    const h = this._host
    const d0 = eff.d0
    const tool = d0 ? this._registry.get(d0.type) : null
    const slot = this._slotById.get(eff.id)
    if (!tool || !slot || !slot.pane) return
    this._ensureResolved(slot)
    this._history.breakCoalescing()
    const pane = slot.pane
    const g = {
      id: eff.id, part: eff.part, index: eff.index, d0, tool, pane, clone: !!eff.clone, cloneId: null,
      cur: d0, down: eff.down || { x: 0, y: 0 }, grabPoint: null, grabFwd: NaN, uGrab0: NaN, z: 0,
    }
    if (eff.part === 'body') {
      // The grab in DATA space (§11 contract D): a history prepend renumbers
      // every bar mid-drag, and a grab kept as an index would jump k bars.
      const ps = pane.ps
      const x = clamp(g.down.x, 0, pane.rect.w)
      const y = clamp(g.down.y, pane.rect.y, pane.rect.y + pane.rect.h)
      g.uGrab0 = h.ts.index(x)
      g.grabPoint = pointFromIndex(h.source, g.uGrab0, ps.price(y), h.timeframeMs)
      g.grabFwd = fwdOf(ps.mode, ps.price(y))
    }
    let first = d0
    if (g.clone) {
      g.cloneId = this._freshId()
      g.z = this._store.maxZ() + 1
      first = this._cloneOf(d0, d0.points, g.cloneId, g.z)
      if (!first) return
      g.cur = first
    }
    this._drag = g
    this._dragSlot = this._slotFor(null, g.cloneId || g.id, first, tool, pane)
    if (eff.part === 'handle') this._motion.press(eff.id, eff.index)
  }

  _cloneOf(d0, points, id, z) {
    const row = toJSON(d0)
    row.id = id
    row.points = points
    row.z = z
    try { return normalizeInput(row, this._registry, id, z) } catch (_) { return null }
  }

  /** Row 32: one drag step, recomputed from the start snapshot d0 plus the pointer. */
  _draft(eff) {
    const g = this._drag
    if (!g) return
    const h = this._host
    const slot = this._slotById.get(g.id)
    if (slot) this._ensureResolved(slot)
    const ctx = this._context(g.pane)
    let points = null
    try {
      points = g.part === 'handle' ? g.tool.dragHandle(g.d0, g.index, eff.s, ctx) : this._bodyPoints(eff)
    } catch (err) {
      h.reportError(err, 'drag ' + g.d0.type)
      points = null
    }
    if (!points) return
    let next
    try {
      next = g.clone ? this._cloneOf(g.d0, points, g.cloneId, g.z) : applyPatch(g.d0, { points }, this._registry)
    } catch (_) {
      next = null
    }
    if (!next) return
    const before = g.cur
    // A re-derive that lands where the last step did changes nothing: no
    // stream event, no repaint of the draft.
    if (sameDrawing(before, next)) return
    const id = g.cloneId || g.id
    const paneId = g.pane.id
    const prevSnap = eff.prev || null
    const snap = eff.s
    if (eff.catchUp) {
      // Touch: the jump over the slop glides instead of teleporting.
      for (let k = 0; k < next.points.length; k++) this._glidePoint(id, k, before.points[k], next.points[k], g.pane, 'slop')
    } else if (g.part === 'handle') {
      const engaged = snapChanged(prevSnap, snap)
      if (snap && engaged) this._snapGlide(g, id, ctx, snap, next.points)
      if (snap && engaged && RING_KINDS.has(snap.kind)) this._motion.ring(snap.u, snap.point.price, paneId, snap.tag)
    }
    g.cur = next
    this._dragSlot = this._slotFor(this._dragSlot, id, next, g.tool, g.pane)
    this._streamDirty = true
    this._streamSnap = g.part === 'handle' ? snap : null
  }

  /**
   * The snapped point's own glide: from where the SAME pointer lands with
   * every snap off, to where the snap put it, both at this frame's view.
   *
   * Measured inside one frame on purpose. The old measure ran from the
   * previous frame's drawn point, so a view that jumped in the same frame a
   * snap engaged (setData snapping to realtime, fitContent, setVisibleRange,
   * a keyboard pan) made that jump part of the "glide", and the held handle
   * swept the whole size of it over ~300 ms. Between the snapped and the
   * unsnapped point at one view there is only the snap's own pull. Releasing
   * a snap has nothing to glide from at the same view, so it just lands.
   */
  _snapGlide(g, id, ctx, snap, snapped) {
    const flat = this._unsnapped(snap)
    if (!flat) return
    let free = null
    try {
      free = g.tool.dragHandle(g.d0, g.index, flat, ctx)
    } catch (_) {
      free = null
    }
    if (!free) return
    for (let k = 0; k < snapped.length; k++) this._glidePoint(id, k, free[k], snapped[k], g.pane, 'snapGlide')
  }

  /** The snap result the same pointer gives with no snap (snap.js u0 / price0), or null when it has no point. */
  _unsnapped(snap) {
    const h = this._host
    if (!snap || !Number.isFinite(snap.u0) || !Number.isFinite(snap.price0)) return null
    const point = pointFromIndex(h.source, snap.u0, snap.price0, h.timeframeMs)
    if (!point) return null
    return Object.assign({}, snap, { u: snap.u0, point, kind: 'slot', tag: null, targetId: null, guide: null })
  }

  /**
   * The default dragBody (§11 contract D): every anchor moves by the same
   * crisp bar count and the same forward-price delta, both measured from a
   * grab that lives in data space. Both the grab and d0's anchors are
   * re-resolved against the CURRENT source, so a prepend mid-drag shifts
   * them equally and the body stays under the pointer.
   */
  _bodyPoints(eff) {
    const g = this._drag
    const h = this._host
    const pane = g.pane
    const ts = h.ts
    const ps = pane.ps
    if (!g.grabPoint) return null
    const x = clamp(eff.x, 0, pane.rect.w)
    const y = clamp(eff.y, pane.rect.y, pane.rect.y + pane.rect.h)
    const uGrab = pointIndex(h.source, g.grabPoint, h.timeframeMs)
    let du = Math.round(ts.index(x) - uGrab)
    let dv = fwdOf(ps.mode, ps.price(y)) - g.grabFwd
    if (!Number.isFinite(du) || !Number.isFinite(dv)) return null
    if (eff.shift) {
      // Shift locks a body drag to its dominant axis (§5.5 step 2).
      if (Math.abs(x - g.down.x) >= Math.abs(y - g.down.y)) dv = 0
      else du = 0
    }
    const ctx = this._context(pane)
    if (typeof g.tool.dragBody === 'function') return g.tool.dragBody(g.d0, du, dv, ctx)
    const out = []
    for (const pt of g.d0.points) {
      // dv 0 keeps the stored price bit for bit (log mode's exp(ln p) need not).
      const price = dv === 0 ? pt.price : invOf(ps.mode, fwdOf(ps.mode, pt.price) + dv)
      if (du === 0) { out.push(atPrice(pt, price)); continue }
      const p = pointFromIndex(h.source, pointIndex(h.source, pt, h.timeframeMs) + du, price, h.timeframeMs)
      if (!p) return null
      out.push(p)
    }
    return out
  }

  /** Row 33: commit the dragged id only, as a per-id diff (a clone creates). */
  _endDrag() {
    const g = this._drag
    const ds = this._dragSlot
    this._drag = null
    this._dragSlot = null
    this._motion.press(null)
    this._streamDirty = false
    if (!g) return
    const slot = this._slotById.get(g.id)
    if (slot) this._ensureResolved(slot)
    const next = g.cur
    if (g.clone) {
      if (sameDrawing(this._cloneOf(g.d0, g.d0.points, g.cloneId, g.z), next)) return
      this._apply(new Map([[next.id, next]]), 'duplicate', 'user', { select: [next.id] })
      return
    }
    const cur = this._store.get(g.id)
    if (!cur || cur.inert || sameDrawing(g.d0, next)) return
    if (slot && ds) { slot.fbOutcome = ds.fbOutcome; slot.fbWrong = ds.fbWrong }
    this._apply(new Map([[g.id, next]]), g.part === 'handle' ? 'reshape' : 'move', 'user')
  }

  /** Row 34: spring back to d0, with no history. */
  _revertDrag() {
    const g = this._drag
    const ds = this._dragSlot
    this._drag = null
    this._dragSlot = null
    this._motion.press(null)
    this._streamDirty = false
    if (!g) return
    if (g.clone) {
      if (ds) this._motion.ghost(ds)
      return
    }
    for (let k = 0; k < g.d0.points.length; k++) this._glidePoint(g.id, k, g.cur.points[k], g.d0.points[k], g.pane, 'cancel')
  }

  /** Seed a residual that makes anchor k glide from where `a` is drawn to where `b` is. */
  _glidePoint(id, k, a, b, pane, kind) {
    if (!a || !b || a === b) return
    const h = this._host
    const du = pointIndex(h.source, a, h.timeframeMs) - pointIndex(h.source, b, h.timeframeMs)
    const dv = fwdOf(pane.ps.mode, a.price) - fwdOf(pane.ps.mode, b.price)
    this._motion.glide(id, k, du, dv, kind, pane.id)
  }

  // ================================================================ text editor

  _openEditor(eff) {
    const el = this.chart.container
    if (!el || typeof document === 'undefined') return
    if (this._editor) {
      const old = this._editor
      this._editor = null
      old.handle.close()
    }
    const draft = eff.id == null
    const slot = draft ? this._preview : this._slotById.get(eff.id)
    if (!slot || !slot.d || !slot.pane) return
    this._editingId = draft ? DRAFT_ID : eff.id
    this._editor = { handle: null, id: draft ? null : eff.id, draft: !!draft }
    const d = slot.d
    const th = this._theme || {}
    const box = this._slotBox(slot) || { x: 0, y: 0, w: 40, h: 18 }
    // Synchronously, inside the hook that asked: iOS raises its keyboard only
    // for a focus() made in the user-activation handler itself (§5.8).
    const handle = openTextEditor(el, box, {
      text: d.options && d.options.text != null ? d.options.text : '',
      font: fontSized(th.font, d.style.fontSize > 0 ? d.style.fontSize : 12),
      color: d.style.textColor || th.textColor,
      bg: d.options && d.options.background ? th.labelBg : 'transparent',
    }, {
      commit: () => this._op(() => this._dispatch({ type: 'key', intent: 'commit' })),
      cancel: () => this._op(() => this._dispatch({ type: 'key', intent: 'escape' })),
    })
    if (this._editor) this._editor.handle = handle
  }

  _editorBox() {
    const ed = this._editor
    if (!ed) return null
    const slot = ed.draft ? this._preview : this._slotById.get(ed.id)
    return slot ? this._slotBox(slot) : null
  }

  /** The text box a text drawing painted, else its bounding box. */
  _slotBox(slot) {
    if (slot.pane && !slot.drawn) {
      ONE[0] = slot
      projectSlots(ONE, this._ctxFor, this._motion, false)
      ONE[0] = null
    }
    const g = slot.geom
    if (!g) return null
    if (g.box && Number.isFinite(g.box.x)) return { x: g.box.x, y: g.box.y, w: g.box.w, h: g.box.h }
    const b = g.bbox
    return b ? { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 } : null
  }

  /**
   * Row 38. EDITING_NEW creates the drawing only if the text is non-empty
   * (D25: until then there is nothing a host should store); EDITING commits
   * the new text as one edit.
   */
  _commitEditor(eff) {
    const ed = this._editor
    this._editor = null
    this._editingId = null
    const text = ed && ed.handle ? String(ed.handle.el.value) : null
    if (ed && ed.handle) ed.handle.close()
    const draftSlot = this._preview
    if (eff.draft || (ed && ed.draft)) {
      this._preview = null
      if (text === null || !text.trim()) return
      const spec = eff.draft ? eff.draft.spec : null
      const pane = draftSlot ? draftSlot.pane : null
      if (!spec || !pane || !draftSlot.d) return
      const id = this._freshId()
      const row = toJSON(draftSlot.d)
      row.id = id
      row.options.text = text
      row.z = this._store.maxZ() + 1
      let d
      try { d = normalizeInput(row, this._registry, id, row.z) } catch (_) { return }
      this._apply(new Map([[id, d]]), 'create', 'user', { select: [id] })
      this._motion.commit(id)
      return
    }
    const id = eff.id != null ? eff.id : ed && ed.id
    const d = id != null ? this._store.get(id) : null
    if (!d || d.inert || text === null || text === d.options.text) return
    this._update(id, { options: { text } }, true, false, 'user', 'text')
  }

  _cancelEditor() {
    const ed = this._editor
    this._editor = null
    this._editingId = null
    if (ed && ed.handle) ed.handle.close()
    if (ed && ed.draft) this._preview = null
  }

  // ================================================================ document edits

  _freshId() {
    for (let i = 0; i < 8; i++) {
      const id = String(this._idFactory())
      if (id.length > 0 && id.length <= 128 && !this._store.has(id)) return id
    }
    throw new Error('idFactory returned 8 ids in use')
  }

  _assertPane(paneId) {
    if (this._host && !this._host.paneById(paneId)) throw new Error(`unknown pane "${paneId}"`)
  }

  /**
   * An API mutation that touches (or, with id null, can touch) the drawing a
   * gesture holds aborts that gesture first (§7.3). Edits of OTHER drawings
   * leave it alone: endDrag commits only its own id.
   */
  _external(id) {
    const s = this._state
    if (s.name === 'IDLE' || s.name === 'ARMED' || s.name === 'QM_SHOWN') return
    if (id !== null) {
      const held = s.name === 'EDITING' ? s.editId : s.pressId
      if (held !== id) return
    }
    this._dispatch({ type: 'external', id })
  }

  _update(id, patch, history, animate, source, reason) {
    const prev = this._store.get(id)
    if (!prev || prev.inert) return false
    const next = applyPatch(prev, patch, this._registry)
    if (next.pane !== prev.pane) this._assertPane(next.pane)
    if (sameDrawing(prev, next)) return false
    this._external(id)
    const why = reason || this._reasonOf(prev, next)
    this._apply(new Map([[id, next]]), why, source, { history })
    if (animate) this._morph(id, prev, next)
    return true
  }

  /** The `change` reason of an API update, from what it changed. */
  _reasonOf(a, b) {
    if (JSON.stringify(a.points) !== JSON.stringify(b.points)) return 'reshape'
    if (a.locked !== b.locked) return 'lock'
    if (a.visible !== b.visible) return 'visibility'
    if (a.z !== b.z) return 'order'
    if (JSON.stringify(toJSON(a).style) !== JSON.stringify(toJSON(b).style)) return 'style'
    if (a.options.text !== b.options.text) return 'text'
    return 'options'
  }

  _remove(ids, source, reason, history) {
    const next = new Map()
    for (const id of ids) {
      const e = this._store.get(id)
      if (e && !e.inert) next.set(id, null)
    }
    if (!next.size) return 0
    for (const id of next.keys()) this._external(id)
    this._apply(next, reason, source, { history })
    return next.size
  }

  _duplicate(id, off, source, select) {
    const d = this._store.get(id)
    const h = this._host
    if (!d || d.inert || !h || !h.source.length) return null
    const points = []
    for (const pt of d.points) {
      const p = pointFromIndex(h.source, pointIndex(h.source, pt, h.timeframeMs) + off, pt.price, h.timeframeMs)
      if (!p) return null
      points.push(p)
    }
    const nid = this._freshId()
    const nd = this._cloneOf(d, points, nid, this._store.maxZ() + 1)
    if (!nd) return null
    this._apply(new Map([[nid, nd]]), 'duplicate', source, { select: select ? [nid] : null })
    this._motion.appear(nid)
    return nid
  }

  _reorder(id, front) {
    const d = this._store.get(id)
    if (!d || d.inert) return false
    const list = this._store.list
    const others = list.filter((e) => e.id !== id)
    if (!others.length) return false
    const z = front ? others[others.length - 1].z + 1 : others[0].z - 1
    if (front ? d.z > others[others.length - 1].z : d.z < others[0].z) return false
    return this._update(id, { z }, true, false, 'api', 'order')
  }

  /** Arrow keys: ±1 bar (Shift ±10), and ±1 px of price in fwd space (§5.7). */
  _nudge(du, dv) {
    const h = this._host
    const next = new Map()
    for (const id of this._selection) {
      const d = this._store.get(id)
      const slot = this._slotById.get(id)
      if (!d || d.inert || d.locked || !slot || !slot.pane) continue
      this._ensureResolved(slot)
      const pane = slot.pane
      const ps = pane.ps
      const mode = ps.mode
      const mid = pane.rect.y + pane.rect.h / 2
      const dF = dv ? fwdOf(mode, ps.price(mid - dv)) - fwdOf(mode, ps.price(mid)) : 0
      const points = []
      for (let k = 0; k < d.points.length; k++) {
        const pt = d.points[k]
        const price = dF ? invOf(mode, fwdOf(mode, pt.price) + dF) : pt.price
        const p = du ? pointFromIndex(h.source, slot.u[k] + du, price, h.timeframeMs) : atPrice(pt, price)
        if (!p || !Number.isFinite(p.price)) { points.length = 0; break }
        points.push(p)
      }
      if (!points.length) continue
      let nd
      try { nd = applyPatch(d, { points }, this._registry) } catch (_) { continue }
      for (let k = 0; k < points.length; k++) this._glidePoint(id, k, d.points[k], nd.points[k], pane, 'nudge')
      next.set(id, nd)
    }
    if (!next.size) return
    this._apply(next, 'nudge', 'user', { coalesce: 'nudge:' + [...next.keys()].join(',') })
  }

  /**
   * Apply per-id changes to the store: one history entry and one `change`
   * for the operation (none inside a batch, which records its own). Returns
   * the Change.
   */
  _apply(next, reason, source, opts) {
    const o = opts || {}
    const store = this._store
    const before = new Map()
    for (const id of next.keys()) before.set(id, store.get(id))
    // A removed drawing fades out from where it was: ghost it before its slot goes.
    for (const [id, d] of next) {
      const b = before.get(id)
      if (d || !b || b.inert) continue
      const s = this._slotById.get(id)
      if (s && s.pane && s.drawn) this._motion.ghost(s)
    }
    const selBefore = this._selection
    for (const [id, d] of next) store.put(id, d)
    this._sync()
    if (o.select) this._setSelection(o.select)
    const ch = diff(before, next)
    if (!ch.created.length && !ch.updated.length && !ch.removed.length) return ch
    const b = this._batch
    if (b) {
      for (const [id, d] of before) if (!b.before.has(id)) b.before.set(id, d)
      return ch
    }
    if (o.history !== false) {
      const entry = { before, after: next, selBefore, selAfter: this._selection, reason }
      if (o.coalesce) entry.coalesce = o.coalesce
      this._history.push(entry)
      this._dirty.add('history')
    }
    this._emitChange(source, reason, ch.created, ch.updated, ch.removed)
    return ch
  }

  /** Rebuild the slot list from the store when the document changed (by identity). */
  _sync() {
    const list = this._store.list
    if (list === this._listRef) return
    this._listRef = list
    const slots = []
    const byId = new Map()
    for (const e of list) {
      if (e.inert) continue
      const tool = this._registry.get(e.type)
      let s = this._slotById.get(e.id)
      if (!s || s.tool !== tool) s = newSlot(e.id, tool)
      s.d = e
      slots.push(s)
      byId.set(e.id, s)
    }
    for (const id of this._slotById.keys()) if (!byId.has(id)) this._motion.forget(id)
    this._slots = slots
    this._slotById = byId
    if (this._selection.some((id) => !byId.has(id))) this._setSelection(this._selection.filter((id) => byId.has(id)))
    if (this._host) {
      this._resolveAll()
      this._host.invalidate()
    }
  }

  _undoRedo(undo) {
    const store = this._store
    const before = new Map()
    const old = new Map()
    // Record what each put replaces, so the change and the animation describe
    // the document as it was, {history:false} edits included.
    const rec = {
      put: (id, d) => {
        if (!before.has(id)) {
          before.set(id, store.get(id))
          old.set(id, this._slotById.get(id) || null)
        }
        store.put(id, d)
      },
    }
    const entry = undo ? this._history.undo(rec) : this._history.redo(rec)
    if (!entry) return false
    this._dirty.add('history')
    const after = new Map()
    for (const id of before.keys()) after.set(id, store.get(id))
    for (const [id, b] of before) {
      const s = old.get(id)
      if (b && !after.get(id) && s && s.pane && s.drawn) this._motion.ghost(s)
    }
    this._sync()
    let survivor = null
    for (const [id, a] of after) {
      const b = before.get(id)
      if (!a || a.inert) continue
      if (!survivor) survivor = id
      if (b && !b.inert) this._morph(id, b, a)
      else this._motion.appear(id)
    }
    this._setSelection(survivor ? [survivor] : [])
    const ch = diff(before, after)
    this._emitChange('history', undo ? 'undo' : 'redo', ch.created, ch.updated, ch.removed)
    return true
  }

  /** Glide every anchor of `id` from where `a` put it to where `b` does, plus the "what changed" halo. */
  _morph(id, a, b) {
    const s = this._slotById.get(id)
    const h = this._host
    if (!s || !s.pane || !h) return
    const n = Math.min(a.points.length, b.points.length)
    const pa = new Float64Array(2 * n)
    const pb = new Float64Array(2 * n)
    const mode = s.pane.ps.mode
    for (let k = 0; k < n; k++) {
      pa[2 * k] = pointIndex(h.source, a.points[k], h.timeframeMs)
      pa[2 * k + 1] = fwdOf(mode, a.points[k].price)
      pb[2 * k] = pointIndex(h.source, b.points[k], h.timeframeMs)
      pb[2 * k + 1] = fwdOf(mode, b.points[k].price)
    }
    this._motion.morph(id, pa, pb, s.pane.id)
  }

  /** A load (D13): not an edit. No history, no `change`, a fresh selection. */
  _load(input) {
    return this._install(normalizeEntries(input, this._registry, { maxDrawings: this._opts.maxDrawings }))
  }

  _install(loaded) {
    const { entries, report } = loaded
    const h = this._host
    if (h) {
      for (const e of entries) if (!e.inert && !h.paneById(e.pane)) report.orphaned.push(e.id)
    }
    for (const s of this._slots) this._motion.forget(s.id)
    this._store.replaceAll(entries)
    this._history.clear()
    this._dirty.add('history')
    this._setSelection([])
    this._sync()
    // a load is not an edit: no 'change'
    this.lastLoadReport = report
    return report
  }

  // ================================================================ events

  _emitChange(source, reason, created, updated, removed) {
    if (!this._listeners.change.size) return
    this._queue.push({
      event: 'change',
      payload: {
        source,
        reason,
        created: created.map(toJSON),
        updated: updated.map((u) => ({ before: toJSON(u.before), after: toJSON(u.after) })),
        removed: removed.map(toJSON),
      },
    })
  }

  _emitEdit(id) {
    const d = this._store.get(id)
    if (!d || d.inert || !this._listeners.edit.size) return
    this._queue.push({ event: 'edit', payload: { id, drawing: toJSON(d), box: this._boxOf(id) } })
  }

  _statePayload(event) {
    if (event === 'select') {
      const ids = this._selection.slice()
      return { ids, drawings: ids.map((id) => toJSON(this._store.get(id))) }
    }
    if (event === 'history') {
      const hs = this._history
      return { canUndo: hs.canUndo, canRedo: hs.canRedo, undoSize: hs.undoSize, redoSize: hs.redoSize }
    }
    if (event === 'tool') return { tool: this._toolName, sticky: this._toolSticky }
    if (event === 'box') {
      const id = this._selection.length ? this._selection[0] : null
      return { id, box: id && this._host ? this._boxOf(id) : null }
    }
    return null
  }

  /** A state event: each listener hears it only when it differs from what that listener last heard. */
  _emitState(event, payload) {
    if (event === 'box') this._lastBox = payload
    for (const fn of [...this._listeners[event]]) {
      const seen = this._seen[event].get(fn)
      if (seen && sameState(event, seen, payload)) continue
      this._seen[event].set(fn, payload)
      this._call(event, fn, payload)
    }
  }

  _call(event, fn, payload) {
    try {
      fn(payload)
    } catch (err) {
      console.error(`[Emberwick] 'drawings:${event}' listener threw`, err)
    }
  }

  _notify(event, payload) {
    for (const fn of [...this._listeners[event]]) this._call(event, fn, payload)
  }

  /**
   * Deliver what the operation queued, in the order change → history →
   * select → tool, then the rest. A listener that calls back into the API
   * queues more; the loop delivers that too, in the same order.
   */
  _flush() {
    if (this._flushing) return
    this._flushing = true
    try {
      while (this._queue.length || this._dirty.size) {
        const q = this._queue
        const dirty = this._dirty
        this._queue = []
        this._dirty = new Set()
        for (const it of q) if (it.event === 'change') this._notify('change', it.payload)
        if (dirty.has('history')) this._emitState('history', this._statePayload('history'))
        if (dirty.has('select')) this._emitState('select', this._statePayload('select'))
        if (dirty.has('tool')) this._emitState('tool', this._statePayload('tool'))
        for (const it of q) if (it.event !== 'change') this._notify(it.event, it.payload)
      }
    } finally {
      this._flushing = false
    }
  }

  /** The armed tool, as the `tool` event reports it. */
  _syncTool() {
    const s = this._state
    const spec = s.tool && (ARMED_STATES.has(s.name) || (s.name === 'EDITING_NEW' && s.stickyAfter)) ? s.tool : null
    const name = spec ? spec.preset || spec.type : null
    const sticky = spec ? spec.sticky === true : false
    if (name === this._toolName && sticky === this._toolSticky) return
    this._toolName = name
    this._toolSticky = sticky
    this._dirty.add('tool')
  }

  /** The `drawing` stream (§7.4): at most once per frame, only while a draft changed. */
  _stream() {
    if (!this._streamDirty) return
    this._streamDirty = false
    if (!this._listeners.drawing.size || !this._host) return
    const g = this._drag
    const slot = g ? this._dragSlot : this._preview
    if (!slot || !slot.d) return
    const phase = g ? (g.part === 'handle' ? 'reshape' : 'move') : 'create'
    const drawing = toJSON(slot.d)
    // Not stored yet: a draft has no id a host could look up.
    if (!g) drawing.id = null
    const s = this._streamSnap
    this._notify('drawing', { phase, drawing, snap: s ? { kind: s.kind, tag: s.tag } : null, stats: this._statsOf(slot.d) })
  }

  _statsOf(d) {
    const h = this._host
    const pts = d.points
    const p0 = pts[0]
    const p1 = pts.length > 1 ? pts[1] : p0
    const u0 = pointIndex(h.source, p0, h.timeframeMs)
    const u1 = pointIndex(h.source, p1, h.timeframeMs)
    const t0 = indexToTime(h.source, u0, h.timeframeMs)
    const t1 = indexToTime(h.source, u1, h.timeframeMs)
    const change = p1.price - p0.price
    return {
      from: p0.price,
      to: p1.price,
      change,
      changePct: p0.price !== 0 ? (change / Math.abs(p0.price)) * 100 : null,
      bars: Number.isFinite(u0) && Number.isFinite(u1) ? Math.abs(u1 - u0) : null,
      durationMs: t0 != null && t1 != null ? t1 - t0 : null,
      approx: !!(p0.offset || p1.offset),
    }
  }

  /**
   * Motion the tools cannot start themselves (they are pure): a position's
   * outcome path draws in when its outcome changes, a one-shot pulse on the
   * transition into a wrong-side stop (D21), and the eased flip of a stats
   * pill that changed sides.
   */
  _feedback() {
    for (const s of this._slots) {
      if (s !== this._dragSlot && this._drag && s.id === this._drag.id) continue
      this._feedOne(s)
    }
    if (this._dragSlot) this._feedOne(this._dragSlot)
  }

  _feedOne(s) {
    const g = s.geom
    if (!s.drawn || !g) return
    if (g.outcomeKind !== undefined) {
      if (s.fbOutcome !== undefined && g.outcomeKind && g.outcomeKind !== s.fbOutcome) this._motion.outcome(s.id)
      s.fbOutcome = g.outcomeKind
      if (s.fbWrong === false && g.wrong === true) this._motion.warn(s.id)
      s.fbWrong = g.wrong === true
    }
    if (g.statsSide === 1 || g.statsSide === -1) this._motion.labelSide(s.id, g.statsSide)
  }

  _boxOf(id) {
    const s = this._drag && (this._drag.id === id) && this._dragSlot ? this._dragSlot : this._slotById.get(id)
    if (!s || !s.pane) return null
    if (s !== this._dragSlot) this._ensureResolved(s)
    const g = s.geom
    if (!s.drawn || !g || !g.bbox) return null
    const b = g.bbox
    if (!Number.isFinite(b.x0) || !Number.isFinite(b.y0) || !Number.isFinite(b.x1) || !Number.isFinite(b.y1)) return null
    return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }
  }

  // ================================================================ options

  _applyOptions(o) {
    const t = this._opts
    if ('magnet' in o && MAGNETS.has(o.magnet)) t.magnet = o.magnet
    if ('stickyTools' in o) t.stickyTools = o.stickyTools === true
    if ('quickMeasure' in o) t.quickMeasure = o.quickMeasure !== false
    if ('keyboard' in o) t.keyboard = o.keyboard !== false
    if ('textEditor' in o) t.textEditor = o.textEditor !== false
    if ('historyLimit' in o && Number.isFinite(o.historyLimit) && o.historyLimit >= 0) t.historyLimit = Math.floor(o.historyLimit)
    if ('motion' in o && MOTION_MODES.has(o.motion)) t.motion = o.motion
    if ('prefersReducedMotion' in o) t.prefersReducedMotion = typeof o.prefersReducedMotion === 'function' ? o.prefersReducedMotion : null
    if ('readOnly' in o) t.readOnly = o.readOnly === true
    if ('theme' in o) t.theme = isPlainObject(o.theme) ? Object.assign({}, o.theme) : null
    if ('maxDrawings' in o && Number.isFinite(o.maxDrawings) && o.maxDrawings >= 0) t.maxDrawings = Math.floor(o.maxDrawings)
    if ('idFactory' in o && typeof o.idFactory === 'function') this._idFactory = o.idFactory
    if ('platform' in o && (o.platform === 'mac' || o.platform === 'other')) this._invertKey = o.platform === 'mac' ? 'metaKey' : 'ctrlKey'
    if ('defaults' in o && isPlainObject(o.defaults)) {
      for (const type of Object.keys(o.defaults)) this.setDefaults(type, o.defaults[type])
    }
  }

  _resolveMode(animate) {
    const m = this._opts.motion
    if (m !== 'auto') return m
    if (!animate) return 'none'
    return this._prefersReduced() ? 'reduced' : 'full'
  }

  _prefersReduced() {
    const fn = this._opts.prefersReducedMotion
    if (fn) {
      try { return !!fn() } catch (_) { return false }
    }
    return this._mqReduced
  }

  /** §6.4: 'auto' follows host.animate (read every tick) and prefers-reduced-motion. */
  _syncMode() {
    this._motion.setMode(this._resolveMode(this._host.animate))
  }
}
