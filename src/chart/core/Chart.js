import { createTimeFormatter, toNumber } from './formatters.js'
import { Layers } from './Layers.js'
import { Loop } from './Loop.js'
import { TimeScale } from './TimeScale.js'
import { Pane, layoutPanes, paneAtY } from './Panes.js'
import { defaultTheme } from './palette.js'
import { LiveCandle } from '../motion/LiveCandle.js'
import { Inertia } from '../motion/Inertia.js'
import { Replay } from '../replay/Replay.js'
import { drawGrid, drawPriceAxis } from '../render/grid.js'
import { drawCandles } from '../render/candles.js'
import { drawCrosshair } from '../render/crosshair.js'
import { drawZones, drawPriceLines, drawMarkers } from '../render/annotations.js'
import { normalizeMarkers, resolveMarkers, layoutMarkers } from '../overlays/annotations.js'
import {
  normalizeSeries,
  normalizeSeriesPoints,
  resolveSeriesPoints,
  seriesExtent,
} from '../overlays/series.js'
import { drawSeries } from '../render/series.js'
import { drawWatermark } from '../render/watermark.js'

/** The 'replay' payload when nothing is being replayed. */
const inactiveReplay = () => ({
  active: false,
  playing: false,
  index: -1,
  length: 0,
  progress: 0,
  speed: 1,
  time: null,
  bar: null,
  atEnd: false,
})

/**
 * Chart — the orchestrator. Owns the bar store, the scales, the input
 * handling and the frame composition. Framework-free by design: this file
 * touches nothing but DOM and Canvas, which is what lets the same core ship
 * as a React component, a Web Component, or a plain script tag.
 */
/** The pane candles, volume and annotations always draw on. */
const PRICE_PANE = 'price'

/** The public shape of a pane. `rect` and `ps` are live; the rest is a copy. */
function paneInfo(pane, seriesIds) {
  return {
    id: pane.id,
    weight: pane.weight,
    minHeight: pane.minHeight,
    title: pane.title,
    rect: pane.rect,
    ps: pane.ps,
    primed: pane.ps.primed,
    series: seriesIds,
  }
}


/** Consecutive gaps sampled when inferring the timeframe. */
const TF_SAMPLES = 200

/** Below this many samples the median is not yet meaningful — see below. */
const TF_MIN_MEDIAN = 5

/**
 * Consecutive failing history pages before paging gives up. One transient 500
 * must not permanently disable lazy history, but a feed that is reliably
 * failing must not be re-asked on every pan either.
 */
const MAX_HISTORY_ERRORS = 3

/**
 * Bar duration, taken as the MEDIAN gap between consecutive bars rather than
 * simply `bars[1].time - bars[0].time`.
 *
 * Any exchange with a trading session puts a large gap between the last bar
 * of one day and the first of the next — NSE closes at 15:30 and reopens at
 * 09:15, so on minute data the very first pair can read as 17.75 HOURS. That
 * one number then drives axis label density and, worse, Replay's future-marker
 * cut-off. The median survives session breaks, weekends and holidays for as
 * long as most bars are consecutive, which is the normal case.
 *
 * Samples a CONTIGUOUS window from the middle rather than striding across the
 * whole array: a stride that happens to be a multiple of the bars-per-session
 * lands every sample on a session boundary and infers the gap instead of the
 * timeframe. A window from the middle is also the cheapest way to stay O(1)
 * on a 500k-bar dataset.
 *
 * With only a handful of samples the median is not robust — with exactly two
 * gaps it IS the larger one, so a two-bar prefix spanning an overnight break
 * would infer 17.75 hours. Below TF_MIN_MEDIAN samples the minimum is the
 * better estimator, because the true bar duration is a floor: real gaps are
 * always longer than the timeframe, never shorter.
 */
export function inferTimeframe(bars, fallback = 60000) {
  const n = bars.length
  if (n < 2) return fallback
  const start = Math.max(1, Math.floor(n / 2) - Math.floor(TF_SAMPLES / 2))
  const end = Math.min(n, start + TF_SAMPLES)
  const gaps = []
  for (let i = start; i < end; i++) {
    const d = bars[i].time - bars[i - 1].time
    if (d > 0) gaps.push(d)
  }
  if (!gaps.length) return fallback
  gaps.sort((a, b) => a - b)
  return gaps.length < TF_MIN_MEDIAN ? gaps[0] : gaps[gaps.length >> 1]
}

export class Chart {
  constructor(container, options = {}) {
    if (!container) throw new Error('Chart: container element is required')

    this.container = container
    /**
     * Vue's ReactiveFlags.SKIP. A plain string constant, no dependency, and
     * inert everywhere else.
     *
     * Without it, storing a Chart on a Vue component's reactive state makes
     * Vue deep-proxy it the first time anything reads a property — including
     * `chart.bars`, which on a real dataset is tens of thousands of objects,
     * on an instance that repaints at 60fps. `markRaw()` is the documented
     * way to avoid that, but it puts the burden on every consumer and the
     * failure is a silent performance cliff rather than an error. Declaring
     * it here means a Chart is never reactive, whoever stores it.
     */
    this.__v_skip = true
    /**
     * Every rendered timestamp goes through this. Browser-local by default;
     * options.timeZone pins it to an exchange's zone instead.
     */
    this.fmt = createTimeFormatter(options.timeZone)
    this.theme = { ...defaultTheme, ...(options.theme || {}) }
    this.options = {
      volumeRatio: 0.18,
      magnet: true,
      animate: true,
      ...options,
    }

    this.bars = []
    this.feed = null
    this._unsub = null
    this._loadingHistory = false
    this._exhausted = false
    this._historyErrors = 0
    this._replay = null
    // Every async feed read is stamped with the generation current when it
    // STARTED. setFeed/detachFeed/destroy bump the counter, so a slow earlier
    // request that resolves second recognises itself as stale and drops its
    // result instead of writing over the newer feed's bars.
    this._feedGen = 0
    /**
     * Bumped whenever the bar array is REPLACED (setData, _swapBars,
     * startReplay). _feedGen alone is not enough: a history page can be in
     * flight when replay starts or when the caller swaps data by hand, and
     * prepending onto a prefix that no longer exists scrolls the viewport off
     * the data. Kept separate from _feedGen because bumping that in setData
     * would trip setFeed's own continuation guard.
     */
    this._barGen = 0
    this._destroyed = false
    this._listeners = {
      crosshair: new Set(),
      visibleRange: new Set(),
      markerClick: new Set(),
      markerHover: new Set(),
      replay: new Set(),
      error: new Set(),
    }

    // ---- annotations --------------------------------------------------
    // Markers carry a `time`; the renderer needs an index. Resolving is a
    // binary search per marker, so it is redone only when the bar array
    // actually shifts (a prepended history page moves every index).
    this._markers = normalizeMarkers(options.markers)
    this.priceLines = Array.isArray(options.priceLines) ? options.priceLines.slice() : []
    this.zones = Array.isArray(options.zones) ? options.zones.slice() : []
    this._markerHits = []
    this._hoverMarkerId = null
    this._resolveKey = ''
    /**
     * id -> { opts, points, drawable, resolveKey }
     *
     * A keyed registry rather than a one-shot setter, because a host toggling
     * one indicator on a panel of twelve should not have to rebuild the other
     * eleven. Insertion order is draw order.
     */
    this._series = new Map()
    // Per-listener dedupe. A single shared key let a LATE subscriber record
    // the current state as "already sent", so the next emit compared equal
    // and every EXISTING listener silently missed that update.
    this._stateKeys = { visibleRange: new Map(), replay: new Map() }

    this.layers = new Layers(container, ['base', 'main', 'overlay'])
    this.ts = new TimeScale(options.timeScale)
    /**
     * Horizontal bands of the plot, top to bottom. _panes[0] is the price
     * pane — where candles, volume and annotations draw — but it is an
     * ordinary Pane, and the layout arithmetic does not know it is first.
     */
    this._panes = [new Pane('price', { weight: 3, priceScale: options.priceScale })]
    this._paneById = new Map([['price', this._panes[0]]])
    /** Vertical gap between panes, in CSS px. Unused while there is one. */
    this._paneGap = isFinite(options.paneGap) && options.paneGap >= 0 ? +options.paneGap : 6
    this.live = new LiveCandle()
    this.live.enabled = this.options.animate !== false
    this.inertia = new Inertia()

    this.cursor = null

    this.loop = new Loop(
      (dirty, dt) => this._frame(dirty, dt),
      (err) => this._emitError(err, 'frame'),
    )
    this.layers.onResize = () => {
      this._layout()
      this.loop.invalidate('all')
    }

    this._layout()
    this._bindEvents()
    this.loop.start()
  }

