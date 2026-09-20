/**
 * Series — arbitrary y-values over the bar time axis.
 *
 * Drawn on the main layer between the candles and the price lines, so an
 * indicator sits over the candles but under the annotations a user placed
 * deliberately.
 */
import { DASH } from './style.js'
import { lowerBound } from '../overlays/series.js'

export function drawSeries(ctx, s) {
  const { theme, ts, ps, plot, series } = s
  if (!series || !series.length) return

  const { from, to } = ts.visibleRange()

  ctx.save()
  /**
   * Clip to the plot.
   *
   * drawCandles gets away without this because a candle is by construction
   * inside the fitted range. A series value is not: an equity curve at
   * 200,000 against a ~100 price scale maps to roughly -15 million px, and
   * unclipped that paints straight over both axes.
   */
  ctx.beginPath()
  ctx.rect(0, plot.y, plot.w, plot.h)
  ctx.clip()

  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'

  for (const entry of series) {
    const opts = entry.opts
    const pts = entry.drawable
    if (!opts.visible || pts.length < 2) continue

    ctx.strokeStyle = opts.color || theme.textStrong
    ctx.lineWidth = opts.lineWidth
    ctx.setLineDash(DASH[opts.lineStyle] || DASH.solid)
    ctx.beginPath()

    // Start one point before the window and run one past it, so the segments
    // entering and leaving the view are drawn rather than stopping at the edge.
    let penDown = false
    let prevY = 0
    for (let i = Math.max(0, lowerBound(pts, from) - 1); i < pts.length; i++) {
      const p = pts[i]
      if (p.index > to + 1) break

      // A gap lifts the pen: the line ends here and the next valued point
      // starts a fresh one. Never interpolated across, never drawn as zero.
      if (Number.isNaN(p.value)) {
        penDown = false
        continue
      }
      const y = ps.y(p.value)
      if (!isFinite(y)) {
        penDown = false
        continue
      }
      const x = ts.x(p.index)

      if (!penDown) {
        ctx.moveTo(x, y)
        penDown = true
      } else if (opts.stepped) {
        ctx.lineTo(x, prevY)
        ctx.lineTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
      prevY = y
    }

    ctx.stroke()
    ctx.setLineDash([])
  }

  ctx.restore()
}
