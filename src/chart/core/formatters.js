/** "Nice" step size (1/2/5 x 10^n) covering `span` in about `count` steps. */
export function niceStep(span, count) {
  const raw = span / Math.max(1, count)
  if (!(raw > 0) || !isFinite(raw)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  const s = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10
  return s * mag
}

export function priceTicks(lo, hi, count) {
  const step = niceStep(hi - lo, count)
  const ticks = []
  const start = Math.ceil(lo / step) * step
  for (let v = start; v <= hi + step * 1e-9; v += step) ticks.push(v)
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
