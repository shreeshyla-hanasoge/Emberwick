import {
  setStroke, setFill, dashOf, alphaOf, unit, widthOf, clipRectOf, strokeSeg, halo, clamp,
  putHandle, putTag, finiteAnchors, setBBox, fontOf, fontPx, boxOf, inBox, withTimeOf,
  shakeBody,
} from '../render/paint.js'
import { pick, flag, textOpt, rawObject, anchorTime } from '../render/labels.js'

/**
 * Vertical line: one moment, marked across the whole plot (every pane, the
 * default) or its own pane only.
 *
 * On a bar it sits exactly on that bar's wick, at every bar width: it uses
 * the candle renderer's own formula rather than rounding the anchor's x,
 * which lands half a pixel beside the wick whenever the bar width is even.
 */

const SPAN = new Set(['all', 'pane'])

const BODY = Object.freeze({ part: 'body' })
const LABEL = Object.freeze({ part: 'label' })

/** The handle stays this far inside the pane when its price is off-screen. */
const HANDLE_INSET = 8

const defaultStyle = Object.freeze({
  color: null, lineWidth: 1, lineStyle: 'solid', fill: null, fillOpacity: 0, textColor: null, fontSize: 12,
})
const defaultOptions = Object.freeze({ span: 'all', timeLabel: true, text: '' })

function normalizeOptions(raw) {
  raw = rawObject(raw)
  return {
    span: pick(raw.span, SPAN, 'all'),
    timeLabel: flag(raw.timeLabel, true),
    text: textOpt(raw.text, ''),
  }
}

function project(d, anchors, ctx, out) {
  out.vis = false
  out.clip = d.options.span === 'all' ? 'plot' : 'pane'
  if (!finiteAnchors(anchors, 1)) return false
  const a = anchors[0]
  const u = a.u
  // An integer u is a bar: use the wick's own x (candles.js). A fractional u
  // (a time between bars, or a glide in flight) has no wick to agree with.
  const x = Number.isInteger(u) ? Math.round(ctx.host.ts.x(u)) + (ctx.host.ts.barWidth() % 2 ? 0.5 : 0) : Math.round(a.x) + 0.5
  const rect = clipRectOf(ctx, out.clip, out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0 }))
  if (!(x >= rect.x - 1 && x <= rect.x + rect.w + 1)) return false
  const pr = ctx.pane.rect
  out.x = x
  out.y0 = rect.y
  out.y1 = rect.y + rect.h
  out.u = u
  out.time = anchorTime(a, ctx)
  out.approx = !!a.approx
  // The handle sits at the anchor's price, kept inside the drawing's own pane.
  out.hy = clamp(a.y, pr.y + HANDLE_INSET, pr.y + pr.h - HANDLE_INSET)
  out.infinite = true
  setBBox(out, x, out.y0, x, out.y1)
  out.vis = true
  return true
}

function linePath(c, g) {
  c.moveTo(g.x, g.y0)
  c.lineTo(g.x, g.y1)
}

function draw(c, g, d, look, ctx) {
  if (!g.vis) return
  shakeBody(c, look)
  const th = ctx.theme
  const alpha = alphaOf(look)
  const w = widthOf(d, look)
  const hov = unit(look.hover, 0)
  if (hov > 0 && !look.exporting) halo(c, linePath, th.halo, w + 6, 0.12 * hov * alpha, g)
  c.globalAlpha = alpha
  setStroke(c, th.line, d.style.color, w, dashOf(d.style, look))
  strokeSeg(c, g.x, g.y0, g.x, g.y1)

  const lb = boxOf(g, 'lb')
  lb.w = 0
  const text = d.options.text
  if (!text) return
  // Rotated to run down the line from the top of the pane, on its right.
  const font = fontOf(g, th.font, d.style.fontSize)
  const tw = ctx.textWidth(font, text)
  const h = fontPx(font)
  const top = g.y0 + 8
  const off = 3 + w / 2
  lb.x = g.x + off
  lb.y = top
  lb.w = h
  lb.h = tw
  c.save()
  c.translate(g.x, top)
  c.rotate(Math.PI / 2)
  c.font = font
  c.textAlign = 'left'
  c.textBaseline = 'bottom'
  setFill(c, th.line, d.style.color)
  if (d.style.textColor) c.fillStyle = d.style.textColor
  c.fillText(text, 0, -off)
  c.restore()
}

function hit(g, x, y, tol) {
  if (!g.vis) return null
  if (g.lb && inBox(g.lb, x, y, 2)) return LABEL
  return Math.abs(x - g.x) <= tol && y >= g.y0 && y <= g.y1 ? BODY : null
}

function handles(g, d, out) {
  if (!g.vis) return 0
  return putHandle(out, 0, g.x, g.hy, 0, 'x', 'ew-resize')
}

/** The handle moves the time only; the stored price (where the handle sits) is kept. */
function dragHandle(d0, index, s) {
  if (!s || !s.point || index !== 0) return d0.points.slice()
  return [withTimeOf(d0.points[0], s.point)]
}

/**
 * A time tag on the time axis, `≈`-prefixed for a point stored as a bar
 * count outside the data (its clock time is an extrapolation). Cached on the
 * geometry against its inputs, so an idle chart formats nothing.
 */
function axisTags(g, d, ctx, out) {
  if (!g.vis || !d.options.timeLabel) return 0
  const k = g.tagKey || (g.tagKey = { time: NaN, approx: false, fmt: null, text: '' })
  if (k.time !== g.time || k.approx !== g.approx || k.fmt !== ctx.formatTime) {
    k.text = (g.approx ? '≈' : '') + ctx.formatTime(g.time)
    k.time = g.time; k.approx = g.approx; k.fmt = ctx.formatTime
  }
  return putTag(out, 0, 'time', g.x, k.text, d.style.color || ctx.theme.line)
}

function bleed(d, g) {
  const lb = g.lb
  return Math.max(12, lb && lb.w > 0 ? lb.w + 8 : 0)
}

export const verticalLine = Object.freeze({
  type: 'verticalLine',
  label: 'Vertical line',
  anchors: 1,
  creation: 'single',
  snapPrefs: Object.freeze(['close', 'high', 'low', 'open']),
  prefBoost: 1,
  defaultStyle,
  defaultOptions,
  normalizeOptions,
  project,
  draw,
  hit,
  handles,
  dragHandle,
  axisTags,
  bleed,
})
