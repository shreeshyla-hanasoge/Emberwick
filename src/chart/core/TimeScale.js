import { Smoothed } from '../motion/Tween.js'
import { toNumber } from './formatters.js'

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/**
 * Hard floor on bars-per-pixel, whatever fitContent is asked to fit. Below
 * this the arithmetic stops being meaningful long before the pixels do.
 */
const FIT_FLOOR = 0.02

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
    /**
     * True only while a live feed is attached. The right-edge zoom lock below
     * is for charts where new candles keep arriving; a static chart follows
     * realtime too — setData() snaps it there — so keying the lock on `follow`
     * alone applied it to every fresh chart and silently broke the
     * cursor-anchored zoom the README advertises.
     */
    this.live = false
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

    // While following a LIVE feed, pin the right edge instead of the cursor so
    // the latest candle stays put — that is what traders expect. With no feed
    // there is no incoming candle to keep in view, so the cursor wins.
    const anchorX = this.follow && this.live ? this.width : x
    const r0 = this._right.target
    const idx = r0 - (this.width - anchorX) / s0
    const r1 = idx + (this.width - anchorX) / s1

    this._spacing.set(s1)
    this._right.set(this._clampRight(r1))
    return true
  }

  /**
   * Set the zoom so `barCount` bars span the plot, with the last at the right
   * edge. Returns false when there is nothing to fit.
   *
   * Deliberately NOT eased. Easing a 4,000-bar dataset from 9px per bar down
   * to 0.2 reads as a glitch rather than as polish, and the caller asked for
   * a view, not an animation — the same reason a drag uses jump().
   *
   * Fitting is allowed to zoom out past `minSpacing`, and lowers it to match.
   * minSpacing exists to stop a wheel gesture burying the chart in mush; an
   * explicit "show me everything" is a different intent, and clamping it
   * would both hide part of the dataset and leave the next zoom-in jumping
   * discontinuously back up to the old floor.
   */
  fitContent(barCount) {
    const n = Math.floor(barCount)
    if (!(n > 1) || !(this.width > 0)) return false
    return this._window(0, n - 1)
  }

  /**
   * Put bars `from`..`to` inclusive across the plot, `to` at the right edge —
   * fitContent over a window rather than over the whole run, and literally
   * that: setVisibleRange(0, barCount - 1) leaves the scale exactly where
   * fitContent(barCount) does.
   *
   * Indices only. The scale holds no bars, so it cannot turn a time into one;
   * and it holds no loop, so it cannot repaint. Chart#setVisibleRange is the
   * supported entry point and this is the arithmetic underneath it.
   *
   * Ends outside the loaded data CLAMP rather than being refused. An index is
   * written by application logic against a length it often did not know — a
   * window chosen before the data landed, or one computed before a history
   * page renumbered every bar — and refusing there would leave the view
   * wherever it happened to be, which reads as the call having silently done
   * nothing. The clamp is the caller's own arithmetic on barCount, so nothing
   * is decided here that the caller could not have predicted.
   *
   * A one-bar window is WIDENED to two rather than refused. Naming a single
   * bar is an ordinary thing to do and has no spacing to compute, and
   * maxSpacing already flattens anything under about five bars to the same
   * view — so refusing one while accepting two would be a distinction with no
   * visible difference.
   *
   * The minSpacing rule fitContent documents above is inherited rather than
   * reconsidered, and a windowed fit never reaches it: a hundred bars across
   * an 832px plot needs 8.3px each, ten times the default floor. It fires
   * only for a window WIDER than interactive zoom allows, and there clamping
   * would show a different window from the one named while still reporting
   * success — the one failure this method must not have.
   */
  setVisibleRange(from, to) {
    const last = this.barCount - 1
    if (!(last > 0) || !(this.width > 0)) return false
    // toNumber, not +: `+null` is 0 and `Math.floor(null)` is 0, so a
    // half-filled window — { from: saved ?? null, to: 99 } — would read as
    // bar 0 and show a window nobody asked for. Same guard, same reason, as
    // the one prices go through.
    let a = toNumber(from)
    let b = toNumber(to)
    if (!isFinite(a) || !isFinite(b)) return false
    // (to, from) has exactly one possible meaning. Refusing it buys the caller
    // no information and costs them the silent no-op described above.
    //
    // BEFORE the rounding, not after. Rounding first turns a reversed
    // fractional window into a NARROWER one — (99.5, 0.4) floors the high end
    // to 99 and ceils the low end to 1, then swaps, so the window arrives
    // 1..99 having lost a bar at each end, which is the one thing the
    // widening below exists to prevent.
    if (a > b) { const t = a; a = b; b = t }
    // Fractional ends WIDEN, never narrow: a caller that computed 99.5 wants
    // bar 99 on screen, and honouring the fraction by hiding it would break
    // the one postcondition this method has.
    a = Math.floor(a)
    b = Math.ceil(b)
    a = clamp(a, 0, last)
    b = clamp(b, 0, last)
    if (a === b) { if (b < last) b++; else a-- }
    return this._window(a, b)
  }

  /**
   * The arithmetic both fits share: `to - from + 1` bars across the plot with
   * `to` on the right edge, immediately.
   *
   * `follow` is DERIVED here rather than set. It is not a preference but a
   * claim of fact — the right edge IS the newest bar — which panBy() clears,
   * setBarCount() reads to decide whether to glide, and zoomAt() pairs with
   * `live` to choose its anchor. A window short of the newest bar that went on
   * following is re-targeted by the very next append(): measured on a 29,000
   * bar set, one appended bar moved a window pinned at 0..99 to 6306..6409 on
   * the first frame, and no call ordering prevents it. fitContent's
   * unconditional `true` was this same expression evaluated on the only input
   * Chart ever gives it, since it always passes the whole bar count.
   */
  _window(from, to) {
    const needed = this.width / (to - from + 1)
    if (needed < this.minSpacing) this.minSpacing = Math.max(needed, FIT_FLOOR)
    this._spacing.jump(clamp(needed, this.minSpacing, this.maxSpacing))
    // No rightOffset: naming the bar at the edge means it IS the edge.
    this._right.jump(to)
    this.follow = to >= this.barCount - 1
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
