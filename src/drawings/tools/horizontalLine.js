import {
  setStroke, setFill, dashOf, alphaOf, unit, widthOf, clipRectOf, strokeSeg, halo, crisp, clamp,
  putHandle, putTag, putTarget, finiteAnchors, setBBox, fontOf, fontPx, boxOf, inBox, withPrice,
  shakeBody,
} from '../render/paint.js'
import { pick, flag, textOpt, rawObject } from '../render/labels.js'

/**
 * Horizontal line: one price, across the whole plot (or from the anchor to
 * the right edge, the `horizontalRay` preset).
 *
 * The line owns a price-axis tag in its own colour, like a core price line,
 * and that tag is part of the drawing: it can be grabbed to drag the line by
 * its label, as in TradingView (§4.3). The anchor's time is still stored:
 * it is where a ray starts, where the handle sits and where the line grows
 * from when it is placed.
 */

const EXTEND = new Set(['both', 'right'])
const ALIGN = new Set(['left', 'center', 'right'])

const BODY = Object.freeze({ part: 'body' })
const LABEL = Object.freeze({ part: 'label' })
const TAG = Object.freeze({ part: 'tag' })

/** Half the height of the axis tag the scene paints (the core's price tags are 18px). */
const TAG_HALF = 10
/** The handle stays this far inside the plot, so a line anchored off-screen is still grabbable. */
const HANDLE_INSET = 24

const defaultStyle = Object.freeze({
  color: null, lineWidth: 1, lineStyle: 'solid', fill: null, fillOpacity: 0, textColor: null, fontSize: 12,
})
const defaultOptions = Object.freeze({ extend: 'both', axisLabel: true, text: '', textAlign: 'right' })

function normalizeOptions(raw) {
  raw = rawObject(raw)
  return {
    extend: pick(raw.extend, EXTEND, 'both'),
    axisLabel: flag(raw.axisLabel, true),
    text: textOpt(raw.text, ''),
    textAlign: pick(raw.textAlign, ALIGN, 'right'),
  }
}

function project(d, a, ctx, out) {
  out.clip = 'pane'
  out.vis = false
  if (!finiteAnchors(a, 1)) return false
  const a0 = a[0]
  const rect = clipRectOf(ctx, 'pane', out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0 }))
  const y = crisp(a0.y)
  // Scrolled off its own pane: nothing to draw, and no tag either (§4.2), so
  // a line far above the price range never prints into the RSI gutter.
  if (!(y >= rect.y - 1 && y <= rect.y + rect.h + 1)) return false
  const ray = d.options.extend === 'right'
  const x0 = ray ? Math.max(rect.x, a0.x) : rect.x
  const x1 = rect.x + rect.w
  if (!(x0 < x1)) return false
  out.y = y
  out.x0 = x0
  out.x1 = x1
  out.ax = clamp(a0.x, x0, x1)
  out.u = a0.u
  out.price = a0.price
  out.ray = ray
  out.plotW = rect.x + rect.w
  out.tagOn = d.options.axisLabel !== false
  out.hx = clamp(a0.x, rect.x + HANDLE_INSET, rect.x + rect.w - HANDLE_INSET)
  out.infinite = true
  setBBox(out, x0, y, x1, y)
  out.vis = true
  return true
}

function linePath(c, g) {
  c.moveTo(g.dx0, g.y)
  c.lineTo(g.dx1, g.y)
}

