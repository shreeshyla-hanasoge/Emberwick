/**
 * Series model — normalisation, time→index resolution, and visible extent.
 *
 * A series is an arbitrary y-value over the same time axis as the bars:
 * an indicator overlay, an equity curve, anything the host can express as
 * { time, value }.
 *
 * Kept out of the renderer so it can be reasoned about — and tested —
 * without a canvas, exactly like overlays/annotations.js.
 */
import { toNumber } from '../core/formatters.js'
import { nearestIndex } from './annotations.js'
import { DASH } from '../render/style.js'

export const LINE_STYLES = Object.keys(DASH)

/**
 * Normalise a series' presentation options. `data` is handled separately,
 * because it changes far more often than the rest.
 */
export function normalizeSeries(raw, id) {
  const o = raw || {}
  return {
    id: String(id),
    color: o.color || null, // resolved against the theme at draw time
    lineWidth: isFinite(o.lineWidth) && o.lineWidth > 0 ? +o.lineWidth : 1.5,
    lineStyle: DASH[o.lineStyle] ? o.lineStyle : 'solid',
    /** Draw as a step function rather than interpolating between points. */
    stepped: o.stepped === true,
    visible: o.visible !== false,
    /** Passthrough metadata — handed back by getSeries(), never drawn. */
    title: o.title != null ? String(o.title) : '',
  }
}

/**
 * Normalise a point list.
 *
 * A point whose value is absent, null or non-numeric is kept as a GAP: it
 * lifts the pen, ending the current line so the next valued point starts a
 * fresh one. It is never coerced to zero — a zero is a claim about the data,
 * and "the indicator has no value here" is not zero. Numeric strings ARE
 * values; plenty of sources send them.
 */
export function normalizeSeriesPoints(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const p of list) {
    if (!p) continue
    // isFinite(null) is true and +null is 0, so a null time would silently
    // become a point at the epoch. Coerce through the same path as values.
    const time = toNumber(p.time)
    if (Number.isNaN(time)) continue
    out.push({ time, value: toNumber(p.value), index: -1 })
  }
  out.sort((a, b) => a.time - b.time)
  return out
}

/**
 * Attach a bar index to every point, and return the drawable run.
 *
 * `toleranceMs` is how far outside the loaded range a point may sit and still
 * snap to an end bar — one timeframe, normally. Beyond that it resolves to -1
 * and is not drawn, rather than piling onto bar 0 as if it happened there.
 * Because the input is sorted by time and nearestIndex is monotonic, the
 * resolved points form one contiguous run, so the drawable slice is a filter
 * rather than a sort.
 */
export function resolveSeriesPoints(points, bars, toleranceMs) {
  const n = bars.length
  const tol = isFinite(toleranceMs) && toleranceMs > 0 ? toleranceMs : Infinity
  const first = n ? bars[0].time - tol : 0
  const last = n ? bars[n - 1].time + tol : 0
  const drawable = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    p.index = !n || p.time < first || p.time > last ? -1 : nearestIndex(bars, p.time)
    if (p.index >= 0) drawable.push(p)
  }
  return drawable
}

/** First position in `drawable` whose index is >= `from`. Binary search. */
export function lowerBound(drawable, from) {
  let lo = 0
  let hi = drawable.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (drawable[mid].index < from) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Min and max of the values visible in [from, to], for autoscale.
 * Infinity / -Infinity when the window holds nothing plottable.
 */
export function seriesExtent(drawable, from, to) {
  let min = Infinity
  let max = -Infinity
  for (let i = lowerBound(drawable, from); i < drawable.length; i++) {
    const p = drawable[i]
    if (p.index > to) break
    const v = p.value
    if (Number.isNaN(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max }
}
