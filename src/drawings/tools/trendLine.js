import { clipLine, distToSegment } from '../interaction/hit.js'
import {
  setStroke, setFill, dashOf, alphaOf, unit, widthOf, clipRectOf, strokeSeg, arrowHead, halo,
  putHandle, keepAnchor, finiteAnchors, statsAlpha, statsBox, boxOf, setBBox, fontOf, fontPx, linePriceAt,
  nearRect,
  shakeBody,
} from '../render/paint.js'
import { pick, textOpt, rawObject, cachedStats, statsLines } from '../render/labels.js'

/**
 * Trend line: P0 -> P1, optionally extended past either end, optionally with
 * arrow caps. The `ray`, `extendedLine` and `arrow` presets are this type with
 * different options, so a reader can toggle `extend` after drawing it.
 *
 * `extend` is relative to the drawn direction: 'right' continues past P1,
 * 'left' past P0. Drawn left to right (as nearly every ray is) that is also
 * screen right and left; drawn the other way, a ray still runs on in the
 * direction the reader dragged, which is what "ray" means.
 */

const EXTEND = new Set(['none', 'left', 'right', 'both'])
const CAP = new Set(['none', 'arrow'])
const STATS = new Set(['active', 'always', 'never'])

const BODY = Object.freeze({ part: 'body' })
const LABEL = Object.freeze({ part: 'label' })
const NO_LINES = Object.freeze([])

/** 28° half-angle: wide enough to read as an arrow at 1px, narrow enough not to look like a tent. */
const ARROW_HALF = (28 * Math.PI) / 180

const defaultStyle = Object.freeze({
  color: null, lineWidth: 1.5, lineStyle: 'solid', fill: null, fillOpacity: 0, textColor: null, fontSize: 12,
})
const defaultOptions = Object.freeze({ extend: 'none', startCap: 'none', endCap: 'none', stats: 'active', text: '' })

function normalizeOptions(raw) {
  raw = rawObject(raw)
  const o = { extend: pick(raw && raw.extend, EXTEND, 'none'),
    startCap: pick(raw.startCap, CAP, 'none'),
    endCap: pick(raw.endCap, CAP, 'none'),
    stats: pick(raw.stats, STATS, 'active'),
    text: textOpt(raw.text, '') }
  return o
}

/** Arrowhead length for a style: grows with the stroke so a 4px arrow is not a 1px arrow's head. */
const arrowLen = (d) => 8 + 2 * (d.style.lineWidth > 0 ? d.style.lineWidth : 1)

function project(d, a, ctx, out) {
  out.clip = 'pane'
  out.vis = false
  if (!finiteAnchors(a, 2)) return false
  const a0 = a[0]
  const a1 = a[1]
  const rect = clipRectOf(ctx, 'pane', out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0 }))
  const ext = d.options.extend
  const extStart = ext === 'left' || ext === 'both'
  const extEnd = ext === 'right' || ext === 'both'
  // Under 1px apart the two anchors have no direction worth trusting: an
  // extension would swing wildly with sub-pixel jitter while the second
  // point is being placed. Draw just the (tiny) segment until they separate.
  const dx = a1.x - a0.x
  const dy = a1.y - a0.y
  const degenerate = dx * dx + dy * dy < 1
  const seg = out.seg || (out.seg = { ax: 0, ay: 0, bx: 0, by: 0 })
  // Clipped in JS (Liang–Barsky) before anything reaches the canvas: an
  // infinite ray, or an anchor at a price of 1e300, never hands the canvas an
  // out-of-range coordinate.
  out.vis = clipLine(a0.x, a0.y, a1.x, a1.y, extStart && !degenerate, extEnd && !degenerate, rect, seg)
  out.extStart = extStart && !degenerate
  out.extEnd = extEnd && !degenerate
  out.infinite = out.extStart || out.extEnd
  out.p0 = keepAnchor(out.p0, a0)
  out.p1 = keepAnchor(out.p1, a1)
  if (out.vis) setBBox(out, seg.ax, seg.ay, seg.bx, seg.by)
  else setBBox(out, a0.x, a0.y, a1.x, a1.y)
  return out.vis
}

/** Halo path: the clipped segment. A named function taking its argument, so hovering allocates nothing. */
function segPath(c, s) {
  c.moveTo(s.ax, s.ay)
  c.lineTo(s.bx, s.by)
}

