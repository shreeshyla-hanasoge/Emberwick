import { toNumber } from '../../chart/index.js'

/**
 * The words and numbers drawings print, and the option coercion the nine
 * tools share.
 *
 * Kept apart from paint.js so the formatting rules can be tested as plain
 * strings, with no canvas in sight, and so a host building its own readout
 * from the `drawing` event can format exactly as the canvas does.
 */

/** U+2212. A hyphen is narrower than a plus sign, so a column of deltas wobbles with it. */
export const MINUS = '−'
export const DASH_TEXT = '—'

const MIN = 60000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/**
 * A clock duration the way a trader says it: '45m', '6h 20m', '2d 3h'.
 *
 * Two units at most, because "2d 3h 14m" is noise at a glance and the bar
 * count beside it is the exact figure. `approx` prefixes '≈': any span that
 * involves a point stored as a bar count outside the data is an estimate
 * (the clock time of a bar that does not exist yet is a guess).
 */
export function formatSpan(ms, approx) {
  const v = Math.abs(toNumber(ms))
  if (Number.isNaN(v)) return DASH_TEXT
  // Round to the unit FIRST, then pick the branch from the rounded value:
  // 59.6s must read '1m' and 59m 59.9s '1h', never '60s' or '0h 60m'.
  let s
  const sec = Math.round(v / 1000)
  const m = Math.round(v / MIN)
  if (sec < 60) s = sec + 's'
  else if (m < 60) s = m + 'm'
  else if (m < DAY / MIN) {
    const h = Math.floor(m / 60)
    const r = m - h * 60
    s = r ? `${h}h ${r}m` : `${h}h`
  } else {
    const hTotal = Math.round(v / HOUR)
    const d = Math.floor(hTotal / 24)
    const r = hTotal - d * 24
    s = r ? `${d}d ${r}h` : `${d}d`
  }
  return approx ? '≈' + s : s
}

/**
 * A signed price change, formatted by the pane's own price formatter so the
 * decimals match the axis: '+12.40', '−2.10', '0.00'.
 */
export function formatDelta(d, fmtPrice) {
  const v = toNumber(d)
  if (Number.isNaN(v)) return DASH_TEXT
  const s = typeof fmtPrice === 'function' ? fmtPrice(Math.abs(v)) : Math.abs(v).toFixed(2)
  return (v > 0 ? '+' : v < 0 ? MINUS : '') + s
}

/**
 * `p` as a signed percentage of `base`: '+1.52%'. A zero or unknown base
 * (a spread that crossed zero, a synthetic series) has no percentage, and
 * prints a dash instead of 'Infinity%'. The base's magnitude is used, so a
 * move up from −4 to −2 reads +50%, not −50%.
 */
export function formatPercent(p, base) {
  const v = toNumber(p)
  const b = toNumber(base)
  if (Number.isNaN(v) || Number.isNaN(b) || b === 0) return DASH_TEXT
  const pct = (v / Math.abs(b)) * 100
  if (!isFinite(pct)) return DASH_TEXT
  const s = Math.abs(pct).toFixed(2)
  // -0.001% rounds to '0.00': print it unsigned rather than '−0.00%'.
  if (+s === 0) return s + '%'
  return (pct > 0 ? '+' : MINUS) + s + '%'
}

/** '1.24M', '12.5K', '950'. The same thresholds as the core's volume axis. */
export function formatVolume(v) {
  const n = toNumber(v)
  if (Number.isNaN(n) || n < 0) return DASH_TEXT
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return String(Math.round(n))
}

/** A fib level as printed: 0.618, 0.5, 1, 1.618, −0.272. At most four decimals. */
export function formatLevel(v) {
  const n = +(+v).toFixed(4)
  return n < 0 ? MINUS + String(-n) : String(n)
}

/**
 * The clock time a screen anchor stands for. A point stored as a bar count
 * past the data carries the newest bar's time; its real time is only known
 * by extrapolating its index, so ask the context for that.
 */
