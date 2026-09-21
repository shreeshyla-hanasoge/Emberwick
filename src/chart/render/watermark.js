import { BRAND_PATHS, BRAND_VIEWBOX } from '../../brand.js'

let paths

/** Draw the official wordmark behind chart data, including exported PNGs. */
export function drawWatermark(ctx, s) {
  if (s.watermark === false || typeof Path2D === 'undefined') return
  if (!paths) paths = BRAND_PATHS.map((d) => new Path2D(d))

  const [, , sourceW, sourceH] = BRAND_VIEWBOX
  // A small bottom-left signature reads as product attribution. Keeping it
  // out of the visual centre also leaves the price action as the clear focus.
  const markW = Math.min(180, s.plot.w * 0.24)
  const scale = markW / sourceW
  const h = sourceH * scale
  const inset = Math.min(16, s.plot.w * 0.04)
  const x = s.plot.x + inset
  const y = s.plot.y + s.plot.h - h - inset

  ctx.save()
  ctx.translate(x, y)
  ctx.scale(scale, scale)
  ctx.fillStyle = s.theme.watermark
  for (const path of paths) ctx.fill(path)
  ctx.restore()
}
