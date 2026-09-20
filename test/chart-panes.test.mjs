/**
 * Multi-pane. The case that motivates it: an RSI on 0..100 cannot share a
 * scale with a price near 24,000 without flattening the candles into a line.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps, drawnValues } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { Pane, layoutPanes, paneAtY } = await import('../src/chart/core/Panes.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const osc = (n = 200) => Array.from({ length: n }, (_, i) => ({ time: T0 + i * MIN, value: 50 + 40 * Math.sin(i / 12) }))

// ------------------------------------------------------------ the model
test('one pane lays out to the whole band, exactly as before panes existed', () => {
  const panes = [new Pane('price', { weight: 3 })]
  layoutPanes(panes, 880, 460, 0)
  assert.deepEqual(panes[0].rect, { x: 0, y: 0, w: 880, h: 460 })
  assert.equal(panes[0].ps.top, 0)
})

test('pane heights plus gaps always sum to the plot height', () => {
  for (const [n, h, gap] of [[2, 460, 6], [3, 460, 6], [4, 301, 5], [2, 97, 0]]) {
    const panes = [new Pane('price', { weight: 3 }), ...Array.from({ length: n - 1 }, (_, i) => new Pane(`p${i}`))]
    layoutPanes(panes, 800, h, gap)
    const total = panes.reduce((a, p) => a + p.rect.h, 0) + gap * (n - 1)
    assert.equal(total, h, `${n} panes in ${h}px with ${gap}px gaps summed to ${total}`)
  }
})

test('each pane scale is laid out at its own offset', () => {
  const panes = [new Pane('price', { weight: 3 }), new Pane('rsi')]
  layoutPanes(panes, 800, 460, 6)
  assert.equal(panes[1].ps.top, panes[1].rect.y)
  assert.ok(panes[1].rect.y > panes[0].rect.h - 1, 'the second band starts below the first')
})

test('paneAtY finds the owning pane, and nothing below the last', () => {
  const panes = [new Pane('price', { weight: 3 }), new Pane('rsi')]
  layoutPanes(panes, 800, 460, 6)
  assert.equal(paneAtY(panes, 10).id, 'price')
  assert.equal(paneAtY(panes, panes[1].rect.y + 10).id, 'rsi')
  assert.equal(paneAtY(panes, 900), null, 'the time axis belongs to no pane')
})

// --------------------------------------------------------- the whole point
test('a sub-pane scales to its own series, leaving the price scale alone', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  settle(chart); frame(chart)
  const priceBefore = { lo: chart.ps.lo, hi: chart.ps.hi }

  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi', color: '#f0b' })
  settle(chart); frame(chart)

  assert.ok(Math.abs(chart.paneScale('price').hi - priceBefore.hi) < 1,
    'an oscillator must not touch the price scale')
  const rsi = chart.paneScale('rsi')
  assert.ok(rsi.lo >= 0 && rsi.lo < 5 && rsi.hi > 95 && rsi.hi <= 105,
    `the rsi pane should scale to 0..100, got ${rsi.lo}..${rsi.hi}`)
  chart.destroy()
})

test('the same series on the price pane WOULD flatten it — the control case', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.setSeries('rsi14', { data: osc() })   // no pane: the price pane
  settle(chart); frame(chart)
  assert.ok(chart.ps.lo < 100, 'this is the failure a sub-pane exists to avoid')
  chart.destroy()
})

test('a sub-pane series is stroked, and on its own band', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi', color: '#f0b' })
  settle(chart); clearOps(chart); frame(chart)

  assert.ok(drawnValues(chart, 'main', 'strokeStyle').includes('#f0b'))
  const band = chart.paneRect('rsi')
  const clips = chart.layers.canvas.main.ops.filter((o) => o.op === 'rect')
  assert.ok(clips.some((o) => o.args[1] === band.y && o.args[3] === band.h),
    'the series must clip to its own pane rect')
  chart.destroy()
})

test('every pane draws a price axis of its own', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  settle(chart); clearOps(chart); frame(chart)

  const labels = chart.layers.canvas.base.ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])
  assert.ok(labels.some((l) => Number(l) > 20000), `no price labels: ${JSON.stringify(labels)}`)
  assert.ok(labels.some((l) => Number(l) >= 0 && Number(l) <= 100), 'no oscillator labels')
  chart.destroy()
})

// ------------------------------------------------------------------- API
test('panes are addressable, and the price pane is permanent', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  assert.deepEqual(chart.panes().map((p) => p.id), ['price'])

  chart.addPane('rsi', { weight: 2, title: 'RSI 14' })
  assert.deepEqual(chart.panes().map((p) => p.id), ['price', 'rsi'])
  assert.equal(chart.pane('rsi').title, 'RSI 14')
  assert.equal(chart.pane('nope'), null)

  assert.throws(() => chart.addPane('rsi'), /already exists/)
  assert.throws(() => chart.removePane('price'), /cannot be removed/)
  assert.throws(() => chart.addPane(null), /needs an id/)
  chart.destroy()
})

test('setSeries refuses an unknown pane instead of silently using the price one', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN, 24000))
  assert.throws(
    () => chart.setSeries('rsi14', { data: osc(), pane: 'rsi' }),
    /names pane "rsi", which does not exist/,
  )
  assert.equal(chart.getSeries().length, 0, 'and must not half-create it')
  chart.destroy()
})

test('removing a pane removes the series routed to it', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.addPane('rsi')
  chart.setSeries('ema', { data: osc() })
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  assert.equal(chart.getSeries().length, 2)

  chart.removePane('rsi')
  assert.deepEqual(chart.getSeries().map((s) => s.id), ['ema'], 'orphaned series must go with it')
  assert.deepEqual(chart.panes().map((p) => p.id), ['price'])
  chart.destroy()
})

test('pane() reports which series it draws', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.addPane('rsi')
  chart.setSeries('a', { data: osc() })
  chart.setSeries('b', { data: osc(), pane: 'rsi' })
  assert.deepEqual(chart.pane('price').series, ['a'])
  assert.deepEqual(chart.pane('rsi').series, ['b'])
  chart.destroy()
})

// ------------------------------------------------------- back-compatibility
test('chart.ps and chart.plot still address the price pane', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.addPane('rsi')
  frame(chart)

  assert.equal(chart.ps, chart.paneScale('price'))
  assert.deepEqual(chart.plot, chart.paneRect('price'))
  assert.equal(chart.plot.y, 0, 'the price pane is always the top band')
  chart.destroy()
})

test('adding a pane shrinks the price pane rather than overflowing', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  const full = chart.plot.h
  chart.addPane('rsi')
  assert.ok(chart.plot.h < full, 'the price pane must give up height')
  assert.ok(chart.paneRect('rsi').y >= chart.plot.h, 'and the new band sits below it')
  chart.destroy()
})

test('a pane with no series draws no axis rather than inventing one', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN, 24000))
  chart.addPane('empty')
  settle(chart); clearOps(chart); frame(chart)

  assert.equal(chart.pane('empty').primed, false)
  const labels = chart.layers.canvas.base.ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])
  assert.ok(!labels.includes('0.10'), `an unprimed pane invented an axis: ${JSON.stringify(labels)}`)
  chart.destroy()
})

test('hiding every series in a pane unprimes nothing and crashes nothing', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  settle(chart); frame(chart)
  chart.setSeriesVisible('rsi14', false)
  assert.doesNotThrow(() => { settle(chart); frame(chart) })
  chart.destroy()
})

test('destroy resets to a single pane', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.addPane('rsi')
  chart.destroy()
  assert.deepEqual(chart.panes().map((p) => p.id), ['price'])
})

test('every pane ticks even while another is already animating', () => {
  // The trap: `animating = animating || pane.ps.tick(dt)` short-circuits, so
  // once the price pane reports motion no pane below it ticks again — their
  // scales freeze mid-ease and never reach their target.
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  settle(chart)

  const rsiScale = chart.paneScale('rsi')
  let ticks = 0
  const realTick = rsiScale.tick.bind(rsiScale)
  rsiScale.tick = (dt) => { ticks++; return realTick(dt) }

  // Put the price pane into motion. Autoscale off first: endFit() runs before
  // the tick loop and would otherwise re-fit the target straight back, so the
  // pane would not be animating when the loop is reached and the test would
  // prove nothing.
  chart.ps.auto = false
  chart.ps._lo.set(chart.ps._lo.value - 500)
  assert.equal(chart.ps.tick(0), true, 'the price pane must actually be easing')
  frame(chart)

  assert.equal(ticks, 1, 'the sub-pane scale must tick on a frame the price pane is animating')
  chart.destroy()
})
