import { clipLine, distToSegment } from '../interaction/hit.js'
import { toNumber, DASH } from '../../chart/index.js'
import {
  setStroke, setFill, alphaOf, unit, widthOf, clipRectOf, strokeSeg, halo, crisp, clamp, roundRect, linePitch,
  putHandle, putTarget, keepAnchor, finiteAnchors, setBBox, nearRect,
  shakeBody,
} from '../render/paint.js'
import { pick, flag, rawObject, colorOpt, formatLevel } from '../render/labels.js'

/**
 * Fibonacci retracement between P0 (the start of the move) and P1 (its end).
 *
 * Level L sits at p1 + (p0 − p1)·L: 0 at P1, 1 at P0, TradingView's
 * convention, so 0.618 is the golden retracement of the move just drawn.
 * `reverse` swaps the ends; `logLevels` interpolates in log price, which is
 * what a log chart's reader expects of a multi-decade move.
 *
 * Level y comes from the residual-applied anchor prices, so every level rides
 * along with the anchors while they glide (undo, snap), not only the ends.
 */

const EXTEND = new Set(['none', 'left', 'right', 'both'])
const LABELS = new Set(['left', 'right', 'none'])

const BODY = Object.freeze({ part: 'body' })
const LABEL = Object.freeze({ part: 'label' })
const FILL = Object.freeze({ part: 'fill' })

const MAX_LEVELS = 24
const HANDLE_PAD = 24
/** Level ys far outside the pane are clamped this far outside it (bounded coordinates, clipped away). */
const CLAMP_PAD = 64
/**
 * Label gap from the level line's end, and the slide distance of the reveal
 * stagger. The gap includes the pill's own padding: the pill sits 3px off
 * the line's end.
 */
const LABEL_GAP = 8
const SLIDE = 6
/** Horizontal padding of a label's backing pill, and the pill's opacity (candles stay faintly visible through it). */
const PILL_PAD = 5
const PILL_ALPHA = 0.82

const level = (value, visible) => Object.freeze({ value, color: null, visible })
const DEFAULT_LEVELS = Object.freeze([
  level(0, true), level(0.236, true), level(0.382, true), level(0.5, true), level(0.618, true),
  level(0.786, true), level(1, true), level(1.272, false), level(1.618, false), level(2.618, false),
])

const defaultStyle = Object.freeze({
  color: null, lineWidth: 1, lineStyle: 'solid', fill: null, fillOpacity: 0.06, textColor: null, fontSize: 12,
})
const defaultOptions = Object.freeze({
  levels: DEFAULT_LEVELS, reverse: false, logLevels: false, extend: 'none', labels: 'left',
  showPrices: true, fill: true, trend: true,
})

const levelPrice = (p0, p1, L) => p1 + (p0 - p1) * L

/** Level price in log space; falls back to linear when either end is not positive (log of it is meaningless). */
function priceOf(o, a, b, L) {
  const p0 = o.reverse ? b : a
  const p1 = o.reverse ? a : b
  if (o.logLevels && p0 > 0 && p1 > 0) return Math.exp(levelPrice(Math.log(p0), Math.log(p1), L))
  return levelPrice(p0, p1, L)
}

/**
 * Levels: an array of { value, color, visible } (a bare number is accepted
 * as a visible level), at most 24, values in [−10, 10]. Anything else in the
 * array is skipped, not fatal: one bad level in a stored row must not cost
 * the reader the other nine. A non-array means "the defaults".
 */
function normalizeLevels(raw) {
  if (!Array.isArray(raw)) return DEFAULT_LEVELS.map((l) => ({ value: l.value, color: l.color, visible: l.visible }))
  const out = []
  for (let i = 0; i < raw.length && out.length < MAX_LEVELS; i++) {
    const L = raw[i]
    let value
    let color = null
    let visible = true
    if (typeof L === 'number' || typeof L === 'string') value = toNumber(L)
    else if (L && typeof L === 'object') {
      value = toNumber(L.value)
      color = colorOpt(L.color)
      visible = L.visible !== false
    } else continue
    if (!(value >= -10 && value <= 10)) continue
    out.push({ value, color, visible })
  }
  return out
}

function normalizeOptions(raw) {
  raw = rawObject(raw)
  return {
    levels: normalizeLevels(raw.levels),
    reverse: flag(raw.reverse, false),
    logLevels: flag(raw.logLevels, false),
    extend: pick(raw.extend, EXTEND, 'none'),
    labels: pick(raw.labels, LABELS, 'left'),
    showPrices: flag(raw.showPrices, true),
    fill: flag(raw.fill, true),
    trend: flag(raw.trend, true),
  }
}

