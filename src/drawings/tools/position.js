import { toNumber, DASH } from '../../chart/index.js'
import {
  setStroke, alphaOf, unit, widthOf, dashOf, clipRectOf, strokeSeg, crisp, clamp,
  putHandle, putTarget, keepAnchor, finiteAnchors, setBBox, nearRect, measureBox, drawBox, boxOf, inBox, withPrice, withTimeOf,
  shakeBody,
} from '../render/paint.js'
import { pick, flag, rawObject, formatDelta, formatPercent, MINUS } from '../render/labels.js'

/**
 * Long / short position: an entry, a target and a stop, with the reward and
 * risk zones, R:R, and (for backtest review) what actually happened next.
 *
 * Points: entry { t0, pE }, target { t1, pT }, stop { t1, pS }. The stop's
 * time always equals the target's (normalizePoints enforces it on every
 * load, add, update and patch): both share the box's right edge.
 *
 * A stop on the wrong side of the entry is kept as drawn (D21): both zones
 * turn the warning colour and R:R reads '—'. Silently flipping or clamping stored trade
 * data would hide the mistake instead of showing it.
 */

const SIDE = new Set(['long', 'short'])

const BODY = Object.freeze({ part: 'body' })
const LABEL = Object.freeze({ part: 'label' })
const FILL = Object.freeze({ part: 'fill' })

const CLAMP_PAD = 64
const HANDLE_PAD = 24
const LABEL_GAP = 12

const defaultStyle = Object.freeze({
  color: null, lineWidth: 1, lineStyle: 'solid', fill: null, fillOpacity: 0.16, textColor: null, fontSize: 12,
})
const defaultOptions = Object.freeze({ side: 'long', qty: null, outcome: true, labels: true })

/** Quantity: a finite number > 0, else null (no money line). */
function qtyOpt(v) {
  const n = toNumber(v)
  return n > 0 ? n : null
}

function normalizeOptions(raw) {
  raw = rawObject(raw)
  return {
    side: pick(raw.side, SIDE, 'long'),
    qty: qtyOpt(raw.qty),
    outcome: flag(raw.outcome, true),
    labels: flag(raw.labels, true),
  }
}

/**
 * Force the stop's time (and bar-count offset and its timeframe) to the
 * target's. A new stop object built from the target's time fields, so an
 * offset the stop had and the target does not is dropped, not kept.
 */
function normalizePoints(points) {
  if (!points || points.length < 3) return points
  const t = points[1]
  const stop = { time: t.time, price: points[2].price }
  if (t.offset !== undefined) stop.offset = t.offset
  if (t.tf !== undefined) stop.tf = t.tf
  return [points[0], t, stop]
}

/**
 * Mean true range of the (up to) 14 revealed bars ending at the entry bar.
 * True range needs the previous close, so the first bar has none; with
 * fewer than 2 bars, or data that yields no usable range, 1% of the price.
 */
function atr14(bars, entryIdx, price) {
  const fallback = Math.abs(price) * 0.01 || 1
  const n = bars ? bars.length : 0
  const e = Math.min(Math.round(entryIdx), n - 1)
  if (!(e >= 1)) return fallback
  let sum = 0
  let k = 0
  for (let i = Math.max(1, e - 13); i <= e; i++) {
    const b = bars[i]
    const p = bars[i - 1]
    if (!b || !p) continue
    const h = toNumber(b.high)
    const l = toNumber(b.low)
    const pc = toNumber(p.close)
    if (Number.isNaN(h) || Number.isNaN(l) || Number.isNaN(pc)) continue
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc))
    k++
  }
  const v = k ? sum / k : NaN
  return v > 0 && isFinite(v) ? v : fallback
}

/**
 * Expand a click (or a press-drag) into the three points.
 *
 * A click places smart brackets from the recent volatility: stop 1.5 ATR
 * away, target at 2R, the box `visibleBars / 6` bars wide (8..60), so a
 * position dropped on a 1m chart and on a daily chart both look sensible.
 * A press-drag sets the target (price and end) where the pointer went, with
 * the stop mirrored at R = |target − entry| / 2.
 *
 * `options` (the tool's normalized options for this creation) says long or
 * short; the ToolDef contract passes three arguments, so without it a click
 * reads long and a drag reads its side from the drag direction.
 */
