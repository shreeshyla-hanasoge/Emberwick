import { clipLine, distToSegment } from '../interaction/hit.js'
import { toNumber, DASH } from '../../chart/index.js'
import {
  setStroke, setFill, dashOf, alphaOf, unit, widthOf, clipRectOf, strokeSeg, halo, clamp,
  putHandle, keepAnchor, finiteAnchors, setBBox, nearRect, linePriceAt,
  shakeBody,
} from '../render/paint.js'
import { pick, flag, rawObject } from '../render/labels.js'

/**
 * Parallel channel: a baseline P0 -> P1 and a parallel line through P2.
 *
 * The offset is measured in SCREEN space from the projected anchors (D20):
 * y is affine in the pane's forward space (identity, or ln in log mode), so a
 * constant screen offset is a constant forward-space offset, and the channel
 * stays parallel on screen in log mode, where a constant PRICE offset would
 * fan out. P2 stays a real data anchor either way.
 */

const EXTEND = new Set(['none', 'left', 'right', 'both'])

const BODY = Object.freeze({ part: 'body' })
const FILL = Object.freeze({ part: 'fill' })

const HANDLE_PAD = 24
/**
 * The fill polygon's offset is capped at this many px: a P2 at a price of
 * 1e300 still fills the view correctly (the far line is off-screen either
 * way), without squaring 1e300-sized coordinates inside the polygon clipper.
 */
const MAX_FILL_OFF = 1e6

const defaultStyle = Object.freeze({
  color: null, lineWidth: 1.5, lineStyle: 'solid', fill: null, fillOpacity: 0.08, textColor: null, fontSize: 12,
})
const defaultOptions = Object.freeze({ extend: 'none', middle: true, fill: true })

function normalizeOptions(raw) {
  raw = rawObject(raw)
  return {
    extend: pick(raw.extend, EXTEND, 'none'),
    middle: flag(raw.middle, true),
    fill: flag(raw.fill, true),
  }
}

/** The baseline's screen y at screen x (the line through a0 and a1). */
const baseY = (a0, a1, x) => {
  const dx = a1.x - a0.x
  return dx ? a0.y + ((a1.y - a0.y) * (x - a0.x)) / dx : a0.y
}

const seg = (out, key) => out[key] || (out[key] = { ax: 0, ay: 0, bx: 0, by: 0 })

function project(d, a, ctx, out) {
  out.clip = 'pane'
  out.vis = false
  out.full = false
  out.polyN = 0
  if (!finiteAnchors(a, 2)) return false
  const a0 = a[0]
  const a1 = a[1]
  // While P1 is still being dragged there is no P2 yet: draw the baseline.
  const a2 = a.length > 2 && a[2] && isFinite(a[2].x) && isFinite(a[2].y) ? a[2] : a1
  const rect = clipRectOf(ctx, 'pane', out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0 }))
  const ext = d.options.extend
  const extStart = ext === 'left' || ext === 'both'
  const extEnd = ext === 'right' || ext === 'both'
  const off = a2.y - baseY(a0, a1, a2.x)
  // Anchors under 1px apart in x have no usable slope (a near-vertical base
  // would put the parallel line at an arbitrary offset): baseline only.
  const degenerate = Math.abs(a1.x - a0.x) < 1
  const full = !degenerate && a2 !== a1 && isFinite(off)
  out.off = full ? off : 0
  out.full = full
  out.extStart = extStart && !degenerate
  out.extEnd = extEnd && !degenerate
  out.infinite = out.extStart || out.extEnd
  out.p0 = keepAnchor(out.p0, a0)
  out.p1 = keepAnchor(out.p1, a1)
  out.p2 = keepAnchor(out.p2, a2)
  // hit() receives no drawing, so the option switches it needs ride along.
  out.midOn = d.options.middle
  out.fillOn = full && d.options.fill && d.style.fillOpacity > 0
  out.slope = degenerate ? 0 : (a1.y - a0.y) / (a1.x - a0.x)

  const base = seg(out, 'base')
  out.baseVis = clipLine(a0.x, a0.y, a1.x, a1.y, out.extStart, out.extEnd, rect, base)
  out.parVis = false
  out.midVis = false
  let vis = out.baseVis
  if (full) {
    out.parVis = clipLine(a0.x, a0.y + off, a1.x, a1.y + off, out.extStart, out.extEnd, rect, seg(out, 'par'))
    out.midVis = clipLine(a0.x, a0.y + off / 2, a1.x, a1.y + off / 2, out.extStart, out.extEnd, rect, seg(out, 'mid'))
    fillPolygon(out, a0, a1, rect)
    vis = vis || out.parVis || out.polyN > 2
  }
  const y0 = Math.min(a0.y, a1.y, a0.y + out.off, a1.y + out.off)
  const y1 = Math.max(a0.y, a1.y, a0.y + out.off, a1.y + out.off)
  setBBox(out, Math.min(a0.x, a1.x), clamp(y0, -1e7, 1e7), Math.max(a0.x, a1.x), clamp(y1, -1e7, 1e7))
  out.vis = vis
  return vis
}

