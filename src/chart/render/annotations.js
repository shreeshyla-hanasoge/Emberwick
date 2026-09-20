import { decimalsFor, priceTicks, toNumber } from '../core/formatters.js'
import { DASH } from './style.js'
import { nearestIndex } from '../overlays/annotations.js'

/**
 * Annotation renderers: zones (behind the candles), price lines and markers
 * (in front of them). Each is a pure draw call over prepared state.
 */

const DOWN_SHAPES = new Set(['arrowDown', 'triangleDown'])

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, h / 2, w / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h)
  ctx.lineTo(x + rr, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr)
  ctx.lineTo(x, y + rr)
  ctx.quadraticCurveTo(x, y, x + rr, y)
  ctx.closePath()
}

/* ------------------------------------------------------------------ zones -- */
/** Shaded regions. Drawn on the base layer, over the grid and under candles. */
export function drawZones(ctx, s) {
  const { zones, theme, ts, ps, plot, bars } = s
  if (!zones || !zones.length) return

  ctx.save()
  ctx.font = theme.font
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  for (const z of zones) {
    let x
    let y
    let w
    let h

    if (isFinite(z.from) && isFinite(z.to)) {
      // price band: spans the full width
      y = ps.y(Math.max(z.from, z.to))
      h = Math.max(1, ps.y(Math.min(z.from, z.to)) - y)
      x = 0
      w = plot.w
    } else if (isFinite(z.fromTime) && isFinite(z.toTime) && bars.length) {
      // time band: spans the full height
      const a = ts.x(nearestIndex(bars, Math.min(z.fromTime, z.toTime)))
      const b = ts.x(nearestIndex(bars, Math.max(z.fromTime, z.toTime)))
      x = a
      w = Math.max(1, b - a)
      y = plot.y
      h = plot.h
    } else {
      continue
    }

    // plot.y rather than 0: the band belongs to its own pane's rect, not to
    // the top of the canvas.
    if (x > plot.w || x + w < 0 || y > plot.y + plot.h || y + h < plot.y) continue

    ctx.fillStyle = z.color || 'rgba(38,166,154,0.10)'
    ctx.fillRect(x, y, w, h)

    if (z.border) {
      ctx.strokeStyle = z.border
      ctx.lineWidth = 1
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h))
    }

    if (z.label) {
      ctx.fillStyle = z.labelColor || theme.text
      ctx.fillText(z.label, Math.max(6, x + 6), Math.max(4, y + 4))
    }
  }

  ctx.restore()
}

