/**
 * The drawing interaction state machine (§5.2), as a pure reducer.
 *
 *   reduce(state, event, env) -> { state, effects, result }
 *
 * Every pointer, key and API event that could change what a gesture is doing
 * comes through here, and nothing else decides it. The reducer never touches
 * the chart, the store, the DOM or a clock: it reads the world only through
 * `env` (hit testing, snapping, the selection) and describes what should
 * happen as a list of plain `effects`, which the controller executes in order.
 * `result` is the boolean the plugin hook returns to the core: claimed (a
 * pointerDown), consumed (a tap, a key, a double-click).
 *
 * Why a reducer and not methods on the controller: the gesture rules are the
 * part of a drawing tool that is hardest to get right and easiest to break —
 * a finger that should pan but drags, a pinch that flashes a ghost, an Esc
 * that leaves a half-dragged handle behind. As a pure function every row of
 * the spec's table is one assertion in a test, with no chart, no canvas and
 * no timers in the way, and a state is just data that can be logged.
 *
 * Determinism: time only ever arrives as `e.timeStamp` on the events, and the
 * only state is what is returned. The same events and env give the same
 * effects, every time.
 *
 * States: IDLE, PRESSED, DRAG_HANDLE, DRAG_BODY, ARMED, PRESS_CREATE,
 * CREATE_DRAG, PLACING, QM_DRAG, QM_SHOWN, EDITING, EDITING_NEW.
 *
 * The state object is opaque to the controller apart from `name`, `ptr` (the
 * stored pointer, whose modifier keys the controller may update before a
 * `rederive`) and ownsPress(). It is never mutated: every transition returns
 * a new object.
 *
 * Effects are the §11 union, with a few fields added so the controller never
 * has to keep a shadow copy of gesture state:
 *   preview      + spec, drag (17a's Snapped), prev (last SnapState, for the
 *                  snap-kind glide), editing (a text draft under its editor)
 *   dragTo       + prev, x, y, shift (the raw pointer, for dragBody's axis
 *                  lock), catchUp (first step of a touch drag: glide the slop)
 *   beginDrag    + down (the press point: a body drag's grab is taken there)
 *   create       + edit (textEditor:false: emit 'edit' for the new text)
 *   openEditor / commitEditor / cancelEditor  + id, draft ({ spec, points })
 *   hover        + part
 * and one key intent beyond keys.js's: 'commit', dispatched by the controller
 * when the text editor itself commits (Enter or blur).
 */
import { tolerance } from './tolerance.js'

export function initialState() {
  return {
    name: 'IDLE',
    /** The armed ToolSpec, kept through creation so a sticky tool re-arms. */
    tool: null,
    /** Anchors placed so far in a creation (k in the spec's table). */
    k: 0,
    points: [],
    /** The Snapped each placed point came from: its u, and where it was drawn. */
    snaps: [],
    /** A touch press recorded but not yet shown (row 15t). */
    latent: false,
    /** This press continues a click-click creation (it came from PLACING). */
    clickMode: false,
    /** CREATE_DRAG: index of the point that follows the pointer. */
    dragIndex: -1,
    /** The current Snapped of the point following the pointer. */
    follow: null,
    pressId: null,
    pressWasSelected: false,
    part: null,
    index: -1,
    cursor: null,
    d0: null,
    grab: null,
    down: null,
    downT: 0,
    pointerType: 'mouse',
    pressAlt: false,
    paneId: null,
    ptr: null,
    prevSnap: null,
    drag: null,
    measure: null,
    draft: null,
    editId: null,
    stickyAfter: false,
    lastCreate: null,
    /** A down was claimed and its up/cancel has not arrived. */
    owned: false,
  }
}

/**
 * Whether the machine still owns the press it last claimed. The controller's
 * pointerDown returns `result && ownsPress(state)` AFTER running the effects:
 * a host 'select' listener that removes the drawing re-entrantly aborts the
 * gesture (an `external` event), and the core must not record an owner that
 * is already gone.
 */
export function ownsPress(s) {
  return !!s && s.owned === true
}

// ------------------------------------------------------------------ helpers

const with_ = (s, patch) => Object.assign({}, s, patch)

function same(s) {
  return { state: s, effects: [], result: false }
}

/** A press the core should handle as its own (pan, scrub, tap, axis scale). */
function unclaimed(s, effects) {
  return { state: s, effects: effects || [], result: false }
}

/** Claim the press but do nothing with it (a double-click's second down, a same-slot re-click). */
function claimedNoop(s) {
  return { state: with_(s, { owned: true }), effects: [{ type: 'claim' }], result: true }
}

const consumed = (s, effects) => ({ state: s, effects, result: true })
const RELEASE = () => ({ type: 'release' })

const isDragging = (s) => s.name === 'DRAG_HANDLE' || s.name === 'DRAG_BODY'
const isEditing = (s) => s.name === 'EDITING' || s.name === 'EDITING_NEW'
const isCreating = (s) => s.name === 'PRESS_CREATE' || s.name === 'CREATE_DRAG' || s.name === 'PLACING'
const isMeasuring = (s) => s.name === 'QM_DRAG' || s.name === 'QM_SHOWN'
const liveMeasure = (s) => s.name === 'QM_SHOWN' && !!s.measure && s.measure.live === true

const selectionOf = (env) => env.selection || []
const isSelected = (env, id) => selectionOf(env).indexOf(id) >= 0

function toolDef(env, type) {
  const t = env.tools
  if (!t || type == null) return null
  return (typeof t.get === 'function' ? t.get(type) : t[type]) || null
}

/** A spec's own `sticky` wins; otherwise the controller's default (options.stickyTools). */
const stickyOf = (spec, env) => (spec && typeof spec.sticky === 'boolean' ? spec.sticky : !!env.sticky)

const travel = (a, x, y) => Math.max(Math.abs(x - a.x), Math.abs(y - a.y))

/** The stored pointer (§5.3): enough to replay the snap with no event in hand. */
function ptrOf(e) {
  return {
    x: e.x,
    y: e.y,
    pointerType: e.pointerType,
    shiftKey: !!e.shiftKey,
    altKey: !!e.altKey,
    ctrlKey: !!e.ctrlKey,
    metaKey: !!e.metaKey,
    region: e.region || 'plot',
    paneId: e.pane ? e.pane.id : null,
  }
}

/** A PluginPointer-shaped event rebuilt from the stored pointer, for re-derive. */
function pointerFrom(ptr, env) {
  return {
    x: ptr.x,
    y: ptr.y,
    pointerId: 0,
    pointerType: ptr.pointerType,
    button: 0,
    buttons: 0,
    shiftKey: ptr.shiftKey,
    altKey: ptr.altKey,
    ctrlKey: ptr.ctrlKey,
    metaKey: ptr.metaKey,
    region: ptr.region || 'plot',
    pane: env.paneAt ? env.paneAt(ptr.y) : null,
    timeStamp: 0,
    event: null,
  }
}

