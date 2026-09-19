/**
 * Loop — ONE requestAnimationFrame loop for the whole chart, driven by
 * dirty flags. 500 feed ticks between two frames still cost one repaint.
 *
 * The frame callback returns `true` while animation is in flight, which is
 * what keeps the loop running; otherwise it idles at zero CPU until something
 * calls invalidate().
 */

/**
 * Consecutive throwing frames tolerated before the loop gives up. A transient
 * error should heal; a permanent one must not spin at 60fps forever.
 */
const MAX_FRAME_ERRORS = 10

export class Loop {
  constructor(onFrame, onGiveUp) {
    this.onFrame = onFrame
    /** Called with the last error when the loop stops itself. Optional. */
    this.onGiveUp = onGiveUp || null
    this._frameErrors = 0
    this.fps = 0
    this._raf = 0
    this._dirty = new Set()
    this._last = 0
    this._running = false
    this._frames = 0
    this._fpsAt = 0
    this._tick = this._tick.bind(this)
  }

  invalidate(...layers) {
    if (!layers.length) this._dirty.add('all')
    else for (const l of layers) this._dirty.add(l)
    this._schedule()
  }

  /** False once the loop has stopped — see Chart#resume(). */
  get running() { return this._running }

  start() {
    if (this._running) return
    this._running = true
    // A restart is a fresh start: without this, a loop that gave up once
    // would give up again after a single further error.
    this._frameErrors = 0
    this._last = performance.now()
    this._fpsAt = this._last
    this.invalidate('all')
  }

  stop() {
    this._running = false
    if (this._raf) cancelAnimationFrame(this._raf)
    this._raf = 0
  }

  _schedule() {
    if (this._raf || !this._running) return
    this._raf = requestAnimationFrame(this._tick)
  }

  _tick(now) {
    this._raf = 0
    if (!this._running) return
    const dt = Math.min(Math.max(now - this._last, 1), 64)
    this._last = now

    this._frames++
    if (now - this._fpsAt >= 500) {
      this.fps = Math.round((this._frames * 1000) / (now - this._fpsAt))
      this._frames = 0
      this._fpsAt = now
    }

    const dirty = this._dirty
    this._dirty = new Set()

    let wantMore = false
    try {
      wantMore = this.onFrame(dirty, dt, now) === true
      this._frameErrors = 0
    } catch (e) {
      // The dirty set was swapped out before the call, so without putting it
      // back a single throw loses the pending layers AND leaves wantMore
      // false — nothing reschedules and the chart freezes for good.
      for (const l of dirty) this._dirty.add(l)
      if (++this._frameErrors >= MAX_FRAME_ERRORS) {
        this._dirty.clear()
        this.stop()
        // stop() clears _running, and _schedule() early-returns while it is
        // false — so nothing, not even invalidate(), can revive the loop from
        // here. Tell the owner, which surfaces it as an 'error' event and
        // makes Chart#resume() the documented way back.
        if (this.onGiveUp) this.onGiveUp(e)
        else console.error(
          `[Emberwick] frame error — stopped after ${MAX_FRAME_ERRORS} consecutive failures`, e)
        return
      }
      console.error('[Emberwick] frame error', e)
    }
    if (wantMore || this._dirty.size) this._schedule()
  }
}
