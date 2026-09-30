import { DASH } from '../../chart/index.js'

/**
 * Paint helpers shared by the nine tools (and by the scene's chrome).
 *
 * Two rules shape everything here, both from the way a canvas fails quietly:
 *
 * - Absolute state only. Nothing reads context state back (no
 *   `c.globalAlpha * a`, no "restore the previous dash"): every helper assigns
 *   the values it needs. The scene wraps each drawing in save/restore too, but
 *   a helper that relied on inherited state would paint the previous
 *   drawing's dash the day that wrapper moved.
 * - Fallback colour first. Canvas silently IGNORES an invalid colour string
 *   and keeps the previous value, which would be the previous drawing's
 *   colour. So the theme colour is always assigned immediately before the
 *   drawing's own: a typo in a stored row paints in the theme colour, not in
 *   whatever was drawn last.
 */

/** Module constant, never mutated: setLineDash copies its argument. */
const NO_DASH = []
const TAU = Math.PI * 2

/**
 * Stroke state for a line: the theme `fallback`, then the drawing's own
 * `color` (which may be invalid, see above), width, and ALWAYS a dash, so a
 * solid line never inherits the dashed line drawn before it.
 */
export function setStroke(c, fallback, color, width, dash) {
  c.strokeStyle = fallback
  if (color) c.strokeStyle = color
  c.lineWidth = width
  c.setLineDash(dash || NO_DASH)
  // Round caps make a solid line's ends and a hover halo look finished; a
  // dashed or dotted line keeps butt caps, or the dots would merge into a
  // solid line at 1.5px.
  const cap = dash && dash.length ? 'butt' : 'round'
  c.lineCap = cap
  c.lineJoin = 'round'
}

/** Fill colour with the same fallback-first rule as setStroke. */
export function setFill(c, fallback, color) {
  c.fillStyle = fallback
  if (color) c.fillStyle = color
}

/** The dash for a style, and for a creation preview (a solid line previews dashed). */
export function dashOf(style, look) {
  const dash = DASH[style && style.lineStyle] || DASH.solid
  return look && look.preview && !dash.length ? DASH.dashed : dash
}

/** A 0..1 look value; undefined, NaN and negatives read as `def`. */
export function unit(v, def) {
  return v >= 0 ? (v > 1 ? 1 : v) : def
}

/** The drawing's opacity: Look.alpha (ghosts, appear fades), 1 when absent. */
export function alphaOf(look) {
  return look ? unit(look.alpha, 1) : 1
}

/**
 * A drawing's main stroke width: the style width, +0.75px while hovered,
 * plus the commit tween's extra width (Look.widthAdd, 1 -> 0 just after a
 * create), times Look.widthScale (a ghost thins out as it fades).
 */
export function widthOf(d, look) {
  const w = d.style && d.style.lineWidth > 0 ? d.style.lineWidth : 1
  if (!look) return w
  const add = look.widthAdd > 0 ? look.widthAdd : 0
  const scale = look.widthScale > 0 ? look.widthScale : 1
  return (w + 0.75 * unit(look.hover, 0) + add) * scale
}

/**
 * The locked-refusal shake (§6.3): the whole body moves by Look.shake px.
 * A translate inside the scene's per-drawing save/restore, so it never
 * leaks; the scene offsets the handles by the same amount.
 */
export function shakeBody(c, look) {
  const s = look && look.shake
  if (s && isFinite(s)) c.translate(s, 0)
}

/** Half-pixel alignment for axis-aligned 1px lines (§4.2). */
export function crisp(v) {
  return Math.round(v) + 0.5
}

/**
 * The rect a geometry is clipped to (§4.2): the drawing's own pane, or the
 * whole plot across panes and the gaps between them (`'plot'`). Written into
 * `out` so a geometry keeps one rect object for its lifetime.
 */
export function clipRectOf(ctx, clip, out) {
  const r = ctx.pane.rect
  if (clip === 'plot') {
    const bottom = ctx.host && ctx.host.plotBottom > 0 ? ctx.host.plotBottom : r.y + r.h
    out.x = 0
    out.y = 0
    out.w = r.w
    out.h = bottom
  } else {
    out.x = r.x
    out.y = r.y
    out.w = r.w
    out.h = r.h
  }
  return out
}

