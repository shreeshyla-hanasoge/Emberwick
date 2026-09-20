/**
 * Free panning: a drag in the plot moves BOTH axes.
 *
 * Before this the plot drag read dx and threw dy away, so the price axis could
 * be stretched from its gutter but never moved. Seeing what sat just above the
 * high meant widening the whole range and shrinking every candle to get there.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const osc = (n) => Array.from({ length: n }, (_, i) => ({ time: T0 + i * MIN, value: 50 + 40 * Math.sin(i / 12) }))

/** One pointer gesture, in CSS px. The container stub puts the origin at 0,0. */
function drag(chart, from, to, id = 1) {
  chart._onDown({ pointerId: id, clientX: from.x, clientY: from.y })
  chart._onMove({ pointerId: id, clientX: to.x, clientY: to.y })
  chart._onUp({ pointerId: id, clientX: to.x, clientY: to.y })
}

const charted = () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  settle(chart); frame(chart)
  return chart
}

const withOscillator = () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(2000), pane: 'rsi' })
  settle(chart); frame(chart)
  return chart
}

// ------------------------------------------------------------------ panning

test('dragging the plot down carries the price range up with the finger', () => {
  const chart = charted()
  const before = { lo: chart.ps.lo, hi: chart.ps.hi }

  drag(chart, { x: 400, y: 150 }, { x: 400, y: 250 })

  // Down-drag => content follows the finger down => the range shown moves UP.
  assert.ok(chart.ps.lo > before.lo, 'low edge rose')
  assert.ok(chart.ps.hi > before.hi, 'high edge rose')
  // A translation, not a stretch: the span is preserved.
  assert.ok(
    Math.abs((chart.ps.hi - chart.ps.lo) - (before.hi - before.lo)) < 1e-6,
    'the span is unchanged',
  )
})

test('a pan tracks the pointer exactly — the price under it does not move', () => {
  const chart = charted()
  const priceUnderPointer = chart.ps.price(150)

  drag(chart, { x: 400, y: 150 }, { x: 400, y: 230 })

  // The grabbed price should now sit where the finger ended.
  assert.ok(Math.abs(chart.ps.y(priceUnderPointer) - 230) < 0.5,
    `grabbed price rendered at ${chart.ps.y(priceUnderPointer)}, expected ~230`)
})

test('panning still moves the time scale, so the gesture is free in both axes', () => {
  const chart = charted()
  const before = chart.ts.right

  drag(chart, { x: 600, y: 150 }, { x: 400, y: 250 })

  assert.notEqual(chart.ts.right, before, 'the time scale moved too')
  assert.ok(chart.ps.lo > 0, 'and the price scale is on a real range')
})

test('a pan clears autoscale, so new data cannot yank the view back', () => {
  const chart = charted()
  assert.equal(chart.ps.auto, true, 'autoscaled before the drag')
  drag(chart, { x: 400, y: 150 }, { x: 400, y: 250 })
  assert.equal(chart.ps.auto, false, 'manual after it')
})

test('a purely horizontal drag leaves the price range exactly where it was', () => {
  const chart = charted()
  const before = { lo: chart.ps.lo, hi: chart.ps.hi, auto: chart.ps.auto }

  drag(chart, { x: 600, y: 150 }, { x: 400, y: 150 })

  assert.equal(chart.ps.lo, before.lo)
  assert.equal(chart.ps.hi, before.hi)
  // dy of 0 must not silently drop the chart out of autoscale.
  assert.equal(chart.ps.auto, before.auto, 'autoscale survives a flat drag')
})

test('panning inside an oscillator moves THAT pane, not the price pane', () => {
  const chart = withOscillator()
  const rsi = chart.paneRect('rsi')
  const priceBefore = { lo: chart.paneScale('price').lo, hi: chart.paneScale('price').hi }
  const rsiBefore = { lo: chart.paneScale('rsi').lo, hi: chart.paneScale('rsi').hi }

  drag(chart, { x: 400, y: rsi.y + 20 }, { x: 400, y: rsi.y + 60 })

  assert.ok(chart.paneScale('rsi').lo > rsiBefore.lo, 'the oscillator moved')
  assert.equal(chart.paneScale('price').lo, priceBefore.lo, 'the price pane did not')
  assert.equal(chart.paneScale('price').hi, priceBefore.hi)
})

// --------------------------------------------------------- double-click reset

test('double-clicking the price gutter restores autoscale without touching time', () => {
  const chart = charted()
  drag(chart, { x: 400, y: 150 }, { x: 400, y: 250 })
  chart.ts.panBy(80)
  const timeAfterPan = chart.ts.right
  assert.equal(chart.ps.auto, false)

  const gutter = chart.plot.w + 10
  chart._onDbl({ clientX: gutter, clientY: 150 })

  assert.equal(chart.ps.auto, true, 'price autoscale restored')
  assert.equal(chart.ts.right, timeAfterPan, 'the time scale was left alone')
})

test('double-clicking the time axis resets time without touching the price axis', () => {
  const chart = charted()
  drag(chart, { x: 400, y: 150 }, { x: 400, y: 250 })
  assert.equal(chart.ps.auto, false)

  const last = chart.paneRect('price')
  chart._onDbl({ clientX: 400, clientY: last.y + last.h + 10 })

  assert.equal(chart.ps.auto, false, 'the price axis kept the reader\'s pan')
})

