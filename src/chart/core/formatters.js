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

/* ------------------------------------------------------------ time zones -- */

/**
 * Intl.DateTimeFormat instances are expensive to construct and cheap to
 * reuse, and these run once per axis label per frame. Memoising is a
 * correctness-adjacent requirement here, not an optimisation.
 */
const intlCache = new Map()
function intl(timeZone, options) {
  const key = timeZone + '|' + JSON.stringify(options)
  let f = intlCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone, ...options })
    intlCache.set(key, f)
  }
  return f
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Build the set of time formatters a chart renders with.
 *
 * With no `timeZone` this is the browser's local zone, using plain Date
 * getters — the fast path, and the behaviour every existing chart has.
 *
 * With one, every rendered timestamp is formatted in that zone. This matters
 * for any instrument whose session is defined in exchange-local time: an NSE
 * chart read in London should still open at 09:15, and a chart whose epochs
 * encode exchange wall time needs to be told which zone that was.
 *
 *   axis(ms, tfMs) -> time of day, or a date for daily-and-coarser bars
 *   date(ms)       -> '20 Sep'
 *   full(ms)       -> '2026-09-20 09:15', for the crosshair
 *   dayKey(ms)     -> an integer that changes exactly when the day does
 */
export function createTimeFormatter(timeZone) {
  if (!timeZone) {
    return {
      zone: null,
      axis: fmtAxisTime,
      full: fmtDateTime,
      date: (ms) => {
        const d = new Date(ms)
        return `${d.getDate()} ${MONTHS[d.getMonth()]}`
      },
      dayKey: (ms) => {
        const d = new Date(ms)
        return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
      },
    }
  }

  const fmt = intl(timeZone, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    // h23 rather than hour12:false — the latter has historically resolved to
    // h24 in some engines, which renders midnight as 24:00. Asking for the
    // cycle we want is better than normalising a value we did not.
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const parts = (ms) => {
    const out = {}
    for (const p of fmt.formatToParts(ms)) if (p.type !== 'literal') out[p.type] = p.value
    return out
  }

  const date = (ms) => {
    const p = parts(ms)
    return `${Number(p.day)} ${MONTHS[Number(p.month) - 1]}`
  }

  return {
    zone: timeZone,
    date,
    axis: (ms, tfMs) => {
      if (tfMs >= 864e5) return date(ms)
      const p = parts(ms)
      return `${p.hour}:${p.minute}`
    },
    full: (ms) => {
      const p = parts(ms)
      return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
    },
    dayKey: (ms) => {
      const p = parts(ms)
      return Number(p.year) * 10000 + Number(p.month) * 100 + Number(p.day)
    },
  }
}
