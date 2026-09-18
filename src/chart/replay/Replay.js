/**
 * Replay — bar-by-bar playback over a fixed dataset.
 *
 * The chart is never put into a special "replay mode". This controller holds
 * the full dataset aside and hands the chart only the REVEALED PREFIX, so the
 * scales, annotations, crosshair and range events all behave exactly as they
 * do on live data that happens to end at the cursor. Nothing downstream needs
 * to know replay exists.
 *
 * Motion reuses the engine that is already there:
 *
 * - revealing the NEXT bar goes through `Chart.append()` — the same path a
 *   feed tick takes — so the candle grows in and the time axis glides;
 * - scrubbing swaps the prefix and jumps, because easing a drag reads as lag
 *   (the same rule the pan gesture follows).
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/** Playback rate bounds, as a multiple of one bar per `baseInterval`. */
export const MIN_SPEED = 0.25
export const MAX_SPEED = 500

/**
 * Ceiling on bars revealed in one frame. At 500× that is ~8 bars/frame, so
 * this only ever bites after a tab has been backgrounded and dt is huge.
 */
const MAX_STEPS_PER_FRAME = 240

export class Replay {
  constructor(chart, options = {}) {
    const src = Array.isArray(options.bars) ? options.bars : []

    this.chart = chart
    /** The full dataset. Never mutated. */
    this.source = src.slice()
    /** Real ms one bar takes at speed 1. Default: one bar per second. */
    this.baseInterval = Math.max(16, +options.baseInterval || 1000)
    this.speed = clamp(+options.speed || 1, MIN_SPEED, MAX_SPEED)
    /** Restart from the beginning instead of stopping at the end. */
    this.looping = options.loop === true
    /** Re-anchor the right edge on the cursor when scrubbing. */
    this.follow = options.follow !== false
    this.playing = false

    this._acc = 0
    this._markerKey = ''
    this._markerView = null
    /**
     * A controller replaced by a second startReplay() is no longer ticked by
     * the chart, but the caller still holds the object returned by the first
     * call — and its transport methods would happily keep swapping bars into
     * a chart that has moved on. Detaching neuters it.
     */
    this._detached = false

    // The scales infer the timeframe from the first PAIR of bars, so two bars
    // is the floor — the cursor never goes below index 1.
    this.minIndex = Math.min(1, this.lastIndex)

    const from = +options.from
    this.index = clamp(
      Number.isFinite(from) ? Math.round(from) : Math.floor(this.lastIndex / 2),
      this.minIndex,
      this.lastIndex,
    )

    this._apply('seek')
  }

  // ----------------------------------------------------------------- state --
  get length() { return this.source.length }
  get lastIndex() { return Math.max(0, this.source.length - 1) }
  get atEnd() { return this.index >= this.lastIndex }
  get bar() { return this.source[this.index] || null }
  get time() { return this.bar ? this.bar.time : null }

  /** 0 at the first playable bar, 1 at the last. */
  get progress() {
    const span = this.lastIndex - this.minIndex
    return span > 0 ? (this.index - this.minIndex) / span : 1
  }

  /** Real ms between bars at the current speed. */
  get interval() { return this.baseInterval / this.speed }

  /** Snapshot handed to `subscribe('replay', fn)`. */
  state() {
    return {
      active: true,
      playing: this.playing,
      index: this.index,
      length: this.length,
      progress: this.progress,
      speed: this.speed,
      time: this.time,
      bar: this.bar,
      atEnd: this.atEnd,
    }
  }

  // ------------------------------------------------------------- transport --
  /** Stop this controller from ever touching the chart again. Idempotent. */
  detach() {
    this._detached = true
    this.playing = false
    return this
  }

  play() {
    if (this._detached || this.playing || this.length < 2) return this
    // Pressing play at the end restarts, rather than doing nothing.
    if (this.atEnd) {
      this.index = this.minIndex
      this._apply('seek')
    }
    this.playing = true
    this._acc = 0
    this._changed()
    return this
  }

