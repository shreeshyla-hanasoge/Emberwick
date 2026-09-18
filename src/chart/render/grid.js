import { priceTicks, decimalsFor, niceBarStep, fmtAxisTime } from '../core/formatters.js'

/** Background, grid, and both axes. Repaints only when the view changes. */
export function drawGrid(ctx, s) {
  const { theme, ts, ps, plot, bars, width, height } = s

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)

  ctx.font = theme.font
  ctx.textBaseline = 'middle'

  // ---- price grid + labels -------------------------------------------------
  const rows = Math.max(2, Math.floor(plot.h / 58))
  const { ticks, step } = priceTicks(ps.lo, ps.hi, rows)
  const dec = decimalsFor(step)

  ctx.strokeStyle = theme.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const v of ticks) {
    const y = Math.round(ps.y(v)) + 0.5
    if (y < plot.y || y > plot.y + plot.h) continue
    ctx.moveTo(0, y)
    ctx.lineTo(plot.w, y)
  }
  ctx.stroke()

  ctx.fillStyle = theme.text
  ctx.textAlign = 'left'
  for (const v of ticks) {
    const y = Math.round(ps.y(v))
    if (y < plot.y + 6 || y > plot.y + plot.h - 6) continue
    ctx.fillText(v.toFixed(dec), plot.w + 8, y)
  }

  // ---- time grid + labels --------------------------------------------------
  if (bars.length) {
    const minBars = Math.ceil(74 / Math.max(0.0001, ts.spacing))
    const stepBars = niceBarStep(minBars)
    const { from, to } = ts.visibleRange()
    const first = Math.ceil(from / stepBars) * stepBars

    ctx.strokeStyle = theme.grid
    ctx.beginPath()
    for (let i = first; i <= to; i += stepBars) {
      const x = Math.round(ts.x(i)) + 0.5
      if (x < 0 || x > plot.w) continue
      ctx.moveTo(x, 0)
      ctx.lineTo(x, plot.h)
    }
    ctx.stroke()

    ctx.fillStyle = theme.text
    ctx.textAlign = 'center'
    const ty = plot.h + theme.timeAxisHeight / 2
    for (let i = first; i <= to; i += stepBars) {
      const bar = bars[i]
      if (!bar) continue
      const x = Math.round(ts.x(i))
      if (x < 28 || x > plot.w - 28) continue
      ctx.fillText(fmtAxisTime(bar.time, ts.timeframeMs), x, ty)
    }
  }

  // ---- axis separators -----------------------------------------------------
  ctx.strokeStyle = theme.axisLine
  ctx.beginPath()
  ctx.moveTo(plot.w + 0.5, 0)
  ctx.lineTo(plot.w + 0.5, plot.h)
  ctx.moveTo(0, plot.h + 0.5)
  ctx.lineTo(width, plot.h + 0.5)
  ctx.stroke()
}