/**
 * The visible levels' indices, sorted by value (bands fill between value
 * neighbours whatever order the host stored them in). Rebuilt only when the
 * levels array changes identity: drawings are immutable, so that is exactly
 * when the levels were edited.
 */
function orderOf(g, levels) {
  if (g.levelsRef === levels && g.order) return g.orderN
  const ord = g.order || (g.order = new Int32Array(MAX_LEVELS))
  let n = 0
  for (let i = 0; i < levels.length && n < MAX_LEVELS; i++) {
    if (!levels[i] || levels[i].visible === false || !isFinite(levels[i].value)) continue
    let j = n++
    while (j > 0 && levels[ord[j - 1]].value > levels[i].value) { ord[j] = ord[j - 1]; j-- }
    ord[j] = i
  }
  g.levelsRef = levels
  g.orderN = n
  g.tags = null
  return n
}

function project(d, a, ctx, out) {
  out.clip = 'pane'
  out.vis = false
  out.n = 0
  if (!finiteAnchors(a, 2)) return false
  const o = d.options
  const a0 = a[0]
  const a1 = a[1]
  const rect = clipRectOf(ctx, 'pane', out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0 }))
  const ps = ctx.pane.ps
  out.p0 = keepAnchor(out.p0, a0)
  out.p1 = keepAnchor(out.p1, a1)
  const ext = o.extend
  const lx = ext === 'left' || ext === 'both' ? rect.x : Math.min(a0.x, a1.x)
  const rx = ext === 'right' || ext === 'both' ? rect.x + rect.w : Math.max(a0.x, a1.x)
  out.lx = clamp(lx, rect.x - CLAMP_PAD, rect.x + rect.w + CLAMP_PAD)
  out.rx = clamp(rx, rect.x - CLAMP_PAD, rect.x + rect.w + CLAMP_PAD)
  out.infinite = ext !== 'none'

  const levels = o.levels || DEFAULT_LEVELS
  const n = orderOf(out, levels)
  const ly = out.ly || (out.ly = new Float64Array(MAX_LEVELS))
  const lp = out.lp || (out.lp = new Float64Array(MAX_LEVELS))
  let y0 = Infinity
  let y1 = -Infinity
  for (let k = 0; k < n; k++) {
    const p = priceOf(o, a0.price, a1.price, levels[out.order[k]].value)
    const y = ps.y(p)
    lp[k] = p
    ly[k] = isFinite(y) ? crisp(clamp(y, rect.y - CLAMP_PAD, rect.y + rect.h + CLAMP_PAD)) : NaN
    if (ly[k] < y0) y0 = ly[k]
    if (ly[k] > y1) y1 = ly[k]
  }
  out.n = n
  out.y0 = y0
  out.y1 = y1
  // The dashed trend line from P0 to P1, clipped like any other segment.
  const tr = out.tr || (out.tr = { ax: 0, ay: 0, bx: 0, by: 0 })
  out.trVis = o.trend !== false && clipLine(a0.x, a0.y, a1.x, a1.y, false, false, rect, tr)
  const hasLevels = n > 0 && y1 >= rect.y && y0 <= rect.y + rect.h
  out.vis = out.lx <= out.rx && out.lx <= rect.x + rect.w && out.rx >= rect.x && (hasLevels || out.trVis)
  setBBox(out, out.lx, n ? y0 : Math.min(a0.y, a1.y), out.rx, n ? y1 : Math.max(a0.y, a1.y))
  return out.vis
}

/**
 * The level labels ('0.618 (148.20)'), cached on the geometry against
 * everything they print: the drawing, both anchor prices, the formatter and
 * the visible range (the axis decimals follow the range).
 */
function labelsOf(g, d, ctx) {
  const ps = ctx.pane.ps
  let k = g.lbKey
  if (!k) k = g.lbKey = { d: null, p0: NaN, p1: NaN, fmt: null, lo: NaN, hi: NaN, n: -1, text: [], w: new Float64Array(MAX_LEVELS), font: '' }
  const font = ctx.theme.font
  if (k.d === d && k.p0 === g.p0.price && k.p1 === g.p1.price && k.fmt === ctx.formatPrice &&
      k.lo === ps.lo && k.hi === ps.hi && k.n === g.n && k.font === font) return k
  const levels = d.options.levels || DEFAULT_LEVELS
  const show = d.options.showPrices !== false
  for (let j = 0; j < g.n; j++) {
    const v = formatLevel(levels[g.order[j]].value)
    k.text[j] = show ? `${v} (${ctx.formatPrice(g.lp[j])})` : v
    k.w[j] = ctx.textWidth(font, k.text[j])
  }
  k.text.length = g.n
  k.d = d; k.p0 = g.p0.price; k.p1 = g.p1.price; k.fmt = ctx.formatPrice; k.lo = ps.lo; k.hi = ps.hi; k.n = g.n; k.font = font
  return k
}

