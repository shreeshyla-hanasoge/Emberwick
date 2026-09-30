import {
  setStroke, setFill, dashOf, alphaOf, unit, widthOf, clipRectOf, strokeSeg, halo, crisp, clamp,
  putHandle, keepAnchor, finiteAnchors, setBBox, fontOf, fontPx, boxOf, inBox, nearRect,
  withPrice, withTimeOf, statsAlpha, statsBox,
  shakeBody,
} from '../render/paint.js'
import { DASH } from '../../chart/index.js'
import { pick, flag, textOpt, rawObject, cachedStats, statsLines } from '../render/labels.js'

/**
 * Rectangle: a price-and-time box between two opposite corners.
 *
 * Handles are the 4 corners (indices 0–3) then the 4 edge midpoints (4–7).
 * Every handle edits one or both coordinates of the stored corners and
 * leaves the opposite corner or edge alone, so dragging a handle past its
 * opposite side simply flips the box: the points are never reordered, and a
 * host that stored P0 as "the start" still finds it there.
 *
 *   0: P0              1: P1
 *   2: P0's time, P1's price     3: P1's time, P0's price
 *   4: edge at P0's time         5: edge at P1's time
 *   6: edge at P0's price        7: edge at P1's price
 */

const EXTEND = new Set(['none', 'right'])
const STATS = new Set(['active', 'always', 'never'])

const BODY = Object.freeze({ part: 'body' })
const LABEL = Object.freeze({ part: 'label' })
const FILL = Object.freeze({ part: 'fill' })
const NO_LINES = Object.freeze([])

/**
 * Box edges far outside the pane are clamped this far outside it: the
 * coordinates stay bounded (a price of 1e300 never reaches the canvas) and
 * the clamped edge stays outside the canvas clip, so it never paints a false
 * border along the pane edge.
 */
const CLAMP_PAD = 64
const HANDLE_PAD = 24

const defaultStyle = Object.freeze({
  color: null, lineWidth: 1, lineStyle: 'solid', fill: null, fillOpacity: 0.12, textColor: null, fontSize: 12,
})
const defaultOptions = Object.freeze({ extend: 'none', text: '', middleLine: false, stats: 'never' })

function normalizeOptions(raw) {
  raw = rawObject(raw)
  return {
    extend: pick(raw.extend, EXTEND, 'none'),
    text: textOpt(raw.text, ''),
    middleLine: flag(raw.middleLine, false),
    stats: pick(raw.stats, STATS, 'never'),
  }
}

function project(d, a, ctx, out) {
  out.clip = 'pane'
  out.vis = false
  if (!finiteAnchors(a, 2)) return false
  const a0 = a[0]
  const a1 = a[1]
  const rect = clipRectOf(ctx, 'pane', out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0 }))
  const ext = d.options.extend === 'right'
  let l = Math.min(a0.x, a1.x)
  let r = ext ? Math.max(rect.x + rect.w, a0.x, a1.x) : Math.max(a0.x, a1.x)
  let t = Math.min(a0.y, a1.y)
  let b = Math.max(a0.y, a1.y)
  out.p0 = keepAnchor(out.p0, a0)
  out.p1 = keepAnchor(out.p1, a1)
  if (r < rect.x - CLAMP_PAD || l > rect.x + rect.w + CLAMP_PAD || b < rect.y - CLAMP_PAD || t > rect.y + rect.h + CLAMP_PAD) {
    setBBox(out, l, t, r, b)
    return false
  }
  l = crisp(clamp(l, rect.x - CLAMP_PAD, rect.x + rect.w + CLAMP_PAD))
  r = crisp(clamp(r, rect.x - CLAMP_PAD, rect.x + rect.w + CLAMP_PAD))
  t = crisp(clamp(t, rect.y - CLAMP_PAD, rect.y + rect.h + CLAMP_PAD))
  b = crisp(clamp(b, rect.y - CLAMP_PAD, rect.y + rect.h + CLAMP_PAD))
  out.l = l
  out.r = r
  out.t = t
  out.b = b
  out.ext = ext
  out.fillA = d.style.fillOpacity > 0 ? d.style.fillOpacity : 0
  out.infinite = ext
  setBBox(out, l, t, r, b)
  out.vis = true
  return true
}