/* ------------------------------------------------------------- price lines -- */
/** Horizontal lines with an optional left title pill and right axis tag. */
export function drawPriceLines(ctx, s) {
  const { priceLines, theme, ps, plot } = s
  if (!priceLines || !priceLines.length) return

  const { step } = priceTicks(ps.lo, ps.hi, Math.max(2, Math.floor(plot.h / 58)))
  const dec = decimalsFor(step)

  ctx.save()
  ctx.font = theme.font
  ctx.textBaseline = 'middle'

  for (const L of priceLines) {
    if (!L) continue
    // isFinite('100.5') is true, so the old guard passed a string straight
    // through to .toFixed() below.
    const price = toNumber(L.price)
    if (Number.isNaN(price)) continue
    const y = Math.round(ps.y(price)) + 0.5
    if (y < plot.y || y > plot.y + plot.h) continue

    const color = L.color || theme.textStrong

    // lineVisible: false draws the labels without the rule — an axis tag
    // pinned to a price, which is a common way to show a current level.
    if (L.lineVisible !== false) {
      ctx.setLineDash(DASH[L.lineStyle] || DASH.dashed)
      ctx.strokeStyle = color
      ctx.lineWidth = L.lineWidth || 1
      ctx.beginPath()
      ctx.moveTo(plot.x, y)
      ctx.lineTo(plot.x + plot.w, y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (L.title) {
      ctx.textAlign = 'left'
      const tw = ctx.measureText(L.title).width
      ctx.fillStyle = color
      roundRect(ctx, 6, y - 9, tw + 12, 18, 4)
      ctx.fill()
      ctx.fillStyle = L.titleColor || theme.tagText
      ctx.fillText(L.title, 12, y)
    }

    if (L.axisLabel !== false) {
      const label = price.toFixed(dec)
      ctx.textAlign = 'left'
      const lw = ctx.measureText(label).width
      ctx.fillStyle = color
      ctx.fillRect(plot.w + 1, y - 9, lw + 14, 18)
      ctx.fillStyle = L.tagTextColor || theme.tagText
      ctx.fillText(label, plot.w + 8, y)
    }
  }

  ctx.restore()
}

/* ---------------------------------------------------------------- markers -- */
function shapePath(ctx, shape, x, y, r) {
  ctx.beginPath()
  switch (shape) {
    case 'arrowUp':
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x + r * 0.45, y)
      ctx.lineTo(x + r * 0.45, y + r)
      ctx.lineTo(x - r * 0.45, y + r)
      ctx.lineTo(x - r * 0.45, y)
      ctx.lineTo(x - r, y)
      ctx.closePath()
      break
    case 'arrowDown':
      ctx.moveTo(x, y + r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x + r * 0.45, y)
      ctx.lineTo(x + r * 0.45, y - r)
      ctx.lineTo(x - r * 0.45, y - r)
      ctx.lineTo(x - r * 0.45, y)
      ctx.lineTo(x - r, y)
      ctx.closePath()
      break
    case 'triangleUp':
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y + r)
      ctx.lineTo(x - r, y + r)
      ctx.closePath()
      break
    case 'triangleDown':
      ctx.moveTo(x, y + r)
      ctx.lineTo(x + r, y - r)
      ctx.lineTo(x - r, y - r)
      ctx.closePath()
      break
    case 'square':
      ctx.rect(x - r, y - r, r * 2, r * 2)
      break
    case 'diamond':
      ctx.moveTo(x, y - r)
      ctx.lineTo(x + r, y)
      ctx.lineTo(x, y + r)
      ctx.lineTo(x - r, y)
      ctx.closePath()
      break
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2)
  }
}

function drawFlag(ctx, x, y, r, color) {
  ctx.fillStyle = color
  ctx.fillRect(x - r * 0.8, y - r, Math.max(1, r * 0.3), r * 2)
  ctx.beginPath()
  ctx.moveTo(x - r * 0.5, y - r)
  ctx.lineTo(x + r, y - r * 0.55)
  ctx.lineTo(x - r * 0.5, y - r * 0.1)
  ctx.closePath()
  ctx.fill()
}

/**
 * Draws placed markers and returns their hit circles, newest first, so the
 * chart can answer "what is under the pointer?" without re-deriving geometry.
 */
export function drawMarkers(ctx, s, placed, hoverId) {
  const hits = []
  if (!placed || !placed.length) return hits

  const { theme } = s
  ctx.save()
  ctx.font = theme.font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const p of placed) {
    const { m, x, y, r, dir } = p
    const color = m.color || (DOWN_SHAPES.has(m.shape) ? theme.down : theme.up)
    const hovered = hoverId != null && m.id === hoverId

    if (m.shape === 'label') {
      const text = m.text || '•'
      const w = ctx.measureText(text).width + 14
      const h = 18 * m.size
      roundRect(ctx, x - w / 2, y - h / 2, w, h, 4)
      ctx.fillStyle = color
      ctx.fill()
      if (hovered) {
        ctx.strokeStyle = theme.textStrong
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.fillStyle = m.textColor || theme.tagText
      ctx.fillText(text, x, y + 0.5)
      hits.push({ id: m.id, marker: m, x, y, r: Math.max(w, h) / 2 })
      continue
    }

    if (hovered) {
      ctx.beginPath()
      ctx.arc(x, y, r + 4, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ctx.fill()
    }

    if (m.shape === 'flag') {
      drawFlag(ctx, x, y, r, color)
    } else {
      shapePath(ctx, m.shape, x, y, r)
      ctx.fillStyle = color
      ctx.fill()
    }

    if (m.text) {
      ctx.fillStyle = m.textColor || theme.text
      ctx.fillText(m.text, x, dir >= 0 ? y + r + 9 : y - r - 9)
    }

    hits.push({ id: m.id, marker: m, x, y, r: r + 3 })
  }

  ctx.restore()
  return hits
}