function complete(points, ctx, drag, options) {
  const entry = points[0]
  const price = entry.price
  const entryIdx = ctx.indexOf(entry)
  const risk = 1.5 * atr14(ctx.bars, entryIdx, price)
  const side = options && SIDE.has(options.side) ? options.side : null
  let pT
  let pS
  let endU
  if (drag && drag.point && isFinite(drag.point.price) && drag.point.price !== price) {
    pT = drag.point.price
    const R = Math.abs(pT - price) / 2
    pS = pT > price ? price - R : price + R
    const du = isFinite(drag.u) && isFinite(entryIdx) ? Math.abs(drag.u - entryIdx) : 0
    endU = entryIdx + Math.max(1, du)
  } else {
    const dir = side === 'short' ? -1 : 1
    pS = price - dir * risk
    pT = price + dir * 2 * risk
    const vb = ctx.visibleBars > 0 ? ctx.visibleBars : 120
    endU = entryIdx + clamp(Math.round(vb / 6), 8, 60)
  }
  const end = isFinite(endU) ? ctx.pointAt(endU, pT) : null
  const tgt = end || withPrice(entry, pT)
  return [entry, tgt, withPrice(tgt, pS)]
}

/** Wrong side (D21): a long needs target > entry > stop; a short the mirror. */
function isWrong(long, pE, pT, pS) {
  return long ? !(pT > pE && pS < pE) : !(pT < pE && pS > pE)
}

/**
 * What happened after entry, over the REVEALED bars only (§3.4): the first
 * bar from entry+1 to min(end, last revealed) whose high/low reaches the
 * target or the stop. A bar that reaches both counts as the stop: a bar's
 * high and low do not say which came first, and a backtest that assumes
 * the kind outcome overstates the strategy.
 */
function scanOutcome(d, ctx) {
  const bars = ctx.bars
  const n = bars ? bars.length : 0
  const long = d.options.side !== 'short'
  const pE = d.points[0].price
  const pT = d.points[1].price
  const pS = d.points[2].price
  const u0 = ctx.indexOf(d.points[0])
  const u1 = ctx.indexOf(d.points[1])
  if (!n || !isFinite(u0) || !isFinite(u1)) return null
  const e = Math.floor(u0)
  // Entry not revealed yet (a replay before the trade): nothing happened.
  if (e > n - 1) return null
  const end = Math.min(Math.floor(u1), n - 1)
  for (let i = Math.max(e + 1, 0); i <= end; i++) {
    const b = bars[i]
    if (!b) continue
    const hi = toNumber(b.high)
    const lo = toNumber(b.low)
    const hitTarget = long ? hi >= pT : lo <= pT
    const hitStop = long ? lo <= pS : hi >= pS
    if (hitStop) return { kind: 'stop', i, sameBar: hitTarget }
    if (hitTarget) return { kind: 'target', i }
  }
  const j = Math.max(0, Math.min(Math.max(end, e), n - 1))
  const close = bars[j] ? toNumber(bars[j].close) : NaN
  return Number.isNaN(close) ? null : { kind: 'open', i: j, close }
}

/**
 * The outcome, cached per (drawing identity, data revision) in the slot's
 * geometry: a replay step or a forming bar's update that reaches the target
 * or the stop bumps dataRev and flips the label on that very frame.
 */
function outcomeOf(d, g, ctx) {
  const c = g.oc || (g.oc = { d: null, rev: NaN, outcome: null })
  if (c.d === d && c.rev === ctx.dataRev) return c.outcome
  c.outcome = scanOutcome(d, ctx)
  c.d = d
  c.rev = ctx.dataRev
  return c.outcome
}

