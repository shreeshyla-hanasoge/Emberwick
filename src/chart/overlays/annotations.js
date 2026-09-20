import { toNumber } from '../core/formatters.js'
/**
 * Annotation model — normalisation, time→index resolution and collision
 * layout for markers.
 *
 * The geometry lives here rather than in the renderer so it can be reasoned
 * about (and tested) without a canvas, and out of Chart.js so the orchestrator
 * stays about orchestration.
 */

export const MARKER_SHAPES = [
  'arrowUp',
  'arrowDown',
  'triangleUp',
  'triangleDown',
  'circle',
  'square',
  'diamond',
  'flag',
  'label',
]

const SHAPE_SET = new Set(MARKER_SHAPES)

/**
 * Generated ids are derived from the marker's own identity, never from its
 * array position and never from a counter.
 *
 * Index-keyed ids collided: remove one marker, add another, and the newcomer
 * could be handed an id a survivor already owned. A monotonic counter fixes
 * that but breaks the other half of the contract — setMarkers() re-normalises
 * the whole array, so calling it twice with the same input minted fresh ids
 * and any id the caller had captured for removeMarker() was already dead.
 * Deriving from (time, shape, nth-duplicate) is both unique and stable across
 * calls, page loads and two charts showing the same data.
 */
function derivedId(marker, seen) {
  const base = `mk${marker.time}:${marker.shape}`
  const n = seen.get(base) || 0
  seen.set(base, n + 1)
  return n ? `${base}:${n}` : base
}

/** Buys sit under the bar, sells over it — the convention traders expect. */
const DEFAULT_POSITION = {
  arrowUp: 'belowBar',
  triangleUp: 'belowBar',
  arrowDown: 'aboveBar',
  triangleDown: 'aboveBar',
}

const POSITIONS = new Set(['aboveBar', 'belowBar', 'inBar', 'atPrice'])

/**
 * Normalise one marker. `id` comes back null when the caller supplied none —
 * normalizeMarkers() fills it in, because a stable generated id needs to see
 * the whole batch to disambiguate duplicates.
 */
// eslint-disable-next-line no-unused-vars
export function normalizeMarker(raw, i) {
  if (!raw) return null
  // isFinite(null) is true and +null is 0 — a null time would place the
  // marker at the epoch rather than rejecting it.
  const time = toNumber(raw.time)
  if (Number.isNaN(time)) return null
  const shape = SHAPE_SET.has(raw.shape) ? raw.shape : 'circle'
  const position = POSITIONS.has(raw.position)
    ? raw.position
    : DEFAULT_POSITION[shape] || 'aboveBar'
  return {
    id: raw.id != null ? String(raw.id) : null,
    time,
    price: isFinite(raw.price) ? +raw.price : null,
    shape,
    position,
    color: raw.color || null,
    textColor: raw.textColor || null,
    text: raw.text != null ? String(raw.text) : '',
    size: isFinite(raw.size) && raw.size > 0 ? +raw.size : 1,
    /** Anything the consumer wants handed back on hover/click. */
    data: raw.data,
    index: -1,
  }
}

export function normalizeMarkers(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Map()
  for (let i = 0; i < list.length; i++) {
    const m = normalizeMarker(list[i], i)
    if (!m) continue
    if (m.id === null) m.id = derivedId(m, seen)
    out.push(m)
  }
  out.sort((a, b) => a.time - b.time)
  return out
}

/**
 * Index of the bar closest in time to `time`; -1 with no bars.
 * Binary search — markers are resolved again whenever the bar array shifts
 * (a history page prepended in front of them moves every index).
 */
export function nearestIndex(bars, time) {
  const n = bars.length
  if (!n) return -1
  if (time <= bars[0].time) return 0
  if (time >= bars[n - 1].time) return n - 1

  let lo = 0
  let hi = n - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const t = bars[mid].time
    if (t === time) return mid
    if (t < time) lo = mid + 1
    else hi = mid - 1
  }
  const a = Math.max(0, hi)
  const b = Math.min(n - 1, lo)
  return Math.abs(bars[a].time - time) <= Math.abs(bars[b].time - time) ? a : b
}

/**
 * Attach a bar index to every marker, in place.
 *
 * `toleranceMs` is how far outside the loaded range a marker may sit and
 * still snap to the nearest end bar — one timeframe, normally. Beyond that it
 * resolves to -1 and is not drawn. Without this, nearestIndex() clamps, so a
 * trade from six months before the loaded window pins itself to bar 0 and
 * reads as an event that happened at the left edge of the chart. Omit the
 * argument for the old clamping behaviour.
 */
export function resolveMarkers(markers, bars, toleranceMs) {
  const n = bars.length
  const tol = isFinite(toleranceMs) && toleranceMs > 0 ? toleranceMs : Infinity
  const first = n ? bars[0].time - tol : 0
  const last = n ? bars[n - 1].time + tol : 0
  for (let i = 0; i < markers.length; i++) {
    const t = markers[i].time
    markers[i].index = !n || t < first || t > last ? -1 : nearestIndex(bars, t)
  }
  return markers
}

/**
 * Place visible markers in screen space.
 *
 * Handles the two things that make markers look amateurish when skipped:
 * several markers on one bar overlapping, and thousands of them piling onto
 * the same pixels when zoomed out.
 */
export function layoutMarkers(markers, s) {
  const { ts, ps, plot, bars, live } = s
  if (!markers.length || !bars.length) return []

  const { from, to } = ts.visibleRange()
  const lastIdx = bars.length - 1
  const dense = ts.barWidth() <= 3
  const stacks = new Map()
  const placed = []
  let lastDenseX = -Infinity

  for (const m of markers) {
    const i = m.index
    if (i < 0 || i < from - 2 || i > to + 2) continue

    // the forming candle is interpolated, so anchor to the animated values
    const bar = live && i === lastIdx ? live : bars[i]
    if (!bar) continue

    const x = ts.x(i)
    if (x < -48 || x > plot.w + 48) continue

    // Zoomed far out, markers collapse onto the same pixels: drawing them all
    // costs frames and reads as noise. One per 4px is plenty.
    if (dense) {
      if (x - lastDenseX < 4) continue
      lastDenseX = x
    }

    const r = 5 * m.size
    let y
    let dir = 0

    if (m.position === 'atPrice' && m.price != null) {
      y = ps.y(m.price)
    } else if (m.position === 'inBar') {
      y = ps.y((bar.high + bar.low) / 2)
    } else if (m.position === 'belowBar') {
      y = ps.y(bar.low) + r + 7
      dir = 1
    } else {
      y = ps.y(bar.high) - r - 7
      dir = -1
    }

    // Two trades on one bar must not draw on top of each other.
    if (dir !== 0) {
      const key = i + m.position
      const n = stacks.get(key) || 0
      stacks.set(key, n + 1)
      y += dir * n * (r * 2 + 5)
    }

    placed.push({ m, x, y, r, dir })
  }

  return placed
}