  // ---------------------------------------------------------------- layout --
  /**
   * The price pane's scale.
   *
   * Superseded by paneScale(id), which names the pane rather than assuming
   * there is only one. Kept because it is public, typed, and what consumers
   * reach for to position host overlays.
   */
  get ps() {
    return this._panes[0].ps
  }

  /**
   * The price pane's rect. Superseded by paneRect(id).
   *
   * Live rather than a copy: the same object survives a resize, where this
   * used to be replaced with a fresh one on every layout.
   */
  get plot() {
    return this._panes[0].rect
  }

  _layout() {
    const { width, height } = this.layers
    const w = Math.max(1, width - this.theme.priceAxisWidth)
    const h = Math.max(1, height - this.theme.timeAxisHeight)
    this.ts.resize(w)
    // One pane takes the whole band with no gap, which is exactly the single
    // rect this used to build by hand.
    layoutPanes(this._panes, w, h, this._panes.length > 1 ? this._paneGap : 0)
  }

  // ------------------------------------------------------------------ data --
  setData(bars) {
    // New data means the dataset being replayed no longer exists.
    if (this._replay) {
      this._replay.detach()
      this._replay = null
    }
    this.bars = Array.isArray(bars) ? bars.slice() : []
    this._exhausted = false
    this._historyErrors = 0
    this._barGen++
    this._resolveKey = '' // new bars, so every marker index must re-resolve
    if (this.bars.length > 1) {
      this.ts.timeframeMs = inferTimeframe(this.bars, this.ts.timeframeMs)
    }
    this.ts.setBarCount(this.bars.length)
    this.ts.snapToRealtime()
    this.live.reset()
    // A manual price window belongs to the dataset it was chosen against. When
    // the replacement bars fall entirely outside it the reader is left staring
    // at blank space, with the axis not even drawn to explain why. So hand the
    // scale back to autoscale, exactly as ts.snapToRealtime() just did for
    // time. Bars that still OVERLAP keep the window, which is what lets a reader
    // toggle a series on the same data without losing the pan they chose.
    if (!this.ps.auto && this.bars.length) {
      let min = Infinity
      let max = -Infinity
      for (const b of this.bars) {
        const lo = toNumber(b.low)
        const hi = toNumber(b.high)
        if (lo < min) min = lo
        if (hi > max) max = hi
      }
      if (isFinite(min) && isFinite(max) && (max < this.ps.lo || min > this.ps.hi)) {
        this.ps.resetAuto()
      }
    }
    // Unprimed only if it is going to re-fit. A manual window we deliberately
    // KEPT is a real range, and unpriming it would stop drawPriceAxis drawing
    // the axis at all — the reader's pan survives on candles it can no longer
    // read a price off. Unpriming an auto scale is what makes the first fit of
    // the new data jump rather than glide across from the old instrument.
    if (this.ps.auto) this.ps._primed = false
    this.loop.invalidate('all')
  }

  /**
   * Replace the bar array WITHOUT re-anchoring the view — the deliberate
   * difference from setData(), which snaps to the right edge and re-primes
   * the price scale. Replay swaps its revealed prefix through here on every
   * scrub, so a snap would fight the user's zoom and the price scale would
   * pop instead of easing between windows.
   */
  _swapBars(bars, timeframeMs) {
    this.bars = Array.isArray(bars) ? bars : []
    this._barGen++
    // Replay passes the timeframe of the WHOLE dataset. Re-inferring it from
    // the revealed prefix would read a 2-bar prefix that straddles a session
    // break as a 17-hour timeframe, which then widens Replay's future-marker
    // cut-off and leaks tomorrow's trades into today's playback.
    if (isFinite(timeframeMs) && timeframeMs > 0) {
      this.ts.timeframeMs = timeframeMs
    } else if (this.bars.length > 1) {
      this.ts.timeframeMs = inferTimeframe(this.bars, this.ts.timeframeMs)
    }
    this.ts.setBarCount(this.bars.length)
    this.live.reset()
    this._resolveKey = '' // the prefix changed length: every index re-resolves
    this.loop.invalidate('all')
  }

  /** Merge a tick into the forming candle (animated). */
  update(bar) {
    if (!bar) return
    const n = this.bars.length
    if (n && this.bars[n - 1].time === bar.time) {
      this.bars[n - 1] = bar
    } else {
      this.append(bar)
      return
    }
    this.live.setTarget(bar)
    this.loop.invalidate('main')
  }

  /**
   * Open a new candle; the previous one is now closed.
   *
   * A bar OLDER than the newest one is dropped rather than applied. It used
   * to overwrite the last element — so a late tick silently deleted the
   * newest candle and left a duplicate timestamp behind, which breaks the
   * ascending-by-time invariant that marker resolution's binary search
   * depends on. Feeds are documented as ascending and de-duplicated
   * (data/DataFeed.js); this is the guard for the ones that are not.
   */
  append(bar) {
    if (!bar) return
    const n = this.bars.length
    if (n && bar.time < this.bars[n - 1].time) return
    // Equal timestamps ARE a replace: that is an idempotent re-send of the
    // forming candle, which is the common case on a chatty feed.
    if (n && bar.time === this.bars[n - 1].time) {
      this.bars[n - 1] = bar
    } else {
      this.bars.push(bar)
      this.ts.setBarCount(this.bars.length)
    }
    this.live.setTarget(bar)
    this.loop.invalidate('main')
  }