function project(d, a, ctx, out) {
  out.clip = 'pane'
  out.vis = false
  if (!finiteAnchors(a, 3)) return false
  const o = d.options
  const a0 = a[0]
  const a1 = a[1]
  const a2 = a[2]
  const rect = clipRectOf(ctx, 'pane', out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0 }))
  out.p0 = keepAnchor(out.p0, a0)
  out.p1 = keepAnchor(out.p1, a1)
  out.p2 = keepAnchor(out.p2, a2)
  const l = Math.min(a0.x, a1.x)
  const r = Math.max(a0.x, a1.x)
  const t = Math.min(a0.y, a1.y, a2.y)
  const b = Math.max(a0.y, a1.y, a2.y)
  setBBox(out, l, t, r, b)
  out.infinite = false
  if (r < rect.x - CLAMP_PAD || l > rect.x + rect.w + CLAMP_PAD || b < rect.y - CLAMP_PAD || t > rect.y + rect.h + CLAMP_PAD) return false
  const lo = rect.y - CLAMP_PAD
  const hi = rect.y + rect.h + CLAMP_PAD
  out.l = crisp(clamp(l, rect.x - CLAMP_PAD, rect.x + rect.w + CLAMP_PAD))
  out.r = crisp(clamp(r, rect.x - CLAMP_PAD, rect.x + rect.w + CLAMP_PAD))
  out.yE = crisp(clamp(a0.y, lo, hi))
  out.yT = crisp(clamp(a1.y, lo, hi))
  out.yS = crisp(clamp(a2.y, lo, hi))
  const p = d.points
  out.long = o.side !== 'short'
  // Judged on the stored prices: a glide in flight must not flash the warning colour.
  out.wrong = isWrong(out.long, p[0].price, p[1].price, p[2].price)
  out.outcome = o.outcome !== false && !out.wrong ? outcomeOf(d, out, ctx) : null
  // Exposed for the controller: an outcome change plays the path draw-in,
  // and the transition into `wrong` plays the one-shot warn pulse (§6.3).
  out.outcomeKind = out.outcome ? out.outcome.kind : null
  if (out.outcome) {
    const oc = out.outcome
    const uE = ctx.indexOf(p[0])
    // x of the exit bar, interpolated between the projected anchors (x is
    // affine in u), so the path moves with the box while it glides.
    const span = a1.u - a0.u
    const x = span ? a0.x + ((oc.i - uE) * (a1.x - a0.x)) / span : ctx.host.ts.x(oc.i)
    const price = oc.kind === 'target' ? p[1].price : oc.kind === 'stop' ? p[2].price : oc.close
    out.ex = clamp(x, rect.x - CLAMP_PAD, rect.x + rect.w + CLAMP_PAD)
    out.ey = clamp(ctx.pane.ps.y(price), lo, hi)
    out.eBars = oc.i - Math.floor(uE)
    out.ePrice = price
  }
  out.vis = true
  return true
}

const money = (v) => Math.abs(v).toFixed(2)
const plural = (n) => (n === 1 ? ' bar' : ' bars')

/**
 * All label text, cached per (drawing, data revision, formatter, visible
 * range): the stored prices, the R multiple and the outcome, never per frame.
 */
