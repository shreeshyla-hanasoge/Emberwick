/**
 * Mutants for host.drawPriceTag and the tag renderer it shares with price
 * lines (test/chart-price-tag.test.mjs). Aggregated by test/mutants.js;
 * `file` is repo-relative.
 */
const CHART = 'src/chart/core/Chart.js'
const ANNOTATIONS = 'src/chart/render/annotations.js'

export const MUTANTS = [
  {
    name: 'A plugin price tag is drawn for a price outside its pane',
    file: CHART,
    find: '        if (!(y >= pane.rect.y && y <= pane.rect.y + pane.rect.h)) return\n',
    replace: '',
  },
  {
    name: 'A plugin price tag is drawn for a NaN price',
    file: CHART,
    find: '        if (!(y >= pane.rect.y && y <= pane.rect.y + pane.rect.h)) return\n',
    replace: '        if (y < pane.rect.y || y > pane.rect.y + pane.rect.h) return\n',
  },
  {
    name: 'A plugin price tag ignores the pane it was given',
    file: CHART,
    find: '        const pane = o.pane || chart._panes[0]\n        const y = Math.round',
    replace: '        const pane = chart._panes[0]\n        const y = Math.round',
  },
  {
    name: 'A plugin price tag sits on a different pixel row from a price line',
    file: CHART,
    find: '        const y = Math.round(pane.ps.y(toNumber(price))) + 0.5',
    replace: '        const y = pane.ps.y(toNumber(price))',
  },
  {
    name: 'A plugin price tag keeps whatever font the plugin last set',
    file: CHART,
    find: "        ctx.font = chart.theme.font\n        ctx.textBaseline = 'middle'\n        drawPriceTag(",
    replace: "        ctx.textBaseline = 'middle'\n        drawPriceTag(",
  },
  {
    name: 'A plugin price tag ignores its text',
    file: CHART,
    find: '        drawPriceTag(ctx, pane.rect, y, o.text != null ? String(o.text) : formatPrice(price, pane),',
    replace: '        drawPriceTag(ctx, pane.rect, y, formatPrice(price, pane),',
  },
  {
    name: 'A plugin price tag drops a text of 0',
    file: CHART,
    find: '        drawPriceTag(ctx, pane.rect, y, o.text != null ? String(o.text) : formatPrice(price, pane),',
    replace: '        drawPriceTag(ctx, pane.rect, y, o.text ? String(o.text) : formatPrice(price, pane),',
  },
  {
    name: 'A plugin price tag ignores its colours',
    file: CHART,
    find: '          o.color || chart.theme.textStrong, o.textColor || chart.theme.tagText)',
    replace: '          chart.theme.textStrong, chart.theme.tagText)',
  },
  {
    name: 'The gutter tag box starts on the axis line',
    file: ANNOTATIONS,
    find: '  ctx.fillRect(plot.w + 1, y - 9, lw + 14, 18)',
    replace: '  ctx.fillRect(plot.w, y - 9, lw + 14, 18)',
  },
  {
    name: 'The gutter tag text is centred on its left edge',
    file: ANNOTATIONS,
    find: "  ctx.textAlign = 'left'\n  const lw = ctx.measureText(label).width",
    replace: "  const lw = ctx.measureText(label).width",
  },
]
