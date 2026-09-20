/**
 * 0.6.2 — hardening for a real consumer.
 *
 * Everything here is reachable on a plain backtest chart: a fixed dataset,
 * no feed. All of it was live on 0.6.1.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, clearOps, settle } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { toNumber } = await import('../src/chart/core/formatters.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

/** Text drawn to a layer this frame. */
const textOn = (chart, layer) =>
  chart.layers.canvas[layer].ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])

// ------------------------------------------------------- string prices
test('toNumber coerces numeric strings and rejects everything else', () => {
  assert.equal(toNumber(100.5), 100.5)
  assert.equal(toNumber('100.5'), 100.5)
  assert.equal(toNumber(' 24005.25 '), 24005.25)
  for (const bad of [null, undefined, true, false, [], {}, '', '   ', 'abc', NaN, Infinity]) {
    assert.ok(Number.isNaN(toNumber(bad)), `${JSON.stringify(bad)} is not a price`)
  }
})

test('a chart fed numeric-string OHLC renders instead of killing the frame', () => {
  // Laravel serialises decimal columns as strings; several exchange REST APIs
  // do too. PriceScale coerced them from 0.5.1, but the renderers still called
  // .toFixed() on the raw value and threw inside the frame.
  const chart = createChart(makeContainer())
  chart.setData(Array.from({ length: 30 }, (_, i) => ({
    time: T0 + i * MIN,
    open: '24000.50', high: '24010.00', low: '23990.00', close: '24005.25',
  })))
  clearOps(chart)
  assert.doesNotThrow(() => frame(chart))

  // The base layer carries the time axis too, so keep only the price labels.
  const prices = textOn(chart, 'base').filter((l) => /^\d+\.\d+$/.test(l)).map(Number)
  assert.ok(prices.length > 1, 'the price axis must be labelled')
  assert.ok(prices.every((v) => v > 23000 && v < 25000),
    `axis is not in the data range: ${JSON.stringify(prices)}`)
  chart.destroy()
})

test('a numeric-string price line renders instead of killing the frame', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 30, MIN))
  chart.setPriceLines([{ price: '100.5', title: 'target' }])
  clearOps(chart)
  assert.doesNotThrow(() => frame(chart))
  chart.destroy()
})

test('ten string-price frames do not stop the loop', () => {
  // The compounding failure: Loop gives up after 10 consecutive throws, so a
  // string-price feed used to leave a frozen canvas needing chart.resume().
  const chart = createChart(makeContainer())
  chart.setData(Array.from({ length: 20 }, (_, i) => ({
    time: T0 + i * MIN, open: '100', high: '101', low: '99', close: '100.5',
  })))
  for (let i = 0; i < 12; i++) frame(chart)
  assert.equal(chart.loop.running, true, 'the loop must still be alive')
  assert.equal(chart.loop._frameErrors, 0)
  chart.destroy()
})

test('a lexicographic close/open comparison cannot flip the last-price colour', () => {
  const chart = createChart(makeContainer(), { theme: { up: '#00ff00', down: '#ff0000' } })
  // '9' > '100' as strings, but 9 < 100 as numbers: a down bar.
  chart.setData([
    { time: T0, open: 100, high: 100, low: 9, close: 100 },
    { time: T0 + MIN, open: '100', high: '100', low: '9', close: '9' },
  ])
  clearOps(chart)
  frame(chart)
  const strokes = chart.layers.canvas.main.ops
    .filter((o) => o.op === 'set' && o.prop === 'strokeStyle').map((o) => o.value)
  assert.ok(strokes.includes('#ff0000'), 'a close below the open must read as down')
  chart.destroy()
})

// --------------------------------------------------- empty / partial data
test('an empty dataset does not invent a price axis', () => {
  // A backtest in progress returns its trades before its candles, so this is
  // a normal frame: markers attached, candle_data still [].
  const chart = createChart(makeContainer())
  chart.setData([])
  chart.setMarkers([{ time: T0, shape: 'circle' }])
  clearOps(chart)
  frame(chart)

  assert.deepEqual(textOn(chart, 'base'), [],
    'labelling a 0.10-0.80 axis for an instrument trading at 24,000 is worse than no axis')
  assert.equal(chart.ps.primed, false)
  chart.destroy()
})

test('the axis appears as soon as real bars arrive', () => {
  const chart = createChart(makeContainer())
  chart.setData([])
  frame(chart)
  assert.equal(chart.ps.primed, false)

  chart.setData(makeBars(T0, 30, MIN))
  clearOps(chart)
  frame(chart)
  assert.equal(chart.ps.primed, true)
  assert.ok(textOn(chart, 'base').length > 1, 'the axis must come back')
  chart.destroy()
})

test('bars carrying no usable price leave the scale unprimed', () => {
  const chart = createChart(makeContainer())
  chart.setData(Array.from({ length: 10 }, (_, i) => ({
    time: T0 + i * MIN, open: null, high: undefined, low: 'abc', close: {},
  })))
  clearOps(chart)
  assert.doesNotThrow(() => frame(chart))
  assert.equal(chart.ps.primed, false, 'nothing plottable means no axis')
  chart.destroy()
})

// ------------------------------------------------------------ price lines
test('lineVisible: false draws the labels without the rule', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 30, MIN))

  // Settle first, then measure the DELTA against a frame with no price lines.
  // Comparing two unsettled frames measures the price scale still easing, not
  // the rule — which let a mutant that ignores lineVisible slip through.
  settle(chart)
  const strokesWith = (lines) => {
    chart.setPriceLines(lines)
    settle(chart)
    clearOps(chart)
    frame(chart)
    return chart.layers.canvas.main.ops.filter((o) => o.op === 'stroke').length
  }

  const baseline = strokesWith([])
  const hidden = strokesWith([{ price: 100.2, title: 'level', lineVisible: false }])
  assert.equal(hidden - baseline, 0, 'lineVisible: false must add no stroke at all')
  assert.ok(textOn(chart, 'main').includes('level'), 'the title pill must still draw')

  const shown = strokesWith([{ price: 100.2, title: 'level' }])
  assert.equal(shown - baseline, 1, 'the default must stroke exactly one rule')
  chart.destroy()
})

// ------------------------------------------------------------------- Vue
test('a Chart declares itself non-reactive to Vue', () => {
  // Vue's ReactiveFlags.SKIP. Without it, reading chart.bars from a component's
  // reactive state deep-proxies every bar on an object repainting at 60fps.
  const chart = createChart(makeContainer())
  assert.equal(chart.__v_skip, true)
  chart.destroy()
})