/**
 * The channel's visible area as a convex polygon, clipped to the pane.
 *
 * The baseline (extended as drawn) is first cut to the pane grown vertically
 * by the offset: any visible point of the channel has its baseline point
 * directly above or below it within |off|, so that cut keeps every x that
 * matters and bounds the coordinates. The vertical-sided parallelogram over
 * it is then clipped to the pane (Sutherland–Hodgman), so the fill is exact
 * even where the two lines leave through different edges.
 */
function fillPolygon(out, a0, a1, rect) {
  const off = clamp(out.off, -MAX_FILL_OFF, MAX_FILL_OFF)
  const pad = Math.abs(off) + 2
  const fr = out.frect || (out.frect = { x: 0, y: 0, w: 0, h: 0 })
  fr.x = rect.x
  fr.y = rect.y - pad
  fr.w = rect.w
  fr.h = rect.h + 2 * pad
  const fs = seg(out, 'fseg')
  if (!clipLine(a0.x, a0.y, a1.x, a1.y, out.extStart, out.extEnd, fr, fs)) return
  const A = out.polyA || (out.polyA = new Float64Array(16))
  const B = out.polyB || (out.polyB = new Float64Array(16))
  A[0] = fs.ax; A[1] = fs.ay
  A[2] = fs.bx; A[3] = fs.by
  A[4] = fs.bx; A[5] = fs.by + off
  A[6] = fs.ax; A[7] = fs.ay + off
  let n = 4
  n = clipEdge(A, n, B, 0, rect.x)
  n = clipEdge(B, n, A, 1, rect.x + rect.w)
  n = clipEdge(A, n, B, 2, rect.y)
  n = clipEdge(B, n, A, 3, rect.y + rect.h)
  out.poly = A
  out.polyN = n
}

/** Is point i of P inside half-plane `side` (0: x >= v, 1: x <= v, 2: y >= v, 3: y <= v)? */
function inside(P, i, side, v) {
  const c = side < 2 ? P[2 * i] : P[2 * i + 1]
  return side === 0 || side === 2 ? c >= v : c <= v
}

/** One Sutherland–Hodgman pass of polygon P (n points) against one edge, into Q. Returns Q's count. */
function clipEdge(P, n, Q, side, v) {
  let m = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const inI = inside(P, i, side, v)
    const inJ = inside(P, j, side, v)
    if (inI && m < 8) { Q[2 * m] = P[2 * i]; Q[2 * m + 1] = P[2 * i + 1]; m++ }
    if (inI !== inJ && m < 8) {
      const x0 = P[2 * i]
      const y0 = P[2 * i + 1]
      const x1 = P[2 * j]
      const y1 = P[2 * j + 1]
      if (side < 2) {
        const t = (v - x0) / (x1 - x0)
        Q[2 * m] = v
        Q[2 * m + 1] = y0 + (y1 - y0) * t
      } else {
        const t = (v - y0) / (y1 - y0)
        Q[2 * m] = x0 + (x1 - x0) * t
        Q[2 * m + 1] = v
      }
      m++
    }
  }
  return m
}

