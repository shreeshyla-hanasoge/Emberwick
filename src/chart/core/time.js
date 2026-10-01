/**
 * Time <-> fractional bar index.
 *
 * Anything stored against time (a drawing anchor, a profile session) is drawn
 * against the bar index the TimeScale lays out. These two functions are the
 * whole bridge, and they are pure: no scale, no chart, just a bar array
 * sorted ascending by time.
 *
 * They are NOT nearestIndex (overlays/annotations.js), which clamps to the
 * data and snaps to a bar. A marker wants that; an anchor in a session gap or
 * past the newest bar must stay where it is.
 *
 * They lived in src/drawings until every plugin needed them. The lines below
 * are the ones the drawings spec prescribed (§3.3) and the mutation manifest
 * anchors on, so reformatting one silently drops the coverage it measures.
 */
import { toNumber } from './formatters.js'

/** First index whose time >= t (n when none). */
function lowerBoundTime(bars, t) {
  let lo = 0
  let hi = bars.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (+bars[mid].time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Fractional bar index of `time`. On a bar: exactly that index. Between two bars
 * (a session gap, or a 1m time on 5m data): linear between them, monotonic.
 * Outside the data: extrapolated at one `tf` per bar. Deliberately NOT
 * nearestIndex, which clamps and snaps.
 *
 * @param {Array<{time:number}>} bars ascending by time
 * @param {number} time ms since epoch
 * @param {number} [tf] bar duration in ms, for times outside the data (default 60000)
 * @returns {number} NaN with no bars or a non-numeric time
 */
export function timeToIndex(bars, time, tf) {
  const n = bars.length
  const t = toNumber(time)
  if (!n || Number.isNaN(t)) return NaN
  const step = tf > 0 ? tf : 60000
  const first = +bars[0].time
  const last = +bars[n - 1].time
  if (t >= last) return n - 1 + (t - last) / step
  if (t <= first) return (t - first) / step
  const k = lowerBoundTime(bars, t)
  if (+bars[k].time === t) return k
  const a = +bars[k - 1].time
  const span = +bars[k].time - a
  return span > 0 ? k - 1 + (t - a) / span : k - 1
}

/**
 * Exact inverse inside the data; integer u -> bars[u].time. null with no bars or a non-finite u.
 *
 * @param {Array<{time:number}>} bars ascending by time
 * @param {number} u fractional bar index
 * @param {number} [tf] bar duration in ms, for indices outside the data (default 60000)
 * @returns {number|null} ms since epoch, rounded
 */
export function indexToTime(bars, u, tf) {
  const n = bars.length
  if (!n || !Number.isFinite(u)) return null
  const step = tf > 0 ? tf : 60000
  if (u <= 0) return Math.round(+bars[0].time + u * step)
  if (u >= n - 1) return Math.round(+bars[n - 1].time + (u - (n - 1)) * step)
  const i = Math.floor(u)
  const f = u - i
  const a = +bars[i].time
  return f === 0 ? a : Math.round(a + f * (+bars[i + 1].time - a))
}