/** Snap a pointer through the controller (§5.5); the machine supplies the per-gesture options. */
function snapAt(env, x, y, e, opts) {
  const invertKey = env.invertKey || 'ctrlKey'
  return env.snap({
    x,
    y,
    pointerType: e.pointerType,
    shift: !!e.shiftKey,
    alt: !!e.altKey,
    invert: !!e[invertKey],
  }, opts)
}

/** A placed Snapped as the ScreenAnchor-shaped origin of an angle constraint. */
function anchorOf(sn) {
  const p = sn.point
  return { x: sn.x, y: sn.y, u: sn.u, time: p.time, price: p.price, approx: !!p.offset, point: p }
}

/**
 * Snap point `index` of the drawing being created. Shift constrains the
 * second anchor's angle from the first; the third (a channel's width) has no
 * angle, and is offered the channel's auto-fit instead — `placing` tells the
 * controller which point this is, and it supplies the fit target (§5.5 step 4).
 */
function snapCreate(s, env, x, y, e, index, prev) {
  const origin = index === 1 && s.snaps[0] ? anchorOf(s.snaps[0]) : undefined
  return snapAt(env, x, y, e, {
    paneId: s.paneId,
    origin,
    tool: toolDef(env, s.tool && s.tool.type),
    placing: index,
    prev,
    allowAngle: !!origin,
    fit: null,
  })
}

function previewFx(s, points, sn, drag) {
  return {
    type: 'preview',
    toolType: s.tool ? s.tool.type : null,
    spec: s.tool,
    points,
    s: sn,
    ephemeral: false,
    drag: drag || null,
    prev: s.prevSnap || null,
  }
}

const hidePreview = (s) => ({
  type: 'preview', toolType: s.tool ? s.tool.type : null, spec: s.tool, points: s.points, s: null, ephemeral: false, hidden: true,
})

/** The ephemeral quick-measure preview (§5.6): never in the document, the history or the events. */
function measureFx(m, effects) {
  if (m) {
    effects.push({
      type: 'preview',
      toolType: 'measure',
      points: [m.p0.point, m.p1.point],
      s: m.p1,
      ephemeral: true,
    })
  }
  return effects
}

const rippleFx = (sn, paneId) => ({ type: 'ripple', u: sn.u, price: sn.point.price, paneId })

/** Back to IDLE, keeping nothing of the gesture. */
const idle = () => initialState()

/** Back to ARMED with the same tool: placed points and the press are forgotten. */
function armed(s) {
  return with_(initialState(), { name: 'ARMED', tool: s.tool, lastCreate: s.lastCreate })
}

// ------------------------------------------------------------------ hover

/** The cursor a hover asks for (§5.9). null defers to the core (marker, then crosshair). */
function hoverCursor(hit, e, env) {
  if (!hit) return null
  if (hit.locked) return hit.part === 'fill' ? null : 'pointer'
  if (env.readOnly) return 'pointer'
  const selected = isSelected(env, hit.id)
  // An unselected line's axis tag selects on click but does not drag (§4.3).
  if (hit.part === 'tag' && !selected) return 'pointer'
  if (selected && hit.part !== 'handle' && hit.part !== 'move' && e.altKey && e.pointerType !== 'touch') return 'copy'
  if (hit.cursor != null) return hit.cursor
  return selected ? 'move' : 'pointer'
}

function hoverIdle(s, e, env) {
  const hit = env.hitAt(e.x, e.y, e.pointerType)
  return {
    state: s,
    effects: [
      { type: 'hover', id: hit ? hit.id : null, part: hit ? hit.part : null },
      { type: 'cursor', css: hoverCursor(hit, e, env) },
      // The crosshair is the core's own (raw, slot- and magnet-snapped) here.
      { type: 'crosshair', s: null },
    ],
    result: false,
  }
}

/** Row 14: the reticle at the snapped point, and the crosshair exactly on it. */
function hoverArmed(s, e, env) {
  const s1 = with_(s, { ptr: ptrOf(e) })
  // Over an axis the tool would place nothing (a press there scales the
  // axis), so no reticle pretends otherwise.
  const pane = e.region === 'plot' || e.region == null ? e.pane : null
  const sn = pane && env.paneReady(pane)
    ? snapAt(env, e.x, e.y, e, {
      paneId: pane.id, tool: toolDef(env, s.tool.type), placing: 0, prev: s.prevSnap, allowAngle: false, fit: null,
    })
    : null
  if (!sn) {
    return {
      state: with_(s1, { prevSnap: null, paneId: null }),
      effects: [hidePreview(s1), { type: 'crosshair', s: null }, { type: 'cursor', css: 'crosshair' }],
      result: false,
    }
  }
  const s2 = with_(s1, { prevSnap: sn.state, paneId: pane.id })
  return {
    state: s2,
    effects: [previewFx(s1, [], sn), { type: 'crosshair', s: sn }, { type: 'cursor', css: 'crosshair' }],
    result: false,
  }
}

/** Row 22: the next point follows the pointer on the latched pane. */
function hoverPlacing(s, e, env) {
  const s1 = with_(s, { ptr: ptrOf(e) })
  const sn = snapCreate(s1, env, e.x, e.y, e, s.points.length, s.prevSnap)
  if (!sn) return { state: s1, effects: [], result: false }
  return {
    state: with_(s1, { follow: sn, prevSnap: sn.state }),
    // The draft this draws carries an accent axis tag for the point that
    // follows the pointer, so the core's own tag would describe it twice.
    effects: [previewFx(s1, s.points.concat([sn.point]), sn), { type: 'crosshair', s: sn, tags: false }, { type: 'cursor', css: 'crosshair' }],
    result: false,
  }
}

/** A click-click quick measure: its far end follows the pointer until the second click. */
function hoverMeasure(s, e, env) {
  const m = s.measure
  const sn = snapAt(env, e.x, e.y, e, {
    paneId: m.paneId, tool: toolDef(env, 'measure'), placing: 1, prev: s.prevSnap, allowAngle: false, fit: null,
  })
  const s1 = with_(s, { ptr: ptrOf(e) })
  if (!sn) return { state: s1, effects: [], result: false }
  const m1 = with_(m, { p1: sn })
  return {
    state: with_(s1, { measure: m1, prevSnap: sn.state }),
    effects: measureFx(m1, [{ type: 'crosshair', s: sn }, { type: 'cursor', css: 'crosshair' }]),
    result: false,
  }
}

