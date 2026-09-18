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

    names.forEach((name, i) => {
      const c = document.createElement('canvas')
      Object.assign(c.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: String(i + 1),
      })
      container.appendChild(c)
      this.canvas[name] = c
      this.ctx[name] = c.getContext('2d')
    })

    this._ro = new ResizeObserver(() => this.measure())
    this._ro.observe(container)
    this.measure()
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
    for (const n of this.names) {
      const c = this.canvas[n]
      c.width = Math.floor(w * dpr)
      c.height = Math.floor(h * dpr)
      this.ctx[n].setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    if (this.onResize) this.onResize(w, h)
  }

  /** Flatten all layers into a single canvas (for toImage/export). */
  composite() {
    const out = document.createElement('canvas')
    out.width = Math.floor(this.width * this.dpr)
    out.height = Math.floor(this.height * this.dpr)
    const c = out.getContext('2d')
    for (const n of this.names) c.drawImage(this.canvas[n], 0, 0)
    return out
  }

  destroy() {
    this._ro.disconnect()
    for (const n of this.names) this.canvas[n].remove()
    this.canvas = {}
    this.ctx = {}
  }
}