  pause() {
    if (!this.playing) return this
    this.playing = false
    this._acc = 0
    this._changed()
    return this
  }

  toggle() { return this.playing ? this.pause() : this.play() }

  /** Multiplier on `baseInterval`. Clamped to 0.25×–500×. */
  setSpeed(speed) {
    const s = clamp(+speed || 1, MIN_SPEED, MAX_SPEED)
    if (s === this.speed) return this
    this.speed = s
    this._acc = 0 // no burst of bars when the rate jumps
    this._changed()
    return this
  }

  setLoop(on) {
    this.looping = !!on
    this._changed()
    return this
  }

  /** Move the cursor. Out-of-range values clamp; playback keeps running. */
  seek(index) {
    const n = Math.round(+index)
    // clamp() compares with < and >, and every comparison against NaN is
    // false, so NaN passes straight through and slice(0, NaN) blanks the
    // chart. Every other numeric entry point here is already defensive.
    if (!Number.isFinite(n)) return this
    const next = clamp(n, this.minIndex, this.lastIndex)
    if (this._detached || next === this.index) return this
    this.index = next
    this._acc = 0
    this._apply('seek')
    this._changed()
    return this
  }

  step(n = 1) { return this.seek(this.index + (n || 0)) }
  toStart() { return this.seek(this.minIndex) }
  toEnd() { return this.seek(this.lastIndex) }

  /**
   * Advance with wall-clock time. Called once per frame by the chart; returns
   * true while playback is in flight, which is what keeps the loop awake.
   */
  tick(dt) {
    if (this._detached || !this.playing || this.length < 2) return false

    this._acc += dt * this.speed
    const steps = Math.floor(this._acc / this.baseInterval)
    if (steps <= 0) return true // playing, just not due for the next bar yet
    this._acc -= steps * this.baseInterval

    const last = this.lastIndex
    let next = this.index + Math.min(steps, MAX_STEPS_PER_FRAME)

    if (next > last) {
      if (this.looping) {
        this.index = this.minIndex
        this._apply('seek')
        this._changed()
        return true
      }
      next = last
    }

    const single = next === this.index + 1
    this.index = next
    this._apply(single ? 'step' : 'seek')
    if (this.atEnd && !this.looping) {
      this.playing = false
      this._acc = 0
    }
    this._changed()
    return this.playing
  }

  // --------------------------------------------------------------- markers --
  /**
   * Markers after the cursor are future information: hidden, not clamped.
   * Without this they would all pin to the newest revealed bar, because
   * time→index resolution snaps to the NEAREST bar.
   *
   * Cached on the cursor, so a paused chart allocates nothing per frame.
   */
  markerFilter(markers) {
    const t = this.time
    if (t == null) return markers
    const key = this.index + ':' + markers.length
    if (key !== this._markerKey || !this._markerView) {
      const cut = t + (this.chart.ts.timeframeMs || 0) / 2
      this._markerView = markers.filter((m) => m.time <= cut)
      this._markerKey = key
    }
    return this._markerView
  }

  /** Drop the cached slice — the marker set itself changed. */
  invalidateMarkers() {
    this._markerKey = ''
    this._markerView = null
  }

  // ---------------------------------------------------------------- private --
  /**
   * Push the revealed prefix into the chart.
   *
   * 'step' (exactly one bar forward) takes the live path so the new candle
   * animates; anything else swaps the prefix and re-anchors without easing.
   */
  _apply(mode) {
    // The single gate on touching the chart: a detached controller must not
    // swap bars underneath whatever replaced it.
    if (this._detached) return
    const chart = this.chart
    if (mode === 'step' && chart.bars.length === this.index) {
      chart.append(this.source[this.index])
      return
    }
    chart._swapBars(this.source.slice(0, this.index + 1))
    if (this.follow) chart.ts.jumpToRealtime()
  }

  /** Any state change needs a frame: that frame is what emits 'replay'. */
  _changed() {
    if (this._detached) return
    this.chart.loop.invalidate('main')
  }
}