function draw(c, g, d, look, ctx) {
  if (!g.vis) return
  shakeBody(c, look)
  const th = ctx.theme
  const alpha = alphaOf(look)
  const w = widthOf(d, look)
  // A new line grows outward from the click (Look.reveal 0 -> 1), so the
  // reader sees where it came from; at rest reveal is 1 and this is a no-op.
  // Motion supplies the click's u (Look.revealU, data space) when it differs
  // from the anchor; the origin is projected now, so it stays glued mid-zoom.
  const r = unit(look.reveal, 1)
  let ox = g.ax
  if (r < 1 && isFinite(look.revealU) && ctx.host && ctx.host.ts) ox = clamp(ctx.host.ts.x(look.revealU), g.x0, g.x1)
  g.dx0 = ox - (ox - g.x0) * r
  g.dx1 = ox + (g.x1 - ox) * r
  const hov = unit(look.hover, 0)
  if (hov > 0 && !look.exporting) halo(c, linePath, th.halo, w + 6, 0.12 * hov * alpha, g)
  c.globalAlpha = alpha
  setStroke(c, th.line, d.style.color, w, dashOf(d.style, look))
  strokeSeg(c, g.dx0, g.y, g.dx1, g.y)

  const lb = boxOf(g, 'lb')
  lb.w = 0
  const text = d.options.text
  if (!text) return
  const font = fontOf(g, th.font, d.style.fontSize)
  const tw = ctx.textWidth(font, text)
  const align = d.options.textAlign
  // Sits just above the line; right-aligned text stops short of the axis tag.
  const tx = align === 'left' ? g.x0 + 8 : align === 'center' ? (g.x0 + g.x1) / 2 - tw / 2 : g.x1 - 8 - tw
  const h = fontPx(font)
  lb.x = tx
  lb.y = g.y - 3 - w / 2 - h
  lb.w = tw
  lb.h = h
  c.font = font
  c.textAlign = 'left'
  c.textBaseline = 'bottom'
  setFill(c, th.line, d.style.color)
  if (d.style.textColor) c.fillStyle = d.style.textColor
  c.fillText(text, tx, g.y - 3 - w / 2)
}

function hit(g, x, y, tol) {
  if (!g.vis) return null
  // The axis tag lives in the price-axis region, right of the plot: a press
  // there with this line under it drags the line by its label.
  if (x > g.plotW) return g.tagOn && Math.abs(y - g.y) <= TAG_HALF ? TAG : null
  if (g.lb && inBox(g.lb, x, y, 2)) return LABEL
  return x >= g.x0 - tol && x <= g.x1 + tol && Math.abs(y - g.y) <= tol ? BODY : null
}

function handles(g, d, out) {
  if (!g.vis) return 0
  // A full-width line's time is incidental, so its handle only moves the
  // price (axis y); a ray's start is part of its meaning, so it moves both.
  return g.ray
    ? putHandle(out, 0, g.hx, g.y, 0, 'xy', 'grab')
    : putHandle(out, 0, g.hx, g.y, 0, 'y', 'ns-resize')
}

function dragHandle(d0, index, s) {
  if (!s || !s.point || index !== 0) return d0.points.slice()
  if (d0.options.extend === 'right') return [s.point]
  return [withPrice(d0.points[0], s.point.price)]
}

/**
 * The price tag in the line's colour. Its text is cached on the geometry
 * against everything it depends on (price, formatter, visible range), so a
 * chart full of horizontal lines formats nothing on a frame where nothing
 * moved.
 */
function axisTags(g, d, ctx, out) {
  if (!g.vis || !g.tagOn) return 0
  const ps = ctx.pane.ps
  const k = g.tagKey || (g.tagKey = { price: NaN, fmt: null, lo: NaN, hi: NaN, text: '' })
  if (k.price !== g.price || k.fmt !== ctx.formatPrice || k.lo !== ps.lo || k.hi !== ps.hi) {
    k.text = ctx.formatPrice(g.price)
    k.price = g.price; k.fmt = ctx.formatPrice; k.lo = ps.lo; k.hi = ps.hi
  }
  return putTag(out, 0, 'price', g.y, k.text, d.style.color || ctx.theme.line)
}

/** The line is a level rail other drawings can snap to (§5.5 step 4). */
function snapTargets(d, g, ctx, out) {
  if (!g.vis) return 0
  return putTarget(out, 0, 'level', g.hx, g.y, g.u, g.price, null, ctx.pane.id, d.id, null)
}

function priceAt(d, u, ctx) {
  const p = d.points[0].price
  if (d.options.extend !== 'right') return p
  const u0 = ctx.indexOf(d.points[0])
  return isFinite(u0) && u >= u0 ? p : null
}

export const horizontalLine = Object.freeze({
  type: 'horizontalLine',
  label: 'Horizontal line',
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
  snapTargets,
  priceAt,
  bleed: () => 12,
})
