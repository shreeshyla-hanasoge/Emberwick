/**
 * 0.6.0 — the surface matches the docs.
 *
 * Each case here pins a place where the advertised behaviour and the shipped
 * behaviour disagreed.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, deferredFeed, frame, drawnValues, clearOps, setDevicePixelRatio } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { TimeScale } = await import('../src/chart/core/TimeScale.js')
const { planDataUpdate } = await import('../src/adapters/react/dataPlan.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

const settle = (ts, n = 500) => { for (let i = 0; i < n; i++) ts.tick(16) }
function scale({ live = false, bars = 500, width = 900 } = {}) {
  const ts = new TimeScale()
  ts.resize(width)
  ts.setBarCount(bars)
  ts.live = live
  settle(ts)
  return ts
}
/** Bars the point under `x` moved by, across a zoom. 0 means cursor-anchored. */
function driftAt(ts, x, factor) {
  const before = ts.index(x)
  ts.zoomAt(x, factor)
  settle(ts)
  return ts.index(x) - before
}

// ------------------------------------------------------------ zoom anchor
test('wheel zoom is cursor-anchored on a static chart, even before any pan', () => {
  // README advertises cursor-anchored zoom unconditionally. A chart with no
  // feed follows realtime from the moment setData() snaps it there, so the
  // right-edge override used to apply to every fresh chart.
  const ts = scale({ live: false })
  assert.equal(ts.follow, true, 'a fresh chart does follow — that is the case under test')
  const drift = driftAt(ts, 200, 1.5)
  assert.ok(Math.abs(drift) < 0.01, `zoom moved the targeted bar by ${drift.toFixed(2)} bars`)
})

test('a live chart following realtime still pins the right edge', () => {
  // The override exists to stop the newest candle sliding away under a live
  // feed. That is worth keeping — just not on charts with no feed.
  const ts = scale({ live: true })
  const rightBefore = ts.index(ts.width)
  ts.zoomAt(200, 1.5)
  settle(ts)
  assert.ok(Math.abs(ts.index(ts.width) - rightBefore) < 0.01,
    'the newest bar must stay put while following a live feed')
})

test('a live chart the user has panned zooms on the cursor', () => {
  const ts = scale({ live: true })
  ts.panBy(300)
  settle(ts)
  assert.equal(ts.follow, false)
  const drift = driftAt(ts, 200, 1.5)
  assert.ok(Math.abs(drift) < 0.01, `drifted ${drift.toFixed(2)} bars once following was cleared`)
})

test('keyboard zoom is anchored on the centre of the plot', () => {
  const ts = scale({ live: false })
  const mid = ts.width / 2
  const drift = driftAt(ts, mid, 1.2)
  assert.ok(Math.abs(drift) < 0.01, `centre moved by ${drift.toFixed(2)} bars`)
})

test('attaching and detaching a feed drives the live flag', async () => {
  const chart = createChart(makeContainer())
  assert.equal(chart.ts.live, false, 'a chart with no feed is not live')

  const feed = deferredFeed({ symbol: 'A', timeframe: MIN })
  const p = chart.setFeed(feed)
  feed.release(0, makeBars(T0, 200, MIN))
  await p
  assert.equal(chart.ts.live, true, 'an attached feed makes it live')

  chart.detachFeed()
  assert.equal(chart.ts.live, false, 'detaching must clear it, or a static chart keeps the lock')
  chart.destroy()
})

test('a replay is not treated as live', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN))
  chart.startReplay({ from: 100 })
  frame(chart)
  assert.equal(chart.ts.live, false,
    'replay reveals a fixed dataset — the user should be able to zoom where they point')
  chart.destroy()
})

// ------------------------------------------------------------- theme fills
test('a theme that only sets `up` still colours the candle bodies', () => {
  // The regression to avoid: making the body read upFill without a fallback
  // silently reverts every theme that colours via `up` to the default teal.
  const chart = createChart(makeContainer(), { theme: { up: '#00ff00', down: '#ff0000' } })
  chart.setData(makeBars(T0, 30, MIN))
  clearOps(chart)
  frame(chart)

  const fills = drawnValues(chart, 'main', 'fillStyle')
  // Count, don't just look: the price tag writes theme.up too, so `includes`
  // stays true even when every candle body has gone undefined.
  const upWrites = fills.filter((f) => f === '#00ff00').length
  assert.ok(upWrites > 5,
    `only ${upWrites} fills used theme.up — bodies fell back to nothing. ` +
    `saw ${JSON.stringify([...new Set(fills)])}`)
  assert.ok(!fills.includes(undefined), 'no body may be filled with undefined')
  chart.destroy()
})