function onHover(s, ev, env) {
  const e = ev.e
  if (!e) {
    if (s.name === 'ARMED' || s.name === 'PLACING') {
      // Row 14a. The pointer left (or a plugin above took it): hide the
      // reticle, keep every placed anchor, and forget the pointer so nothing
      // re-derives from a place the mouse no longer is.
      return {
        state: with_(s, { ptr: null, prevSnap: null }),
        effects: [hidePreview(s), { type: 'crosshair', s: null }],
        result: false,
      }
    }
    if (s.name === 'IDLE') {
      return { state: s, effects: [{ type: 'hover', id: null, part: null }, { type: 'cursor', css: null }], result: false }
    }
    if (s.name !== 'QM_SHOWN') return same(s)
    // Row 37. A shown measure is something the reader is reading: moving to
    // the host's own UI (the pointer leaving the chart) must not erase it.
    // Only a pan dismisses it, because the measured bars slide away under it.
    if (ev.reason !== 'pan') return same(s)
    return { state: idle(), effects: [{ type: 'dismissMeasure' }], result: false }
  }
  if (s.name === 'IDLE') return hoverIdle(s, e, env)
  if (s.name === 'ARMED') return hoverArmed(s, e, env)
  if (s.name === 'PLACING') return hoverPlacing(s, e, env)
  if (liveMeasure(s)) return hoverMeasure(s, e, env)
  if (s.name === 'QM_SHOWN') return hoverIdle(with_(s, { ptr: ptrOf(e) }), e, env)
  return same(s)
}

/** Re-run the hover of ARMED / PLACING / a live measure from the stored pointer (row 40). */
function hoverFrom(s, ptr, env) {
  return onHover(s, { type: 'hover', e: pointerFrom(ptr, env) }, env)
}

// ------------------------------------------------------------------ down

function onDown(s, ev, env) {
  const e = ev.e
  if (!e) return same(s)
  if (s.name !== 'IDLE') {
    // Row 38a. The container's pointerdown arrives BEFORE the textarea's
    // blur: commit the text now, then handle the press as if from IDLE.
    if (isEditing(s)) return redispatch(commitEditor(s), ev, env)
    // The core cancels a live owner before offering a new down; this is the
    // belt to that brace, so a press can never land in the middle of a drag.
    if (s.owned && s.name !== 'ARMED' && s.name !== 'PLACING') return redispatch(onCancel(s), ev, env)
  }
  switch (s.name) {
    case 'IDLE': return downIdle(s, ev, env)
    case 'ARMED': return downArmed(s, e, env)
    case 'PLACING': return downPlacing(s, e, env)
    case 'QM_SHOWN': return downMeasureShown(s, e, env)
    default: return unclaimed(s)
  }
}

function redispatch(r, ev, env) {
  const r2 = reduce(r.state, ev, env)
  return { state: r2.state, effects: r.effects.concat(r2.effects), result: r2.result }
}

/** Rows 2–7. */
function downIdle(s, ev, env) {
  const e = ev.e
  const touch = e.pointerType === 'touch'
  if (e.button !== 0) return unclaimed(s)
  const hit = env.hitAt(e.x, e.y, e.pointerType)
  if (hit) {
    // Touch claims only what the finger has already selected, and never a
    // fill: on a phone most of a selected box is fill, and a one-finger swipe
    // there has to pan (and a long press has to scrub).
    const selected = isSelected(env, hit.id)
    // D23: locked drawings never claim, so the chart pans straight through a
    // full-width locked fib. A locked handle also refuses visibly.
    if (hit.locked && hit.part === 'handle') return unclaimed(s, [{ type: 'shake', id: hit.id }])
    if (hit.locked) return unclaimed(s)
    if (touch && !selected) return unclaimed(s)
    if (touch && hit.part === 'fill') return unclaimed(s)
    // An unselected horizontal line's axis tag: the press scales the axis as
    // usual; a click on it selects the line (row 8).
    if (hit.part === 'tag' && !selected) return unclaimed(s)
    return pressDrawing(s, e, hit, env, selected)
  }
  // Row 6: Shift+press on empty plot measures, ephemerally.
  if (e.shiftKey && !touch && e.region === 'plot' && env.quickMeasure && e.pane && env.paneReady(e.pane)) {
    return startMeasure(s, e, env)
  }
  return unclaimed(s)
}

/** A press the machine takes (rows 2, 4): select on down, then wait for the slop. */
function pressDrawing(s, e, hit, env, selected) {
  const touch = e.pointerType === 'touch'
  if (env.readOnly) return unclaimed(s)
  const d0 = env.drawing(hit.id)
  if (!d0) return unclaimed(s)
  const handle = hit.part === 'handle' && Number.isFinite(hit.hx) && Number.isFinite(hit.hy)
  const effects = [{ type: 'claim' }]
  if (!(selectionOf(env).length === 1 && selected)) effects.push({ type: 'select', ids: [hit.id] })
  const s1 = with_(initialState(), {
    name: 'PRESSED',
    pressId: hit.id,
    pressWasSelected: selected,
    part: hit.part,
    index: hit.index,
    cursor: hit.cursor,
    d0,
    // Grab offset (§5.2): snapping runs at pointer + grab, so a handle never
    // jumps to centre itself under the finger that took it off-centre.
    grab: handle ? { dx: hit.hx - e.x, dy: hit.hy - e.y } : { dx: 0, dy: 0 },
    down: { x: e.x, y: e.y },
    downT: e.timeStamp > 0 ? e.timeStamp : 0,
    pointerType: e.pointerType,
    // Alt at PRESS decides a clone, not Alt at the slop crossing.
    pressAlt: !!e.altKey && !touch,
    paneId: d0.pane,
    ptr: ptrOf(e),
    owned: true,
  })
  return consumed(s1, effects)
}

/** Rows 15, 15a, 15b, 15t. */
function downArmed(s, e, env) {
  if (e.button !== 0 || e.region !== 'plot' || !e.pane || !env.paneReady(e.pane)) return unclaimed(s)
  const tool = toolDef(env, s.tool && s.tool.type)
  if (!tool) return unclaimed(s)
  if (s.lastCreate) {
    // The second down of a double-click with a sticky single-click tool.
    if (isRepeatPress(s.lastCreate, e, env)) return claimedNoop(s)
  }
  const s1 = beginPress(s, e, e.pane.id, false)
  if (s1.latent) return consumed(s1, [{ type: 'claim' }])
  const sn = snapCreate(s1, env, e.x, e.y, e, 0, null)
  if (!sn) return unclaimed(s)
  const s2 = placed(s1, sn)
  return consumed(s2, [
    { type: 'claim' },
    previewFx(s2, s2.points, sn),
    { type: 'crosshair', s: sn, tags: false },
  ])
}

/**
 * Row 15a. A habitual double-click with a sticky single-click tool makes ONE
 * drawing: the second down, within 500 ms of the last create, within slop of
 * the press that made it, on the same bar slot and pane, is swallowed. A
 * missing timeStamp (0) on either press never matches, so a test event or an
 * odd browser can only ever create too much, never silently too little.
 */
function isRepeatPress(lc, e, env) {
  if (!lc || !(lc.t > 0) || !(e.timeStamp > 0)) return false
  const dt = e.timeStamp - lc.t
  if (dt < 0 || dt > 500) return false
  if (!e.pane || e.pane.id !== lc.paneId) return false
  if (travel(lc, e.x, e.y) >= tolerance(e.pointerType).slop) return false
  const sn = snapAt(env, e.x, e.y, e, {
    paneId: lc.paneId, tool: null, placing: 0, prev: null, allowAngle: false, fit: null,
  })
  return !!sn && Math.round(sn.u) === Math.round(lc.u)
}

