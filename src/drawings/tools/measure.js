import { distToSegment } from '../interaction/hit.js'
import { toNumber } from '../../chart/index.js'
import {
  setStroke, setFill, alphaOf, unit, clipRectOf, strokeSeg, arrowHead, crisp, clamp,
  putHandle, keepAnchor, finiteAnchors, setBBox, nearRect, measureBox, drawBox, boxOf, inBox,
  shakeBody,
} from '../render/paint.js'
import { flag, rawObject, statsLines, formatVolume, DASH_TEXT } from '../render/labels.js'

/**
 * Measure: the price change, bar count, clock span and volume between two
 * points, as a box filled up or down by the sign of the move.
 *
 * The same tool draws the ephemeral Shift+drag quick measure (§5.6), which
 * never enters the document: nothing here assumes a stored drawing.
 */

const BODY = Object.freeze({ part: 'body' })
const LABEL = Object.freeze({ part: 'label' })
const FILL = Object.freeze({ part: 'fill' })
const NO_LINES = Object.freeze([])

const CLAMP_PAD = 64
const HANDLE_PAD = 24
const ARROW_LEN = 7
const ARROW_HALF = (28 * Math.PI) / 180

const defaultStyle = Object.freeze({
  color: null, lineWidth: 1, lineStyle: 'solid', fill: null, fillOpacity: 0.12, textColor: null, fontSize: 12,
})
const defaultOptions = Object.freeze({ volume: true })

function normalizeOptions(raw) {
  raw = rawObject(raw)
  return { volume: flag(raw.volume, true) }
}

/** Clamp into [lo, hi] grown by CLAMP_PAD: far edges stay bounded and outside the clip. */
const cl = (v, lo, hi) => clamp(v, lo - CLAMP_PAD, hi + CLAMP_PAD)

function project(d, a, ctx, out) {
  out.clip = 'pane'
  out.vis = false
  if (!finiteAnchors(a, 2)) return false
  const a0 = a[0]
  const a1 = a[1]
  const rect = clipRectOf(ctx, 'pane', out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0 }))
  out.p0 = keepAnchor(out.p0, a0)
  out.p1 = keepAnchor(out.p1, a1)
  const l = Math.min(a0.x, a1.x)
  const r = Math.max(a0.x, a1.x)
  const t = Math.min(a0.y, a1.y)
  const b = Math.max(a0.y, a1.y)
  setBBox(out, l, t, r, b)
  out.infinite = false
  if (r < rect.x - CLAMP_PAD || l > rect.x + rect.w + CLAMP_PAD || b < rect.y - CLAMP_PAD || t > rect.y + rect.h + CLAMP_PAD) return false
  out.l = crisp(cl(l, rect.x, rect.x + rect.w))
  out.r = crisp(cl(r, rect.x, rect.x + rect.w))
  out.t = crisp(cl(t, rect.y, rect.y + rect.h))
  out.b = crisp(cl(b, rect.y, rect.y + rect.h))
  // Arrow ends in the direction of the measurement: time runs P0 -> P1 along
  // x, price P0 -> P1 along y, so the arrows point where the move went.
  out.hx0 = crisp(cl(a0.x, rect.x, rect.x + rect.w))
  out.hx1 = crisp(cl(a1.x, rect.x, rect.x + rect.w))
  out.vy0 = crisp(cl(a0.y, rect.y, rect.y + rect.h))
  out.vy1 = crisp(cl(a1.y, rect.y, rect.y + rect.h))
  out.cx = crisp((out.l + out.r) / 2)
  out.cy = crisp((out.t + out.b) / 2)
  out.up = a1.price >= a0.price
  out.vis = true
  return true
}

/**
 * Volume over the REVEALED bars inside the span (§3.4): under replay the
 * measure must not know about volume the reader has not been shown yet.
 * Cached per (drawing identity, data revision), so a forming bar's volume
 * update or a replay step recounts it and nothing else does. The range comes
 * from the stored points, not the on-screen anchors, so a glide in flight
 * does not recount it every frame.
 */
function volumeOf(g, d, ctx) {
  const c = g.vol || (g.vol = { d: null, rev: NaN, v: NaN })
  if (c.d === d && c.rev === ctx.dataRev) return c.v
  c.d = d
  c.rev = ctx.dataRev
  const bars = ctx.bars
  const u0 = ctx.indexOf(d.points[0])
  const u1 = ctx.indexOf(d.points[1])
  let v = NaN
  if (bars && bars.length && isFinite(u0) && isFinite(u1)) {
    const lo = Math.max(0, Math.ceil(Math.min(u0, u1)))
    const hi = Math.min(bars.length - 1, Math.floor(Math.max(u0, u1)))
    if (lo <= hi) {
      v = 0
      for (let i = lo; i <= hi; i++) {
        const x = bars[i] ? toNumber(bars[i].volume) : NaN
        if (!Number.isNaN(x)) v += x
      }
    }
  }
  c.v = v
  return v
}