/** One straight segment as its own path. */
export function strokeSeg(c, ax, ay, bx, by) {
  c.beginPath()
  c.moveTo(ax, ay)
  c.lineTo(bx, by)
  c.stroke()
}

/**
 * A rounded rectangle PATH (beginPath … closePath; the caller fills or
 * strokes). ctx.roundRect is not in every engine this library targets, and
 * Path2D is not in Node, so this is the one implementation.
 */
export function roundRect(c, x, y, w, h, r) {
  if (w < 0) { x += w; w = -w }
  if (h < 0) { y += h; h = -h }
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  c.beginPath()
  c.moveTo(x + rr, y)
  c.lineTo(x + w - rr, y)
  c.quadraticCurveTo(x + w, y, x + w, y + rr)
  c.lineTo(x + w, y + h - rr)
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  c.lineTo(x + rr, y + h)
  c.quadraticCurveTo(x, y + h, x, y + h - rr)
  c.lineTo(x, y + rr)
  c.quadraticCurveTo(x, y, x + rr, y)
  c.closePath()
}

/* --------------------------------------------------------------- text -- */

let lastFont = ''
let lastPx = 11
/** The pixel size in a CSS font string ('11px ui-sans-serif' -> 11); 11 when absent. */
export function fontPx(font) {
  if (font === lastFont) return lastPx
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '')
  lastFont = font
  lastPx = m ? +m[1] : 11
  return lastPx
}

/**
 * `font` at `px` pixels, keeping its family (and weight): the text tool's
 * fontSize must not throw away the host's typeface.
 */
export function fontSized(font, px) {
  if (typeof font === 'string' && /\d+(?:\.\d+)?px/.test(font)) return font.replace(/\d+(?:\.\d+)?px/, px + 'px')
  return px + 'px ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif'
}

/**
 * fontSized, cached on a geometry: the string is rebuilt only when the
 * theme font or the size changes, so a labelled drawing allocates no font
 * string per frame.
 */
export function fontOf(g, font, px) {
  const size = px > 0 ? px : 12
  if (g.fontBase !== font || g.fontSize !== size || !g.fontStr) {
    g.fontBase = font
    g.fontSize = size
    g.fontStr = fontSized(font, size)
  }
  return g.fontStr
}

export const BOX_PAD_X = 8
export const BOX_PAD_Y = 2
/** Line pitch inside a label box: the font size plus 4px of leading. */
export function linePitch(font) {
  return fontPx(font) + 4
}

/**
 * Measure `n` lines as a label box into `out` ({ w, h }; x/y untouched).
 * Measured with the canvas itself so the box always fits what fillText
 * draws, whatever the font actually resolved to.
 */
export function measureBox(c, lines, n, font, out) {
  c.font = font
  let w = 0
  for (let i = 0; i < n; i++) {
    const lw = c.measureText(lines[i]).width
    if (lw > w) w = lw
  }
  out.w = Math.ceil(w) + BOX_PAD_X * 2
  out.h = n * linePitch(font) + BOX_PAD_Y * 2
  return out
}

/**
 * Draw a measured, placed box ({ x, y, w, h }) with `n` lines of text.
 * `firstFg`, when given, colours the first line (a signed change in up/down)
 * while the rest stay in `fg`. `align` is the text alignment inside the box.
 */
export function drawBox(c, box, lines, n, bg, fg, font, align, firstFg) {
  const x = Math.round(box.x)
  const y = Math.round(box.y)
  if (bg) {
    c.fillStyle = bg
    roundRect(c, x, y, box.w, box.h, n > 1 ? 5 : 4)
    c.fill()
  }
  c.font = font
  c.textBaseline = 'middle'
  c.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left'
  const tx = align === 'center' ? x + box.w / 2 : align === 'right' ? x + box.w - BOX_PAD_X : x + BOX_PAD_X
  const pitch = linePitch(font)
  for (let i = 0; i < n; i++) {
    c.fillStyle = i === 0 && firstFg ? firstFg : fg
    c.fillText(lines[i], tx, y + BOX_PAD_Y + pitch * i + pitch / 2)
  }
}

/**
 * A one-line rounded label. `x` is its left edge, centre or right edge per
 * `align`; `y` its vertical centre. Returns the width drawn.
 */