/** A creation press: the latched pane and the down point. Nothing placed yet. */
function beginPress(s, e, paneId, clickMode) {
  const s1 = Object.assign({}, s, {
    name: 'PRESS_CREATE',
    // Touch presses are latent (row 15t): the first finger of every pinch
    // lands tens of ms before the second, and placing on the down would flash
    // a ripple and a ghost for a gesture that was never a drawing.
    latent: e.pointerType === 'touch',
    clickMode,
    dragIndex: -1,
    paneId,
    down: { x: e.x, y: e.y },
    downT: e.timeStamp > 0 ? e.timeStamp : 0,
    pointerType: e.pointerType,
    ptr: ptrOf(e),
    prevSnap: null,
    drag: null,
    grab: null,
    owned: true,
  })
  return s1
}

/** Append a placed point. */
function placed(s, sn) {
  const points = s.points.concat([sn.point])
  return with_(s, { points, snaps: s.snaps.concat([sn]), k: points.length })
}

/** Row 23 (and its touch form). */
function downPlacing(s, e, env) {
  // A press on an axis while placing is the axis's (scale it, then carry on).
  if (e.button !== 0 || e.region !== 'plot') return unclaimed(s)
  const touch = e.pointerType === 'touch'
  if (touch) {
    // Latent like the first press: a pinch between taps must not place.
    return consumed(beginPress(s, e, s.paneId, true), [{ type: 'claim' }])
  }
  const sn = snapCreate(s, env, e.x, e.y, e, s.points.length, null)
  if (!sn) return claimedNoop(s)
  if (repeatsLast(s, e, sn)) return claimedNoop(s)
  const s2 = placed(beginPress(s, e, s.paneId, true), sn)
  return consumed(s2, [
    { type: 'claim' },
    previewFx(s2, s2.points, sn),
    { type: 'crosshair', s: sn, tags: false },
  ])
}

/**
 * A second click on the point just placed (the tail of a double-click, or a
 * hesitant re-click) places nothing: a zero-length trendline is never what
 * the reader meant.
 */
function repeatsLast(s, e, sn) {
  const last = s.snaps[s.snaps.length - 1]
  if (!last) return false
  return travel(last, e.x, e.y) < tolerance(e.pointerType).slop && Math.round(sn.u) === Math.round(last.u)
}

// ------------------------------------------------------------------ move

function onMove(s, ev, env) {
  const e = ev.e
  if (!e) return same(s)
  switch (s.name) {
    case 'PRESSED': return movePressed(s, e, env)
    case 'DRAG_HANDLE':
    case 'DRAG_BODY': return dragStep(s, e, env, false)
    case 'PRESS_CREATE': return movePressCreate(s, e, env)
    case 'CREATE_DRAG': return createDragStep(s, e, env)
    case 'QM_DRAG': return measureDragStep(s, e, env)
    // The owner of a swallowed click (claimedNoop) keeps hovering.
    case 'ARMED':
    case 'PLACING': return onHover(s, { type: 'hover', e }, env)
    default: return same(s)
  }
}

/** Rows 28–30. Below the slop nothing happens; past it the drag starts. */
function movePressed(s, e, env) {
  const tol = tolerance(s.pointerType)
  if (travel(s.down, e.x, e.y) < tol.slop) return { state: with_(s, { ptr: ptrOf(e) }), effects: [], result: true }
  const handle = s.part === 'handle'
  const clone = !handle && s.pressAlt
  const s1 = with_(s, { name: handle ? 'DRAG_HANDLE' : 'DRAG_BODY', prevSnap: null })
  const effects = [
    {
      type: 'beginDrag',
      id: s.pressId,
      part: handle ? 'handle' : 'body',
      index: handle ? s.index : -1,
      grab: s.grab,
      clone,
      d0: s.d0,
      // Where the press began: a body drag's data-space grab is taken HERE,
      // not at the slop crossing, or the drawing would trail by the slop.
      down: s.down,
    },
    { type: 'setCursor', css: handle ? (s.cursor && s.cursor !== 'grab' ? s.cursor : 'grabbing') : clone ? 'copy' : 'move' },
  ]
  const r = dragStep(s1, e, env, s.pointerType === 'touch')
  return { state: r.state, effects: effects.concat(r.effects), result: true }
}

/**
 * Row 32: one step of a handle or body drag, from the start snapshot plus the
 * pointer (the controller recomputes from d0; nothing accumulates here).
 *
 * A handle snaps at pointer + grab, with its tool's angle origin for Shift.
 * A body drag passes the raw pointer (snapped as 'free'): the controller
 * moves every anchor by the same crisp bar count and price delta (§11,
 * dragBody), and the raw x/y and Shift ride along for its dominant-axis lock.
 * `catchUp` marks the first step of a touch drag, whose jump over the slop
 * the controller glides instead of snapping.
 */
function dragStep(s, e, env, catchUp) {
  const s1 = with_(s, { ptr: ptrOf(e) })
  let sn
  if (s.name === 'DRAG_HANDLE') {
    const tool = toolDef(env, s.d0 && s.d0.type)
    const oi = tool && typeof tool.angleOrigin === 'function' ? tool.angleOrigin(s.d0, s.index) : -1
    const anchors = oi >= 0 && env.anchorsOf ? env.anchorsOf(s.pressId) : null
    const origin = anchors && anchors[oi] ? anchors[oi] : undefined
    sn = snapAt(env, e.x + s.grab.dx, e.y + s.grab.dy, e, {
      paneId: s.paneId,
      origin,
      excludeId: s.pressId,
      handle: s.index,
      tool,
      prev: s.prevSnap,
      allowAngle: !!origin,
      fit: null,
    })
  } else {
    sn = env.snap({ x: e.x, y: e.y, pointerType: e.pointerType, shift: false, alt: true, invert: false }, {
      paneId: s.paneId, excludeId: s.pressId, tool: toolDef(env, s.d0 && s.d0.type), prev: null, allowAngle: false, fit: null,
    })
  }
  // Zero bars, or the pane went away mid-drag: hold still rather than store NaN.
  if (!sn) return { state: s1, effects: [], result: true }
  const step = { type: 'dragTo', s: sn, prev: s.prevSnap, x: e.x, y: e.y, shift: !!e.shiftKey }
  if (catchUp) step.catchUp = true
  return {
    state: with_(s1, { prevSnap: s.name === 'DRAG_HANDLE' ? sn.state : null }),
    effects: [step, { type: 'crosshair', s: sn, tags: false }],
    result: true,
  }
}

