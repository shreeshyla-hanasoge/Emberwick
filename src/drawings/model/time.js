/**
 * Time <-> fractional bar index, for drawing anchors.
 *
 * A drawing is stored against time (so it survives reloads, prepends and a
 * timeframe switch) but drawn against the bar index the TimeScale lays out.
 * These functions are the whole bridge, and they are pure: no scale, no
 * chart, just a bar array sorted ascending by time.
 *
 * timeToIndex and indexToTime moved into the core (src/chart/core/time.js) so
 * every plugin maps time the same way; they are re-exported here because this
 * module and the drawings entry have always exported them. What stays is the
 * drawing-specific half: a stored point carries a bar-count offset outside
 * the data.
 *
 * The code below is prescribed line for line by the drawings spec (§3.3); the
 * mutation manifest anchors on these exact lines, so reformatting one silently
 * drops the test coverage it measures.
 */
import { timeToIndex, indexToTime } from '../../chart/index.js'

export { timeToIndex, indexToTime }

/** First index whose time >= t (n when none). The same search the core's timeToIndex runs, kept for callers that need the insertion point itself. */
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