function labelsOf(g, d, ctx) {
  const ps = ctx.pane.ps
  let k = g.lbKey
  if (!k) k = g.lbKey = { d: null, rev: NaN, fmt: null, lo: NaN, hi: NaN, tgt: '', stp: '', ctr: [], out: '' }
  if (k.d === d && k.rev === ctx.dataRev && k.fmt === ctx.formatPrice && k.lo === ps.lo && k.hi === ps.hi) return k
  const fmt = ctx.formatPrice
  const p = d.points
  const pE = p[0].price
  const pT = p[1].price
  const pS = p[2].price
  const reward = Math.abs(pT - pE)
  const risk = Math.abs(pE - pS)
  const rr = !g.wrong && risk > 0 ? (reward / risk).toFixed(2) : null
  k.tgt = `Target ${fmt(pT)} · ${formatDelta(pT - pE, fmt)} (${formatPercent(pT - pE, pE)})` + (rr ? ` · ${rr}R` : '')
  k.stp = `Stop ${fmt(pS)} · ${formatDelta(pS - pE, fmt)} (${formatPercent(pS - pE, pE)})`
  k.ctr.length = 0
  k.ctr.push(`R:R ${rr || '—'}`)
  const qty = d.options.qty
  if (qty > 0) k.ctr.push(`Qty ${qty} · +${money(qty * reward)} / ${MINUS}${money(qty * risk)}`)
  k.out = ''
  const oc = g.outcome
  if (oc) {
    const gain = g.long ? g.ePrice - pE : pE - g.ePrice
    const pct = formatPercent(gain, pE)
    if (oc.kind === 'target') k.out = `Target hit · ${pct} · ${g.eBars}${plural(g.eBars)}`
    else if (oc.kind === 'stop') k.out = `Stopped · ${pct} · ${g.eBars}${plural(g.eBars)}` + (oc.sameBar ? ' (same bar)' : '')
    else k.out = `Open · ${pct}`
  }
  k.d = d; k.rev = ctx.dataRev; k.fmt = fmt; k.lo = ps.lo; k.hi = ps.hi
  return k
}

/** Air kept between two pills, in px. Rounding to whole pixels at draw time can eat one of them. */
const PILL_GAP = 2
/** "As far as it takes": the shift limit for a pill that must always be drawn. */
const ANYWHERE = 1e9

/** Whether two placed pills touch or come within PILL_GAP of each other; an unplaced one (w = 0) never does. */
function crowds(a, b) {
  if (!a || !b || !(a.w > 0) || !(b.w > 0)) return false
  const g = PILL_GAP - 0.01
  return a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g
}

/** Whether `box` moved to top edge `y` is inside the pane and clear of `a`, `b` and `c`. */
function clearAt(box, y, rect, a, b, c) {
  if (y < rect.y + 2 || y + box.h > rect.y + rect.h - 2) return false
  const y0 = box.y
  box.y = y
  const hit = crowds(box, a) || crowds(box, b) || crowds(box, c)
  box.y = y0
  return !hit
}

/**
 * Slide `box` vertically to the nearest spot that is clear of the pills
 * `a`, `b` and `c` (any may be null or unplaced) and inside the pane, at most
 * `reach` px from where it started. Returns false, leaving it where it was,
 * when there is none.
 *
 * The only spots worth trying are the ones flush against another pill (just
 * above it or just below it) and the start itself: any clear spot can be
 * slid until it touches a pill or the start, so the nearest clear spot is
 * always one of them. No search loop, and no allocation on a frame.
 */
function settleY(box, rect, reach, a, b, c) {
  const y0 = box.y
  if (clearAt(box, y0, rect, a, b, c)) return true
  let best = NaN
  let bestD = reach
  for (let i = 0; i < 3; i++) {
    const o = i === 0 ? a : i === 1 ? b : c
    if (!o || !(o.w > 0)) continue
    for (let j = 0; j < 2; j++) {
      const y = j === 0 ? o.y + o.h + PILL_GAP : o.y - PILL_GAP - box.h
      const d = Math.abs(y - y0)
      if (d <= bestD && clearAt(box, y, rect, a, b, c)) { best = y; bestD = d }
    }
  }
  if (Number.isNaN(best)) return false
  box.y = best
  return true
}

/** One-line label box centred on x, `gap` px beyond edge y on the side away from the entry; flips inside at the pane edge. Places only: the pills are laid out against each other before any is drawn. */
function placeEdge(c, box, text, font, x, y, away, rect) {
  const one = LINE1
  one[0] = text
  measureBox(c, one, 1, font, box)
  box.x = clamp(x - box.w / 2, rect.x + 4, rect.x + rect.w - 4 - box.w)
  let top = away < 0 ? y - LABEL_GAP / 2 - box.h : y + LABEL_GAP / 2
  if (top < rect.y + 2 || top + box.h > rect.y + rect.h - 2) top = away < 0 ? y + LABEL_GAP / 2 : y - LABEL_GAP / 2 - box.h
  box.y = clamp(top, rect.y + 2, rect.y + rect.h - 2 - box.h)
}
const LINE1 = ['']

