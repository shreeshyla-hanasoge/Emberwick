import { decimalsFor, priceTicks } from '../core/formatters.js'

/**
 * Crosshair lives alone on the top canvas: moving the pointer repaints only
 * these few pixels, never the candles underneath.
 */
export function drawCrosshair(ctx, s) {
  const { theme, ts, ps, plot, bars, width, height, cursor, magnet } = s

  ctx.clearRect(0, 0, width, height)
  if (!cursor || !bars.length) return
  if (cursor.x < 0 || cursor.x > plot.w || cursor.y < 0 || cursor.y > plot.h) return

  const i = Math.round(ts.index(cursor.x))
  const bar = bars[i]

  let x = cursor.x
  let y = cursor.y
  if (bar) {
    x = ts.x(i) // snap to the bar slot
    if (magnet) {
      // magnet to the nearest OHLC value
      const cands = [bar.open, bar.high, bar.low, bar.close]
      let best = null
      let bestD = Infinity
      for (const p of cands) {
        const py = ps.y(p)
        const d = Math.abs(py - cursor.y)
        if (d < bestD) { bestD = d; best = py }
      }
      if (bestD < 22) y = best
    }
  }

  ctx.save()
  ctx.setLineDash([4, 4])
  ctx.strokeStyle = theme.crosshair
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(Math.round(x) + 0.5, 0)
  ctx.lineTo(Math.round(x) + 0.5, plot.h)
  ctx.moveTo(0, Math.round(y) + 0.5)
  ctx.lineTo(plot.w, Math.round(y) + 0.5)
  ctx.stroke()
  ctx.restore()

  ctx.font = theme.font
  ctx.textBaseline = 'middle'

  // price tag
  const { step } = priceTicks(ps.lo, ps.hi, Math.max(2, Math.floor(plot.h / 58)))
  const priceLabel = ps.price(y).toFixed(decimalsFor(step))
  ctx.textAlign = 'left'
  const pw = ctx.measureText(priceLabel).width
  ctx.fillStyle = theme.labelBg
  ctx.fillRect(plot.w + 1, y - 9, pw + 14, 18)
  ctx.fillStyle = theme.labelText
  ctx.fillText(priceLabel, plot.w + 8, y)

  // time tag
  if (bar) {
    const t = s.fmt.full(bar.time)
    ctx.textAlign = 'center'
    const tw = ctx.measureText(t).width
    const bx = Math.min(Math.max(x, tw / 2 + 6), plot.w - tw / 2 - 6)
    ctx.fillStyle = theme.labelBg
    ctx.fillRect(bx - tw / 2 - 7, plot.h + 3, tw + 14, 18)
    ctx.fillStyle = theme.labelText
    ctx.fillText(t, bx, plot.h + 12)
  }
}