function draw(c, g, d, look, ctx) {
  if (!g.vis) return
  shakeBody(c, look)
  const th = ctx.theme
  const o = d.options
  const s = g.seg
  const p0 = g.p0
  const p1 = g.p1
  const alpha = alphaOf(look)
  const w = widthOf(d, look)
  const hov = unit(look.hover, 0)
  if (hov > 0 && !look.exporting) halo(c, segPath, th.halo, w + 6, 0.12 * hov * alpha, s)

  const len = arrowLen(d)
  const L = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const endArrow = o.endCap === 'arrow' && L > 1 && nearRect(g.rect, p1.x, p1.y, len)
  const startArrow = o.startCap === 'arrow' && L > 1 && nearRect(g.rect, p0.x, p0.y, len)
  let ax = s.ax
  let ay = s.ay
  let bx = s.bx
  let by = s.by
  // Stop the stroke at the arrowhead's base: a 4px line running on to the
  // tip blunts the point. Only where the line actually ends at that anchor
  // (not extended past it) and is long enough to keep a visible shaft.
  if (L > 2 * len) {
    const ux = (p1.x - p0.x) / L
    const uy = (p1.y - p0.y) / L
    const k = len * 0.7
    if (endArrow && !g.extEnd && Math.abs(bx - p1.x) < 0.5 && Math.abs(by - p1.y) < 0.5) { bx -= ux * k; by -= uy * k }
    if (startArrow && !g.extStart && Math.abs(ax - p0.x) < 0.5 && Math.abs(ay - p0.y) < 0.5) { ax += ux * k; ay += uy * k }
  }

  c.globalAlpha = alpha
  setStroke(c, th.line, d.style.color, w, dashOf(d.style, look))
  strokeSeg(c, ax, ay, bx, by)
  if (endArrow || startArrow) {
    setFill(c, th.line, d.style.color)
    if (endArrow) arrowHead(c, p0.x, p0.y, p1.x, p1.y, len, ARROW_HALF)
    if (startArrow) arrowHead(c, p1.x, p1.y, p0.x, p0.y, len, ARROW_HALF)
  }

  drawText(c, g, d, look, ctx, alpha)

  const sb = boxOf(g, 'statsB')
  const sa = statsAlpha(o.stats, look)
  sb.w = 0
  if (sa > 0) {
    const lines = cachedStats(g, d, p0, p1, ctx)
    const dp = p1.price - p0.price
    c.globalAlpha = sa
    statsBox(c, lines, p1.x, p1.y, g.rect, th, ctx.pointerType === 'touch', sb, dp > 0 ? th.up : dp < 0 ? th.down : null, look.flip)
    // Which side the pill chose, for the controller to feed motion's eased flip.
    g.statsSide = sb.side
  }
}

/**
 * The optional text, centred on the visible part of the line and rotated
 * along it, sitting just above the stroke. The angle is folded into
 * (−90°, 90°] so the text never reads upside down, whichever way the line
 * was drawn.
 */
function drawText(c, g, d, look, ctx, alpha) {
  const tl = g.tl || (g.tl = { cx: 0, cy: 0, ang: 0, w: 0, h: 0, off: 0 })
  tl.w = 0
  const text = d.options.text
  if (!text) return
  const s = g.seg
  const th = ctx.theme
  let ang = Math.atan2(s.by - s.ay, s.bx - s.ax)
  if (ang > Math.PI / 2) ang -= Math.PI
  else if (ang <= -Math.PI / 2) ang += Math.PI
  const font = fontOf(g, th.font, d.style.fontSize)
  tl.cx = (s.ax + s.bx) / 2
  tl.cy = (s.ay + s.by) / 2
  tl.ang = ang
  tl.w = ctx.textWidth(font, text)
  tl.h = fontPx(font)
  tl.off = 4 + widthOf(d, look) / 2
  c.save()
  c.translate(tl.cx, tl.cy)
  c.rotate(ang)
  c.globalAlpha = alpha
  c.font = font
  c.textAlign = 'center'
  c.textBaseline = 'bottom'
  setFill(c, th.line, d.style.color)
  if (d.style.textColor) c.fillStyle = d.style.textColor
  c.fillText(text, 0, -tl.off)
  c.restore()
}

/** Hit test the rotated text label: rotate the point into the label's frame. */
function inLabel(tl, x, y, pad) {
  if (!tl || !(tl.w > 0)) return false
  const dx = x - tl.cx
  const dy = y - tl.cy
  const cos = Math.cos(-tl.ang)
  const sin = Math.sin(-tl.ang)
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  return Math.abs(lx) <= tl.w / 2 + pad && ly <= -tl.off + pad && ly >= -tl.off - tl.h - pad
}

function hit(g, x, y, tol) {
  if (!g.vis) return null
  if (inLabel(g.tl, x, y, 2)) return LABEL
  const s = g.seg
  return distToSegment(x, y, s.ax, s.ay, s.bx, s.by) <= tol ? BODY : null
}

/** How far outside the clip rect a handle may sit and still be offered (a pane-edge handle stays whole). */
const HANDLE_PAD = 24

function handles(g, d, out, touch) {
  if (!g.p0) return 0
  const r = g.rect
  let n = 0
  if (nearRect(r, g.p0.x, g.p0.y, HANDLE_PAD)) n = putHandle(out, n, g.p0.x, g.p0.y, 0, 'xy', 'grab')
  if (nearRect(r, g.p1.x, g.p1.y, HANDLE_PAD)) n = putHandle(out, n, g.p1.x, g.p1.y, 1, 'xy', 'grab')
  // On touch a line is thin and its ends are often under the thumb: a move
  // handle at the midpoint drags the whole line (index −1: not a point).
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

function stats(d, a, ctx) {
  if (d.options.stats === 'never' || !a || a.length < 2) return NO_LINES
  return statsLines(a[0], a[1], ctx)
}

function priceAt(d, u, ctx) {
  const ext = d.options.extend
  return linePriceAt(d.points[0].price, d.points[1].price, ctx.indexOf(d.points[0]), ctx.indexOf(d.points[1]),
    ext === 'left' || ext === 'both', ext === 'right' || ext === 'both', u, ctx)
}

function bleed(d, g) {
  const sb = g.statsB
  const tl = g.tl
  return Math.max(12, sb && sb.w > 0 ? sb.w + 16 : 0, tl && tl.w > 0 ? tl.w / 2 + 8 : 0)
}

export const trendLine = Object.freeze({
  type: 'trendLine',
  label: 'Trend line',
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
  priceAt,
  bleed,
})
