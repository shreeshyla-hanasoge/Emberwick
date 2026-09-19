import { decimalsFor, priceTicks } from '../core/formatters.js'

/**
 * Candles + volume. Everything here is culled to the visible index range —
 * 500k bars loaded still costs only the ~200 on screen.
 */
export function drawCandles(ctx, s) {
  const { theme, ts, ps, plot, bars, width, height, live, volumeRatio } = s

  ctx.clearRect(0, 0, width, height)
  if (!bars.length) return

  const { from, to } = ts.visibleRange()
  const bw = ts.barWidth()
  const half = bw / 2
  const thin = bw <= 2

  // ---- volume strip --------------------------------------------------------
  const volH = plot.h * volumeRatio
  const volTop = plot.y + plot.h - volH
  let vmax = 0
  for (let i = from; i <= to; i++) {
    const b = bars[i]
    if (b && b.volume > vmax) vmax = b.volume
  }
  if (vmax > 0) {
    for (let i = from; i <= to; i++) {
      let b = bars[i]
      if (!b) continue
      if (live && i === bars.length - 1) b = live
      const x = ts.x(i)
      if (x < -bw || x > plot.w + bw) continue
      const h = (b.volume / vmax) * volH * 0.9
      ctx.fillStyle = b.close >= b.open ? theme.volumeUp : theme.volumeDown
      ctx.fillRect(Math.round(x - half), volTop + (volH - h), Math.max(1, bw), h)
    }
  }

  // ---- candles -------------------------------------------------------------
  for (let i = from; i <= to; i++) {
    let b = bars[i]
    if (!b) continue
    const isLast = i === bars.length - 1
    if (live && isLast) b = live

    const x = ts.x(i)
    if (x < -bw || x > plot.w + bw) continue

    const up = b.close >= b.open
    // Body fill only. theme.up/down also drive the last-price line and the
    // price tag, so upFill/downFill are the escape hatch for theming the
    // bodies independently — falling back to up/down when unset, which is
    // what keeps a theme that only sets `up` looking exactly as it did.
    const color = up ? theme.upFill || theme.up : theme.downFill || theme.down
    const yO = ps.y(b.open)
    const yC = ps.y(b.close)
    const yH = ps.y(b.high)
    const yL = ps.y(b.low)

    // grow-from-centre on a freshly opened candle
    let scale = 1
    if (live && isLast && typeof b._spawn === 'number') scale = 0.35 + 0.65 * b._spawn

    const cx = Math.round(x) + (bw % 2 ? 0.5 : 0)

    // wick
    ctx.strokeStyle = up ? theme.wickUp : theme.wickDown
    ctx.lineWidth = Math.max(1, Math.min(2, bw * 0.16))
    ctx.beginPath()
    ctx.moveTo(cx, yH)
    ctx.lineTo(cx, yL)
    ctx.stroke()

    if (thin) continue

    // body
    const top = Math.min(yO, yC)
    const bodyH = Math.max(1, Math.abs(yC - yO))
    const w = Math.max(1, bw * scale)
    ctx.fillStyle = color
    ctx.fillRect(Math.round(x - w / 2), Math.round(top), Math.round(w), Math.round(bodyH))
  }

  // ---- last price line -----------------------------------------------------
  const lastBar = live || bars[bars.length - 1]
  if (lastBar) {
    const y = Math.round(ps.y(lastBar.close)) + 0.5
    if (y > plot.y && y < plot.y + plot.h) {
      const up = lastBar.close >= lastBar.open
      ctx.save()
      ctx.setLineDash([3, 3])
      ctx.strokeStyle = up ? theme.up : theme.down
      ctx.lineWidth = 1
      ctx.globalAlpha = 0.7
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(plot.w, y)
      ctx.stroke()
      ctx.restore()

      const { step } = priceTicks(ps.lo, ps.hi, Math.max(2, Math.floor(plot.h / 58)))
      const label = lastBar.close.toFixed(decimalsFor(step))
      ctx.font = theme.font
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      const tw = ctx.measureText(label).width
      ctx.fillStyle = up ? theme.up : theme.down
      ctx.fillRect(plot.w + 1, y - 9, tw + 14, 18)
      ctx.fillStyle = theme.tagText
      ctx.fillText(label, plot.w + 8, y)
    }
  }
}
