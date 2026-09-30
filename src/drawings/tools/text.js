import { DASH } from '../../chart/index.js'
import {
  setStroke, setFill, alphaOf, unit, clipRectOf, roundRect, finiteAnchors, setBBox, fontOf, boxOf, inBox,
  shakeBody,
} from '../render/paint.js'
import { pick, flag, textOpt, rawObject } from '../render/labels.js'

/**
 * Text: a note pinned to a time and price, its anchor the box's top-left.
 *
 * Set in the chart's own typeface (theme.font's family at the drawing's
 * fontSize), optionally on a label pill. Multi-line text keeps its line
 * breaks. While the text is being edited its canvas copy is hidden, so it
 * never shows twice under the <textarea>.
 */

const ALIGN = new Set(['left', 'center', 'right'])

const BODY = Object.freeze({ part: 'body' })

/** Lines beyond this are not laid out: a pasted novel must not cost a frame. */
const MAX_LINES = 100

const defaultStyle = Object.freeze({
  color: null, lineWidth: 1, lineStyle: 'solid', fill: null, fillOpacity: 1, textColor: null, fontSize: 12,
})
const defaultOptions = Object.freeze({ text: 'Text', background: false, align: 'left' })

function normalizeOptions(raw) {
  raw = rawObject(raw)
  return {
    text: textOpt(raw.text, 'Text'),
    background: flag(raw.background, false),
    align: pick(raw.align, ALIGN, 'left'),
  }
}

/**
 * Split and measure, cached per (text, font) on the geometry (§6.5): the
 * widths come from ctx.textWidth, itself cached per (font, text), and
 * setTheme({ font }) changes the font string and so re-measures.
 */
function layoutOf(g, text, font, ctx) {
  let k = g.lay
  if (!k) k = g.lay = { text: null, font: '', lines: [], widths: [], maxW: 0 }
  if (k.text === text && k.font === font) return k
  const lines = String(text).split('\n')
  if (lines.length > MAX_LINES) lines.length = MAX_LINES
  let maxW = 0
  k.widths.length = 0
  for (let i = 0; i < lines.length; i++) {
    const w = ctx.textWidth(font, lines[i])
    k.widths.push(w)
    if (w > maxW) maxW = w
  }
  k.lines = lines
  k.maxW = maxW
  k.text = text
  k.font = font
  return k
}

function project(d, a, ctx, out) {
  out.clip = 'pane'
  out.vis = false
  if (!finiteAnchors(a, 1)) return false
  const a0 = a[0]
  const st = d.style
  const px = st.fontSize > 0 ? st.fontSize : 12
  const font = fontOf(out, ctx.theme.font, px)
  const lay = layoutOf(out, d.options.text, font, ctx)
  const pad = d.options.background ? 6 : 2
  const pitch = Math.round(px * 1.3)
  const box = boxOf(out, 'box')
  box.x = Math.round(a0.x)
  box.y = Math.round(a0.y)
  box.w = Math.ceil(lay.maxW) + pad * 2
  box.h = lay.lines.length * pitch + pad * 2
  out.font = font
  out.pad = pad
  out.pitch = pitch
  out.infinite = false
  setBBox(out, box.x, box.y, box.x + box.w, box.y + box.h)
  const rect = clipRectOf(ctx, 'pane', out.rect || (out.rect = { x: 0, y: 0, w: 0, h: 0 }))
  out.vis = box.x < rect.x + rect.w && box.x + box.w > rect.x && box.y < rect.y + rect.h && box.y + box.h > rect.y
  return out.vis
}

function draw(c, g, d, look, ctx) {
  if (!g.vis || look.editing) return
  shakeBody(c, look)
  const th = ctx.theme
  const st = d.style
  const o = d.options
  const box = g.box
  const alpha = alphaOf(look)
  if (o.background) {
    c.globalAlpha = alpha * (st.fillOpacity > 0 ? st.fillOpacity : 1)
    setFill(c, th.labelBg, st.fill)
    roundRect(c, box.x, box.y, box.w, box.h, 4)
    c.fill()
  }
  const lay = g.lay
  c.globalAlpha = alpha
  c.font = g.font
  c.textBaseline = 'middle'
  c.textAlign = o.align
  setFill(c, o.background ? th.labelText : th.textColor, st.color)
  if (st.textColor) c.fillStyle = st.textColor
  const x = o.align === 'center' ? box.x + box.w / 2 : o.align === 'right' ? box.x + box.w - g.pad : box.x + g.pad
  for (let i = 0; i < lay.lines.length; i++) {
    c.fillText(lay.lines[i], x, box.y + g.pad + g.pitch * i + g.pitch / 2)
  }
  // A text has no handles, so selection (and hover) is shown as a dashed
  // accent frame around it: without one a selected note looks unselected.
  const sel = Math.max(unit(look.select, 0), 0.6 * unit(look.hover, 0))
  if (sel > 0 && !look.exporting) {
    c.globalAlpha = alpha * sel
    setStroke(c, th.accent, null, 1, DASH.dashed)
    roundRect(c, Math.round(box.x) - 2.5, Math.round(box.y) - 2.5, box.w + 5, box.h + 5, 4)
    c.stroke()
  }
}

function hit(g, x, y, tol) {
  if (!g.vis || !g.box) return null
  return inBox(g.box, x, y, Math.min(tol, 4)) ? BODY : null
}

/** No handles: a text moves by its body and is resized by its font size. */
function handles() {
  return 0
}

function dragHandle(d0) {
  return d0.points.slice()
}

function bleed(d, g) {
  return Math.max(12, g.box ? g.box.w + 12 : 200)
}

export const text = Object.freeze({
  type: 'text',
  label: 'Text',
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
  bleed,
})