/** Rows 17, 17a: the press became a drag. */
function movePressCreate(s, e, env) {
  const tol = tolerance(s.pointerType)
  if (travel(s.down, e.x, e.y) < tol.slop) return { state: with_(s, { ptr: ptrOf(e) }), effects: [], result: true }
  const tool = toolDef(env, s.tool && s.tool.type)
  if (!tool) return { state: s, effects: [], result: true }
  const single = tool.creation === 'single'
  const effects = []
  let s1 = s
  let dragIndex
  let grab = null
  if (s.clickMode) {
    if (s.latent) {
      // Touch, placing the next point of a tap-tap creation. The width point
      // of a channel (index 2) is a RELATIVE drag of its preview, so the
      // finger never covers the line it is adjusting; any other point simply
      // goes where the finger is.
      const f = s.follow
      dragIndex = s.points.length
      grab = f && dragIndex >= 2 ? { dx: f.x - s.down.x, dy: f.y - s.down.y } : null
    } else {
      // Mouse: the click placed point k at the down; the drag adjusts it.
      dragIndex = s.points.length - 1
    }
  } else {
    if (s.latent) {
      // Row 17: P0 goes where the finger went DOWN, now that this is a drag.
      const sn0 = snapCreate(s, env, s.down.x, s.down.y, e, 0, null)
      if (!sn0) return { state: s, effects: [], result: true }
      s1 = placed(s, sn0)
      effects.push(rippleFx(sn0, s.paneId))
    }
    // A single-click tool without press-drag creation just follows with its
    // one point; press-drag (position, 17a) keeps P0 and reads the drag.
    dragIndex = single ? (tool.dragCreate ? -1 : 0) : 1
  }
  const s2 = with_(s1, { name: 'CREATE_DRAG', latent: false, dragIndex, grab, prevSnap: null })
  const r = createDragStep(s2, e, env)
  return { state: r.state, effects: effects.concat(r.effects), result: true }
}

/** The point following the pointer in CREATE_DRAG, and the preview it makes. */
function createDragStep(s, e, env) {
  const s1 = with_(s, { ptr: ptrOf(e) })
  const gx = s.grab ? s.grab.dx : 0
  const gy = s.grab ? s.grab.dy : 0
  const index = s.dragIndex < 0 ? 1 : s.dragIndex
  const sn = snapCreate(s1, env, e.x + gx, e.y + gy, e, index, s.prevSnap)
  if (!sn) return { state: s1, effects: [], result: true }
  const s2 = with_(s1, { follow: sn, prevSnap: sn.state, drag: s.dragIndex < 0 ? sn : null })
  const points = s.dragIndex < 0 ? s.points : s.points.slice(0, s.dragIndex).concat([sn.point])
  return {
    state: s2,
    effects: [previewFx(s1, points, sn, s.dragIndex < 0 ? sn : null), { type: 'crosshair', s: sn, tags: false }],
    result: true,
  }
}

// ------------------------------------------------------------------ up

function onUp(s, ev, env) {
  const e = ev.e
  if (!e) return same(s)
  switch (s.name) {
    case 'PRESSED': return upPressed(s, e, env)
    case 'DRAG_HANDLE':
    case 'DRAG_BODY': return upDrag(s, e, env)
    case 'PRESS_CREATE': return upPressCreate(s, e, env)
    case 'CREATE_DRAG': return upCreateDrag(s, e, env)
    case 'QM_DRAG': return upMeasure(s, e)
    default: return { state: s.owned ? with_(s, { owned: false }) : s, effects: [], result: false }
  }
}

/** Rows 31, 31a. */
function upPressed(s, e, env) {
  const d = s.d0
  if (e.pointerType === 'touch' && s.pressWasSelected && d && d.type === 'text' && env.textEditor &&
      !env.readOnly && !d.locked && travel(s.down, e.x, e.y) < tolerance('touch').slop) {
    // iOS raises the keyboard only for a focus() inside this very pointerup;
    // the controller runs openEditor synchronously, before the hook returns.
    return consumed(with_(initialState(), { name: 'EDITING', editId: s.pressId }), [{ type: 'openEditor', id: s.pressId }])
  }
  return { state: idle(), effects: [], result: true }
}

/** Row 33. */
function upDrag(s, e, env) {
  let effects = []
  // The up can land a pixel from the last move; the drawing ends where the
  // pointer did.
  if (!s.ptr || s.ptr.x !== e.x || s.ptr.y !== e.y) {
    effects = dragStep(s, e, env, false).effects.filter((f) => f.type === 'dragTo')
  }
  effects.push({ type: 'endDrag' }, { type: 'setCursor', css: null })
  // Hand the crosshair back to the core's own snapping: no stale exact
  // point outlives the gesture. On touch the core dismisses it on the up.
  if (e.pointerType !== 'touch') effects.push({ type: 'crosshairRaw', x: e.x, y: e.y })
  return { state: idle(), effects, result: true }
}

/** Rows 18, 18t, 19 (and the latent placement of 15t). */
function upPressCreate(s, e, env) {
  const tool = toolDef(env, s.tool && s.tool.type)
  if (!tool) return { state: armed(s), effects: [], result: true }
  let s1 = with_(s, { owned: false })
  const effects = []
  if (s.latent) {
    const index = s.points.length
    const sn = snapCreate(s1, env, e.x, e.y, e, index, null)
    if (!sn) return { state: s.clickMode ? toPlacing(s1) : armed(s1), effects: [], result: true }
    if (s.clickMode && repeatsLast(s1, e, sn)) return { state: toPlacing(s1), effects: [], result: true }
    s1 = placed(s1, sn)
    if (index === 0) effects.push(rippleFx(sn, s.paneId))
  }
  if (tool.creation === 'single' || s1.points.length >= tool.anchors) return prepend(effects, finishCreate(s1, env, e, null))
  // Row 19: a click, not a drag: the next point follows the mouse (or, on
  // touch, waits for the next tap). Its preview starts on the last point.
  const last = s1.snaps[s1.snaps.length - 1]
  const s2 = with_(toPlacing(s1), { follow: last })
  effects.push(previewFx(s2, s2.points, last))
  return { state: s2, effects, result: true }
}

/** Rows 20, 21. */
function upCreateDrag(s, e, env) {
  const tool = toolDef(env, s.tool && s.tool.type)
  if (!tool) return { state: armed(s), effects: [], result: true }
  const r = createDragStep(s, e, env)
  const s1 = with_(r.state, { owned: false })
  const sn = s1.follow
  if (s.dragIndex < 0) return finishCreate(s1, env, e, sn)
  const points = s1.points.slice(0, s.dragIndex).concat(sn ? [sn.point] : [])
  const snaps = s1.snaps.slice(0, s.dragIndex).concat(sn ? [sn] : [])
  const s2 = with_(s1, { points, snaps, k: points.length })
  if (tool.creation === 'single' || points.length >= tool.anchors) return finishCreate(s2, env, e, null)
  // Row 21: a channel's third point is placed by a click (or, on touch, a
  // relative drag) after its baseline was dragged out.
  const s3 = with_(toPlacing(s2), { follow: sn })
  const effects = [previewFx(s3, points, sn)]
  if (e.pointerType !== 'touch') effects.push({ type: 'crosshair', s: sn, tags: false })
  return { state: s3, effects, result: true }
}