export function pill(c, x, y, text, bg, fg, font, align) {
  c.font = font
  const w = Math.ceil(c.measureText(text).width) + BOX_PAD_X * 2
  const h = linePitch(font) + BOX_PAD_Y * 2
  const left = Math.round(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x)
  const top = Math.round(y - h / 2)
  c.fillStyle = bg
  roundRect(c, left, top, w, h, 4)
  c.fill()
  c.fillStyle = fg
  c.textAlign = 'left'
  c.textBaseline = 'middle'
  c.fillText(text, left + BOX_PAD_X, top + h / 2)
  return w
}

/**
 * Place a label box of known size near a point (§4.2 stats): below and to
 * the right, flipping to the other side at the pane's right or bottom edge,
 * then clamped inside the pane. On touch it floats 64px ABOVE the point, so
 * the finger that is dragging it never covers the number it is reading.
 * `box.side` reports the side chosen (1 right, -1 left), for motion to ease.
 */
export function placeNear(box, ax, ay, rect, touch, flip) {
  const gap = 14
  const edge = 4
  box.side = 1
  if (touch) {
    box.x = ax - box.w / 2
    box.y = ay - 64 - box.h
  } else {
    box.x = ax + gap
    box.y = ay + gap
    if (box.x + box.w > rect.x + rect.w - edge) { box.x = ax - gap - box.w; box.side = -1 }
    if (box.y + box.h > rect.y + rect.h - edge) box.y = ay - gap - box.h
    // With an eased side from motion (Look.flip, -1..1), slide between the
    // two sides instead of teleporting when the label meets the edge.
    if (flip >= -1 && flip <= 1) {
      const right = ax + gap
      const left = ax - gap - box.w
      box.x = left + (right - left) * (flip + 1) / 2
    }
  }
  const maxX = rect.x + rect.w - edge - box.w
  const maxY = rect.y + rect.h - edge - box.h
  box.x = Math.max(rect.x + edge, Math.min(maxX, box.x))
  box.y = Math.max(rect.y + edge, Math.min(maxY, box.y))
  return box
}

/** True when (x, y) is inside a box, grown by `pad` on every side. */
export function inBox(box, x, y, pad) {
  return box.w > 0 && x >= box.x - pad && x <= box.x + box.w + pad && y >= box.y - pad && y <= box.y + box.h + pad
}

/* ------------------------------------------------------------- chrome -- */

/**
 * A drag handle: a filled circle with a 1.5px ring. Pressed, it fills with
 * the ring colour (the accent), so the one being dragged reads at a glance.
 * The caller passes the final radius (the ×1.35 press scale is motion's).
 */
export function handle(c, x, y, r, fill, stroke, pressed) {
  c.setLineDash(NO_DASH)
  c.beginPath()
  c.arc(x, y, r, 0, TAU)
  c.fillStyle = pressed ? stroke : fill
  c.fill()
  c.lineWidth = 1.5
  c.strokeStyle = stroke
  c.stroke()
}

/**
 * The touch move handle's 4-way glyph: four small arrowheads around a dot,
 * inside a handle of radius `r`. On touch a fill never claims a press (D24),
 * so this is how a finger moves a whole box.
 */
export function moveGlyph(c, x, y, r, color) {
  const a = r * 0.62
  const s = Math.max(1.5, r * 0.26)
  c.fillStyle = color
  c.beginPath()
  c.moveTo(x, y - a - s); c.lineTo(x - s, y - a + s * 0.4); c.lineTo(x + s, y - a + s * 0.4); c.closePath()
  c.moveTo(x, y + a + s); c.lineTo(x - s, y + a - s * 0.4); c.lineTo(x + s, y + a - s * 0.4); c.closePath()
  c.moveTo(x - a - s, y); c.lineTo(x - a + s * 0.4, y - s); c.lineTo(x - a + s * 0.4, y + s); c.closePath()
  c.moveTo(x + a + s, y); c.lineTo(x + a - s * 0.4, y - s); c.lineTo(x + a - s * 0.4, y + s); c.closePath()
  c.fill()
  c.beginPath()
  c.arc(x, y, Math.max(1, r * 0.14), 0, TAU)
  c.fill()
}

/**
 * A filled arrowhead with its tip at (x1, y1), pointing along (x0,y0)->(x1,y1).
 * `len` is the head's length and `halfAngle` its half-angle in radians.
 * Returns false (and draws nothing) for a zero-length direction.
 */