/** Stroke path: four sides, or three for a box extended to the right edge (it has no right side). */
function boxPath(c, g) {
  if (g.ext) {
    c.moveTo(g.r, g.t)
    c.lineTo(g.l, g.t)
    c.lineTo(g.l, g.b)
    c.lineTo(g.r, g.b)
  } else {
    c.moveTo(g.l, g.t)
    c.lineTo(g.r, g.t)
    c.lineTo(g.r, g.b)
    c.lineTo(g.l, g.b)
    c.closePath()
  }
}

function draw(c, g, d, look, ctx) {
  if (!g.vis) return
  shakeBody(c, look)
  const th = ctx.theme
  const st = d.style
  const alpha = alphaOf(look)
  const w = widthOf(d, look)
  const hov = unit(look.hover, 0)
  if (g.fillA > 0) {
    // Hover lifts the fill a touch, so the box under the pointer reads as the
    // one that will move.
    c.globalAlpha = alpha * Math.min(1, g.fillA + 0.04 * hov)
    setFill(c, th.line, st.color)
    if (st.fill) c.fillStyle = st.fill
    c.fillRect(g.l, g.t, g.r - g.l, g.b - g.t)
  }
  if (hov > 0 && !look.exporting) {
    halo(c, boxPath, th.halo, w + 6, 0.12 * hov * alpha, g)
  }
  c.globalAlpha = alpha
  setStroke(c, th.line, st.color, w, dashOf(st, look))
  c.beginPath()
  boxPath(c, g)
  c.stroke()

  if (d.options.middleLine) {
    const my = crisp((g.t + g.b) / 2)
    c.globalAlpha = alpha * 0.7
    setStroke(c, th.line, st.color, 1, DASH.dashed)
    strokeSeg(c, g.l, my, g.r, my)
  }

  const lb = boxOf(g, 'lb')
  lb.w = 0
  const text = d.options.text
  if (text) {
    const font = fontOf(g, th.font, st.fontSize)
    const tw = ctx.textWidth(font, text)
    const h = fontPx(font)
    // Centred in the visible part of the box, so a box wider than the view
    // still shows its label.
    const pr = g.rect
    const cx = (Math.max(g.l, pr.x) + Math.min(g.r, pr.x + pr.w)) / 2
    const cy = (Math.max(g.t, pr.y) + Math.min(g.b, pr.y + pr.h)) / 2
    lb.x = cx - tw / 2
    lb.y = cy - h / 2
    lb.w = tw
    lb.h = h
    c.globalAlpha = alpha
    c.font = font
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    setFill(c, th.textColor, st.color)
    if (st.textColor) c.fillStyle = st.textColor
    c.fillText(text, cx, cy)
  }

  const sb = boxOf(g, 'statsB')
  sb.w = 0
  const sa = statsAlpha(d.options.stats, look)
  if (sa > 0) {
    const lines = cachedStats(g, d, g.p0, g.p1, ctx)
    const dp = g.p1.price - g.p0.price
    c.globalAlpha = sa
    statsBox(c, lines, g.p1.x, g.p1.y, g.rect, th, ctx.pointerType === 'touch', sb, dp > 0 ? th.up : dp < 0 ? th.down : null, look.flip)
    // Which side the pill chose, for the controller to feed motion's eased flip.
    g.statsSide = sb.side
  }
}