function polyPath(c, g) {
  const P = g.poly
  c.moveTo(P[0], P[1])
  for (let i = 1; i < g.polyN; i++) c.lineTo(P[2 * i], P[2 * i + 1])
  c.closePath()
}

function linesPath(c, g) {
  if (g.baseVis) { c.moveTo(g.base.ax, g.base.ay); c.lineTo(g.base.bx, g.base.by) }
  if (g.parVis) { c.moveTo(g.par.ax, g.par.ay); c.lineTo(g.par.bx, g.par.by) }
}

function draw(c, g, d, look, ctx) {
  if (!g.vis) return
  shakeBody(c, look)
  const th = ctx.theme
  const st = d.style
  const alpha = alphaOf(look)
  const w = widthOf(d, look)
  const hov = unit(look.hover, 0)
  if (g.full && d.options.fill && st.fillOpacity > 0 && g.polyN > 2) {
    c.globalAlpha = alpha * Math.min(1, st.fillOpacity + 0.03 * hov)
    setFill(c, th.line, st.color)
    if (st.fill) c.fillStyle = st.fill
    c.beginPath()
    polyPath(c, g)
    c.fill()
  }
  if (hov > 0 && !look.exporting) halo(c, linesPath, th.halo, w + 6, 0.12 * hov * alpha, g)
  c.globalAlpha = alpha
  setStroke(c, th.line, st.color, w, dashOf(st, look))
  c.beginPath()
  linesPath(c, g)
  c.stroke()
  if (g.full && g.midVis && d.options.middle) {
    c.globalAlpha = alpha * 0.8
    setStroke(c, th.line, st.color, 1, DASH.dashed)
    strokeSeg(c, g.mid.ax, g.mid.ay, g.mid.bx, g.mid.by)
  }
}