/**
 * The reveal stagger (§6.3 fibStagger): level i fades in and slides 22ms
 * after the one before it, 180ms each. A drawing at rest (reveal 1, or no
 * reveal in flight) shows every level in full, whatever its age reads.
 */
function staggerOf(look, i) {
  const rev = unit(look.reveal, 1)
  if (rev >= 1) return 1
  const age = look.age > 0 ? look.age : 0
  return Math.min(1, Math.max(0, (age - i * 22) / 180))
}

/** Theme colour of the k-th visible level: theme.fib by the level's position in `levels`. */
function levelColor(th, g, k) {
  const fib = th.fib
  return fib && fib.length ? fib[g.order[k] % fib.length] : th.line
}

function levelsPath(c, g) {
  for (let k = 0; k < g.n; k++) {
    if (!isFinite(g.ly[k])) continue
    c.moveTo(g.lx, g.ly[k])
    c.lineTo(g.rx, g.ly[k])
  }
}

function draw(c, g, d, look, ctx) {
  if (!g.vis) return
  shakeBody(c, look)
  const th = ctx.theme
  const o = d.options
  const st = d.style
  const levels = o.levels || DEFAULT_LEVELS
  const alpha = alphaOf(look)
  const w = widthOf(d, look)
  const hov = unit(look.hover, 0)
  const n = g.n

  // Bands between value neighbours, each in the colour of its upper level.
  if (o.fill !== false && st.fillOpacity > 0) {
    for (let k = 1; k < n; k++) {
      const ya = g.ly[k - 1]
      const yb = g.ly[k]
      if (!isFinite(ya) || !isFinite(yb) || ya === yb) continue
      c.globalAlpha = alpha * st.fillOpacity * staggerOf(look, k)
      setFill(c, levelColor(th, g, k), levels[g.order[k]].color)
      c.fillRect(g.lx, Math.min(ya, yb), g.rx - g.lx, Math.abs(yb - ya))
    }
  }

  if (hov > 0 && !look.exporting) halo(c, levelsPath, th.halo, w + 6, 0.12 * hov * alpha, g)

  if (g.trVis) {
    c.globalAlpha = alpha * 0.7
    setStroke(c, th.line, st.color, 1, DASH.dashed)
    strokeSeg(c, g.tr.ax, g.tr.ay, g.tr.bx, g.tr.by)
  }

  const dash = look.preview ? DASH.dashed : DASH[st.lineStyle] || DASH.solid
  for (let k = 0; k < n; k++) {
    const y = g.ly[k]
    if (!isFinite(y)) continue
    c.globalAlpha = alpha * staggerOf(look, k)
    setStroke(c, levelColor(th, g, k), levels[g.order[k]].color, w, dash)
    strokeSeg(c, g.lx, y, g.rx, y)
  }

  const lx = g.lxLab || (g.lxLab = new Float64Array(MAX_LEVELS))
  const lw = g.lwLab || (g.lwLab = new Float64Array(MAX_LEVELS))
  g.maxLW = 0
  g.labOn = o.labels !== 'none'
  if (!g.labOn) return
  const lab = labelsOf(g, d, ctx)
  const rect = g.rect
  c.font = th.font
  c.textBaseline = 'middle'
  // Each label sits on a pill in the chart's own background colour. Bare
  // text was unreadable wherever a level ran through the candles: the level
  // colours are picked to read on the background, not on a green or red body.
  // The background (not labelBg) keeps each level's colour readable exactly
  // as it is on the empty chart, in the light theme too.
  const pillBg = th.handleFill || th.labelBg
  const ph = linePitch(th.font) + 2
  for (let k = 0; k < n; k++) {
    const y = g.ly[k]
    lw[k] = 0
    if (!isFinite(y) || y < rect.y - 8 || y > rect.y + rect.h + 8) continue
    const s = staggerOf(look, k)
    const tw = lab.w[k]
    // Outside the level lines when there is room; tucked inside (above the
    // line) when the outside would run off the pane, so a fib drawn from the
    // left edge still labels its levels.
    let x
    let yy = y
    if (o.labels === 'left') {
      x = g.lx - LABEL_GAP - tw
      if (x - PILL_PAD < rect.x + 2) { x = g.lx + 4 + PILL_PAD; yy = y - ph / 2 - 3 }
    } else {
      x = g.rx + LABEL_GAP
      if (x + tw + PILL_PAD > rect.x + rect.w - 2) { x = g.rx - 4 - PILL_PAD - tw; yy = y - ph / 2 - 3 }
    }
    x += (o.labels === 'left' ? -SLIDE : SLIDE) * (1 - s)
    // The hit area is the pill, so the whole chip picks the drawing up.
    lx[k] = x - PILL_PAD
    lw[k] = tw + PILL_PAD * 2
    if (lw[k] > g.maxLW) g.maxLW = lw[k]
    c.globalAlpha = alpha * s * PILL_ALPHA
    c.fillStyle = pillBg
    roundRect(c, Math.round(lx[k]), Math.round(yy - ph / 2), lw[k], ph, 4)
    c.fill()
    c.globalAlpha = alpha * s
    c.textAlign = 'left'
    setFill(c, levelColor(th, g, k), levels[g.order[k]].color)
    c.fillText(lab.text[k], x, yy)
  }
}

