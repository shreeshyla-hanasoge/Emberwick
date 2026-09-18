import { Smoothed } from '../motion/Tween.js'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/**
 * PriceScale — maps price <-> y pixels, with animated autoscale.
 *
 * Bounds live in *transformed* space (identity for linear, log for log), so
 * switching modes is a one-line change and the easing still behaves.
 * The whole point of smoothing here: when a spike arrives the range glides to
 * its new bounds instead of the chart snapping and losing the reader.
 */
export class PriceScale {
  constructor({ mode = 'linear', tau = 120, marginTop = 0.12, marginBottom = 0.12 } = {}) {
    this.mode = mode
    this.marginTop = marginTop
    this.marginBottom = marginBottom
    this.auto = true
    this.top = 0
    this.height = 1
    this._lo = new Smoothed(0, tau)
    this._hi = new Smoothed(1, tau)
    this._primed = false
  }

  _fwd(v) { return this.mode === 'log' ? Math.log(Math.max(v, 1e-9)) : v }
  _inv(v) { return this.mode === 'log' ? Math.exp(v) : v }

  setMode(mode) {
    if (mode === this.mode) return
    const lo = this._inv(this._lo.value)
    const hi = this._inv(this._hi.value)
    this.mode = mode
    this._lo.jump(this._fwd(lo))
    this._hi.jump(this._fwd(hi))
  }

  layout(top, height) {
    this.top = top
    this.height = Math.max(1, height)
  }

  get lo() { return this._inv(this._lo.value) }
  get hi() { return this._inv(this._hi.value) }

  y(price) {
    const a = this._lo.value
    const b = this._hi.value
    const t = (this._fwd(price) - a) / (b - a || 1)
    return this.top + this.height * (1 - t)
  }

  price(y) {
    const a = this._lo.value
    const b = this._hi.value
    const t = 1 - (y - this.top) / this.height
    return this._inv(a + t * (b - a))
  }

  /** Fit visible bars. `extra` lets the forming candle influence the range. */
  fit(bars, from, to, extra) {
    if (!this.auto || !bars.length) return
    let min = Infinity
    let max = -Infinity
    for (let i = from; i <= to; i++) {
      const b = bars[i]
      if (!b) continue
      if (b.low < min) min = b.low
      if (b.high > max) max = b.high
    }
    if (extra) {
      if (extra.low < min) min = extra.low
      if (extra.high > max) max = extra.high
    }
    if (!isFinite(min) || !isFinite(max)) return

    let a = this._fwd(min)
    let b = this._fwd(max)
    let pad = (b - a) * this.marginTop
    if (!(pad > 0)) pad = Math.abs(b) * 0.01 || 1
    a -= pad
    b += (b - a) * 0 + pad

    this._lo.set(a)
    this._hi.set(b)
    if (!this._primed) {
      this._lo.jump(a)
      this._hi.jump(b)
      this._primed = true
    }
  }

  /** Manual axis-drag scaling around the vertical centre. */
  scaleBy(factor) {
    this.auto = false
    const a = this._lo.target
    const b = this._hi.target
    const mid = (a + b) / 2
    const half = ((b - a) / 2) * clamp(factor, 0.2, 5)
    this._lo.set(mid - half)
    this._hi.set(mid + half)
  }

  resetAuto() {
    this.auto = true
  }

  tick(dt) {
    const a = this._lo.tick(dt)
    const b = this._hi.tick(dt)
    return a || b
  }
}
