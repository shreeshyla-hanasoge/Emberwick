import { priceTicks, decimalsFor, niceBarStep } from '../core/formatters.js'

/**
 * One pane's horizontal grid and its price labels.
 *
 * Draws nothing until the scale has actually fitted a price: until then the
 * bounds are the 0..1 constructor defaults, and drawing them labels an
 * instrument trading at 24,000 with an axis running 0.10 to 0.80. A backtest
 * still in progress returns its trades before its candles, so an empty
 * dataset with markers already attached is a normal frame, not an edge case.
 *
 * Deliberately does NOT clear or paint a background — exactly one renderer
 * clears each canvas, and for `base` that is drawGrid below. This is what a
 * sub-pane draws, and what the price pane's own axis goes through.
 */
export function drawPriceAxis(ctx, s) {
  const { theme, ps, plot } = s
  if (!ps.primed) return

  ctx.font = theme.font
  ctx.textBaseline = 'middle'

  const rows = Math.max(2, Math.floor(plot.h / 58))
  const { ticks, step } = priceTicks(ps.lo, ps.hi, rows)
  const dec = decimalsFor(step)

  ctx.strokeStyle = theme.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const v of ticks) {
    const y = Math.round(ps.y(v)) + 0.5
    if (y < plot.y || y > plot.y + plot.h) continue
    ctx.moveTo(plot.x, y)
    ctx.lineTo(plot.x + plot.w, y)
  }
  ctx.stroke()

  ctx.fillStyle = theme.text
  ctx.textAlign = 'left'
  for (const v of ticks) {
    const y = Math.round(ps.y(v))
    if (y < plot.y + 6 || y > plot.y + plot.h - 6) continue
    ctx.fillText(v.toFixed(dec), plot.w + 8, y)
  }
}

/** Background, grid, and both axes. Repaints only when the view changes. */
export function drawGrid(ctx, s) {
  const { theme, ts, plot, bars, width, height, fmt } = s
  // The time axis belongs to the WHOLE plot, not to the price pane: its
  // labels, its vertical gridlines and its separator all sit below the last
  // pane. plot.h is only the first band once a sub-pane exists.
  const bottom = isFinite(s.plotBottom) ? s.plotBottom : plot.y + plot.h

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = theme.background
  ctx.fillRect(0, 0, width, height)

  ctx.font = theme.font
  ctx.textBaseline = 'middle'

  drawPriceAxis(ctx, s)

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
      ctx.lineTo(x, bottom)
    }
    ctx.stroke()

    ctx.fillStyle = theme.text
    ctx.textAlign = 'center'
    const ty = bottom + theme.timeAxisHeight / 2
    // The first label of a new day shows the date instead of the time.
    // Without it a multi-day intraday chart is nothing but times, with no
    // clue where one session ends — the old rule only labelled a date at
    // local midnight, which is a moment intraday instruments never trade.
    let prevDay = null
    const before = bars[Math.max(0, first - stepBars)]
    if (before) prevDay = fmt.dayKey(before.time)
    for (let i = first; i <= to; i += stepBars) {
      const bar = bars[i]
      if (!bar) continue
      const day = fmt.dayKey(bar.time)
      const newDay = prevDay !== null && day !== prevDay
      prevDay = day
      const x = Math.round(ts.x(i))
      if (x < 28 || x > plot.w - 28) continue
      ctx.fillText(newDay ? fmt.date(bar.time) : fmt.axis(bar.time, ts.timeframeMs), x, ty)
    }
  }

  // ---- axis separators -----------------------------------------------------
  ctx.strokeStyle = theme.axisLine
  ctx.beginPath()
  ctx.moveTo(plot.w + 0.5, 0)
  ctx.lineTo(plot.w + 0.5, bottom)
  ctx.moveTo(0, bottom + 0.5)
  ctx.lineTo(width, bottom + 0.5)
  ctx.stroke()
}