function drawEdge(c, box, text, font, bg, fg, align) {
  const one = LINE1
  one[0] = text
  drawBox(c, box, one, 1, bg, fg, font, align || 'center', null)
}

function draw(c, g, d, look, ctx) {
  if (!g.vis) return
  shakeBody(c, look)
  const th = ctx.theme
  const o = d.options
  const st = d.style
  const alpha = alphaOf(look)
  const hov = unit(look.hover, 0)
  // Boxes grow out of the entry line when the position is placed.
  const rev = unit(look.reveal, 1)
  const yE = g.yE
  const yT = yE + (g.yT - yE) * rev
  const yS = yE + (g.yS - yE) * rev
  const up = g.wrong ? th.warn : th.up
  const down = g.wrong ? th.warn : th.down
  const pulse = g.wrong ? 0.22 * unit(look.warnPulse, 0) : 0
  const fa = st.fillOpacity > 0 ? st.fillOpacity : 0
  const w = g.r - g.l

  c.globalAlpha = alpha * Math.min(1, fa + pulse + 0.04 * hov)
  c.fillStyle = up
  c.fillRect(g.l, Math.min(yE, yT), w, Math.abs(yT - yE))
  c.fillStyle = down
  c.fillRect(g.l, Math.min(yE, yS), w, Math.abs(yS - yE))

  c.globalAlpha = alpha
  setStroke(c, up, null, 1, null)
  strokeSeg(c, g.l, yT, g.r, yT)
  setStroke(c, down, null, 1, null)
  strokeSeg(c, g.l, yS, g.r, yS)
  setStroke(c, th.textColor, st.color, widthOf(d, look), dashOf(st, look))
  strokeSeg(c, g.l, yE, g.r, yE)

  const ob = boxOf(g, 'ob')
  ob.w = 0
  const oc = g.outcome
  if (oc && !look.preview) {
    // The trade's path: entry to exit, dotted, in the outcome's colour. It
    // draws itself in once per outcome change (Look.outcome, when motion
    // supplies it); at rest it is whole.
    const tone = oc.kind === 'target' ? th.up : oc.kind === 'stop' ? th.down : th.textColor
    const prog = unit(look.outcome, 1)
    const x0 = g.p0.x
    const x1 = x0 + (g.ex - x0) * prog
    const y1 = yE + (g.ey - yE) * prog
    c.globalAlpha = alpha
    setStroke(c, tone, null, 1.25, DASH.dotted)
    strokeSeg(c, x0, yE, x1, y1)
    if (prog >= 1) {
      c.fillStyle = tone
      c.beginPath()
      c.arc(g.ex, g.ey, 3, 0, Math.PI * 2)
      c.fill()
    }
  }

  const tb = boxOf(g, 'tb')
  const sb = boxOf(g, 'sb')
  const cb = boxOf(g, 'cb')
  tb.w = 0
  sb.w = 0
  cb.w = 0
  if (o.labels === false) return
  const lab = labelsOf(g, d, ctx)
  const font = th.font
  const rect = g.rect
  const cx = (g.l + g.r) / 2
  c.globalAlpha = alpha * rev
  // Every pill is placed against the others BEFORE any is drawn, in order of
  // how much the reader needs it: target, stop, R:R, then the outcome. A
  // pill that would land on a more important one slides clear of it; the
  // R:R and outcome pills, which repeat what the two edge pills and the path
  // already say, drop out when there is nowhere near to slide to (a box a few
  // px tall). The target and stop pills are never dropped.
  placeEdge(c, tb, lab.tgt, font, cx, yT, yT < yE ? -1 : 1, rect)
  placeEdge(c, sb, lab.stp, font, cx, yS, yS < yE ? -1 : 1, rect)
  // Both fall on the entry's side when the stop is on the wrong one (D21).
  settleY(sb, rect, ANYWHERE, tb, null, null)
  measureBox(c, lab.ctr, lab.ctr.length, font, cb)
  cb.x = clamp(cx - cb.w / 2, rect.x + 4, rect.x + rect.w - 4 - cb.w)
  cb.y = clamp(yE - cb.h / 2, rect.y + 2, rect.y + rect.h - 2 - cb.h)
  if (!settleY(cb, rect, cb.h, tb, sb, null)) cb.w = 0
  // The outcome label lands once the path has drawn itself in.
  const showOut = !!(lab.out && oc && !look.preview && unit(look.outcome, 1) >= 1)
  if (showOut && !placeOutcome(c, g, ob, lab.out, font, rect, yE, tb, sb, cb)) ob.w = 0
  drawEdge(c, tb, lab.tgt, font, up, th.tagText)
  drawEdge(c, sb, lab.stp, font, down, th.tagText)
  if (cb.w > 0) drawBox(c, cb, lab.ctr, lab.ctr.length, g.wrong ? th.warn : th.labelBg, g.wrong ? th.tagText : th.labelText, font, 'center', null)
  if (ob.w > 0) {
    const tone = oc.kind === 'target' ? th.up : oc.kind === 'stop' ? th.down : th.labelBg
    // A short dotted leader from the exit dot to its label.
    const beside = g.ex < ob.x || g.ex > ob.x + ob.w
    const lx = beside ? (ob.x > g.ex ? ob.x : ob.x + ob.w) : g.ex
    const ly = beside ? ob.y + ob.h / 2 : ob.y > g.ey ? ob.y : ob.y + ob.h
    setStroke(c, oc.kind === 'open' ? th.textColor : tone, null, 1, DASH.dotted)
    strokeSeg(c, g.ex, g.ey, lx, ly)
    drawEdge(c, ob, lab.out, font, tone, oc.kind === 'open' ? th.labelText : th.tagText, 'left')
  }
}

