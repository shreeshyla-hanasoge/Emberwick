/**
 * Drawing a profile: projection and fillRect, and nothing else.
 *
 * Everything here runs every frame on a live chart, so it allocates nothing
 * and decides nothing about the data: bins, their maximum and the value area
 * were prepared when the data arrived (data.js). What is left is turning a
 * column of volumes into rectangles through the scales as they are NOW.
 *
 * BINS ARE FIXED IN PRICE. Each bin's edges are prices from the data,
 * `lo + i * step`, sent through `ps.y()` on every frame. They are never
 * pixel rows that volume is poured into: the price scale eases on almost
 * every frame, and bins cut in pixels would re-bin as it moved and shimmer.
 * The only thing done in pixels is rounding an edge to the grid, so two
 * neighbouring translucent bins neither overlap (a darker seam) nor gap.
 */

/**
 * Left pixel edge of a session whose first bar is at fractional index `u0`:
 * half a candle before that bar's centre, so the profile starts where its
 * first candle does.
 */
export function spanLeft(ts, u0) {
  return ts.x(u0) - ts.barWidth() / 2
}

/** Right pixel edge of a session whose last bar is at fractional index `u1`. */
export function spanRight(ts, u1) {
  return ts.x(u1) + ts.barWidth() / 2
}

/**
 * Pixel length of a bin holding `v` when the longest bin (`max`) is `maxLen`
 * long. Whole pixels, and never less than one: a bin that traded at all is
 * drawn, however small it is beside the POC.
 */
export function barLength(v, max, maxLen) {
  return Math.max(1, Math.round((v / max) * maxLen))
}

/**
 * Index of the bin containing `price`, or -1 outside the profile.
 * Bin i covers [lo + i*step, lo + (i+1)*step).
 */
export function binAt(price, lo, step, n) {
  const i = Math.floor((price - lo) / step)
  return i >= 0 && i < n ? i : -1
}

/**
 * Fill one profile's bins.
 *
 * `x0` is the edge the bars grow from and `dir` the direction: +1 rightward
 * (a session, or the visible profile on the left), -1 leftward (the visible
 * profile on the right). `top`/`bottom` are the pixel rows of the clip, used
 * only to skip bins that cannot show; the caller clips.
 *
 * Bins shorter than a pixel are MERGED rather than dropped: adjacent bins are
 * accumulated until they span a pixel row and drawn as one rect, as long as
 * the longest of them. Zoomed far out, eighty bins in twenty pixels become
 * twenty rects with the profile's true outline, instead of vanishing or
 * turning into eighty overlapping slivers.
 *
 * `st.fill` carries the context's current fillStyle between calls, so twenty
 * sessions cost a handful of style changes rather than sixteen hundred.
 *
 * @returns {number} how many rects were drawn
 */
export function drawBins(ctx, ps, s, step, x0, dir, maxLen, top, bottom, colors, tint, st) {
  const { lo, bins, n, max } = s
  if (!(max > 0) || !(maxLen > 0)) return 0
  // The bins the clip can show: prices at the bottom and top pixel rows.
  let i0 = Math.floor((ps.price(bottom) - lo) / step)
  let i1 = Math.floor((ps.price(top) - lo) / step)
  if (i0 < 0) i0 = 0
  if (i1 > n - 1) i1 = n - 1
  if (i0 > i1) return 0

  let drawn = 0
  let yb = Math.round(ps.y(lo + i0 * step))
  let run = 0
  let runVa = false
  for (let i = i0; i <= i1; i++) {
    const v = bins[i]
    if (v > run) {
      run = v
      runVa = tint && i >= s.vaFrom && i <= s.vaTo
    }
    const yt = Math.round(ps.y(lo + (i + 1) * step))
    // Not a pixel row yet: keep accumulating, unless this is the last bin.
    if (yb - yt < 1 && i < i1) continue
    if (run > 0) {
      const h = yb - yt
      const len = barLength(run, max, maxLen)
      const fill = runVa ? colors.valueArea : colors.fill
      if (st.fill !== fill) ctx.fillStyle = st.fill = fill
      // A one-pixel gap under any bin tall enough to spare it, so tall bins
      // read as separate bars and not as one slab. A last run that never
      // reached a pixel row takes the row above: the one at `yt` belongs to
      // the rect drawn before it, and two translucent fills would stack.
      if (h < 1) ctx.fillRect(dir > 0 ? x0 : x0 - len, yt - 1, len, 1)
      else ctx.fillRect(dir > 0 ? x0 : x0 - len, yt, len, h >= 3 ? h - 1 : h)
      drawn++
    }
    yb = yt
    run = 0
    runVa = false
  }
  return drawn
}

/**
 * Fill the one bin `i` in `color`: the hover highlight. The same edges and
 * the same length drawBins gives that bin when it is not merged.
 */
export function drawBin(ctx, ps, s, step, i, x0, dir, maxLen, color) {
  const yb = Math.round(ps.y(s.lo + i * step))
  const yt = Math.round(ps.y(s.lo + (i + 1) * step))
  const h = yb - yt
  const len = barLength(s.bins[i], s.max, maxLen)
  ctx.fillStyle = color
  if (h < 1) ctx.fillRect(dir > 0 ? x0 : x0 - len, yt - 1, len, 1)
  else ctx.fillRect(dir > 0 ? x0 : x0 - len, yt, len, h >= 3 ? h - 1 : h)
}

/**
 * Index of the first bar from `from` on whose range contains `price`, or -1.
 * This is what ends a "naked" POC: the first later bar that trades through it.
 */
export function firstTouch(bars, from, price) {
  for (let k = from < 0 ? 0 : from; k < bars.length; k++) {
    const b = bars[k]
    if (+b.low <= price && +b.high >= price) return k
  }
  return -1
}