test('upFill overrides the body without touching the last-price line', () => {
  const chart = createChart(makeContainer(), {
    theme: { up: '#00ff00', down: '#ff0000', upFill: '#0000ff', downFill: '#ffff00' },
  })
  chart.setData(makeBars(T0, 30, MIN))
  clearOps(chart)
  frame(chart)

  const fills = drawnValues(chart, 'main', 'fillStyle')
  const strokes = drawnValues(chart, 'main', 'strokeStyle')
  const count = (v) => fills.filter((f) => f === v).length

  // One fillStyle write per candle body, so the override should dominate.
  assert.ok(count('#0000ff') > 5, `only ${count('#0000ff')} bodies used upFill`)
  // theme.up legitimately survives as the price-tag fill — exactly one write.
  // Counting rather than checking presence is what separates "the body still
  // uses theme.up" from "the tag does, as designed".
  assert.equal(count('#00ff00'), 1, 'theme.up should remain only as the price tag')
  assert.ok(strokes.includes('#00ff00'),
    'the last-price line must stay on theme.up — that is the point of a separate key')
  chart.destroy()
})

test('the built-in themes no longer ship dead fill keys', async () => {
  const { defaultTheme, lightTheme } = await import('../src/chart/core/palette.js')
  for (const [name, t] of [['defaultTheme', defaultTheme], ['lightTheme', lightTheme]]) {
    assert.equal('upFill' in t, false, `${name} still declares upFill`)
    assert.equal('downFill' in t, false, `${name} still declares downFill`)
  }
})

// --------------------------------------------------------- pixel ratio
test('a devicePixelRatio change re-measures the canvases', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 40, MIN))
  const canvas = chart.layers.canvas.main
  const widthAt1x = canvas.width
  assert.equal(chart.layers.dpr, 1)

  // Same CSS size, different ratio — ResizeObserver never fires for this.
  setDevicePixelRatio(2)

  assert.equal(chart.layers.dpr, 2, 'the ratio change must be noticed')
  assert.equal(canvas.width, widthAt1x * 2, 'the backing store must be reallocated')
  chart.destroy()
})

test('the dpr watcher re-arms, so a second change is caught too', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 40, MIN))
  setDevicePixelRatio(2)
  setDevicePixelRatio(1)
  assert.equal(chart.layers.dpr, 1, 'a resolution query stops matching once it fires')
  chart.destroy()
})

test('destroy stops watching the pixel ratio', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 40, MIN))
  chart.destroy()
  assert.doesNotThrow(() => setDevicePixelRatio(3),
    'a destroyed chart must not still be measuring')
})

test('resize() is a no-op on a destroyed chart', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 40, MIN))
  assert.doesNotThrow(() => chart.resize())
  chart.destroy()
  assert.doesNotThrow(() => chart.resize())
})

// ------------------------------------------------- framework data planning
test('identical bars behind a new array identity are not re-applied', () => {
  const bars = makeBars(T0, 100, MIN)
  const first = planDataUpdate(null, bars)
  assert.equal(first.action, 'replace', 'the first application must set the data')

  // What React hands a wrapper on every parent render.
  const again = planDataUpdate(first.next, bars.slice())
  assert.equal(again.action, 'none',
    're-applying identical content would re-anchor and lose the pan/zoom')
})

test('a moved forming candle updates instead of replacing', () => {
  const bars = makeBars(T0, 100, MIN)
  const applied = planDataUpdate(null, bars).next
  const ticked = bars.slice()
  ticked[ticked.length - 1] = { ...ticked[ticked.length - 1], close: 999 }

  const plan = planDataUpdate(applied, ticked)
  assert.equal(plan.action, 'update')
})

test('bars appended to the same history append rather than re-anchor', () => {
  const bars = makeBars(T0, 100, MIN)
  const applied = planDataUpdate(null, bars).next
  const extended = bars.concat(makeBars(T0 + 100 * MIN, 3, MIN))

  const plan = planDataUpdate(applied, extended)
  assert.equal(plan.action, 'append')
  assert.equal(plan.from, 100, 'only the new bars should be appended')
})