  async setFeed(feed) {
    this.detachFeed()
    this.feed = feed
    if (!feed) return
    const gen = ++this._feedGen
    // Taking ownership means dropping the previous symbol NOW. Otherwise a
    // rejected first page leaves the new feed attached to the old symbol's
    // bars, and the next pan asks the new symbol for history anchored at the
    // old symbol's oldest timestamp.
    if (this.bars.length) this.setData([])
    this.ts.timeframeMs = feed.timeframe || this.ts.timeframeMs
    let bars
    try {
      bars = await feed.getBars({
        symbol: feed.symbol,
        timeframe: feed.timeframe,
        to: null,
        limit: this.options.initialBars || 1500,
      })
    } catch (err) {
      if (gen !== this._feedGen || this._destroyed) return
      this._emitError(err, 'setFeed')
      return
    }
    // Another setFeed(), a detachFeed() or a destroy() landed while we were
    // awaiting: this result belongs to a chart state that no longer exists.
    if (gen !== this._feedGen || this._destroyed) return
    this.setData(bars)
    // Read back the SANITISED array rather than the raw return value:
    // setData() has already coerced a non-array to [], and prime() is
    // documented as taking Bar | undefined.
    if (typeof feed.prime === 'function') feed.prime(this.bars[this.bars.length - 1])
    this.ts.live = true // new candles are coming: hold the right edge on zoom
    this._unsub = feed.subscribe((msg) => {
      if (!msg || !msg.bar) return
      // A subscription that outlived its generation must never write bars —
      // two feeds on one timeframe otherwise target the same forming candle.
      if (gen !== this._feedGen || this._destroyed) return
      // During replay the feed is the FUTURE arriving: let it run, ignore it.
      if (this._replay) return
      if (msg.type === 'append') this.append(msg.bar)
      else this.update(msg.bar)
    })
  }

  detachFeed() {
    // Bumping the generation is what cancels in-flight work: neither
    // getBars() promise can be aborted, so instead they resolve into no-ops.
    this._feedGen++
    this._loadingHistory = false
    this._historyErrors = 0
    this._exhausted = false // the next feed gets a clean slate
    this.ts.live = false
    if (this._unsub) this._unsub()
    this._unsub = null
    this.feed = null
  }

  async _maybeLoadHistory() {
    // Replay owns the bar array; a page prepended underneath it would
    // renumber the cursor mid-playback.
    if (this._replay) return
    if (this._loadingHistory || this._exhausted || !this.feed) return
    const { from } = this.ts.visibleRange()
    if (from > 80 || !this.bars.length) return

    this._loadingHistory = true
    // Bind this page to the feed that asked for it. Everything after the await
    // must prove it still belongs to that feed before touching shared state —
    // including _exhausted, which a stale page could otherwise latch on a
    // fresh symbol that still has years of history.
    const gen = this._feedGen
    const barGen = this._barGen
    const feed = this.feed
    try {
      const older = await feed.getBars({
        symbol: feed.symbol,
        timeframe: feed.timeframe,
        to: this.bars[0].time,
        limit: 1000,
      })
      // The bar array must still be the one we measured the boundary against:
      // a replay that started, or a caller's setData, while this page was in
      // flight means these bars belong in front of something that is gone.
      if (gen !== this._feedGen || barGen !== this._barGen || this._destroyed) return
      if (this._replay || !this.bars.length) return
      if (!older || !older.length) {
        this._exhausted = true
        return
      }
      // Re-read the boundary AFTER the await. Filtering against the stale
      // pre-await value can splice a page into the middle of the array and
      // break the ascending-by-time invariant that nearestIndex()'s binary
      // search and the candle draw order both depend on.
      const boundary = this.bars[0].time
      const added = older.filter((b) => b.time < boundary)
      if (!added.length) {
        this._exhausted = true
        return
      }
      this._historyErrors = 0
      this.bars = added.concat(this.bars)
      // Keep the view pinned to the same bars: every index shifted right.
      // Smoothed.jump() writes BOTH value and target, so it alone pins the
      // view. The set() that used to follow re-read the already-shifted
      // target and added the page size a SECOND time, easing the viewport
      // past the newest bar — which pushed `from` above the 80-bar threshold
      // and disabled lazy paging permanently.
      this.ts.barCount = this.bars.length
      this.ts._right.jump(this.ts._right.value + added.length)
      this.loop.invalidate('all')
    } catch (err) {
      if (gen !== this._feedGen || barGen !== this._barGen || this._destroyed) return
      // Retry on the next pan; latch only once the feed looks properly dead.
      if (++this._historyErrors >= MAX_HISTORY_ERRORS) this._exhausted = true
      this._emitError(err, 'loadHistory')
    } finally {
      // Only the generation that owns the latch may release it, or a stale
      // request finishing late would unlock a load already in progress.
      if (gen === this._feedGen) this._loadingHistory = false
    }
  }

  /**
   * Feed failures are delivered as an 'error' event so an adapter can react.
   * With no subscriber they still reach the console rather than vanishing.
   */
  /**
   * The frame state as `pane` sees it: its own scale, its own rect, its own
   * series. Everything else — theme, time scale, bars, formatter — is shared,
   * which is what makes the time axis common to every pane.
   */
  _paneState(base, pane) {
    return { ...base, ps: pane.ps, plot: pane.rect, series: pane.visible }
  }

  _emitError(err, phase) {
    const set = this._listeners.error
    if (!set.size) {
      console.error(`[Emberwick] ${phase} failed`, err)
      return
    }
    for (const fn of set) fn(err)
  }

  // ---------------------------------------------------------------- events --
  /**
   * What a drag starting at (x, y) does, and to which pane's scale.
   *
   * Two independent questions, which one ternary used to conflate:
   *
   * - 'pan' vs 'time' is about the PLOT. The boundary is the
   *   bottom of the LAST pane. It used to be `plot.h`, which stopped meaning
   *   "the bottom of the plot" the moment a second pane existed — the same
   *   trap that drew the time axis between the panes in 0.9.0 — so every
   *   pointer below the price pane read as being on the time axis, and a
   *   horizontal drag inside an oscillator zoomed the chart instead of
   *   panning it. On a 3:1 layout that is 30% of the plot; on 3:1:1, 48%.
   *
   * - 'price' is the only mode that needs a TARGET, and it is the pane beside
   *   the pointer, not pane 0. Dragging the gutter next to an oscillator used
   *   to stretch the price scale — the pane the reader was not pointing at.
   *
   * The seam between two panes, and the corner where both gutters meet,
   * resolve to the nearest pane rather than to none. paneAtY returning null
   * is right for the crosshair, which must go quiet off-pane; for a gesture
   * already in flight there is no "no pane" to act on, and nearest keeps a
   * single-pane chart behaving exactly as it always has, since the nearest
   * pane is then always pane 0.
   */
  _classifyDrag(x, y) {
    if (x > this.plot.w) return { mode: 'price', pane: this._paneNear(y) }
    const last = this._panes[this._panes.length - 1].rect
    if (y > last.y + last.h) return { mode: 'time', pane: null }
    // A pan carries a pane because it is free in both axes: dx moves the shared
    // time scale, dy moves the price scale of the pane under the pointer. Only
    // that pane's, never every pane's — the panes hold unrelated quantities, and
    // dragging a price chart has no business shifting an RSI off its 0..100.
    return { mode: 'pan', pane: this._paneNear(y) }
  }