test('double-clicking the plot still resets both, as it always has', () => {
  const chart = charted()
  drag(chart, { x: 400, y: 150 }, { x: 400, y: 250 })
  assert.equal(chart.ps.auto, false)

  chart._onDbl({ clientX: 400, clientY: 150 })

  assert.equal(chart.ps.auto, true, 'price reset')
})

test('the gutter beside an oscillator resets THAT pane only', () => {
  const chart = withOscillator()
  const rsi = chart.paneRect('rsi')
  const price = chart.paneRect('price')
  // Take both panes out of autoscale.
  drag(chart, { x: 400, y: price.y + 20 }, { x: 400, y: price.y + 60 })
  drag(chart, { x: 400, y: rsi.y + 10 }, { x: 400, y: rsi.y + 40 }, 2)
  assert.equal(chart.paneScale('price').auto, false)
  assert.equal(chart.paneScale('rsi').auto, false)

  chart._onDbl({ clientX: chart.plot.w + 10, clientY: rsi.y + 20 })

  assert.equal(chart.paneScale('rsi').auto, true, 'the pane pointed at reset')
  assert.equal(chart.paneScale('price').auto, false, 'the other pane did not')
})

// ------------------------------------------------------------------- log mode

test('a log-mode pan moves by a constant ratio, so it still tracks the pointer', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  chart.setPriceMode('log')
  settle(chart); frame(chart)

  const grabbed = chart.ps.price(160)
  drag(chart, { x: 400, y: 160 }, { x: 400, y: 240 })

  assert.ok(Math.abs(chart.ps.y(grabbed) - 240) < 0.5,
    `grabbed price rendered at ${chart.ps.y(grabbed)}, expected ~240`)
})

// ---------------------------------------------------- the page steals the drag

/**
 * On touch, Traed sets `touch-action: pan-y` on the inline chart so the READER
 * can still scroll the page past it. The browser delivers the first few
 * pointermoves anyway and only then decides the gesture is a scroll, firing
 * pointercancel. Without an undo, every scroll past the chart would nudge it
 * and leave it out of autoscale permanently.
 */
test('a gesture the browser cancels leaves no trace of its vertical pan', () => {
  const chart = charted()
  const before = { lo: chart.ps.lo, hi: chart.ps.hi, auto: chart.ps.auto }
  assert.equal(before.auto, true)

  chart._onDown({ pointerId: 1, clientX: 400, clientY: 150 })
  chart._onMove({ pointerId: 1, clientX: 402, clientY: 158 })
  chart._onMove({ pointerId: 1, clientX: 403, clientY: 171 })
  chart._onCancel({ pointerId: 1, clientX: 403, clientY: 171 })

  assert.equal(chart.ps.auto, true, 'autoscale survived the stolen gesture')
  assert.ok(Math.abs(chart.ps.lo - before.lo) < 1e-6, 'low edge restored')
  assert.ok(Math.abs(chart.ps.hi - before.hi) < 1e-6, 'high edge restored')
})

test('a gesture cancelled on a pane the reader had already panned keeps that pan', () => {
  // Only THIS gesture is unwound. A manual range the reader set earlier is
  // theirs, and autoscale must not come back on and swallow it.
  const chart = charted()
  drag(chart, { x: 400, y: 150 }, { x: 400, y: 250 })
  const settled = { lo: chart.ps.lo, hi: chart.ps.hi }
  assert.equal(chart.ps.auto, false)

  chart._onDown({ pointerId: 2, clientX: 400, clientY: 150 })
  chart._onMove({ pointerId: 2, clientX: 401, clientY: 162 })
  chart._onCancel({ pointerId: 2, clientX: 401, clientY: 162 })

  assert.equal(chart.ps.auto, false, 'still manual, as the reader left it')
  assert.ok(Math.abs(chart.ps.lo - settled.lo) < 1e-6, 'their pan is intact')
})

// --------------------------------------- a manual window and a new dataset

test('replacing the bars with a range the manual window cannot see restores autoscale', () => {
  const chart = charted()
  drag(chart, { x: 400, y: 150 }, { x: 400, y: 250 })
  assert.equal(chart.ps.auto, false)

  chart.setData(makeBars(T0, 500, MIN, 150))
  settle(chart); frame(chart)

  assert.equal(chart.ps.auto, true, 'autoscale came back')
  assert.ok(chart.ps.lo < 150 && 150 < chart.ps.hi,
    `the new bars are visible (${chart.ps.lo}..${chart.ps.hi})`)
})

test('replacing the bars with the SAME data leaves the reader\'s pan alone', () => {
  // Toggling a series re-sends the same bars. Resetting here would throw away
  // the window the reader chose every time they ticked a checkbox.
  const chart = charted()
  drag(chart, { x: 400, y: 150 }, { x: 400, y: 250 })
  const panned = { lo: chart.ps.lo, hi: chart.ps.hi }
  assert.equal(chart.ps.auto, false)

  chart.setData(makeBars(T0, 2000, MIN, 24000))
  settle(chart); frame(chart)

  assert.equal(chart.ps.auto, false, 'still the reader\'s window')
  assert.ok(Math.abs(chart.ps.lo - panned.lo) < 1e-6)
})
