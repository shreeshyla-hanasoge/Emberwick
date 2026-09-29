import { decimalsFor, priceTicks } from '../core/formatters.js'

/**
 * Crosshair lives alone on the top canvas: moving the pointer repaints only
 * these few pixels, never the candles underneath.
 */
export function drawCrosshair(ctx, s) {
  const { theme, ts, ps, plot, bars, width, height, cursor, magnet } = s

  ctx.clearRect(0, 0, width, height)
  if (!cursor || !bars.length) return
  // Bounds are the pane's rect, not the canvas: plot.y is 0 for a chart with
  // a single pane and non-zero for every pane below the first.
  if (cursor.x < plot.x || cursor.x > plot.x + plot.w) return
  if (cursor.y < plot.y || cursor.y > plot.y + plot.h) return

  const i = Math.round(ts.index(cursor.x))
  const bar = bars[i]

  let x = cursor.x
  let y = cursor.y
  if (bar && !cursor.exact) {
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
  ctx.moveTo(Math.round(x) + 0.5, plot.y)
  ctx.lineTo(Math.round(x) + 0.5, plot.y + plot.h)
  ctx.moveTo(plot.x, Math.round(y) + 0.5)
  ctx.lineTo(plot.x + plot.w, Math.round(y) + 0.5)
  ctx.stroke()
  ctx.restore()

  // The plugin draws this point's own axis tags (an accent tag per anchor);
  // two tags for one point would hide one and disagree past the newest bar.
  if (cursor.exact && cursor.tags === false) return

  ctx.font = theme.font
  ctx.textBaseline = 'middle'

  // price tag
  const { step } = priceTicks(ps.lo, ps.hi, Math.max(2, Math.floor(plot.h / 58)))
  // An exact point was snapped by a plugin (a drawing anchor, a level, an
  // angle): re-snapping it with this renderer's own 22px magnet would make the
  // tag disagree with the handle it sits beside. Number.isFinite: a null or
  // string price must fall back, not reach toFixed() inside the frame.
  const priceLabel = (cursor.exact && Number.isFinite(cursor.price) ? cursor.price : ps.price(y)).toFixed(decimalsFor(step))
  ctx.textAlign = 'left'
  const pw = ctx.measureText(priceLabel).width
  ctx.fillStyle = theme.labelBg
  ctx.fillRect(plot.w + 1, y - 9, pw + 14, 18)
  ctx.fillStyle = theme.labelText
  ctx.fillText(priceLabel, plot.w + 8, y)

  // time tag
  if (bar) {
    // Against the bottom of the WHOLE plot, the same quantity and the same
    // guard drawGrid uses. `plot` here is the hovered PANE's rect, so plot.h
    // is that pane's height — hovering an oscillator put the timestamp a
    // third of the way up the chart, in the middle of the candles. The same
    // trap that drew the time axis between the panes in 0.9.0; grid.js was
    // fixed in that sweep and this renderer was missed.
    const bottom = isFinite(s.plotBottom) ? s.plotBottom : plot.y + plot.h
    const t = s.fmt.full(bar.time)
    ctx.textAlign = 'center'
    const tw = ctx.measureText(t).width
    const bx = Math.min(Math.max(x, tw / 2 + 6), plot.w - tw / 2 - 6)
    ctx.fillStyle = theme.labelBg
    ctx.fillRect(bx - tw / 2 - 7, bottom + 3, tw + 14, 18)
    ctx.fillStyle = theme.labelText
    ctx.fillText(t, bx, bottom + 12)
  }
}