/** The three label lines, cached on the geometry like every stats label (§6.5). */
function linesOf(g, d, ctx) {
  const ps = ctx.pane.ps
  let k = g.lnKey
  if (!k) k = g.lnKey = { d: null, u0: NaN, u1: NaN, p0: NaN, p1: NaN, rev: NaN, fmt: null, lo: NaN, hi: NaN, lines: [] }
  if (k.d === d && k.u0 === g.p0.u && k.u1 === g.p1.u && k.p0 === g.p0.price && k.p1 === g.p1.price &&
      k.rev === ctx.dataRev && k.fmt === ctx.formatPrice && k.lo === ps.lo && k.hi === ps.hi) return k.lines
  statsLines(g.p0, g.p1, ctx, k.lines)
  if (d.options.volume !== false) {
    const v = volumeOf(g, d, ctx)
    k.lines.push('Vol ' + (Number.isNaN(v) ? DASH_TEXT : formatVolume(v)))
  }
  k.d = d; k.u0 = g.p0.u; k.u1 = g.p1.u; k.p0 = g.p0.price; k.p1 = g.p1.price
  k.rev = ctx.dataRev; k.fmt = ctx.formatPrice; k.lo = ps.lo; k.hi = ps.hi
  return k.lines
}

function draw(c, g, d, look, ctx) {
  if (!g.vis) return
  shakeBody(c, look)
  const th = ctx.theme
  const st = d.style
  const alpha = alphaOf(look)
  const hov = unit(look.hover, 0)
  const tone = g.up ? th.up : th.down

  c.globalAlpha = alpha * Math.min(1, (st.fillOpacity > 0 ? st.fillOpacity : 0.12) + 0.04 * hov)
  setFill(c, tone, st.color)
  c.fillRect(g.l, g.t, g.r - g.l, g.b - g.t)

  // Two arrows through the centre: time (x) and price (y).
  c.globalAlpha = alpha
  setStroke(c, tone, st.color, 1 + 0.75 * hov, null)
  strokeSeg(c, g.hx0, g.cy, g.hx1, g.cy)
  strokeSeg(c, g.cx, g.vy0, g.cx, g.vy1)
  setFill(c, tone, st.color)
  if (Math.abs(g.hx1 - g.hx0) > ARROW_LEN * 1.5) arrowHead(c, g.hx0, g.cy, g.hx1, g.cy, ARROW_LEN, ARROW_HALF)
  if (Math.abs(g.vy1 - g.vy0) > ARROW_LEN * 1.5) arrowHead(c, g.cx, g.vy0, g.cx, g.vy1, ARROW_LEN, ARROW_HALF)

  // The readout sits outside the box on the side the move went (above for
  // an up move, below for a down move), centred, clamped into the pane.
  const lines = linesOf(g, d, ctx)
  const box = boxOf(g, 'lb')
  measureBox(c, lines, lines.length, th.font, box)
  const rect = g.rect
  box.x = (g.l + g.r) / 2 - box.w / 2
  box.y = g.up ? g.t - 8 - box.h : g.b + 8
  if (box.y < rect.y + 4) box.y = g.up ? g.b + 8 : box.y
  if (box.y + box.h > rect.y + rect.h - 4) box.y = g.up ? box.y : g.t - 8 - box.h
  box.x = clamp(box.x, rect.x + 4, rect.x + rect.w - 4 - box.w)
  box.y = clamp(box.y, rect.y + 4, rect.y + rect.h - 4 - box.h)
  c.globalAlpha = alpha * 0.95
  drawBox(c, box, lines, lines.length, tone, th.tagText, th.font, 'center', null)
}

function hit(g, x, y, tol) {
  if (!g.vis) return null
  if (g.lb && inBox(g.lb, x, y, 1)) return LABEL
  if (distToSegment(x, y, g.hx0, g.cy, g.hx1, g.cy) <= tol) return BODY
  if (distToSegment(x, y, g.cx, g.vy0, g.cx, g.vy1) <= tol) return BODY
  if (x > g.l && x < g.r && y > g.t && y < g.b) return FILL
  return null
}

function handles(g, d, out, touch) {
  if (!g.p0) return 0
  const r = g.rect
  let n = 0
  if (nearRect(r, g.p0.x, g.p0.y, HANDLE_PAD)) n = putHandle(out, n, g.p0.x, g.p0.y, 0, 'xy', 'grab')
  if (nearRect(r, g.p1.x, g.p1.y, HANDLE_PAD)) n = putHandle(out, n, g.p1.x, g.p1.y, 1, 'xy', 'grab')
  if (touch && g.vis && nearRect(r, g.cx, g.cy, 0)) n = putHandle(out, n, g.cx, g.cy, -1, 'xy', 'move', true)
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

function stats(d, a, ctx) {
  if (!a || a.length < 2) return NO_LINES
  return statsLines(a[0], a[1], ctx)
}

function bleed(d, g) {
  // The readout is centred on the box and can be wider than a narrow one.
  const lb = g.lb
  return Math.max(12, lb && lb.w > 0 ? lb.w / 2 + 8 : 80)
}

export const measure = Object.freeze({
  type: 'measure',
  label: 'Measure',
  anchors: 2,
  creation: 'points',
  snapPrefs: Object.freeze(['high', 'low', 'close', 'open']),
  prefBoost: 1,
  defaultStyle,
  defaultOptions,
  normalizeOptions,
  project,
  draw,
  hit,
  handles,
  dragHandle,
  angleOrigin,
  stats,
  bleed,
})
