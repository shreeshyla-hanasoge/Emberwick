/**
 * Loop — ONE requestAnimationFrame loop for the whole chart, driven by
 * dirty flags. 500 feed ticks between two frames still cost one repaint.
 *
 * The frame callback returns `true` while animation is in flight, which is
 * what keeps the loop running; otherwise it idles at zero CPU until something
 * calls invalidate().
 */
export class Loop {
  constructor(onFrame) {
    this.onFrame = onFrame
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

  start() {
    if (this._running) return
    this._running = true
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
    } catch (e) {
      console.error('[Emberwick] frame error', e)
    }
    if (wantMore || this._dirty.size) this._schedule()
  }
}