/** Point in the (convex, clipped) fill polygon, by the crossing rule. */
function inPoly(P, n, x, y) {
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = P[2 * i]
    const yi = P[2 * i + 1]
    const xj = P[2 * j]
    const yj = P[2 * j + 1]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function hit(g, x, y, tol) {
  if (!g.vis) return null
  if (g.baseVis && distToSegment(x, y, g.base.ax, g.base.ay, g.base.bx, g.base.by) <= tol) return BODY
  if (g.parVis && distToSegment(x, y, g.par.ax, g.par.ay, g.par.bx, g.par.by) <= tol) return BODY
  if (g.midVis && g.midOn && distToSegment(x, y, g.mid.ax, g.mid.ay, g.mid.bx, g.mid.by) <= tol) return BODY
  if (g.fillOn && g.polyN > 2 && inPoly(g.poly, g.polyN, x, y)) return FILL
  return null
}

function handles(g, d, out, touch) {
  if (!g.p0) return 0
  const r = g.rect
  let n = 0
  if (nearRect(r, g.p0.x, g.p0.y, HANDLE_PAD)) n = putHandle(out, n, g.p0.x, g.p0.y, 0, 'xy', 'grab')
  if (nearRect(r, g.p1.x, g.p1.y, HANDLE_PAD)) n = putHandle(out, n, g.p1.x, g.p1.y, 1, 'xy', 'grab')
  if (g.full) {
    // P2 is edited through the parallel line's midpoint: wherever P2 was
    // placed along that line, this is where a reader looks for its handle.
    const mx = (g.p0.x + g.p1.x) / 2
    const my = (g.p0.y + g.p1.y) / 2
    if (nearRect(r, mx, my + g.off, HANDLE_PAD)) n = putHandle(out, n, mx, my + g.off, 2, 'y', 'ns-resize')
    if (touch && nearRect(r, mx, my + g.off / 2, 0)) n = putHandle(out, n, mx, my + g.off / 2, -1, 'xy', 'move', true)
  } else if (touch) {
    const mx = (g.p0.x + g.p1.x) / 2
    const my = (g.p0.y + g.p1.y) / 2
    if (nearRect(r, mx, my, 0)) n = putHandle(out, n, mx, my, -1, 'xy', 'move', true)
  }
  return n
}

/**
 * P0 and P1 move the baseline (P2 stays put in data, so the width follows
 * the new slope, as TradingView's does). Handle 2 re-places P2 at the
 * pointer: any point on the parallel line defines it equally.
 */
function dragHandle(d0, index, s) {
  const pts = d0.points.slice()
  if (s && s.point && index >= 0 && index <= 2 && index < pts.length) pts[index] = s.point
  return pts
}

function angleOrigin(d, handleIndex) {
  return handleIndex === 0 ? 1 : handleIndex === 1 ? 0 : -1
}

/**
 * The auto-fit magnet for P2 (§4.3): of the revealed bars between P0 and P1,
 * the one whose high (pointer above the base) or low (below) lies farthest
 * from the baseline, measured on screen. Snapping P2 there makes the channel
 * just contain the move. Price pane only: a sub-pane's scale has no highs.
 */
function fitTarget(d, placing, ptrY, ctx) {
  if (placing !== 2 || !d || !d.points || d.points.length < 2) return null
  const host = ctx.host
  if (!host || !host.panes || ctx.pane !== host.panes[0]) return null
  const bars = ctx.bars
  const ps = ctx.pane.ps
  const ts = host.ts
  const p0 = d.points[0]
  const p1 = d.points[1]
  const u0 = ctx.indexOf(p0)
  const u1 = ctx.indexOf(p1)
  if (!bars || !bars.length || !isFinite(u0) || !isFinite(u1) || !isFinite(ptrY)) return null
  const x0 = ts.x(u0)
  const x1 = ts.x(u1)
  if (Math.abs(x1 - x0) < 1) return null
  const y0 = ps.y(p0.price)
  const perBar = (ps.y(p1.price) - y0) / (u1 - u0)
  if (!isFinite(y0) || !isFinite(perBar)) return null
  const lo = Math.max(0, Math.ceil(Math.min(u0, u1)))
  const hi = Math.min(bars.length - 1, Math.floor(Math.max(u0, u1)))
  if (lo > hi) return null
  const above = ptrY < y0 + perBar * ((u0 + u1) / 2 - u0)
  let best = 0
  let bi = -1
  let bp = NaN
  for (let i = lo; i <= hi; i++) {
    const b = bars[i]
    if (!b) continue
    const v = toNumber(above ? b.high : b.low)
    if (Number.isNaN(v)) continue
    const yb = y0 + perBar * (i - u0)
    const e = above ? yb - ps.y(v) : ps.y(v) - yb
    if (e > best) { best = e; bi = i; bp = v }
  }
  if (bi < 0) return null
  const point = ctx.pointAt(bi, bp)
  if (!point) return null
  return { kind: 'fit', x: ts.x(bi), y: ps.y(bp), u: bi, price: bp, point, paneId: ctx.pane.id, id: d.id, tag: 'Fit' }
}

function priceAt(d, u, ctx) {
  const ext = d.options.extend
  return linePriceAt(d.points[0].price, d.points[1].price, ctx.indexOf(d.points[0]), ctx.indexOf(d.points[1]),
    ext === 'left' || ext === 'both', ext === 'right' || ext === 'both', u, ctx)
}

export const parallelChannel = Object.freeze({
  type: 'parallelChannel',
  label: 'Parallel channel',
  anchors: 3,
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
  fitTarget,
  priceAt,
})