function hit(g, x, y, tol) {
  if (!g.vis) return null
  for (let k = 0; k < g.n; k++) {
    const ly = g.ly[k]
    if (!isFinite(ly)) continue
    if (g.labOn && g.lwLab && g.lwLab[k] > 0 && x >= g.lxLab[k] - 2 && x <= g.lxLab[k] + g.lwLab[k] + 2 && Math.abs(y - ly) <= 8) return LABEL
    if (x >= g.lx - tol && x <= g.rx + tol && Math.abs(y - ly) <= tol) return BODY
  }
  if (g.trVis && distToSegment(x, y, g.tr.ax, g.tr.ay, g.tr.bx, g.tr.by) <= tol) return BODY
  if (g.n > 1 && x >= g.lx && x <= g.rx && y >= g.y0 && y <= g.y1) return FILL
  return null
}

function handles(g, d, out, touch) {
  if (!g.p0) return 0
  const r = g.rect
  let n = 0
  if (nearRect(r, g.p0.x, g.p0.y, HANDLE_PAD)) n = putHandle(out, n, g.p0.x, g.p0.y, 0, 'xy', 'grab')
  if (nearRect(r, g.p1.x, g.p1.y, HANDLE_PAD)) n = putHandle(out, n, g.p1.x, g.p1.y, 1, 'xy', 'grab')
  if (touch) {
    const mx = (g.p0.x + g.p1.x) / 2
    const my = (g.p0.y + g.p1.y) / 2
    if (nearRect(r, mx, my, 0)) n = putHandle(out, n, mx, my, -1, 'xy', 'move', true)
  }
  return n
}

function dragHandle(d0, index, s) {
  const pts = d0.points.slice()
  if (s && s.point && (index === 0 || index === 1)) pts[index] = s.point
  return pts
}

function angleOrigin(d, handleIndex) {
  return handleIndex === 0 ? 1 : handleIndex === 1 ? 0 : -1
}

/** Every visible level is a rail other drawings snap to, tagged with its ratio. */
function snapTargets(d, g, ctx, out) {
  if (!g.vis) return 0
  const levels = d.options.levels || DEFAULT_LEVELS
  if (!g.tags || g.tagsRef !== levels) {
    g.tags = []
    for (let k = 0; k < g.n; k++) g.tags[k] = formatLevel(levels[g.order[k]].value)
    g.tagsRef = levels
  }
  const x = (g.lx + g.rx) / 2
  let m = 0
  for (let k = 0; k < g.n; k++) {
    if (!isFinite(g.ly[k])) continue
    m = putTarget(out, m, 'level', x, g.ly[k], g.p0.u, g.lp[k], null, ctx.pane.id, d.id, g.tags[k])
  }
  return m
}

function bleed(d, g) {
  if (d.options.labels === 'none') return 12
  // Labels sit outside the level lines: a fib just off-screen still shows them.
  return Math.max(12, (g.maxLW || 90) + LABEL_GAP + SLIDE + 4)
}

export const fibRetracement = Object.freeze({
  type: 'fibRetracement',
  label: 'Fib retracement',
  anchors: 2,
  creation: 'points',
  snapPrefs: Object.freeze(['high', 'low']),
  prefBoost: 1.5,
  defaultStyle,
  defaultOptions,
  normalizeOptions,
  project,
  draw,
  hit,
  handles,
  dragHandle,
  angleOrigin,
  snapTargets,
  bleed,
})
