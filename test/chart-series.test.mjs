/**
 * Line series — the drawing primitive behind indicator overlays and equity
 * curves. The subtle part is gap handling: a missing value must lift the pen,
 * never read as zero.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps, drawnValues } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { normalizeSeriesPoints, resolveSeriesPoints, seriesExtent, lowerBound } =
  await import('../src/chart/overlays/series.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const at = (i) => T0 + i * MIN

const opsOn = (chart, layer, op) => chart.layers.canvas[layer].ops.filter((o) => o.op === op)
const line = (n, fn = (i) => 100 + i * 0.1) => Array.from({ length: n }, (_, i) => ({ time: at(i), value: fn(i) }))

// ----------------------------------------------------------- normalisation
test('points are sorted by time and numeric strings are values', () => {
  const pts = normalizeSeriesPoints([
    { time: at(2), value: '102.5' },
    { time: at(0), value: 100 },
    { time: at(1), value: 101 },
  ])
  assert.deepEqual(pts.map((p) => p.time), [at(0), at(1), at(2)])
  assert.deepEqual(pts.map((p) => p.value), [100, 101, 102.5])
})

test('a missing value is a gap, never a zero', () => {
  const pts = normalizeSeriesPoints([
    { time: at(0), value: 100 },
    { time: at(1) },                 // the shape the engine emits for a gap
    { time: at(2), value: null },
    { time: at(3), value: 'n/a' },
    { time: at(4), value: 103 },
  ])
  assert.equal(pts.length, 5, 'gap points are kept — they carry the break')
  assert.ok(Number.isNaN(pts[1].value))
  assert.ok(Number.isNaN(pts[2].value))
  assert.ok(Number.isNaN(pts[3].value))
  assert.ok(!pts.some((p) => p.value === 0), 'nothing may be coerced to zero')
})

test('points with an unusable time are dropped entirely', () => {
  const pts = normalizeSeriesPoints([
    { time: at(0), value: 1 }, { time: null, value: 2 }, { value: 3 }, null, { time: 'x', value: 4 },
  ])
  assert.equal(pts.length, 1)
})

// ------------------------------------------------------------- resolution
test('points outside the loaded range resolve to -1 rather than clamping', () => {
  const bars = makeBars(T0, 100, MIN)
  const pts = normalizeSeriesPoints([
    { time: T0 - 400 * MIN, value: 1 },  // long before
    { time: T0 - MIN / 4, value: 2 },    // just before bar 0, within tolerance
    { time: at(50), value: 3 },
    { time: at(5000), value: 4 },        // long after
  ])
  const drawable = resolveSeriesPoints(pts, bars, MIN)

  assert.equal(pts[0].index, -1, 'a point from before the window is not an event at the left edge')
  assert.equal(pts[1].index, 0, 'within one timeframe still snaps')
  assert.equal(pts[2].index, 50)
  assert.equal(pts[3].index, -1)
  assert.equal(drawable.length, 2, 'only resolvable points are drawable')
})

test('extent covers the visible window only, and ignores gaps', () => {
  const bars = makeBars(T0, 100, MIN)
  const pts = normalizeSeriesPoints([
    { time: at(1), value: 999 },     // outside the window under test
    { time: at(10), value: 50 },
    { time: at(20) },                // gap
    { time: at(30), value: 150 },
    { time: at(90), value: -999 },   // outside
  ])
  const drawable = resolveSeriesPoints(pts, bars, MIN)
  const ext = seriesExtent(drawable, 5, 40)
  assert.deepEqual(ext, { min: 50, max: 150 })
})

test('extent is empty when the window holds nothing plottable', () => {
  const bars = makeBars(T0, 100, MIN)
  const drawable = resolveSeriesPoints(normalizeSeriesPoints([{ time: at(10) }]), bars, MIN)
  const ext = seriesExtent(drawable, 0, 50)
  assert.equal(isFinite(ext.min), false, 'a window of only gaps must not claim a range')
})

test('lowerBound finds the first index at or after the target', () => {
  const bars = makeBars(T0, 100, MIN)
  const drawable = resolveSeriesPoints(normalizeSeriesPoints(line(100)), bars, MIN)
  assert.equal(lowerBound(drawable, 0), 0)
  assert.equal(drawable[lowerBound(drawable, 42)].index, 42)
  assert.equal(lowerBound(drawable, 999), drawable.length)
})

// -------------------------------------------------------------- chart API
test('a series is created, updated in place, and removed by id', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))

  chart.setSeries('ema20', { data: line(100), color: '#c084fc', title: 'EMA 20' })
  chart.setSeries('sma50', { data: line(100), color: '#38bdf8' })
  assert.deepEqual(chart.getSeries().map((s) => s.id), ['ema20', 'sma50'], 'insertion order is draw order')
  assert.equal(chart.getSeries()[0].color, '#c084fc')
  assert.equal(chart.getSeries()[0].title, 'EMA 20', 'title is passthrough metadata')

  chart.setSeries('ema20', { color: '#ff0000' })
  assert.equal(chart.getSeries().length, 2, 'same id updates in place')
  assert.equal(chart.getSeries()[0].color, '#ff0000')

  chart.removeSeries('ema20')
  assert.deepEqual(chart.getSeries().map((s) => s.id), ['sma50'])
  chart.clearSeries()
  assert.equal(chart.getSeries().length, 0)
  chart.destroy()
})

test('setSeries without data leaves the existing points alone', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.setSeries('x', { data: line(100), color: '#0f0' })
  settle(chart); clearOps(chart); frame(chart)
  const before = opsOn(chart, 'main', 'lineTo').length

  chart.setSeries('x', { color: '#00f' })   // presentation only
  settle(chart); clearOps(chart); frame(chart)
  assert.equal(opsOn(chart, 'main', 'lineTo').length, before, 'the line must survive an options-only update')
  chart.destroy()
})

test('operations on an unknown id are no-ops, not throws', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 50, MIN))
  assert.doesNotThrow(() => {
    chart.setSeriesData('nope', line(10))
    chart.setSeriesVisible('nope', false)
    chart.removeSeries('nope')
  })
  assert.throws(() => chart.setSeries(null, {}), /needs an id/)
  chart.destroy()
})

// --------------------------------------------------------------- drawing
test('a series is stroked in its own colour', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.setSeries('ema', { data: line(100), color: '#c084fc' })
  clearOps(chart); frame(chart)

  assert.ok(drawnValues(chart, 'main', 'strokeStyle').includes('#c084fc'))
  assert.ok(opsOn(chart, 'main', 'lineTo').length > 5, 'a polyline must actually be drawn')
  chart.destroy()
})

test('a gap lifts the pen instead of joining across it', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 60, MIN))

  const solid = line(60)
  chart.setSeries('s', { data: solid, color: '#0f0' })
  settle(chart); clearOps(chart); frame(chart)
  const movesWithout = opsOn(chart, 'main', 'moveTo').length

  const broken = solid.map((p, i) => (i === 30 ? { time: p.time } : p))
  chart.setSeriesData('s', broken)
  settle(chart); clearOps(chart); frame(chart)
  const movesWith = opsOn(chart, 'main', 'moveTo').length

  assert.equal(movesWith - movesWithout, 1,
    'a gap must start exactly one new sub-path, not interpolate across')
  chart.destroy()
})

test('a series is clipped to the plot rather than painting over the axes', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 60, MIN))
  chart.setSeries('equity', { data: line(60, () => 200000), color: '#0f0' })
  clearOps(chart); frame(chart)
  assert.ok(opsOn(chart, 'main', 'clip').length > 0,
    'an equity curve against a price scale maps millions of px off-plot')
  chart.destroy()
})

test('stepped draws corners instead of diagonals', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 60, MIN))
  const data = line(60)

  chart.setSeries('s', { data, color: '#0f0' })
  settle(chart); clearOps(chart); frame(chart)
  const smooth = opsOn(chart, 'main', 'lineTo').length

  chart.setSeries('s', { data, color: '#0f0', stepped: true })
  settle(chart); clearOps(chart); frame(chart)
  assert.ok(opsOn(chart, 'main', 'lineTo').length > smooth, 'each step is two segments')
  chart.destroy()
})

test('a hidden series is neither drawn nor autoscaled', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN))
  settle(chart)
  const { to } = chart.ts.visibleRange()
  const candlesOnly = { lo: chart.ps.lo, hi: chart.ps.hi }

  chart.setSeries('band', { data: [{ time: at(to - 3), value: 140 }], color: '#f00' })
  settle(chart); frame(chart)
  assert.ok(chart.ps.hi > 130, 'a visible series must widen the range')

  chart.setSeriesVisible('band', false)
  settle(chart); clearOps(chart); frame(chart)
  assert.ok(Math.abs(chart.ps.hi - candlesOnly.hi) < 0.01, 'hiding must exclude it again')
  assert.ok(!drawnValues(chart, 'main', 'strokeStyle').includes('#f00'))
  chart.destroy()
})

test('series indices re-resolve when the bar array changes', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.setSeries('s', { data: line(100), color: '#0f0' })
  frame(chart)
  const entry = chart._series.get('s')
  assert.equal(entry.drawable[0].index, 0)

  // A different window: every index must move.
  chart.setData(makeBars(T0 - 50 * MIN, 150, MIN))
  frame(chart)
  assert.equal(entry.drawable[0].index, 50, 'stale indices would draw the line in the wrong place')
  chart.destroy()
})

test('destroy drops the series registry', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 50, MIN))
  chart.setSeries('s', { data: line(50) })
  chart.destroy()
  assert.equal(chart.getSeries().length, 0)
})

test('a null or unusable marker time is rejected, not placed at the epoch', async () => {
  const { normalizeMarkers } = await import('../src/chart/overlays/annotations.js')
  const out = normalizeMarkers([
    { time: at(5), shape: 'circle' },
    { time: null, shape: 'circle' },
    { shape: 'circle' },
    { time: 'nope', shape: 'circle' },
  ])
  assert.equal(out.length, 1, 'isFinite(null) is true — the guard has to coerce')
  assert.equal(out[0].time, at(5))
})