function toPlacing(s) {
  return with_(s, {
    name: 'PLACING', latent: false, clickMode: true, dragIndex: -1, grab: null, drag: null, prevSnap: null, owned: false,
  })
}

const prepend = (effects, r) => ({ state: r.state, effects: effects.concat(r.effects), result: r.result })

/**
 * The creation is complete: create it (rows 18, 20), or open a text draft
 * (row 18t). A text is a DRAFT until its first non-empty commit (D25): a
 * save-on-change host must never insert a row it then has to delete, so no
 * `create` is emitted here for text.
 */
function finishCreate(s, env, e, drag) {
  const spec = s.tool
  const points = s.points
  if (spec.type === 'text' && env.textEditor) return openDraft(s, spec, points)
  const sticky = stickyOf(spec, env)
  const tool = toolDef(env, spec.type)
  const effects = [{ type: 'create', spec, points, drag: drag || null }]
  // textEditor:false hands text to the host: it is created with its default
  // text and the host is told to edit it.
  if (spec.type === 'text') effects[0].edit = true
  if (e.pointerType !== 'touch') effects.push({ type: 'crosshairRaw', x: e.x, y: e.y })
  if (!sticky) {
    effects.push({ type: 'tool', tool: null })
    return { state: idle(), effects, result: true }
  }
  const first = s.snaps[0]
  const lastCreate = tool && tool.creation === 'single' && first
    ? { u: first.u, price: first.point.price, paneId: s.paneId, x: s.down.x, y: s.down.y, t: e.timeStamp > 0 ? e.timeStamp : s.downT }
    : null
  // Re-armed under a mouse that has not moved: keep its pointer, so the next
  // frame's re-derive shows the reticle at once instead of on the next move.
  const ptr = e.pointerType !== 'touch' ? ptrOf(e) : null
  return { state: with_(armed(s), { lastCreate, ptr }), effects, result: true }
}

/** Row 18t: an in-place editor on a draft that is not in the document yet. */
function openDraft(s, spec, points) {
  const draft = { spec, points }
  const s1 = with_(initialState(), {
    name: 'EDITING_NEW',
    tool: spec,
    draft,
    paneId: s.paneId,
    stickyAfter: spec.sticky === true,
  })
  return consumed(s1, [
    with_(previewFx(s, points, s.snaps[0] || null), { editing: true }),
    { type: 'openEditor', id: null, draft },
  ])
}

// ------------------------------------------------------------------ quick measure

/** Row 6. */
function startMeasure(s, e, env) {
  const sn = snapAt(env, e.x, e.y, e, {
    paneId: e.pane.id, tool: toolDef(env, 'measure'), placing: 0, prev: null, allowAngle: false, fit: null,
  })
  if (!sn) return unclaimed(s)
  const m = { paneId: e.pane.id, p0: sn, p1: sn, live: false, second: false }
  const s1 = with_(initialState(), {
    name: 'QM_DRAG', measure: m, paneId: e.pane.id, down: { x: e.x, y: e.y }, pointerType: e.pointerType, ptr: ptrOf(e), owned: true,
  })
  return consumed(s1, measureFx(m, [{ type: 'claim' }, { type: 'crosshair', s: sn }]))
}

/** Row 35. Shift started the measure, so it does not constrain its angle. */
function measureDragStep(s, e, env) {
  const r = hoverMeasure(with_(s, { name: 'QM_SHOWN', measure: with_(s.measure, { live: true }) }), e, env)
  const m = with_(r.state.measure, { live: false })
  return { state: with_(r.state, { name: 'QM_DRAG', measure: m }), effects: r.effects, result: true }
}

/**
 * Row 36. A Shift+CLICK (no drag) leaves the far end following the mouse
 * until a second click: Shift+click-click measures as well as press-drag.
 */
function upMeasure(s, e) {
  const click = !s.measure.second && travel(s.down, e.x, e.y) < tolerance(s.pointerType).slop
  const m = with_(s.measure, { live: click })
  const effects = []
  if (!click && e.pointerType !== 'touch') effects.push({ type: 'crosshairRaw', x: e.x, y: e.y })
  return { state: with_(s, { name: 'QM_SHOWN', measure: m, owned: false, prevSnap: null }), effects, result: true }
}

/** Row 37, and the second click of a click-click measure. */
function downMeasureShown(s, e, env) {
  if (liveMeasure(s) && e.button === 0 && e.pointerType !== 'touch') {
    const r = hoverMeasure(s, e, env)
    const m = with_(r.state.measure, { live: false, second: true })
    const s1 = with_(r.state, {
      name: 'QM_DRAG', measure: m, down: { x: e.x, y: e.y }, pointerType: e.pointerType, owned: true,
    })
    return consumed(s1, [{ type: 'claim' }].concat(r.effects))
  }
  // Not claimed: the press carries on as whatever it would have been.
  return unclaimed(idle(), [{ type: 'dismissMeasure' }])
}

// ------------------------------------------------------------------ cancel / abort

/**
 * Revert whatever a gesture did and hand the press back (row 34). Also the
 * single place a PRESSED press is let go of without an up.
 */
function cancelGesture(s) {
  const effects = []
  switch (s.name) {
    case 'DRAG_HANDLE':
    case 'DRAG_BODY':
      effects.push({ type: 'revert' })
      effects.push({ type: 'release' })
      effects.push({ type: 'setCursor', css: null })
      if (s.pointerType !== 'touch' && s.ptr) effects.push({ type: 'crosshairRaw', x: s.ptr.x, y: s.ptr.y })
      break
    case 'PRESSED':
      effects.push(RELEASE())
      break
    default:
      break
  }
  return { state: idle(), effects, result: true }
}

/**
 * Row 25: Esc (or an external edit) while creating. Back to ARMED; what was
 * visible ghosts out. A latent first press showed nothing, so nothing ghosts.
 */
function abortCreation(s) {
  return {
    state: armed(s),
    effects: [{ type: 'abortCreate', ghost: s.points.length > 0 }, RELEASE()],
    result: true,
  }
}

/**
 * Row 27: the platform took the press away (a second finger, pointercancel,
 * lost capture). Only THAT press is reverted: points placed by earlier clicks
 * survive a pinch between taps.
 */
function cancelPress(s) {
  if (!s.clickMode) {
    // The first press of the creation: everything placed is this press's.
    // A latent one placed nothing and showed nothing: no residual, no ghost.
    return { state: armed(s), effects: [{ type: 'abortCreate', ghost: s.points.length > 0 }], result: false }
  }
  // Points that predate this press. A mouse click placed (and its drag
  // adjusts) the last point; a latent touch press placed nothing, and its
  // drag moves a point that was never appended.
  let keep = s.points.length
  if (s.name === 'PRESS_CREATE' && !s.latent) keep -= 1
  if (s.name === 'CREATE_DRAG') keep = Math.min(s.points.length, s.dragIndex)
  const points = s.points.slice(0, Math.max(0, keep))
  const snaps = s.snaps.slice(0, points.length)
  if (!points.length) return { state: armed(s), effects: [{ type: 'abortCreate', ghost: false }], result: false }
  const s1 = with_(toPlacing(s), { points, snaps, k: points.length, follow: snaps[snaps.length - 1] })
  return { state: s1, effects: [previewFx(s1, points, s1.follow)], result: false }
}