export function arrowHead(c, x0, y0, x1, y1, len, halfAngle) {
  const dx = x1 - x0
  const dy = y1 - y0
  if (!(dx * dx + dy * dy > 0)) return false
  const ang = Math.atan2(dy, dx)
  c.beginPath()
  c.moveTo(x1, y1)
  c.lineTo(x1 - len * Math.cos(ang - halfAngle), y1 - len * Math.sin(ang - halfAngle))
  c.lineTo(x1 - len * Math.cos(ang + halfAngle), y1 - len * Math.sin(ang + halfAngle))
  c.closePath()
  c.fill()
  return true
}

/**
 * A soft glow under a path: the hover and selection highlight. `pathFn(c, arg)`
 * adds the path (after this helper's beginPath); passing `arg` instead of
 * closing over it keeps a hovered drawing's frame allocation-free.
 */
export function halo(c, pathFn, color, width, alpha, arg) {
  if (!(alpha > 0)) return
  c.globalAlpha = alpha > 1 ? 1 : alpha
  c.strokeStyle = color
  c.lineWidth = width
  c.setLineDash(NO_DASH)
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.beginPath()
  pathFn(c, arg)
  c.stroke()
}

/** A small padlock centred on (x, y), for locked drawings. */
export function lockBadge(c, x, y, color) {
  c.setLineDash(NO_DASH)
  c.fillStyle = color
  c.strokeStyle = color
  c.lineWidth = 1.5
  c.lineCap = 'butt'
  c.fillRect(Math.round(x - 4), Math.round(y - 1), 8, 6)
  c.beginPath()
  c.arc(Math.round(x), Math.round(y - 1), 2.6, Math.PI, 0)
  c.stroke()
}

/**
 * `color` with alpha `a`, as rgba(). For hosts and DOM chrome: canvas fills
 * in this library use globalAlpha instead (§4.2), because alpha arithmetic on
 * colour strings silently fails on named or hsl() colours. Returns the colour
 * unchanged when it cannot be parsed.
 */
export function withAlpha(color, a) {
  if (typeof color !== 'string') return color
  const s = color.trim()
  let r
  let g
  let b
  if (s[0] === '#') {
    const h = s.slice(1)
    if (!/^[0-9a-fA-F]+$/.test(h)) return color
    if (h.length === 3 || h.length === 4) {
      r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16)
    } else if (h.length === 6 || h.length === 8) {
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16)
    } else return color
  } else {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(s)
    if (!m) return color
    r = +m[1]; g = +m[2]; b = +m[3]
  }
  const al = Math.max(0, Math.min(1, +a || 0))
  return `rgba(${r},${g},${b},${al})`
}

/* ------------------------------------------------------------ geometry -- */

/** The reused { x0, y0, x1, y1 } bbox of a geometry, created on first use. */
export function bboxOf(out) {
  return out.bbox || (out.bbox = { x0: 0, y0: 0, x1: 0, y1: 0 })
}

export function setBBox(out, x0, y0, x1, y1) {
  const b = bboxOf(out)
  b.x0 = Math.min(x0, x1)
  b.x1 = Math.max(x0, x1)
  b.y0 = Math.min(y0, y1)
  b.y1 = Math.max(y0, y1)
  return b
}

/**
 * Write one HandleSpec into the caller's scratch array, reusing the object
 * already in that slot (handles() must not allocate per frame).
 */
export function putHandle(out, i, x, y, index, axis, cursor, move) {
  let h = out[i]
  if (!h) h = out[i] = { x: 0, y: 0, index: 0, axis: 'xy', cursor: '', move: undefined }
  h.x = x
  h.y = y
  h.index = index
  h.axis = axis
  h.cursor = cursor
  h.move = move ? true : undefined
  return i + 1
}

/** Write one AxisTag into the caller's scratch array, reusing the slot's object. */
export function putTag(out, i, axis, pos, text, color) {
  let t = out[i]
  if (!t) t = out[i] = { axis: 'price', pos: 0, text: '', color: '' }
  t.axis = axis
  t.pos = pos
  t.text = text
  t.color = color
  return i + 1
}

/**
 * Write one SnapTarget into the caller's scratch array, reusing the slot's
 * object. `point` is the exact stored point when the target IS a drawing's
 * point, else null (a derived level).
 */
