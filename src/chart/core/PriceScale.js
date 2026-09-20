import { Smoothed } from '../motion/Tween.js'
import { toNumber } from './formatters.js'

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
    this._fitMin = Infinity
    this._fitMax = -Infinity
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

  /**
   * False until fit() has accepted at least one price. While false the bounds
   * are still their 0..1 constructor defaults, which are not a price range —
   * renderers use this to decline to draw an axis rather than invent one.
   */
  get primed() { return this._primed }

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
   * Coerce a price to a plottable number, or NaN if it is not one.
   *
   * Numeric STRINGS are accepted deliberately: Binance, Bybit and Kraken all
   * return OHLC as strings, and rejecting them outright leaves the scale
   * unset and the chart blank with no error at all. Coercing also fixes the
   * original defect, which was that once `min` had become a string the next
   * comparison was lexicographic.
   *
   * null, undefined, booleans and objects are NOT prices. `+null` is 0, and a
   * null low silently dragging the range to zero — flattening every candle
   * into the top of the plot — is exactly what this guard exists to stop.
   * Log mode additionally rejects non-positives: log(0) is -Infinity, and
   * clamping to 1e-9 turns one zero tick into a ~20-decade range.
   */
  _price(v) {
    const n = toNumber(v)
    if (Number.isNaN(n)) return NaN
    return this.mode === 'log' && n <= 0 ? NaN : n
  }

  /**
   * Fitting is a three-step transaction so that more than one kind of thing
   * can influence the range.
   *
   *   ps.beginFit()
   *   ps.considerBars(bars, from, to, extra)
   *   ps.consider(lo, hi)        // once per visible series, say
   *   ps.endFit()
   *
   * Before this, fit() only ever looked at bar highs and lows, so any value
   * that leaves the candle range — an oscillator, an equity curve, a
   * Supertrend or a Bollinger band on a quiet stretch — was drawn and then
   * clipped at the plot edge.
   */
  beginFit() {
    this._fitMin = Infinity
    this._fitMax = -Infinity
  }

  /** Widen the pending range. Non-prices are ignored, not coerced. */
  consider(lo, hi) {
    const a = this._price(lo)
    const b = this._price(hi)
    if (!Number.isNaN(a) && a < this._fitMin) this._fitMin = a
    if (!Number.isNaN(b) && b > this._fitMax) this._fitMax = b
  }

  /** Widen the pending range by the visible bars. `extra` is the live candle. */
  considerBars(bars, from, to, extra) {
    for (let i = from; i <= to; i++) {
      const b = bars[i]
      if (!b) continue
      this.consider(b.low, b.high)
    }
    if (extra) this.consider(extra.low, extra.high)
  }

  /**
   * Apply the pending range.
   *
   * Considering nothing plottable leaves the bounds AND `_primed` untouched,
   * which is what lets a renderer decline to draw an axis rather than invent
   * one. That used to be an accident of the isFinite guard; once every series
   * on a chart can be hidden it stops being one.
   */
  endFit() {
    if (!this.auto) return
    const min = this._fitMin
    const max = this._fitMax
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

  /** Fit visible bars. `extra` lets the forming candle influence the range. */
  fit(bars, from, to, extra) {
    if (!this.auto || !bars.length) return
    this.beginFit()
    this.considerBars(bars, from, to, extra)
    this.endFit()
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