/**
 * Place the outcome pill near the exit dot, clear of the target, stop and
 * R:R pills; false when nowhere near the dot is clear.
 *
 * The three other pills are centred on the box and can be wider than it, so
 * "outside the far edge, level with the exit" is exactly where a target hit
 * (exit level with the target line) or a stop hit (level with the stop line)
 * used to land on top of them. Candidates, in order: outside the far edge;
 * outside the near edge; inside the box beside the exit dot. Each may slide
 * up or down (settleY) to get clear, by up to three pill heights.
 */
function placeOutcome(c, g, ob, text, font, rect, yE, tb, sb, cb) {
  const one = LINE1
  one[0] = text
  measureBox(c, one, 1, font, ob)
  const reach = ob.h * 3
  const far = g.p1.x >= g.p0.x
  const left = rect.x + 4
  const right = rect.x + rect.w - 4
  for (let k = 0; k < 2; k++) {
    // k = 0: the far edge; k = 1: the other one.
    const onRight = far === (k === 0)
    const ox = onRight ? g.r + 6 : g.l - 6 - ob.w
    if (ox < left || ox + ob.w > right) continue
    ob.x = ox
    ob.y = clamp(g.ey - ob.h / 2, rect.y + 2, rect.y + rect.h - 2 - ob.h)
    if (settleY(ob, rect, reach, tb, sb, cb)) return true
  }
  // Inside the box, on the entry side of the exit's level.
  ob.x = clamp(clamp(g.ex - ob.w / 2, g.l + 4, g.r - 4 - ob.w), left, right - ob.w)
  ob.y = clamp(yE >= g.ey ? g.ey + 8 : g.ey - 8 - ob.h, rect.y + 2, rect.y + rect.h - 2 - ob.h)
  return settleY(ob, rect, reach, tb, sb, cb)
}