  /** The pane containing `y`, or the closest one — never null. */
  _paneNear(y) {
    const hit = paneAtY(this._panes, y)
    if (hit) return hit
    let best = this._panes[0]
    let bestGap = Infinity
    for (const pane of this._panes) {
      const gap = y < pane.rect.y ? pane.rect.y - y : y - (pane.rect.y + pane.rect.h)
      if (gap < bestGap) { bestGap = gap; best = pane }
    }
    return best
  }

  _bindEvents() {
    const el = this.container
    el.style.touchAction = 'none'
    el.style.cursor = 'crosshair'

    let dragging = false
    let mode = null
    /**
     * The pane a 'price' drag stretches, latched for the whole gesture.
     *
     * Latched, not re-resolved per move, for the same reason `mode` is: a
     * drag that wanders across a pane boundary must go on stretching the
     * scale it started on, or one continuous finger movement silently
     * retargets and stretches two.
     *
     * The Pane OBJECT rather than an id or a rect copy — Panes.js documents
     * the rect as mutated in place, so the latch survives a resize landing
     * mid-drag, which a copy would not.
     */
    let dragPane = null
    // How far this gesture has panned vertically, and whether the pane was
    // autoscaling before it started — both needed to UNDO the pan if the
    // browser takes the gesture away. See _onCancel.
    let panDy = 0
    let paneWasAuto = true
    let lastX = 0
    let lastY = 0
    let lastT = 0
    let moved = false
    const pointers = new Map()
    let pinchDist = 0

    const localPos = (e) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    this._onDown = (e) => {
      pointers.set(e.pointerId, localPos(e))
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        dragging = false
        return
      }
      const p = localPos(e)
      dragging = true
      moved = false
      const target = this._classifyDrag(p.x, p.y)
      mode = target.mode
      dragPane = target.pane
      panDy = 0
      paneWasAuto = dragPane ? dragPane.ps.auto : true
      lastX = p.x
      lastY = p.y
      lastT = performance.now()
      this.inertia.stop()
      el.setPointerCapture(e.pointerId)
    }