function hit(g, x, y, tol) {
  if (!g.vis) return null
  if (g.lb && inBox(g.lb, x, y, 2)) return LABEL
  const inV = y >= g.t - tol && y <= g.b + tol
  const inH = x >= g.l - tol && x <= g.r + tol
  if (inV && (Math.abs(x - g.l) <= tol || (!g.ext && Math.abs(x - g.r) <= tol))) return BODY
  if (inH && (Math.abs(y - g.t) <= tol || Math.abs(y - g.b) <= tol)) return BODY
  if (g.fillA > 0 && x > g.l && x < g.r && y > g.t && y < g.b) return FILL
  return null
}

/**
 * The resize cursor for a corner, from its screen position relative to the
 * opposite corner: top-left and bottom-right corners resize along the
 * nwse diagonal, the other two along nesw. By screen orientation, not by
 * index, because a flipped box swaps which corner is where.
 */
const cornerCursor = (x, y, ox, oy) => ((x - ox) * (y - oy) >= 0 ? 'nwse-resize' : 'nesw-resize')

function handles(g, d, out, touch) {
  if (!g.p0) return 0
  const r = g.rect
  const x0 = g.p0.x
  const y0 = g.p0.y
  const x1 = g.p1.x
  const y1 = g.p1.y
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  let n = 0
  if (nearRect(r, x0, y0, HANDLE_PAD)) n = putHandle(out, n, x0, y0, 0, 'xy', cornerCursor(x0, y0, x1, y1))
  if (nearRect(r, x1, y1, HANDLE_PAD)) n = putHandle(out, n, x1, y1, 1, 'xy', cornerCursor(x1, y1, x0, y0))
  if (nearRect(r, x0, y1, HANDLE_PAD)) n = putHandle(out, n, x0, y1, 2, 'xy', cornerCursor(x0, y1, x1, y0))
  if (nearRect(r, x1, y0, HANDLE_PAD)) n = putHandle(out, n, x1, y0, 3, 'xy', cornerCursor(x1, y0, x0, y1))
  if (nearRect(r, x0, my, HANDLE_PAD)) n = putHandle(out, n, x0, my, 4, 'x', 'ew-resize')
  if (nearRect(r, x1, my, HANDLE_PAD)) n = putHandle(out, n, x1, my, 5, 'x', 'ew-resize')
  if (nearRect(r, mx, y0, HANDLE_PAD)) n = putHandle(out, n, mx, y0, 6, 'y', 'ns-resize')
  if (nearRect(r, mx, y1, HANDLE_PAD)) n = putHandle(out, n, mx, y1, 7, 'y', 'ns-resize')
  if (touch && nearRect(r, mx, my, 0)) n = putHandle(out, n, mx, my, -1, 'xy', 'move', true)
  return n
}

function dragHandle(d0, index, s) {
  const p = d0.points
  if (!s || !s.point) return p.slice()
  const q = s.point
  switch (index) {
    case 0: return [q, p[1]]
    case 1: return [p[0], q]
    case 2: return [withTimeOf(p[0], q), withPrice(p[1], q.price)]
    case 3: return [withPrice(p[0], q.price), withTimeOf(p[1], q)]
    case 4: return [withTimeOf(p[0], q), p[1]]
    case 5: return [p[0], withTimeOf(p[1], q)]
    case 6: return [withPrice(p[0], q.price), p[1]]
    case 7: return [p[0], withPrice(p[1], q.price)]
    default: return p.slice()
  }
}

/** Shift on a corner constrains the diagonal from the opposite stored corner: 45° is a screen square. */
function angleOrigin(d, handleIndex) {
  return handleIndex === 0 ? 1 : handleIndex === 1 ? 0 : -1
}

function stats(d, a, ctx) {
  if (d.options.stats === 'never' || !a || a.length < 2) return NO_LINES
  return statsLines(a[0], a[1], ctx)
}

function bleed(d, g) {
  const sb = g.statsB
  return Math.max(12, sb && sb.w > 0 ? sb.w + 16 : 0)
}

export const rectangle = Object.freeze({
  type: 'rectangle',
  label: 'Rectangle',
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
