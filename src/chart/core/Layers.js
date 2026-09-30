/**
 * Layers — stacked canvases sharing one coordinate space.
 *
 * Why: the crosshair repaints on every pointer move, the candles do not.
 * Separate canvases mean moving the cursor never touches candle pixels.
 * All contexts are pre-scaled by devicePixelRatio, so every renderer draws
 * in CSS pixels and gets crisp output on retina.
 */
export class Layers {
  constructor(container, names) {
    this.container = container
    this.names = names
    this.canvas = {}
    this.ctx = {}
    this.width = 0
    this.height = 0
    this.dpr = 0
    this.onResize = null

    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative'
    }

    // A copy, built one canvas at a time: add() and remove() splice this
    // array, and it must never be the caller's.
    this.names = []
    for (const name of names) this._create(name, this.names.length)

    this._ro = new ResizeObserver(() => this.measure())
    this._ro.observe(container)
    this.measure()
    this._watchDpr()
  }

  /**
   * Detect a devicePixelRatio change.
   *
   * ResizeObserver does not fire when a window moves to a different-DPI
   * monitor at the same logical size, and measure()'s only other caller is
   * the constructor — so the dpr branch of its guard was unreachable and the
   * canvases stayed at the old ratio, visibly blurry until something else
   * happened to resize them.
   *
   * A resolution query stops matching the moment the ratio moves, so the
   * listener has to be re-armed against the new value each time.
   */
  _watchDpr() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const arm = () => {
      const dpr = window.devicePixelRatio || 1
      this._dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`)
      this._onDpr = () => {
        this.measure()
        arm()
      }
      this._dprQuery.addEventListener('change', this._onDpr, { once: true })
    }
    arm()
  }

  _unwatchDpr() {
    if (this._dprQuery && this._onDpr) {
      this._dprQuery.removeEventListener('change', this._onDpr)
    }
    this._dprQuery = null
    this._onDpr = null
  }

  /** Create a canvas at stack position `at` and renumber every zIndex. */
  _create(name, at) {
    const c = document.createElement('canvas')
    Object.assign(c.style, {
      position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', pointerEvents: 'none',
    })
    this.container.appendChild(c)
    this.canvas[name] = c
    this.ctx[name] = c.getContext('2d')
    this.names.splice(at, 0, name)
    this.names.forEach((n, i) => { this.canvas[n].style.zIndex = String(i + 1) })
  }

  _size(n) {
    const c = this.canvas[n]
    c.width = Math.floor(this.width * this.dpr)
    c.height = Math.floor(this.height * this.dpr)
    this.ctx[n].setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
  }

  /**
   * Add a canvas directly BELOW `before` (on top when absent). Idempotent.
   * Sized immediately: measure() early-returns while the size is unchanged, so
   * a canvas added after construction would otherwise stay 0x0 until a resize.
   */
  add(name, before) {
    if (this.ctx[name]) return this.ctx[name]
    const i = this.names.indexOf(before)
    this._create(name, i < 0 ? this.names.length : i)
    this._size(name)
    return this.ctx[name]
  }

  remove(name) {
    const c = this.canvas[name]
    if (!c) return
    c.remove()
    delete this.canvas[name]
    delete this.ctx[name]
    this.names.splice(this.names.indexOf(name), 1)
    this.names.forEach((n, i) => { this.canvas[n].style.zIndex = String(i + 1) })
  }

  measure() {
    const r = this.container.getBoundingClientRect()
    const w = Math.max(1, Math.floor(r.width))
    const h = Math.max(1, Math.floor(r.height))
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (w === this.width && h === this.height && dpr === this.dpr) return
    this.width = w
    this.height = h
    this.dpr = dpr
    for (const n of this.names) this._size(n)
    if (this.onResize) this.onResize(w, h)
  }

  /**
   * Flatten `names` (default: every layer) into one canvas. `between(c, name)`
   * runs after each layer is drawn, so a caller can paint an export pass into
   * the stack without touching the live canvases.
   */
  composite(names = this.names, between = null) {
    const out = document.createElement('canvas')
    out.width = Math.floor(this.width * this.dpr)
    out.height = Math.floor(this.height * this.dpr)
    const c = out.getContext('2d')
    for (const n of names) {
      if (this.canvas[n]) c.drawImage(this.canvas[n], 0, 0)
      if (between) between(c, n)
    }
    return out
  }

  destroy() {
    this._unwatchDpr()
    this._ro.disconnect()
    for (const n of this.names) this.canvas[n].remove()
    this.canvas = {}
    this.ctx = {}
  }
}
