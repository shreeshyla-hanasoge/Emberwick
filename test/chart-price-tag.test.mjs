/**
 * host.drawPriceTag: the price-axis gutter tag, shared by core price lines
 * and plugins.
 *
 * The point of sharing is that the two cannot drift, so the central test
 * draws the same price both ways and compares the recorded operations. The
 * recording context has no state stack and measureText always answers 10, so
 * every expected number below is exact.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

const charted = (options) => {
  const chart = createChart(makeContainer(), options)
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  settle(chart); frame(chart)
  return chart
}

/** Attach a plugin whose draw calls `fn(host, ctx)`; returns its host. */
const tagging = (chart, fn, layer) => {
  const p = { layer, attach(h) { this.host = h }, draw(ctx) { fn(this.host, ctx) } }
  chart.addPlugin(p)
  return p
}

/** The tag's own ops: everything a draw recorded between its save and restore. */
const drawn = (chart, layer = 'plugins') => {
  const ops = chart.layers.canvas[layer].ops
  const a = ops.findIndex((o) => o.op === 'save')
  const b = ops.findIndex((o) => o.op === 'restore')
  return ops.slice(a + 1, b)
}

const flat = (ops) => ops.map((o) => (o.op === 'set' ? [o.prop, o.value] : [o.op, ...o.args]))

test('host.drawPriceTag records the operations a core price line records for its tag', () => {
  const chart = charted()
  const price = 24000.4
  chart.setPriceLines([{ price, color: '#abcdef', tagTextColor: '#123456', lineVisible: false }])
  tagging(chart, (host, ctx) => host.drawPriceTag(ctx, price, { color: '#abcdef', textColor: '#123456' }))
  clearOps(chart)
  frame(chart)

  // The price line, alone on main between drawPriceLines' own save and restore.
  const main = chart.layers.canvas.main.ops
  const end = main.map((o) => o.op).lastIndexOf('fillText')
  let start = end
  while (main[start].op !== 'save') start--
  const line = flat(main.slice(start + 1, end + 1))
  assert.deepEqual(flat(drawn(chart)), line, 'same font, baseline, alignment, box and text, in the same order')

  const y = Math.round(chart.ps.y(price)) + 0.5
  assert.deepEqual(line, [
    ['font', chart.theme.font],
    ['textBaseline', 'middle'],
    ['textAlign', 'left'],
    ['fillStyle', '#abcdef'],
    ['fillRect', chart.plot.w + 1, y - 9, 10 + 14, 18],
    ['fillStyle', '#123456'],
    ['fillText', price.toFixed(2), chart.plot.w + 8, y],
  ])
})

test('the defaults are a price line\'s: theme.textStrong, theme.tagText, and the axis decimals', () => {
  const chart = charted()
  const p = tagging(chart, (host, ctx) => host.drawPriceTag(ctx, 24000.4))
  clearOps(chart)
  frame(chart)
  const ops = flat(drawn(chart))
  assert.deepEqual(ops.filter((o) => o[0] === 'fillStyle').map((o) => o[1]), [chart.theme.textStrong, chart.theme.tagText])
  assert.equal(ops.find((o) => o[0] === 'fillText')[1], p.host.formatPrice(24000.4))
})

test('text replaces the formatted price, and numbers are stringified', () => {
  const chart = charted()
  let text = 'POC'
  tagging(chart, (host, ctx) => host.drawPriceTag(ctx, 24000, { text }))
  const label = () => { clearOps(chart); frame(chart); return drawn(chart).find((o) => o.op === 'fillText').args[0] }
  assert.equal(label(), 'POC')
  text = 0
  assert.equal(label(), '0', 'a falsy text is still the text')
  text = null
  assert.equal(label(), '24000.00', 'null falls back to the price')
})

