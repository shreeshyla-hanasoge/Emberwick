/**
 * Time <-> fractional bar index, for drawing anchors.
 *
 * A drawing is stored against time (so it survives reloads, prepends and a
 * timeframe switch) but drawn against the bar index the TimeScale lays out.
 * These five functions are the whole bridge, and they are pure: no scale, no
 * chart, just a bar array sorted ascending by time.
 *
 * The code below is prescribed line for line by the drawings spec (§3.3); the
 * mutation manifest anchors on these exact lines, so reformatting one silently
 * drops the test coverage it measures.
 */
import { toNumber } from '../../chart/index.js'

/** First index whose time >= t (n when none). A private copy of the core's search: deep-importing it would split the core bundle. */
export function lowerBoundTime(bars, t) {
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

/** Exact inverse inside the data; integer u -> bars[u].time. null with no bars or a non-finite u. */
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

/** A stored point's fractional index against `bars` at the current timeframe. */
export function pointIndex(bars, pt, tf) {
  const base = timeToIndex(bars, pt.time, tf)
  if (!pt.offset) return base
  const scale = pt.tf > 0 && tf > 0 ? pt.tf / tf : 1
  return base + pt.offset * scale
}

/**
 * The stored form of index `u` at `price`: bar time + bar count outside the
 * data (both sides), the interpolated time inside it. null with no bars or a
 * non-finite u — callers treat that as "nothing to place" (§3.5, zero bars).
 */
export function pointFromIndex(bars, u, price, tf) {
  const last = bars.length - 1
  if (last < 0 || !Number.isFinite(u)) return null
  if (u > last) return { time: +bars[last].time, price, offset: u - last, tf }
  if (u < 0) return { time: +bars[0].time, price, offset: u, tf }
  return { time: indexToTime(bars, u, tf), price }
}