function onCancel(s) {
  if (isDragging(s) || s.name === 'PRESSED') return with_(cancelGesture(s), { result: false })
  if (s.name === 'PRESS_CREATE' || s.name === 'CREATE_DRAG') return cancelPress(s)
  if (s.name === 'QM_DRAG') return { state: idle(), effects: [{ type: 'dismissMeasure' }], result: false }
  if (s.owned) return { state: with_(s, { owned: false }), effects: [], result: false }
  return same(s)
}

/** Row 41: an API mutation that touches (or can touch) the gesture's drawing. */
function onExternal(s, ev) {
  const id = ev.id == null ? null : ev.id
  if (isDragging(s) || s.name === 'PRESSED') {
    if (id !== null && id !== s.pressId) return same(s)
    return with_(cancelGesture(s), { result: false })
  }
  if (isCreating(s)) return with_(abortCreation(s), { result: false })
  if (isEditing(s)) {
    if (s.name === 'EDITING' && id !== null && id !== s.editId) return same(s)
    return { state: idle(), effects: [{ type: 'cancelEditor', id: s.editId, draft: s.draft }], result: false }
  }
  return same(s)
}

// ------------------------------------------------------------------ editing

/**
 * Row 38: Enter or blur. EDITING commits the text as an edit; EDITING_NEW
 * creates the drawing when the text is non-empty, and otherwise discards the
 * draft with no event at all (the controller decides which, from the text).
 * A second commit arrives in IDLE and is a no-op there.
 */
function commitEditor(s) {
  const next = s.name === 'EDITING_NEW' && s.stickyAfter ? armed(s) : idle()
  return {
    state: next,
    effects: [{ type: 'commitEditor', id: s.editId, draft: s.draft }],
    result: true,
  }
}

/**
 * Row 39: Esc in the editor. EDITING reverts; EDITING_NEW is discarded with
 * no event and no history. A sticky text tool stays armed: Esc peels one
 * layer at a time (§5.7), and the editor was the top layer.
 */
function cancelEdit(s) {
  const next = s.name === 'EDITING_NEW' && s.stickyAfter ? armed(s) : idle()
  return consumed(next, [{ type: 'cancelEditor', id: s.editId, draft: s.draft }, { type: 'focus' }])
}

// ------------------------------------------------------------------ taps and double-clicks

/**
 * Rows 8–10. A tap selects what is under it — locked drawings and axis tags
 * included, since a click is how a locked drawing gets selected to unlock it.
 * On touch a tap is consumed, so no crosshair appears; on mouse and pen it is
 * not, so the core still fires markerClick for a marker under the drawing.
 */
function onTap(s, ev, env) {
  const e = ev.e
  if (!e || s.name !== 'IDLE') return same(s)
  const touch = e.pointerType === 'touch'
  const hit = env.hitAt(e.x, e.y, e.pointerType)
  if (hit) return selectTap(s, hit, env, touch)
  if (selectionOf(env).length) {
    // A tap on nothing deselects: consumed on touch (a crosshair there would
    // answer a question the reader did not ask), not on mouse, so the core
    // still reports a markerClick under it.
    const s1 = with_(s, { ptr: null })
    const effects = [{ type: 'select', ids: [] }]
    return { state: s1, effects, result: touch }
  }
  return same(s)
}

function selectTap(s, hit, env, touch) {
  const sel = selectionOf(env)
  const effects = sel.length === 1 && sel[0] === hit.id ? [] : [{ type: 'select', ids: [hit.id] }]
  return { state: s, effects, result: touch }
}

/** Rows 11, 12. A double-click while drawing is consumed so it never resets the view. */
function onDblclick(s, ev, env) {
  const e = ev.e
  if (s.name === 'ARMED' || isCreating(s)) return consumed(s, [])
  if (!e || s.name !== 'IDLE') return same(s)
  const hit = env.hitAt(e.x, e.y, e.pointerType)
  if (!hit) return same(s)
  const d = env.drawing(hit.id)
  if (!d) return same(s)
  if (d.type === 'text' && !env.readOnly && env.textEditor) return editText(s, hit.id, hit.locked, env)
  return consumed(s, [{ type: 'emitEdit', id: hit.id }])
}

function editText(s, id, locked, env) {
  if (locked) return consumed(s, [{ type: 'shake', id }])
  const effects = isSelected(env, id) && selectionOf(env).length === 1 ? [] : [{ type: 'select', ids: [id] }]
  effects.push({ type: 'openEditor', id })
  return consumed(with_(initialState(), { name: 'EDITING', editId: id }), effects)
}

// ------------------------------------------------------------------ keys

function onKey(s, ev, env) {
  switch (ev.intent) {
    case 'escape': return onEscape(s, env)
    case 'undo':
    case 'redo': return onUndo(s, ev, env)
    case 'delete': return onDelete(s, env)
    case 'unplace': return s.name === 'PLACING' ? unplace(s) : onDelete(s, env)
    case 'duplicate': return onEdit(s, env, (ids) => [{ type: 'duplicate', ids }], false)
    case 'nudge': return onEdit(s, env, (ids) => [{ type: 'nudge', du: +ev.du || 0, dv: +ev.dv || 0 }], true)
    case 'edit': return onEnter(s, env)
    case 'commit': return isEditing(s) ? commitEditor(s) : same(s)
    // Not consumed: modifiers belong to the core too. The controller follows
    // a modifier with its own `rederive`.
    case 'modifier': return with_(onRederive(s, env), { result: false })
    default: return same(s)
  }
}

/**
 * Esc peels exactly one layer (§5.7): revert a drag, then cancel creation,
 * then close the editor, then close quick measure, then deselect, then disarm.
 */
function onEscape(s, env) {
  if (isDragging(s) || s.name === 'PRESSED') return cancelGesture(s)
  if (isCreating(s)) return abortCreation(s)
  if (isEditing(s)) return cancelEdit(s)
  if (isMeasuring(s)) {
    const effects = [{ type: 'dismissMeasure' }]
    if (s.name === 'QM_DRAG') effects.push(RELEASE())
    return consumed(idle(), effects)
  }
  if (selectionOf(env).length) return consumed(s, [{ type: 'select', ids: [] }])
  if (s.name === 'ARMED') return consumed(idle(), [hidePreview(s), { type: 'tool', tool: null }])
  return same(s)
}

function onUndo(s, ev, env) {
  // The editor keeps its own undo (it stops the keys reaching the chart).
  if (!isEditing(s)) {
    // During a gesture Ctrl/Cmd+Z only cancels the gesture. Popping history
    // under a held handle would change a drawing the hand is still holding.
    if (isDragging(s)) return cancelGesture(s)
    if (s.name === 'PRESSED') return cancelGesture(s)
    if (isCreating(s)) return abortCreation(s)
    if (s.name === 'QM_DRAG') return onEscape(s, env)
    if (!env.readOnly) return consumed(s, [{ type: ev.intent }])
  }
  return same(s)
}