test('a numeric-string price is coerced the way every Emberwick price is', () => {
  const chart = charted()
  tagging(chart, (host, ctx) => host.drawPriceTag(ctx, '24000.4'))
  clearOps(chart)
  frame(chart)
  const ops = flat(drawn(chart))
  assert.equal(ops.find((o) => o[0] === 'fillText')[1], '24000.40')
  assert.equal(ops.find((o) => o[0] === 'fillRect')[2], Math.round(chart.ps.y(24000.4)) + 0.5 - 9)
})

test('a price outside the pane, or not a price at all, draws nothing', () => {
  const chart = charted()
  let price = chart.ps.price(chart.plot.y - 40)        // above the top of the pane
  tagging(chart, (host, ctx) => host.drawPriceTag(ctx, price))
  const count = () => { clearOps(chart); frame(chart); return drawn(chart).length }
  assert.equal(count(), 0, 'above the pane')
  price = chart.ps.price(chart.plot.y + chart.plot.h + 40)
  assert.equal(count(), 0, 'below it')
  for (const bad of [NaN, null, undefined, 'soon']) {
    price = bad
    assert.equal(count(), 0, `${String(bad)} is not a price`)
  }
  price = 24000
  assert.equal(count(), 7, 'inside, it is drawn')
})

test('pane: the tag uses that pane\'s scale, band and decimals', () => {
  const chart = charted()
  chart.addPane('rsi', { weight: 1 })
  chart.setSeries('r', { pane: 'rsi', data: chart.bars.map((b, i) => ({ time: b.time, value: 30 + (i % 40) + 0.123 })) })
  settle(chart); frame(chart)
  const rsi = chart._paneById.get('rsi')
  let host = null
  tagging(chart, (h, ctx) => { host = h; h.drawPriceTag(ctx, 55.5, { pane: h.paneById('rsi') }) })
  clearOps(chart)
  frame(chart)
  const ops = flat(drawn(chart))
  const y = Math.round(rsi.ps.y(55.5)) + 0.5
  assert.ok(y > rsi.rect.y && y < rsi.rect.y + rsi.rect.h, 'inside the RSI band')
  assert.deepEqual(ops.find((o) => o[0] === 'fillRect'), ['fillRect', chart.plot.w + 1, y - 9, 24, 18])
  assert.equal(ops.find((o) => o[0] === 'fillText')[1], host.formatPrice(55.5, rsi))
  assert.notEqual(y, Math.round(chart.ps.y(55.5)) + 0.5, 'not where the price pane would put 55.5')
})

test('drawPriceTag and formatPrice work detached from the host object', () => {
  const chart = charted()
  tagging(chart, (host, ctx) => {
    const { drawPriceTag, formatPrice } = host
    drawPriceTag(ctx, 24000.4, { text: formatPrice(24000.4) + '!' })
  })
  clearOps(chart)
  frame(chart)
  assert.equal(drawn(chart).find((o) => o.op === 'fillText').args[0], '24000.40!')
})

test('a below plugin\'s tag is painted on its own layer, under the candles\' tags', () => {
  const chart = charted()
  tagging(chart, (host, ctx) => host.drawPriceTag(ctx, 24000.4), 'below')
  clearOps(chart)
  frame(chart)
  assert.equal(drawn(chart, 'pluginsBelow').filter((o) => o.op === 'fillText').length, 1)
  assert.deepEqual(chart.layers.names, ['base', 'pluginsBelow', 'main', 'overlay'])
})

test('it draws into the export pass too', () => {
  const chart = charted()
  tagging(chart, (host, ctx) => host.drawPriceTag(ctx, 24000.4, { text: 'tag' }))
  const created = []
  const doc = globalThis.document
  const make = doc.createElement
  doc.createElement = (tag) => { const c = make(tag); created.push(c); return c }
  try { chart.toImage() } finally { doc.createElement = make }
  assert.ok(created[created.length - 1].ops.some((o) => o.op === 'fillText' && o.args[0] === 'tag'))
})
