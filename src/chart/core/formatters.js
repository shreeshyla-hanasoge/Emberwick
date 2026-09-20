/**
 * Coerce a value to a finite number, or NaN.
 *
 * Prices arrive as numeric STRINGS from plenty of real sources: Laravel
 * serialises decimal columns as strings, and Binance, Bybit and Kraken all
 * return OHLC that way. PriceScale already coerces them when fitting the
 * range — so the scale would fit correctly and then a renderer calling
 * .toFixed() on the raw value would throw inside the frame, which after ten
 * consecutive failures stops the loop entirely. Both paths go through here.
 */
export function toNumber(v) {
  const t = typeof v
  if (t === 'number') return isFinite(v) ? v : NaN
  if (t !== 'string') return NaN
  const n = v.trim() === '' ? NaN : +v
  return isFinite(n) ? n : NaN
}

/** "Nice" step size (1/2/5 x 10^n) covering `span` in about `count` steps. */
export function niceStep(span, count) {
  const raw = span / Math.max(1, count)
  if (!(raw > 0) || !isFinite(raw)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10
  return s * mag
}

/** Hard ceiling on tick count — a guard, never reached by a sane range. */
const MAX_TICKS = 1000

export function priceTicks(lo, hi, count) {
  const step = niceStep(hi - lo, count)
  // A non-finite bound makes niceStep fall back to 1 and `start` become
  // -Infinity, and `v += step` never moves off -Infinity: the loop below
  // would spin forever inside a frame. Bail instead.
  if (!isFinite(lo) || !isFinite(hi) || hi < lo) return { ticks: [], step }
  const start = Math.ceil(lo / step) * step
  const ticks = []
  // Multiply rather than accumulate: repeated += step drifts on floats.
  for (let i = 0; i < MAX_TICKS; i++) {
    const v = start + i * step
    if (v > hi + step * 1e-9) break
    ticks.push(v)
  }
  return { ticks, step }
}

export function decimalsFor(step) {
  if (!isFinite(step) || step <= 0) return 2
  if (step >= 100) return 0
  if (step >= 1) return 2
  return Math.min(8, Math.ceil(-Math.log10(step)) + 1)
}

/** Bar-index step that keeps time labels at least `minPx` apart. */
export function niceBarStep(minBars) {
  const opts = [1, 2, 5, 10, 15, 20, 30, 60, 120, 240, 480, 960, 1920, 3840, 7680]
  for (const o of opts) if (o >= minBars) return o
  return Math.ceil(minBars / 1000) * 1000
}

const p2 = (n) => String(n).padStart(2, '0')

export function fmtAxisTime(ms, tfMs) {
  const d = new Date(ms)
  if (tfMs >= 864e5) return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`
  if (d.getHours() === 0 && d.getMinutes() === 0) {
    return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`
  }
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export function fmtDateTime(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

export function fmtVolume(v) {
  if (!isFinite(v)) return '—'
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'
  return String(Math.round(v))
}