test('a genuinely different dataset replaces', () => {
  const applied = planDataUpdate(null, makeBars(T0, 100, MIN)).next
  for (const [label, bars] of [
    ['a different symbol / start time', makeBars(T0 + 500 * MIN, 100, MIN)],
    ['history prepended', makeBars(T0 - 50 * MIN, 150, MIN)],
    ['a shorter window', makeBars(T0, 40, MIN)],
  ]) {
    assert.equal(planDataUpdate(applied, bars).action, 'replace', label)
  }
})

test('empty or absent data leaves the chart alone', () => {
  const applied = planDataUpdate(null, makeBars(T0, 10, MIN)).next
  for (const empty of [[], null, undefined]) {
    const plan = planDataUpdate(applied, empty)
    assert.equal(plan.action, 'none')
    assert.equal(plan.next, applied, 'and must not forget what was applied')
  }
})

test('the planned actions keep the viewport where the user put it', () => {
  // The end-to-end property, on the real chart: the actions this plan chooses
  // must not re-anchor, while the one it rejects does.
  const chart = createChart(makeContainer())
  const bars = makeBars(T0, 300, MIN)
  chart.setData(bars)
  frame(chart)
  chart.ts.panBy(500)
  frame(chart)
  const parked = chart.ts.visibleRange()

  const applied = planDataUpdate(null, bars).next
  assert.equal(planDataUpdate(applied, bars.slice()).action, 'none')
  frame(chart)
  assert.deepEqual(
    { from: chart.ts.visibleRange().from, to: chart.ts.visibleRange().to },
    { from: parked.from, to: parked.to },
    'doing nothing must leave the view untouched',
  )

  // And the thing we are protecting against really does move it.
  chart.setData(bars.slice())
  frame(chart)
  assert.notEqual(chart.ts.visibleRange().to, parked.to,
    'setData re-anchors — which is exactly why identity-keyed re-application hurt')
  chart.destroy()
})

// ------------------------------------------------- newly documented surface
test('markers, priceLines and zones can be supplied to createChart', () => {
  // Implemented and typed since annotations landed, but undocumented until
  // 0.6.1 — and therefore never exercised.
  const chart = createChart(makeContainer(), {
    markers: [{ time: T0 + 10 * MIN, shape: 'arrowUp', text: 'BUY' }],
    priceLines: [{ price: 100.5, title: 'target' }],
    zones: [{ from: 99, to: 101, label: 'value area' }],
  })
  chart.setData(makeBars(T0, 100, MIN))
  frame(chart)

  assert.equal(chart.getMarkers().length, 1, 'constructor markers must be normalised')
  assert.equal(chart.getMarkers()[0].index, 10, 'and resolved like any other')
  assert.equal(chart.priceLines.length, 1)
  assert.equal(chart.zones.length, 1)
  chart.destroy()
})

test('getMarkers() index is -1 until a frame has run, as documented', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.setMarkers([{ time: T0 + 20 * MIN, shape: 'circle' }])

  assert.equal(chart.getMarkers()[0].index, -1,
    'resolution happens in the frame, not in setMarkers')
  frame(chart)
  assert.equal(chart.getMarkers()[0].index, 20)
  chart.destroy()
})

test('double-click resets zoom and autoscale, not just the scroll position', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 300, MIN))
  frame(chart)

  const defaultSpacing = chart.ts.spacing
  chart.ts.zoomAt(200, 3)
  chart.ps.scaleBy(2)          // manual price scaling clears auto
  for (let i = 0; i < 400; i++) { chart.ts.tick(16); chart.ps.tick(16) }
  assert.notEqual(chart.ts.spacing, defaultSpacing)
  assert.equal(chart.ps.auto, false)

  chart._onDbl()
  for (let i = 0; i < 400; i++) { chart.ts.tick(16); chart.ps.tick(16) }

  assert.ok(Math.abs(chart.ts.spacing - defaultSpacing) < 0.01, 'zoom must return to default')
  assert.equal(chart.ps.auto, true, 'and the price scale must resume autoscaling')
  assert.equal(chart.ts.follow, true)
  chart.destroy()
})