export function anchorTime(p, ctx) {
  if (p.approx && ctx && typeof ctx.timeAt === 'function') {
    const t = ctx.timeAt(p.u)
    if (t !== null && isFinite(t)) return t
  }
  return p.time
}

/**
 * The two stats lines shown for a line or box:
 *   '+12.40 (+1.52%)'
 *   '38 bars · 6h 20m'
 * The span is the clock difference, which reports session gaps honestly (an
 * overnight gap is part of how long the move took); the bar count is |u1−u0|,
 * which is what the chart shows. `out` is reused when given.
 */
export function statsLines(p0, p1, ctx, out) {
  const res = out || []
  res.length = 0
  const fmt = ctx && typeof ctx.formatPrice === 'function' ? ctx.formatPrice : null
  const dp = p1.price - p0.price
  res.push(`${formatDelta(dp, fmt)} (${formatPercent(dp, p0.price)})`)
  const bars = Math.round(Math.abs(p1.u - p0.u))
  const barsText = isFinite(bars) ? `${bars} ${bars === 1 ? 'bar' : 'bars'}` : ''
  const ms = anchorTime(p1, ctx) - anchorTime(p0, ctx)
  const approx = !!(p0.approx || p1.approx)
  let span = ''
  if (isFinite(ms)) {
    span = ctx && typeof ctx.formatSpan === 'function' ? ctx.formatSpan(Math.abs(ms), approx) : formatSpan(ms, approx)
  }
  res.push(barsText && span ? `${barsText} · ${span}` : barsText || span)
  return res
}

/**
 * statsLines, cached on the geometry (§6.5): keyed on the drawing identity,
 * both anchors' u and price, the data revision, the price formatter and the
 * pane's visible range (the axis decimals follow the range). A drawing at
 * rest therefore builds its strings once, not once a frame; while it moves,
 * the key changes and the text follows it.
 */
export function cachedStats(g, d, p0, p1, ctx) {
  let k = g.statsKey
  if (!k) k = g.statsKey = { d: null, u0: 0, u1: 0, p0: 0, p1: 0, rev: 0, fmt: null, lo: 0, hi: 0, lines: [] }
  const ps = ctx.pane && ctx.pane.ps
  const lo = ps ? ps.lo : 0
  const hi = ps ? ps.hi : 0
  if (k.d !== d || k.u0 !== p0.u || k.u1 !== p1.u || k.p0 !== p0.price || k.p1 !== p1.price ||
      k.rev !== ctx.dataRev || k.fmt !== ctx.formatPrice || k.lo !== lo || k.hi !== hi) {
    statsLines(p0, p1, ctx, k.lines)
    k.d = d; k.u0 = p0.u; k.u1 = p1.u; k.p0 = p0.price; k.p1 = p1.price
    k.rev = ctx.dataRev; k.fmt = ctx.formatPrice; k.lo = lo; k.hi = hi
  }
  return k.lines
}

/* ------------------------------------------------------ option coercion -- */
// Every normalizeOptions builds a NEW object from known keys through these,
// so a stored row's junk (and __proto__, constructor, prototype) never
// reaches options, and an out-of-set enum falls back instead of throwing.

/** `v` if it is a member of `set`, else `def`. */
export function pick(v, set, def) {
  return set.has(v) ? v : def
}

/** A strict boolean with a default: only true/false count, not 'yes' or 1. */
export function flag(v, def) {
  return v === true || v === false ? v : def
}

/** Text options: String()ed, capped at 1,000 characters; null/undefined -> def. */
export function textOpt(v, def) {
  if (v === undefined || v === null) return def
  if (typeof v === 'object' || typeof v === 'function' || typeof v === 'symbol') return def
  const s = String(v)
  return s.length > 1000 ? s.slice(0, 1000) : s
}

/** A colour option: a string of at most 64 characters, else null (follow the theme). */
export function colorOpt(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : null
}

/** The raw options object, or an empty one for anything that is not a plain object. */
export function rawObject(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : EMPTY
}
const EMPTY = Object.freeze({})
