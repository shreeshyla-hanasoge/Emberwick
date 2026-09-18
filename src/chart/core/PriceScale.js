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

  /**
   * Is this a price this scale can actually plot?
   *
   * `isFinite(null)` is TRUE — null numifies to 0 — so a bar carrying a null
   * low used to sail through the old isFinite() guard and drag the minimum to
   * zero, flattening every candle into the top of the plot. Log mode has the
   * same problem from the other end: log(0) is -Infinity, and the clamp to
   * 1e-9 turns one zero tick into a ~20-decade range.
   */
  _plottable(v) {
    return typeof v === 'number' && isFinite(v) && (this.mode !== 'log' || v > 0)
  }

  /** Fit visible bars. `extra` lets the forming candle influence the range. */
  fit(bars, from, to, extra) {
    if (!this.auto || !bars.length) return
    let min = Infinity
    let max = -Infinity
    const consider = (lo, hi) => {
      if (this._plottable(lo) && lo < min) min = lo
      if (this._plottable(hi) && hi > max) max = hi
    }
    for (let i = from; i <= to; i++) {
      const b = bars[i]
      if (!b) continue
      consider(b.low, b.high)
    }
    if (extra) consider(extra.low, extra.high)
    if (!isFinite(min) || !isFinite(max)) return

    let a = this._fwd(min)
    let b = this._fwd(max)
    // marginTop pads the high side, marginBottom the low side. They used to
    // share one `pad` computed from marginTop, which made the documented and
    // typed `marginBottom` option inert.
    const span = b - a
    let padTop = span * this.marginTop
    let padBottom = span * this.marginBottom
    if (!(padTop > 0)) padTop = Math.abs(b) * 0.01 || 1
    if (!(padBottom > 0)) padBottom = Math.abs(a) * 0.01 || 1
    a -= padBottom
    b += padTop

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