/** Delete / Backspace on the selection. A locked drawing shakes and is kept (D23). */
function onDelete(s, env) {
  const ids = selectionOf(env)
  if (!ids.length || env.readOnly || (s.name !== 'IDLE' && s.name !== 'ARMED')) return same(s)
  const locked = []
  const free = []
  for (const id of ids) {
    const d = env.drawing(id)
    if (!d) continue
    if (d.locked) locked.push(id)
    else free.push(id)
  }
  if (!locked.length && !free.length) return same(s)
  const effects = locked.map((id) => ({ type: 'shake', id }))
  if (free.length) effects.push({ type: 'remove', ids: free })
  return consumed(s, effects)
}

/**
 * Duplicate and nudge. With zero bars neither applies (§3.5), so the key is
 * not consumed and falls through to the core. Nudging a locked drawing shakes.
 */
function onEdit(s, env, make, refusesLocked) {
  const ids = selectionOf(env)
  if (!ids.length || env.readOnly || env.hasBars === false || (s.name !== 'IDLE' && s.name !== 'ARMED')) return same(s)
  const live = []
  const locked = []
  for (const id of ids) {
    const d = env.drawing(id)
    if (!d) continue
    if (refusesLocked && d.locked) locked.push(id)
    else live.push(id)
  }
  const effects = locked.map((id) => ({ type: 'shake', id }))
  if (live.length) effects.push(...make(live))
  return effects.length ? consumed(s, effects) : same(s)
}

/** Enter on a selected text opens its editor; on anything else Enter is not ours. */
function onEnter(s, env) {
  const ids = selectionOf(env)
  if (s.name !== 'IDLE' || ids.length !== 1 || env.readOnly) return same(s)
  const d = env.drawing(ids[0])
  if (!d || d.type !== 'text') return same(s)
  if (!env.textEditor) return consumed(s, [{ type: 'emitEdit', id: ids[0] }])
  return editText(s, ids[0], d.locked, env)
}

/** Row 26: Backspace while placing takes back the last anchor. */
function unplace(s) {
  if (s.points.length <= 1) return { state: armed(s), effects: [{ type: 'abortCreate', ghost: s.points.length > 0 }], result: true }
  const points = s.points.slice(0, -1)
  const snaps = s.snaps.slice(0, -1)
  const s1 = with_(s, { points, snaps, k: points.length, prevSnap: null })
  const effects = [previewFx(s1, s.follow ? points.concat([s.follow.point]) : points, s.follow)]
  return consumed(s1, effects)
}

// ------------------------------------------------------------------ setTool / rederive

/** Rows 13, 16: arming aborts whatever was in flight first. */
function onSetTool(s, ev, env) {
  const t = ev.tool || null
  if (t && (env.readOnly || !toolDef(env, t.type))) return same(s)
  let pre = []
  if (isDragging(s) || s.name === 'PRESSED') pre = cancelGesture(s).effects
  else if (isCreating(s)) pre = abortCreation(s).effects
  else if (isEditing(s)) pre = commitEditor(s).effects
  else if (isMeasuring(s)) pre = [{ type: 'dismissMeasure' }].concat(s.name === 'QM_DRAG' ? [RELEASE()] : [])
  else if (s.name === 'ARMED') pre = [hidePreview(s)]
  if (!t) {
    if (s.name === 'IDLE' && !s.tool) return { state: s, effects: pre, result: false }
    return consumed(idle(), pre.concat([{ type: 'tool', tool: null }]))
  }
  // The spec's stickiness is resolved once, here: every later decision
  // (re-arm after a create, after a text commit) reads spec.sticky.
  const spec = with_(t, { sticky: stickyOf(t, env) })
  const s1 = with_(initialState(), { name: 'ARMED', tool: spec })
  return consumed(s1, pre.concat([
    { type: 'tool', tool: spec },
    { type: 'hover', id: null, part: null },
    { type: 'cursor', css: 'crosshair' },
    { type: 'focus' },
  ]))
}

/** Row 40 in a PRESS_CREATE: the press's own point, re-snapped at the down point under the moved view. */
function resnapPress(s, env) {
  if (!s.points.length || !s.ptr) return same(s)
  const index = s.points.length - 1
  const sn = snapCreate(s, env, s.down.x, s.down.y, s.ptr, index, null)
  if (!sn) return same(s)
  const points = s.points.slice(0, index).concat([sn.point])
  const snaps = s.snaps.slice(0, index).concat([sn])
  const s1 = with_(s, { points, snaps })
  return { state: s1, effects: [previewFx(s1, points, sn)], result: false }
}

/**
 * Row 40 (D9): a full frame, a modifier change or a window blur. Every state
 * with a known pointer re-snaps from it, so a wheel zoom, an autoscale ease, a
 * live tick or a replay step never pulls a held handle, a preview reticle or
 * an exact crosshair off a still pointer. PRESSED does nothing: a view that
 * moves under a still mouse is not the hand starting a drag.
 */
function onRederive(s, env) {
  if (isDragging(s) || s.name === 'CREATE_DRAG' || s.name === 'QM_DRAG') {
    return s.ptr ? with_(onMove(s, { type: 'move', e: pointerFrom(s.ptr, env) }, env), { result: false }) : same(s)
  }
  if (s.name === 'PRESS_CREATE') return s.latent ? same(s) : resnapPress(s, env)
  if (s.name === 'ARMED' || s.name === 'PLACING' || s.name === 'QM_SHOWN') {
    // As hover, from the stored pointer: the reticle and the exact crosshair
    // re-snap under a still mouse while the view eases.
    if (s.name === 'ARMED' && s.ptr) return hoverFrom(s, s.ptr, env)
    if (s.ptr && (s.name === 'PLACING' || liveMeasure(s))) return hoverFrom(s, s.ptr, env)
    return same(s)
  }
  return same(s)
}

// ------------------------------------------------------------------ reduce

/**
 * The reducer. Unknown events and events a state does not handle return the
 * state unchanged with no effects and `result: false` — a new event type can
 * never throw inside a pointer handler.
 */
export function reduce(s, ev, env) {
  if (!s) s = initialState()
  if (!ev) return same(s)
  switch (ev.type) {
    case 'hover': return onHover(s, ev, env)
    case 'down': return onDown(s, ev, env)
    case 'move': return onMove(s, ev, env)
    case 'up': return onUp(s, ev, env)
    case 'tap': return onTap(s, ev, env)
    case 'dblclick': return onDblclick(s, ev, env)
    case 'cancel': return onCancel(s)
    case 'rederive': return onRederive(s, env)
    case 'external': return onExternal(s, ev)
    case 'key': return onKey(s, ev, env)
    case 'setTool': return onSetTool(s, ev, env)
    case 'escape': return onEscape(s, env)
    default: return same(s)
  }
}