function hit(g, x, y, tol) {
  if (!g.vis) return null
  if ((g.tb && inBox(g.tb, x, y, 1)) || (g.sb && inBox(g.sb, x, y, 1)) || (g.cb && inBox(g.cb, x, y, 1)) || (g.ob && inBox(g.ob, x, y, 1))) return LABEL
  const inX = x >= g.l - tol && x <= g.r + tol
  if (inX && (Math.abs(y - g.yE) <= tol || Math.abs(y - g.yT) <= tol || Math.abs(y - g.yS) <= tol)) return BODY
  const top = Math.min(g.yT, g.yS, g.yE)
  const bottom = Math.max(g.yT, g.yS, g.yE)
  if (x > g.l && x < g.r && y > top && y < bottom) return FILL
  return null
}

/**
 * Entry (xy: its price and start time), target and stop (y), and the end
 * (x, at the right edge on the entry line). The price handles sit at the
 * entry's side of the box, where TradingView puts them.
 */
function handles(g, d, out, touch) {
  if (!g.vis) return 0
  const r = g.rect
  const hx = g.p0.x
  let n = 0
  if (nearRect(r, hx, g.yE, HANDLE_PAD)) n = putHandle(out, n, hx, g.yE, 0, 'xy', 'grab')
  if (nearRect(r, hx, g.yT, HANDLE_PAD)) n = putHandle(out, n, hx, g.yT, 1, 'y', 'ns-resize')
  if (nearRect(r, hx, g.yS, HANDLE_PAD)) n = putHandle(out, n, hx, g.yS, 2, 'y', 'ns-resize')
  if (nearRect(r, g.p1.x, g.yE, HANDLE_PAD)) n = putHandle(out, n, g.p1.x, g.yE, 3, 'x', 'ew-resize')
  if (touch) {
    const mx = (g.l + g.r) / 2
    const my = (g.yE + g.yT) / 2
    if (nearRect(r, mx, my, 0)) n = putHandle(out, n, mx, my, -1, 'xy', 'move', true)
  }
  return n
}

function dragHandle(d0, index, s) {
  const p = d0.points
  if (!s || !s.point) return p.slice()
  const q = s.point
  switch (index) {
    case 0: return [q, p[1], p[2]]
    case 1: return [p[0], withPrice(p[1], q.price), p[2]]
    case 2: return [p[0], p[1], withPrice(p[2], q.price)]
    case 3: return [p[0], withTimeOf(p[1], q), withTimeOf(p[2], q)]
    default: return p.slice()
  }
}

/** Entry, target and stop are level rails for other drawings (§5.5). */
function snapTargets(d, g, ctx, out) {
  if (!g.vis) return 0
  const p = d.points
  const x = (g.l + g.r) / 2
  const id = ctx.pane.id
  let n = 0
  n = putTarget(out, n, 'level', x, g.yE, g.p0.u, p[0].price, null, id, d.id, 'Entry')
  n = putTarget(out, n, 'level', x, g.yT, g.p1.u, p[1].price, null, id, d.id, 'TP')
  n = putTarget(out, n, 'level', x, g.yS, g.p1.u, p[2].price, null, id, d.id, 'SL')
  return n
}

/** Labels are centred on the box and may be wider than a narrow one; the outcome label sits right of the exit. */
const half = (b) => (b && b.w > 0 ? b.w / 2 : 0)

function bleed(d, g) {
  let w = Math.max(half(g.tb), half(g.sb), half(g.cb))
  if (g.ob && g.ob.w > 0) w = Math.max(w, g.ob.w + 12)
  return Math.max(12, w ? w + 8 : 140)
}

export const position = Object.freeze({
  type: 'position',
  label: 'Position',
  anchors: 3,
  creation: 'single',
  dragCreate: true,
  snapPrefs: Object.freeze(['close', 'open', 'high', 'low']),
  prefBoost: 1,
  defaultStyle,
  defaultOptions,
  normalizeOptions,
  normalizePoints,
  complete,
  project,
  draw,
  hit,
  handles,
  dragHandle,
  snapTargets,
  bleed,
  angleOrigin: () => -1,
})