export function putTarget(out, i, kind, x, y, u, price, point, paneId, id, tag) {
  let t = out[i]
  if (!t) t = out[i] = { kind: 'level', x: 0, y: 0, u: 0, price: 0, point: null, paneId: '', id: '', tag: null }
  t.kind = kind
  t.x = x
  t.y = y
  t.u = u
  t.price = price
  t.point = point
  t.paneId = paneId
  t.id = id
  t.tag = tag
  return i + 1
}

/**
 * A point that keeps `pt`'s price but takes `src`'s time, including a
 * bar-count offset and its timeframe (a point past the data must stay one).
 */
export function withTimeOf(pt, src) {
  const out = { time: src.time, price: pt.price }
  if (src.offset) {
    out.offset = src.offset
    if (src.tf > 0) out.tf = src.tf
  }
  return out
}

/** A point that keeps `pt`'s time (and offset/tf) but takes `price`. */
export function withPrice(pt, price) {
  const out = { time: pt.time, price }
  if (pt.offset) {
    out.offset = pt.offset
    if (pt.tf > 0) out.tf = pt.tf
  }
  return out
}

/**
 * Copy a ScreenAnchor's fields into a geometry-owned object (created once),
 * so draw() and the stats labels can read anchors project() saw without the
 * scene having to keep its anchor array alive.
 */
export function keepAnchor(prev, a) {
  const o = prev || { x: 0, y: 0, u: 0, time: 0, price: 0, approx: false }
  o.x = a.x
  o.y = a.y
  o.u = a.u
  o.time = a.time
  o.price = a.price
  o.approx = !!a.approx
  return o
}

/** True when every anchor projected to finite screen coordinates. */
export function finiteAnchors(a, n) {
  if (!a || a.length < n) return false
  for (let i = 0; i < n; i++) {
    if (!a[i] || !isFinite(a[i].x) || !isFinite(a[i].y)) return false
  }
  return true
}

/**
 * How visible a drawing's stats label is (§4.2 stats option): 'never' 0,
 * 'always' 1, 'active' while creating, dragging or selected, following the
 * eased Look.stats (and the selection, so a drawing selected before motion
 * has seeded Look.stats still shows its numbers). Never in an export.
 */
export function statsAlpha(mode, look) {
  if (!look || look.exporting || mode === 'never') return 0
  const a = alphaOf(look)
  if (mode === 'always') return a
  const on = Math.max(unit(look.stats, 0), unit(look.select, 0), look.preview ? 1 : 0)
  return on * a
}

/**
 * Measure, place near (ax, ay) and draw a stats box in the label colours.
 * `firstFg` colours the first line (the signed change) up or down.
 */
export function statsBox(c, lines, ax, ay, rect, theme, touch, box, firstFg, flip) {
  const n = lines.length
  if (!n) { box.w = 0; return box }
  measureBox(c, lines, n, theme.font, box)
  placeNear(box, ax, ay, rect, touch, flip)
  drawBox(c, box, lines, n, theme.labelBg, theme.labelText, theme.font, 'left', firstFg)
  return box
}

/** A reusable { x, y, w, h, side } box, created on first use; w = 0 means "not drawn". */
export function boxOf(g, key) {
  return g[key] || (g[key] = { x: 0, y: 0, w: 0, h: 0, side: 1 })
}

/**
 * The line's price at bar index `u`, extension-aware (null off the drawn
 * extent). Interpolated in the pane's forward space, because that is the
 * space in which the drawn line is straight: in log mode a straight line on
 * screen is geometric in price.
 */
export function linePriceAt(p0, p1, u0, u1, extStart, extEnd, u, ctx) {
  if (!isFinite(u0) || !isFinite(u1) || !isFinite(u)) return null
  if (u0 === u1) return null
  const t = (u - u0) / (u1 - u0)
  if (t < 0 && !extStart) return null
  if (t > 1 && !extEnd) return null
  const f0 = ctx.fwd(p0)
  const f1 = ctx.fwd(p1)
  const v = ctx.inv(f0 + (f1 - f0) * t)
  return isFinite(v) ? v : null
}

/**
 * Is (x, y) within `pad` px of rect `r`? Arrowheads, handles and labels at a
 * far-off anchor are skipped rather than drawn at y = 1e290.
 */
export function nearRect(r, x, y, pad) {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad
}

/** Clamp v into [lo, hi]. */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}