    this._onMove = (e) => {
      const p = localPos(e)
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p)

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0 && d > 0) {
          const mid = (a.x + b.x) / 2
          this.ts.zoomAt(mid, d / pinchDist)
          this.loop.invalidate('all')
        }
        pinchDist = d
        return
      }

      this.cursor = p
      this._emitCrosshair(p)
      this.loop.invalidate('overlay')

      if (!dragging) return
      const now = performance.now()
      const dt = now - lastT
      const dx = p.x - lastX
      const dy = p.y - lastY
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true

      if (mode === 'pan') {
        this.ts.panBy(dx)
        // Inertia stays horizontal. It models a flick along the time axis,
        // where there is more data to glide into; a vertical throw would coast
        // the range off the candles and leave the reader looking at blank space
        // with no data to stop it.
        if (dragPane) { dragPane.ps.panBy(dy); panDy += dy }
        this.inertia.sample(dx, dt)
        this.loop.invalidate('all')
        this._maybeLoadHistory()
      } else if (mode === 'price') {
        dragPane.ps.scaleBy(1 + dy / 220)
        this.loop.invalidate('all')
      } else if (mode === 'time') {
        this.ts.zoomAt(this.plot.w, 1 - dx / 260)
        this.loop.invalidate('all')
      }

      lastX = p.x
      lastY = p.y
      lastT = now
    }

    /**
     * The browser took the gesture — on touch, that is a page scroll starting.
     *
     * `touch-action: pan-y` still delivers the first few pointermoves before
     * the user agent decides the drag belongs to the page, so a vertical pan
     * has already been applied by the time pointercancel arrives. Left alone
     * it sticks: every scroll past an inline chart would nudge it a few pixels
     * and, worse, leave it out of autoscale for good, because a pan is a
     * deliberate act and panBy clears `auto`. So unwind exactly what this
     * gesture did. panBy is a pure translation and the span it divides by is
     * unchanged, so -panDy is its exact inverse.
     */
    this._onCancel = (e) => {
      if (dragPane && panDy) {
        dragPane.ps.panBy(-panDy)
        if (paneWasAuto) dragPane.ps.resetAuto()
        this.loop.invalidate('all')
      }
      panDy = 0
      this._onUp(e)
    }

    this._onUp = (e) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      if (dragging && mode === 'pan' && moved) {
        this.inertia.release()
        this.loop.invalidate('all')
      }
      dragging = false
      mode = null
      dragPane = null
      panDy = 0
      try { el.releasePointerCapture(e.pointerId) } catch (_) {}
    }

    this._onLeave = () => {
      this.cursor = null
      this._emitCrosshair(null)
      this.loop.invalidate('overlay')
    }

    this._onWheel = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left
      const factor = Math.pow(0.999, e.deltaY)
      this.ts.zoomAt(x, factor)
      this.loop.invalidate('all')
      this._maybeLoadHistory()
    }

    /**
     * Double-click resets the axis it lands on, and both from the plot.
     *
     * It is classified by _classifyDrag, the same function the drag itself
     * goes through, so the region that scales an axis is by construction the
     * region that resets it — two hit tests would be two chances to disagree
     * about where the gutter starts.
     *
     * The plot keeps resetting both, which is what it did before free panning
     * existed and still the only gesture that undoes a pan in one action.
     */
    this._onDbl = (e) => {
      // An event with no coordinates resets everything, which is what a
      // double-click did before it was scoped at all. A DOM dblclick always
      // carries a position, so this is for a synthetic one -- and "reset the
      // whole chart" is the only honest reading of a gesture that did not say
      // where it landed.
      let hit = { mode: 'pan', pane: null }
      if (isFinite(e?.clientX) && isFinite(e?.clientY)) {
        const p = localPos(e)
        hit = this._classifyDrag(p.x, p.y)
      }
      if (hit.mode === 'price') hit.pane.ps.resetAuto()
      else if (hit.mode === 'time') this.ts.reset()
      else { this.ts.reset(); this._resetAutoScales() }
      this.loop.invalidate('all')
    }

    this._onKey = (e) => {
      const step = e.shiftKey ? 120 : 40
      if (e.key === 'ArrowLeft') { this.ts.panBy(step); this.loop.invalidate('all'); this._maybeLoadHistory() }
      else if (e.key === 'ArrowRight') { this.ts.panBy(-step); this.loop.invalidate('all') }
      else if (e.key === '+' || e.key === '=') { this.ts.zoomAt(this.plot.w / 2, 1.2); this.loop.invalidate('all') }
      else if (e.key === '-' || e.key === '_') { this.ts.zoomAt(this.plot.w / 2, 0.8); this.loop.invalidate('all') }
      else return
      e.preventDefault()
    }

    this._onClick = (e) => {
      // `moved` is still set from the gesture that just ended — a pan that
      // happens to finish over a marker must not read as a click on it.
      if (moved) return
      if (!this._listeners.markerClick.size) return
      const p = localPos(e)
      const hit = this.markerAt(p.x, p.y)
      if (hit) for (const fn of this._listeners.markerClick) fn(hit)
    }

    el.addEventListener('click', this._onClick)
    el.addEventListener('pointerdown', this._onDown)
    el.addEventListener('pointermove', this._onMove)
    el.addEventListener('pointerup', this._onUp)
    el.addEventListener('pointercancel', this._onCancel)
    el.addEventListener('pointerleave', this._onLeave)
    el.addEventListener('wheel', this._onWheel, { passive: false })
    el.addEventListener('dblclick', this._onDbl)
    el.addEventListener('keydown', this._onKey)
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0')
  }

  _emitCrosshair(p) {
    if (this._listeners.crosshair.size) {
      let payload = null
      // Resolve the pane under the pointer, not the price pane. The crosshair
      // is DRAWN in whichever pane the cursor is in; before this the payload
      // was bounded by pane 0's rect and read pane 0's scale, so hovering an
      // oscillator drew a crosshair and reported null — a legend went blank
      // exactly where the user was looking.
      const pane = p && this.bars.length && p.x >= 0 && p.x <= this.plot.w
        ? paneAtY(this._panes, p.y)
        : null
      if (pane) {
        const i = Math.round(this.ts.index(p.x))
        const bar = this.bars[i]
        // `price` is in THAT pane's scale, so `pane` has to come with it —
        // 63.4 means nothing without knowing it is the RSI pane.
        if (bar) payload = { index: i, bar, price: pane.ps.price(p.y), pane: pane.id }
      }
      for (const fn of this._listeners.crosshair) fn(payload)
    }
    this._updateHover(p)
  }

  /**
   * Topmost marker whose hit circle contains the point, else null.
   * Hit circles come from the last render, so this costs nothing but a loop.
   */
  markerAt(x, y) {
    const hits = this._markerHits
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i]
      const dx = x - h.x
      const dy = y - h.y
      if (dx * dx + dy * dy <= h.r * h.r) return h.marker
    }
    return null
  }

  _updateHover(p) {
    const hit = p ? this.markerAt(p.x, p.y) : null
    const id = hit ? hit.id : null
    if (id === this._hoverMarkerId) return
    this._hoverMarkerId = id
    this.container.style.cursor = hit ? 'pointer' : 'crosshair'
    // the hover ring is drawn with the markers, so that layer must repaint
    this.loop.invalidate('main')
    for (const fn of this._listeners.markerHover) fn(hit)
  }

  subscribe(event, fn) {
    const set = this._listeners[event]
    if (!set) throw new Error(`Chart: unknown event "${event}"`)
    set.add(fn)
    // 'visibleRange' is a state event, not a notification: a new subscriber is
    // told the CURRENT window straight away, so it never has to wait for the
    // user to pan before it knows what is on screen.
    // The immediate call is wrapped because a throw here would escape BEFORE
    // the unsubscriber is returned, leaving the listener registered with no
    // way for the caller to ever remove it.
    if (event === 'visibleRange') {
      const payload = this.visibleRange()
      this._stateKeys.visibleRange.set(fn, this._rangeIdentity(payload))
      try { fn(payload) } catch (e) { console.error("[Emberwick] 'visibleRange' listener threw", e) }
    }
    // 'replay' is a state event for the same reason: a transport UI can render
    // itself from the first call instead of waiting for the first tick.
    if (event === 'replay') {
      const payload = this.replayState()
      this._stateKeys.replay.set(fn, this._replayIdentity(payload))
      try { fn(payload) } catch (e) { console.error("[Emberwick] 'replay' listener threw", e) }
    }
    return () => {
      set.delete(fn)
      const keys = this._stateKeys[event]
      if (keys) keys.delete(fn)
    }
  }

  // ------------------------------------------------------------------ range --
  /**
   * The window currently on screen. Cheap enough to poll, though
   * subscribe('visibleRange', fn) is the better way to track it.
   */
  visibleRange() {
    const { from, to } = this.ts.visibleRange()
    return this._rangePayload(from, to)
  }

  _rangePayload(from, to) {
    const n = this.bars.length
    return {
      from,
      to,
      fromTime: n ? this.bars[from].time : null,
      toTime: n ? this.bars[to].time : null,
      barCount: n,
      spacing: this.ts.spacing,
      settled: this.ts.settled,
    }
  }

  _rangeIdentity(p) {
    return `${p.from}:${p.to}:${p.fromTime}:${p.toTime}:${p.settled ? 1 : 0}`
  }

  /**
   * Fires only when the window actually changed, so a consumer can hang a
   * fetch off it without debouncing. Two deliberate choices:
   *
   * - `spacing` is NOT part of the identity. It is a float that moves on every
   *   frame of an eased zoom, so keying on it would make this a 60/sec
   *   firehose. It is still reported, for level-of-detail decisions.
   * - `settled` IS part of the identity, so the final event of a gesture
   *   always arrives with settled:true. Without it, code that defers expensive
   *   work until the view stops moving would wait forever.
   */
  _emitVisibleRange(from, to) {
    this._emitState('visibleRange', this._rangePayload(from, to), this._rangeIdentity)
  }

  /**
   * Deliver a state event to every listener that has not already seen this
   * exact state. Keys are per-listener, so one subscriber can never suppress
   * another's update, and a brand-new listener (no key yet) always gets one.
   */
  _emitState(event, payload, identity) {
    const set = this._listeners[event]
    if (!set.size) return
    const key = identity.call(this, payload)
    const keys = this._stateKeys[event]
    for (const fn of set) {
      if (keys.get(fn) === key) continue
      // Record BEFORE calling: a listener that throws has still had its turn,
      // and leaving the key unset would re-deliver the same state every frame.
      keys.set(fn, key)
      // State events are emitted from inside the frame, so an unguarded throw
      // here counts against Loop's consecutive-error budget — ten of them and
      // a consumer's own buggy handler stops the chart.
      try {
        fn(payload)
      } catch (e) {
        console.error(`[Emberwick] '${event}' listener threw`, e)
      }
    }
  }

  // ----------------------------------------------------------------- replay --
  /**
   * Start bar-by-bar playback over a fixed dataset.
   *
   * With no `bars`, the chart's CURRENT data becomes the dataset — the usual
   * case: load history, then replay it. The chart is not switched into a
   * special mode; it is simply handed the revealed prefix, so scales,
   * annotations, the crosshair and visibleRange all keep behaving normally.
   *
   *   chart.startReplay({ from: 200, speed: 4 })
   *   chart.replay.play()
   *
   * @param {object} [options]
   * @param {Bar[]} [options.bars]          dataset (defaults to current bars)
   * @param {number} [options.from]         starting index (default: midpoint)
   * @param {number} [options.speed]        rate multiplier, 0.25–500
   * @param {number} [options.baseInterval] real ms per bar at 1× (default 1000)
   * @param {boolean} [options.loop]        restart at the end
   * @param {boolean} [options.follow]      re-anchor the right edge on scrub
   * @returns {Replay|null} null if there are fewer than two bars to replay
   */
  startReplay(options = {}) {
    const source =
      Array.isArray(options.bars) && options.bars.length
        ? options.bars
        : this._replay
          ? this._replay.source
          : this.bars
    if (!source || source.length < 2) return null
    // Snapshot BEFORE the controller starts swapping prefixes in, otherwise
    // the dataset would be the live array it is about to shorten.
    const dataset = source.slice()
    this._barGen++ // an in-flight history page no longer belongs to these bars
    // The caller still holds whatever the previous startReplay() returned;
    // without detaching, its transport methods keep driving this chart.
    if (this._replay) this._replay.detach()
    // Inferred ONCE from the whole dataset. The controller hands it back on
    // every prefix swap so the scales never have to guess from two bars.
    const timeframeMs = inferTimeframe(dataset, this.ts.timeframeMs)
    this._replay = new Replay(this, { ...options, bars: dataset, timeframeMs })
    return this._replay
  }

  /** Leave replay and reveal the whole dataset again. */
  stopReplay() {
    if (!this._replay) return
    const full = this._replay.source
    this._replay.detach()
    this._replay = null
    this.setData(full) // snaps back to the right edge, like any fresh data
  }

  /** The active controller, or null. */
  get replay() {
    return this._replay
  }

  /** Current playback state; `{ active: false, ... }` when not replaying. */
  replayState() {
    return this._replay ? this._replay.state() : inactiveReplay()
  }

  _replayIdentity(p) {
    return `${p.active ? 1 : 0}:${p.playing ? 1 : 0}:${p.index}:${p.length}:${p.speed}`
  }

  /**
   * Emitted from the frame, like visibleRange, so a handler can safely touch
   * the chart. Keyed on cursor + transport, not on the payload object, so a
   * paused replay emits nothing at all.
   */
  _emitReplay() {
    this._emitState('replay', this.replayState(), this._replayIdentity)
  }

  // ----------------------------------------------------------------- panes --
  /**
   * Add a pane below the existing ones.
   *
   * A pane is a horizontal band with its own price scale, sharing the time
   * axis. Route a series to it with setSeries(id, { pane }). This is what an
   * oscillator needs: RSI on 0..100 cannot share a scale with a price near
   * 24,000 without flattening the candles into a line.
   *
   *   chart.addPane('rsi', { weight: 1 })
   *   chart.setSeries('rsi14', { data: points, pane: 'rsi' })
   */
  addPane(id, options = {}) {
    if (id == null) throw new Error('Chart: addPane() needs an id')
    const key = String(id)
    if (this._paneById.has(key)) throw new Error(`Chart: pane "${key}" already exists`)
    const pane = new Pane(key, options, { priceScale: this.options.priceScale })
    this._panes.push(pane)
    this._paneById.set(key, pane)
    this._layout()
    this.loop.invalidate('all')
    return paneInfo(pane, this._seriesIdsFor(key))
  }

  /** Remove a pane and every series routed to it. The price pane cannot go. */
  removePane(id) {
    const key = String(id)
    if (key === PRICE_PANE) throw new Error('Chart: the price pane cannot be removed')
    const pane = this._paneById.get(key)
    if (!pane) return this
    for (const [sid, entry] of this._series) {
      if (entry.opts.pane === key) this._series.delete(sid)
    }
    this._panes.splice(this._panes.indexOf(pane), 1)
    this._paneById.delete(key)
    this._layout()
    this.loop.invalidate('all')
    return this
  }

  /** Every pane, top to bottom. panes()[0] is always the price pane. */
  panes() {
    return this._panes.map((p) => paneInfo(p, this._seriesIdsFor(p.id)))
  }

  pane(id) {
    const p = this._paneById.get(String(id))
    return p ? paneInfo(p, this._seriesIdsFor(p.id)) : null
  }

  /** A pane's live PriceScale — for positioning host overlays. */
  paneScale(id) {
    const p = this._paneById.get(String(id))
    return p ? p.ps : null
  }

  /** A copy of a pane's rect, in CSS px. */
  paneRect(id) {
    const p = this._paneById.get(String(id))
    return p ? { ...p.rect } : null
  }

  _seriesIdsFor(paneId) {
    const out = []
    for (const [sid, entry] of this._series) if (entry.opts.pane === paneId) out.push(sid)
    return out
  }

  // ---------------------------------------------------------------- series --
  /**
   * Create or update a series.
   *
   * A series is an arbitrary y-value over the bar time axis — an indicator
   * overlay, an equity curve, anything expressible as { time, value }.
   * Calling it again with the same id updates in place, so a host can toggle
   * one of twelve indicators without rebuilding the rest. Insertion order is
   * draw order.
   *
   *   chart.setSeries('ema20', { data: points, color: '#c084fc' })
   *
   * A point whose value is absent, null or non-numeric is a GAP: it lifts the
   * pen rather than being drawn as zero or interpolated across.
   */
  setSeries(id, options = {}) {
    if (id == null) throw new Error('Chart: setSeries() needs an id')
    const key = String(id)
    // Refuse rather than defaulting to the price pane. A typo'd pane id would
    // otherwise put an RSI at 50 through the price scale's autoscale on a
    // 24,000 instrument, flattening the candles into a line — exactly the
    // failure panes exist to prevent, arriving with no error at all.
    if (options.pane != null && !this._paneById.has(String(options.pane))) {
      throw new Error(
        `Chart: setSeries("${key}") names pane "${options.pane}", which does not exist — ` +
          `call chart.addPane(${JSON.stringify(String(options.pane))}) first`,
      )
    }
    const existing = this._series.get(key)
    const opts = normalizeSeries(options, key)
    if (existing) {
      existing.opts = opts
      if ('data' in options) this._applySeriesData(existing, options.data)
    } else {
      const entry = {
        opts,
        points: [],
        drawable: [],
        resolveKey: '',
      }
      this._series.set(key, entry)
      if ('data' in options) this._applySeriesData(entry, options.data)
    }
    this.loop.invalidate('main')
    return this
  }

  /** Replace one series' points, leaving its presentation options alone. */
  setSeriesData(id, points) {
    const entry = this._series.get(String(id))
    if (!entry) return this
    this._applySeriesData(entry, points)
    this.loop.invalidate('main')
    return this
  }

  /** Show or hide a series. Hidden series do not influence autoscale. */
  setSeriesVisible(id, visible) {
    const entry = this._series.get(String(id))
    if (!entry) return this
    entry.opts.visible = visible !== false
    this.loop.invalidate('main')
    return this
  }

  removeSeries(id) {
    if (this._series.delete(String(id))) this.loop.invalidate('main')
    return this
  }

  clearSeries() {
    if (this._series.size) {
      this._series.clear()
      this.loop.invalidate('main')
    }
    return this
  }

  /** Every series' options, in draw order. Point data is not copied. */
  getSeries() {
    return [...this._series.values()].map((e) => ({ ...e.opts }))
  }

  _applySeriesData(entry, points) {
    entry.points = normalizeSeriesPoints(points)
    entry.drawable = []
    entry.resolveKey = '' // force re-resolution on the next frame
  }

  // ----------------------------------------------------------- annotations --
  /** Replace every marker. Each `time` is resolved to its nearest bar. */
  setMarkers(markers) {
    this._markers = normalizeMarkers(markers)
    // The hovered marker may not exist any more; keeping its id would report
    // a hover on something no marker owns.
    this._hoverMarkerId = null
    this._resolveKey = '' // force re-resolution on the next frame
    if (this._replay) this._replay.invalidateMarkers()
    this.loop.invalidate('main')
  }

  /** The current markers, normalised, each with its resolved bar index. */
  getMarkers() {
    return this._markers.slice()
  }

  addMarker(marker) {
    this.setMarkers(this._markers.concat([marker]))
  }

  removeMarker(id) {
    const key = String(id)
    this.setMarkers(this._markers.filter((m) => m.id !== key))
  }

  clearMarkers() {
    this.setMarkers([])
  }

  /** Horizontal lines — entries, stops, targets, alerts. */
  setPriceLines(lines) {
    this.priceLines = Array.isArray(lines) ? lines.slice() : []
    this.loop.invalidate('main')
  }

  /** Shaded regions: a price band ({from,to}) or a time band ({fromTime,toTime}). */
  setZones(zones) {
    this.zones = Array.isArray(zones) ? zones.slice() : []
    this.loop.invalidate('all')
  }

  // ----------------------------------------------------------------- frame --
  _frame(dirty, dt) {
    let animating = false

    // First: replay may append or swap bars, and everything below reads them.
    // It returns true while playing, which both keeps the loop awake and
    // forces the full redraw the newly revealed bar needs.
    if (this._replay && this._replay.tick(dt)) animating = true

    if (this.ts.tick(dt)) animating = true

    const dx = this.inertia.tick(dt)
    if (dx) {
      this.ts.panBy(dx)
      animating = true
      this._maybeLoadHistory()
    }

    if (this.live.tick(dt)) animating = true

    const { from, to } = this.ts.visibleRange()
    const lastIdx = this.bars.length - 1
    const liveBar = this.bars.length ? this.live.read(this.bars[lastIdx]) : null
    const liveVisible = liveBar && to >= lastIdx ? liveBar : null

    // Series indices go stale for the same reasons marker indices do, plus
    // whenever a series' own data is replaced — which is why they cannot
    // share _resolveKey.
    const barKey = this._barGen + ':' + this.bars.length
    for (const pane of this._panes) pane.visible.length = 0
    for (const entry of this._series.values()) {
      // New data clears resolveKey outright, so this covers both causes:
      // the bar array shifting, and the series' own points being replaced.
      const key = barKey
      if (key !== entry.resolveKey) {
        entry.drawable = resolveSeriesPoints(entry.points, this.bars, this.ts.timeframeMs)
        entry.resolveKey = key
      }
      if (!entry.opts.visible) continue
      // setSeries refuses an unknown pane, so this only falls back if a pane
      // was removed out from under a series that outlived it.
      const pane = this._paneById.get(entry.opts.pane) || this._panes[0]
      pane.visible.push(entry)
    }
    const visibleSeries = this._panes[0].visible

    // Autoscale over the bars AND every visible series: a value outside the
    // candle range would otherwise be drawn and then clipped at the edge.
    if (this.bars.length) {
      for (const pane of this._panes) {
        pane.ps.beginFit()
        // Only the price pane is fitted to the bars. A sub-pane is scaled by
        // its own series alone — an RSI on 0..100 must not see a price.
        if (pane === this._panes[0]) pane.ps.considerBars(this.bars, from, to, liveVisible)
        for (const entry of pane.visible) {
          const ext = seriesExtent(entry.drawable, from, to)
          if (isFinite(ext.min)) pane.ps.consider(ext.min, ext.max)
        }
        pane.ps.endFit()
      }
    }
    // Every pane ticks, every frame. `animating || pane.ps.tick(dt)` would
    // short-circuit once one pane reported motion and freeze the rest.
    for (const pane of this._panes) {
      if (pane.ps.tick(dt)) animating = true
    }

    const redrawAll = animating || dirty.has('all') || dirty.has('base') || dirty.has('main')
    const state = {
      theme: this.theme,
      ts: this.ts,
      ps: this.ps,
      plot: this.plot,
      bars: this.bars,
      width: this.layers.width,
      height: this.layers.height,
      live: liveVisible,
      volumeRatio: this.options.volumeRatio,
      cursor: this.cursor,
      magnet: this.options.magnet,
      priceLines: this.priceLines,
      zones: this.zones,
      series: visibleSeries,
      watermark: this.options.watermark,
      fmt: this.fmt,
      /** Bottom of the LAST pane — where the shared time axis belongs. */
      plotBottom: this._panes[this._panes.length - 1].rect.y + this._panes[this._panes.length - 1].rect.h,
    }

    // Markers past the replay cursor are future information — hidden, not
    // clamped, because time→index resolution snaps to the NEAREST bar and
    // would otherwise pile them all onto the newest revealed candle.
    let markers = this._markers
    if (this._replay && markers.length) markers = this._replay.markerFilter(markers)

    // Marker indices only go stale when the bar array shifts: a prepended
    // history page renumbers every bar, an append does not.
    if (markers.length) {
      const key =
        markers.length + ':' + this.bars.length + ':' + (this.bars.length ? this.bars[0].time : 0)
      if (key !== this._resolveKey) {
        // One timeframe of slack: a marker further outside the loaded range
        // than that resolves to -1 and is hidden, rather than clamping onto
        // the first or last bar as if it happened there.
        resolveMarkers(markers, this.bars, this.ts.timeframeMs)
        this._resolveKey = key
      }
    }

    if (redrawAll) {
      drawGrid(this.layers.ctx.base, state)
      drawWatermark(this.layers.ctx.base, state)
      // Sub-panes draw their own horizontal grid and price labels. drawGrid
      // has already cleared and painted the background for the whole canvas —
      // exactly one renderer clears each layer, which is what lets this be an
      // append rather than a restructure.
      for (let i = 1; i < this._panes.length; i++) {
        drawPriceAxis(this.layers.ctx.base, this._paneState(state, this._panes[i]))
      }
      drawZones(this.layers.ctx.base, state)
      drawCandles(this.layers.ctx.main, state)
      drawSeries(this.layers.ctx.main, state)
      for (let i = 1; i < this._panes.length; i++) {
        drawSeries(this.layers.ctx.main, this._paneState(state, this._panes[i]))
      }
      drawPriceLines(this.layers.ctx.main, state)
      this._markerHits = drawMarkers(
        this.layers.ctx.main,
        state,
        layoutMarkers(markers, state),
        this._hoverMarkerId,
      )
    }
    if (redrawAll || dirty.has('overlay')) {
      // The crosshair belongs to whichever pane the pointer is in, so its
      // price tag reads that pane's scale rather than the price pane's.
      const hot = this.cursor ? paneAtY(this._panes, this.cursor.y) : null
      drawCrosshair(
        this.layers.ctx.overlay,
        hot && hot !== this._panes[0] ? this._paneState(state, hot) : state,
      )
    }

    // Emitted after drawing, deliberately: a handler is free to call
    // setData() or setMarkers(), and by this point the renderers have
    // finished reading the state it would mutate.
    this._emitVisibleRange(from, to)
    this._emitReplay()

    return animating
  }

  // ------------------------------------------------------------------- api --
  get fps() { return this.loop.fps }

  setTheme(theme) {
    this.theme = { ...this.theme, ...theme }
    this._layout()
    this.loop.invalidate('all')
  }

  /**
   * The PRICE pane's scale only, deliberately — not a loop over the panes the
   * way a reset is. Log is a statement about prices; an oscillator bounded on
   * 0..100 has no business on one, and RSI 0 has no logarithm at all.
   */
  setPriceMode(mode) {
    this.ps.setMode(mode)
    this.loop.invalidate('all')
  }

  setAnimate(on) {
    this.live.enabled = !!on
    this.loop.invalidate('all')
  }

  setMagnet(on) {
    this.options.magnet = !!on
    this.loop.invalidate('overlay')
  }

  /**
   * Zoom and scroll so the whole dataset is on screen.
   *
   * The normal opening move for a finished dataset — a backtest, a replay
   * tape — where the useful first view is the whole run, not the last hundred
   * bars at the default zoom. Not animated: see TimeScale#fitContent.
   *
   * Returns false when there are fewer than two bars to fit.
   */
  fitContent() {
    if (this._destroyed || !this._laidOut()) return false
    if (!this.ts.fitContent(this.bars.length)) return false
    this.inertia.stop()
    this._resetAutoScales()
    this.loop.invalidate('all')
    return true
  }

  /**
   * Open on a WINDOW of the data rather than all of it.
   *
   *   chart.setData(bars)
   *   chart.setVisibleRange({ from: 0, to: 99 })
   *
   * fitContent() for a run you mean to read forward. Fitting a finished
   * backtest whole is the honest view of the dataset and a useless first
   * impression — 29,000 bars across an 832px plot is 0.03px each, every
   * series collapses onto every other and layoutMarkers thins the trades to
   * one per four pixels. The rest of the run stays loaded and pannable: this
   * is a view, not a filter.
   *
   * Inclusive bar indices. An object rather than two arguments so the window
   * is named the way visibleRange() already names it, and so the
   * { fromTime, toTime } variant this will eventually want arrives as a field
   * rather than as a second method.
   *
   * Ends outside the data CLAMP — see TimeScale#setVisibleRange. False is kept
   * for what no clamp can rescue: a destroyed chart, fewer than two bars
   * loaded, ends that are not numbers. So a call that raced the data load is
   * still loud rather than quietly showing some other window.
   *
   * Reading the window back is not the identity of setting it: visibleRange()
   * reports the partly visible bar at each edge too, so it answers a bar or
   * two wider than the window you named. Save what you SET.
   *
   * Not animated, for the reason fitContent() is not.
   */
  setVisibleRange(range) {
    if (this._destroyed || !range || !this._laidOut()) return false
    if (!this.ts.setVisibleRange(range.from, range.to)) return false
    this.inertia.stop()
    this._resetAutoScales()
    this.loop.invalidate('all')
    return true
  }

  snapToRealtime() {
    this.ts.snapToRealtime()
    this.inertia.stop()
    this._resetAutoScales()
    this.loop.invalidate('all')
  }

  /**
   * Whether the container has a width worth fitting a view against.
   *
   * A view is computed from the plot width and nothing recomputes it on the
   * next layout, so a fit against a container that has not been laid out yet
   * — a mount effect that beats the browser to it, or an element still
   * display:none — is not merely approximate, it is wrong for good, and it
   * drags minSpacing down to the fit floor on the way. TimeScale.resize
   * clamps width to a minimum of 1, so 1 IS the "no layout yet" reading, and
   * a chart genuinely one pixel wide has nothing to show either way.
   *
   * False rather than a deferred fit: all three callers return a boolean the
   * caller can branch on, and "I will do it later" is the kind of answer that
   * gets discovered months afterwards.
   */
  _laidOut() {
    return this.plot.w > 1
  }

  /**
   * Every pane back to autoscale, not just the price pane.
   *
   * A view change re-frames what is on screen, so a pane still holding a
   * hand-set range is describing bars that are no longer there. `this.ps` is
   * a getter onto _panes[0] and was written when that was the only scale
   * there was — the same pane-blindness the crosshair payload had, and it
   * became reachable the moment a drag beside a sub-pane could stretch that
   * sub-pane: double-click is the documented way out of a hand-set scale, and
   * it was releasing a pane the user had never touched.
   */
  _resetAutoScales() {
    for (const pane of this._panes) pane.ps.resetAuto()
  }

  /**
   * Restart the render loop after it gave up on consecutive frame errors.
   *
   * The loop stops itself after ten failing frames in a row and reports the
   * last error through the 'error' event. Fix the cause — a lost canvas
   * context is the usual one — then call this. Returns false if the chart is
   * destroyed or the loop is already running, so it is safe to call blindly.
   */
  resume() {
    if (this._destroyed || this.loop.running) return false
    this.loop.start()
    return true
  }

  /**
   * Re-measure the container and canvases now.
   *
   * Resizes and devicePixelRatio changes are detected automatically; this is
   * the escape hatch for the cases that are not observable from inside the
   * element — a CSS transition on an ancestor, a container revealed from
   * display:none, or a layout the host framework drives imperatively.
   */
  /**
   * Format every rendered timestamp in `zone` — an IANA name such as
   * 'Asia/Kolkata', or null for the browser's local zone.
   *
   * Display only. Bar times remain the ms epochs you supplied, and everything
   * the chart hands back — the crosshair payload, visibleRange, marker times
   * — is still in those terms.
   */
  setTimeZone(zone) {
    this.fmt = createTimeFormatter(zone || null)
    this.loop.invalidate('all')
    return this
  }

  resize() {
    if (this._destroyed) return
    this.layers.measure()
  }

  toImage() {
    return this.layers.composite().toDataURL('image/png')
  }

  destroy() {
    // Idempotent: Layers.destroy() throws on an already-emptied canvas map,
    // and both framework adapters can unmount twice (React StrictMode).
    if (this._destroyed) return
    this._destroyed = true
    const el = this.container
    el.removeEventListener('pointerdown', this._onDown)
    el.removeEventListener('pointermove', this._onMove)
    el.removeEventListener('pointerup', this._onUp)
    el.removeEventListener('pointercancel', this._onCancel)
    el.removeEventListener('pointerleave', this._onLeave)
    el.removeEventListener('wheel', this._onWheel)
    el.removeEventListener('dblclick', this._onDbl)
    el.removeEventListener('keydown', this._onKey)
    el.removeEventListener('click', this._onClick)
    this.detachFeed()
    this.loop.stop()
    this.layers.destroy()
    for (const set of Object.values(this._listeners)) set.clear()
    for (const keys of Object.values(this._stateKeys)) keys.clear()
    if (this._replay) this._replay.detach()
    this._replay = null
    this._panes.length = 1
    this._paneById = new Map([[PRICE_PANE, this._panes[0]]])
    this._series.clear()
    this._markers = []
    this._markerHits = []
    this.priceLines = []
    this.zones = []
    this.bars = []
  }
}
