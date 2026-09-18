import { Smoothed } from '../motion/Tween.js'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/**
 * TimeScale — maps bar index <-> x pixels.
 *
 * Two smoothed values define the view:
 *   spacing : px per bar (zoom)
 *   right   : float bar index sitting at the right edge of the plot
 *
 * Both are Smoothed, so a wheel zoom eases instead of stepping, and new bars
 * glide in rather than jumping. Dragging uses jump() so the chart stays glued
 * to the pointer — easing a drag feels like lag, not smoothness.
 */
export class TimeScale {
  constructor({ spacing = 9, minSpacing = 0.8, maxSpacing = 160, rightOffset = 12 } = {}) {
    this.minSpacing = minSpacing
    this.maxSpacing = maxSpacing
    this.rightOffset = rightOffset
    this.width = 0
    this.barCount = 0
    this.follow = true
    this.timeframeMs = 60000
    this._spacing = new Smoothed(spacing, 65)
    this._right = new Smoothed(rightOffset, 65)
    this._initial = spacing
  }

  get spacing() { return this._spacing.value }
  get right() { return this._right.value }

  resize(w) { this.width = Math.max(1, w) }

  setBarCount(n) {
    const grew = n > this.barCount
    this.barCount = n
    if (this.follow) {
      // target the new last bar; Smoothed turns this into a glide
      const t = n - 1 + this.rightOffset
      if (grew) this._right.set(t)
      else this._right.jump(t)
    }
  }

  x(i) { return this.width - (this._right.value - i) * this._spacing.value }

  /** Centre-x of bar i (bars are drawn centred on their slot). */
  index(x) { return this._right.value - (this.width - x) / this._spacing.value }

  barWidth() {
    const s = this._spacing.value
    // leave a gap between candles, but never thinner than a hairline
    return Math.max(1, Math.floor(s * 0.72))
  }

  visibleRange() {
    const first = Math.floor(this.index(0)) - 1
    const last = Math.ceil(this.index(this.width)) + 1
    return {
      from: clamp(first, 0, Math.max(0, this.barCount - 1)),
      to: clamp(last, 0, Math.max(0, this.barCount - 1)),
    }
  }

  _clampRight(v) {
    const max = this.barCount - 1 + this.rightOffset + this.width / this._spacing.target
    const min = Math.min(4, this.barCount - 1 + this.rightOffset)
    return clamp(v, min, max)
  }

  /** Immediate pan, in pixels. Positive dx drags content right (back in time). */
  panBy(dxPx) {
    if (!dxPx) return false
    const next = this._clampRight(this._right.value - dxPx / this._spacing.value)
    this._right.jump(next)
    this.follow = false
    return true
  }

  /** Zoom by `factor`, keeping the bar under `x` pinned. */
  zoomAt(x, factor) {
    const s0 = this._spacing.target
    const s1 = clamp(s0 * factor, this.minSpacing, this.maxSpacing)
    if (Math.abs(s1 - s0) < 1e-9) return false

    // While following realtime, pin the right edge instead of the cursor so the
    // latest candle stays put — that is what traders expect.
    const anchorX = this.follow ? this.width : x
    const r0 = this._right.target
    const idx = r0 - (this.width - anchorX) / s0
    const r1 = idx + (this.width - anchorX) / s1

    this._spacing.set(s1)
    this._right.set(this._clampRight(r1))
    return true
  }

  snapToRealtime() {
    this.follow = true
    this._right.set(this.barCount - 1 + this.rightOffset)
  }

  /**
   * Same anchor, no easing. Scrubbing re-targets the right edge many times a
   * second; easing each one reads as the chart lagging the scrubber, which is
   * the same reason a drag uses jump().
   */
  jumpToRealtime() {
    this.follow = true
    this._right.jump(this.barCount - 1 + this.rightOffset)
  }

  reset() {
    this._spacing.set(this._initial)
    this.snapToRealtime()
  }

  /** True while the view is still easing. */
  tick(dt) {
    const a = this._spacing.tick(dt)
    const b = this._right.tick(dt)
    return a || b
  }

  get settled() { return this._spacing.settled && this._right.settled }
}
