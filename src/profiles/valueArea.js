/**
 * Point of control and value area of one volume profile.
 *
 * Pure arithmetic on an array of bin volumes: no chart, no DOM, no time. It
 * runs once per session when the host's data omits `poc`, `vah` or `val`
 * (setData / upsertSession), never per frame.
 *
 * Bin i covers [lo + i*step, lo + (i+1)*step). A volume that is not a
 * positive finite number counts as zero, so one bad bin cannot poison a sum.
 */

/** A bin's volume as this module counts it: positive and finite, else 0. */
const vol = (v) => (v > 0 && v < Infinity ? +v : 0)

/**
 * Index of the point of control: the bin with the most volume, or -1 when
 * nothing traded.
 *
 * Ties are real (a flat profile, a two-peaked session), and "first wins"
 * would park the POC at the bottom of the range on every one of them. The
 * tied bin NEAREST THE MIDDLE of the range wins, because that is where a
 * reader expects the centre of a balanced profile; two bins equally near the
 * middle resolve to the lower one, so the answer never depends on float luck.
 *
 * @param {ArrayLike<number>} bins volume per bin
 * @returns {number} bin index, or -1
 */
export function pocIndex(bins) {
  const n = bins ? bins.length : 0
  const mid = (n - 1) / 2
  let best = -1
  let max = 0
  for (let i = 0; i < n; i++) {
    const v = vol(bins[i])
    if (v > max || (v === max && best >= 0 && Math.abs(i - mid) < Math.abs(best - mid))) {
      max = v
      best = i
    }
  }
  return best
}

/**
 * The value area as bin indices: `{ poc, from, to, total }`, bins from..to
 * inclusive, or null when nothing traded.
 *
 * The standard algorithm. Start with the POC bin. Compare the volume of the
 * TWO bins above the area with the two below it, add the larger pair, and
 * repeat until the area holds at least `share` of the total.
 *
 * - At an edge a "pair" is whatever is left on that side, and a side with
 *   nothing left stops being offered, so the area keeps growing the other way.
 * - Two equal pairs: the upper one is taken. It has to be one of them, and
 *   taking the same one every time is what makes the result reproducible.
 * - A pair is added whole, even when its first bin alone would reach the
 *   share. That is the textbook behaviour, and it is why a value area's edges
 *   move in steps of two bins.
 *
 * @param {ArrayLike<number>} bins volume per bin
 * @param {number} [share] fraction of the total the area must hold (default 0.7)
 * @param {number} [poc] POC bin index, when the caller already knows it
 * @returns {{poc:number, from:number, to:number, total:number}|null}
 */
export function valueAreaBins(bins, share = 0.7, poc = pocIndex(bins)) {
  const n = bins ? bins.length : 0
  if (!(poc >= 0 && poc < n)) return null
  let total = 0
  for (let i = 0; i < n; i++) total += vol(bins[i])
  if (!(total > 0)) return null
  // A hair under the target, so "exactly 70%" stops there: 0.7 * 3 is
  // 2.0999999999999996 in floating point, and an area holding 2.1 of 3
  // must not be sent round the loop again for the missing 4e-16.
  const target = (share > 0 ? Math.min(share, 1) : 0) * total * (1 - 1e-12)
  let from = poc
  let to = poc
  let acc = vol(bins[poc])
  while (acc < target && (from > 0 || to < n - 1)) {
    const up = vol(bins[to + 1]) + vol(bins[to + 2])
    const down = vol(bins[from - 1]) + vol(bins[from - 2])
    if (to < n - 1 && (from === 0 || up >= down)) {
      to = Math.min(n - 1, to + 2)
      acc += up
    } else {
      from = Math.max(0, from - 2)
      acc += down
    }
  }
  return { poc, from, to, total }
}

/**
 * Point of control and value area of a profile, as prices.
 *
 *   computeValueArea([1, 4, 9, 5, 1], 100, 0.5)
 *   // { poc: 101.25, vah: 102.5, val: 101 }
 *
 * `poc` is the centre of the busiest bin. `vah` is the HIGH edge of the top
 * bin in the value area and `val` the LOW edge of the bottom one, so
 * `vah - val` is a whole number of steps and the area is the band a renderer
 * fills. Returns null when nothing traded (an empty array, all zeros) or
 * when `lo` or `step` is not usable: no value area, and no crash.
 *
 * @param {ArrayLike<number>} bins volume per bin; bin i covers [lo + i*step, lo + (i+1)*step)
 * @param {number} lo price of the low edge of bin 0
 * @param {number} step price width of one bin (> 0)
 * @param {number} [share] fraction of the total volume the area must hold (default 0.7)
 * @returns {{poc:number, vah:number, val:number}|null}
 */
export function computeValueArea(bins, lo, step, share = 0.7) {
  if (!Number.isFinite(lo) || !(step > 0 && step < Infinity)) return null
  const va = valueAreaBins(bins, share)
  if (!va) return null
  return { poc: lo + (va.poc + 0.5) * step, vah: lo + (va.to + 1) * step, val: lo + va.from * step }
}
