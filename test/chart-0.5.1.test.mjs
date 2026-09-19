/**
 * Regression tests for 0.5.1 — the defects the 0.5.0 correctness batch itself
 * introduced, plus the ones its tests were too weak to catch.
 *
 * Several of these drive Chart._frame through the harness's frame() helper.
 * Before 0.5.1 no test ran a frame at all, which is how 0.5.0 shipped with a
 * blank-chart regression that 27 green tests said nothing about.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, deferredFeed, frame } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart, inferTimeframe } = await import('../src/chart/index.js')
  .then(async (idx) => ({ ...idx, ...(await import('../src/chart/core/Chart.js')) }))
const { PriceScale } = await import('../src/chart/core/PriceScale.js')
const { Loop } = await import('../src/chart/core/Loop.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const SESSION_GAP = 63_900_000 // NSE 15:30 close -> 09:15 next open

function quiet(fn) {
  const real = console.error
  console.error = () => {}
  try { return fn() } finally { console.error = real }
}
const panLeft = (chart) => chart.ts.panBy(4000)

// ------------------------------------------------- string OHLC (the big one)
test('numeric-string OHLC produces a real price range, not a blank chart', () => {
  const ps = new PriceScale()
  ps.layout(0, 400)
  // What Binance, Bybit and Kraken actually return.
  ps.fit([{ low: '100.5', high: '101.2' }, { low: '99.8', high: '102.0' }], 0, 1)

  assert.equal(typeof ps.lo, 'number')
  assert.equal(typeof ps.hi, 'number')
  assert.ok(ps.lo > 95 && ps.lo < 100, `lo=${ps.lo} — bounds never left their defaults`)
  assert.ok(ps.hi > 101 && ps.hi < 107, `hi=${ps.hi}`)
  assert.ok(Number.isFinite(ps.y(101)))
})

test('a string-OHLC chart draws candles inside the plot', () => {
  const chart = createChart(makeContainer())
  chart.setData(Array.from({ length: 40 }, (_, i) => ({
    time: T0 + i * MIN,
    open: String(100 + i * 0.1), high: String(100.8 + i * 0.1),
    low: String(99.4 + i * 0.1), close: String(100.3 + i * 0.1), volume: '10',
  })))
  frame(chart)
  const y = chart.ps.y(102)
  assert.ok(Number.isFinite(y) && y > 0 && y < 400, `y(102)=${y} is off-plot`)
  chart.destroy()
})

test('null, boolean and object OHLC are still rejected', () => {
  const ps = new PriceScale()
  ps.layout(0, 400)
  ps.fit([{ low: 100, high: 110 }, { low: null, high: undefined },
          { low: true, high: [] }, { low: '', high: 'abc' }], 0, 3)
  assert.ok(ps.lo > 50, `lo=${ps.lo} — a non-price leaked in`)
  assert.ok(ps.hi < 200)
})

// --------------------------------------------------------- loop recoverable
test('the loop reports giving up through the error event and resume() revives it', () => {
  let pending = null
  const savedRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => { pending = fn; return 1 }

  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 40, MIN))
  const errors = []
  chart.subscribe('error', (e) => errors.push(e))

  let boom = true
  const real = chart._frame.bind(chart)
  chart._frame = (d, dt) => { if (boom) throw new Error('canvas context lost'); return real(d, dt) }

  quiet(() => {
    chart.loop.start()
    for (let i = 0; i < 40 && pending; i++) { const f = pending; pending = null; f(performance.now() + i * 16) }
  })

  assert.equal(chart.loop.running, false, 'must stop after the cap')
  assert.equal(errors.length, 1, 'giving up must surface as an error event')
  assert.match(errors[0].message, /context lost/)

  boom = false
  assert.equal(chart.resume(), true, 'resume() must restart a stopped loop')
  assert.equal(chart.loop.running, true)
  assert.ok(pending, 'a resumed loop must reschedule')
  assert.equal(chart.resume(), false, 'resume() on a running loop is a no-op')

  globalThis.requestAnimationFrame = savedRaf
  chart.destroy()
  assert.equal(chart.resume(), false, 'resume() after destroy must not restart anything')
})

test('start() clears the error budget so a revived loop gets a full allowance', () => {
  const loop = new Loop(() => { throw new Error('x') })
  loop._frameErrors = 9
  loop.start()
  assert.equal(loop._frameErrors, 0)
})

// ------------------------------------------------ listener errors contained
test('a throwing state listener cannot stop the chart', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 300, MIN))
  let delivered = 0
  chart.subscribe('visibleRange', () => { throw new Error('consumer bug') })
  chart.subscribe('visibleRange', () => { delivered++ })

  quiet(() => {
    for (let i = 0; i < 30; i++) { chart.ts.panBy(40); frame(chart) }
  })

  assert.ok(delivered > 0, 'a well-behaved listener must still be served')
  assert.equal(chart.loop._frameErrors, 0, 'a listener bug must not burn the frame budget')
  chart.destroy()
})

test('subscribe returns an unsubscriber even when the immediate call throws', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 50, MIN))
  let off
  quiet(() => { off = chart.subscribe('visibleRange', () => { throw new Error('boom') }) })
  assert.equal(typeof off, 'function', 'the listener would otherwise be unremovable')
  off()
  assert.equal(chart._listeners.visibleRange.size, 0)
  chart.destroy()
})

// ----------------------------------------------------------- replay + time
test('replay keeps the dataset timeframe at the cursor floor', () => {
  const chart = createChart(makeContainer())
  // A tape that OPENS across a session break: the 2-bar prefix at the cursor
  // floor spans 17.75 hours.
  chart.setData([
    { time: T0, open: 1, high: 1, low: 1, close: 1 },
    { time: T0 + SESSION_GAP, open: 1, high: 1, low: 1, close: 1 },
    ...Array.from({ length: 80 }, (_, i) => ({
      time: T0 + SESSION_GAP + (i + 1) * MIN, open: 1, high: 1, low: 1, close: 1,
    })),
  ])
  const replay = chart.startReplay({ from: 1 })
  assert.equal(chart.ts.timeframeMs, MIN, 'the prefix must not redefine the timeframe')

  replay.seek(3)
  assert.equal(chart.ts.timeframeMs, MIN, 'nor on any later scrub')
  chart.destroy()
})

test('a future marker cannot leak into playback through a widened cut-off', () => {
  const chart = createChart(makeContainer())
  chart.setData([
    { time: T0, open: 1, high: 1, low: 1, close: 1 },
    { time: T0 + SESSION_GAP, open: 1, high: 1, low: 1, close: 1 },
    ...Array.from({ length: 80 }, (_, i) => ({
      time: T0 + SESSION_GAP + (i + 1) * MIN, open: 1, high: 1, low: 1, close: 1,
    })),
  ])
  const replay = chart.startReplay({ from: 1 })
  chart.setMarkers([{ time: T0 + SESSION_GAP + 2 * 3_600_000, shape: 'arrowUp', text: 'FUTURE' }])
  frame(chart)

  const shown = replay.markerFilter(chart.getMarkers())
  assert.ok(!shown.some((m) => m.text === 'FUTURE'),
    'a replay that shows tomorrow is worse than no replay')
  chart.destroy()
})

test('inferTimeframe prefers the minimum until it has enough samples', () => {
  // Two gaps: the median IS the larger one, which is the session break.
  assert.equal(inferTimeframe([{ time: T0 }, { time: T0 + SESSION_GAP }, { time: T0 + SESSION_GAP + MIN }], 1), MIN)
  // Plenty of samples: the median is robust and the outlier is ignored.
  assert.equal(inferTimeframe([
    { time: T0 }, { time: T0 + SESSION_GAP },
    ...Array.from({ length: 60 }, (_, i) => ({ time: T0 + SESSION_GAP + (i + 1) * MIN })),
  ], 1), MIN)
})

// ------------------------------------------------------- bar ownership
test('a history page that lands after replay starts is dropped', async () => {
  const chart = createChart(makeContainer())
  const feed = deferredFeed({ symbol: 'NIFTY', timeframe: MIN })
  const p = chart.setFeed(feed)
  feed.release(0, makeBars(T0, 400, MIN))
  await p

  panLeft(chart)
  const paging = chart._maybeLoadHistory()   // asks for older bars
  chart.startReplay({ from: 100 })           // ...then replay takes the array
  const revealed = chart.bars.length

  feed.release(1, makeBars(T0 - 200 * MIN, 200, MIN))
  await paging

  assert.equal(chart.bars.length, revealed,
    'history must not splice in front of a revealed replay prefix')
  chart.destroy()
})

// ------------------------------------------------------------- feed swap
test('a rejected setFeed does not leave the previous symbol on screen', async () => {
  const chart = createChart(makeContainer())
  const good = deferredFeed({ symbol: 'RELIANCE', timeframe: MIN })
  const p = chart.setFeed(good)
  good.release(0, makeBars(T0, 200, MIN, 1200))
  await p
  assert.equal(chart.bars.length, 200)

  const errors = []
  chart.subscribe('error', (e) => errors.push(e))
  await chart.setFeed({
    symbol: 'TCS', timeframe: MIN,
    getBars: () => Promise.reject(new Error('502')),
    subscribe: () => () => {},
  })

  assert.equal(chart.bars.length, 0, 'the old symbol must not persist under the new feed')
  assert.equal(errors.length, 1)
  chart.destroy()
})

test('detachFeed clears the exhausted latch for the next feed', async () => {
  const chart = createChart(makeContainer())
  const a = deferredFeed({ symbol: 'A', timeframe: MIN })
  const p = chart.setFeed(a)
  a.release(0, makeBars(T0, 200, MIN))
  await p

  panLeft(chart)
  const paging = chart._maybeLoadHistory()
  a.release(1, [])                 // "no more history"
  await paging
  assert.equal(chart._exhausted, true)

  chart.detachFeed()
  assert.equal(chart._exhausted, false, 'a fresh feed must be allowed to page')
  chart.destroy()
})

// -------------------------------------------------------- history backoff
test('a transient history error retries, and only a persistent one latches', async () => {
  const chart = createChart(makeContainer())
  let attempts = 0
  let failing = true
  const feed = {
    symbol: 'A', timeframe: MIN,
    getBars: ({ to }) => {
      if (to == null) return Promise.resolve(makeBars(T0, 200, MIN))
      attempts++
      return failing ? Promise.reject(new Error('500')) : Promise.resolve(makeBars(T0 - 100 * MIN, 100, MIN))
    },
    subscribe: () => () => {},
  }
  await chart.setFeed(feed)
  chart.subscribe('error', () => {})

  panLeft(chart)
  await chart._maybeLoadHistory()
  assert.equal(chart._exhausted, false, 'one failure must not disable paging')

  failing = false
  panLeft(chart)
  await chart._maybeLoadHistory()
  assert.equal(chart.bars.length, 300, 'a retry must be allowed to succeed')
  assert.equal(chart._historyErrors, 0, 'success must reset the counter')

  failing = true
  for (let i = 0; i < 3; i++) { panLeft(chart); await chart._maybeLoadHistory() }
  assert.equal(chart._exhausted, true, 'a persistently dead feed must stop being asked')

  const settled = attempts
  panLeft(chart)
  await chart._maybeLoadHistory()
  assert.equal(attempts, settled, 'no further requests once latched')
  chart.destroy()
})

// ----------------------------------------------------------- marker ids
test('generated marker ids are stable across repeated setMarkers calls', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  const input = [
    { time: T0, shape: 'circle' },
    { time: T0 + MIN, shape: 'circle' },
    { time: T0, shape: 'circle' },   // a genuine duplicate
  ]
  chart.setMarkers(input)
  const first = chart.getMarkers().map((m) => m.id)
  const captured = first[0]
  chart.setMarkers(input)
  const second = chart.getMarkers().map((m) => m.id)

  assert.deepEqual(second, first, 'the same input must mint the same ids')
  assert.equal(new Set(first).size, first.length, 'ids must still be unique')

  chart.removeMarker(captured)
  assert.equal(chart.getMarkers().length, 2, 'a captured id must still remove its marker')
  chart.destroy()
})

test('addMarker does not renumber the markers already present', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.setMarkers([{ time: T0, shape: 'circle' }, { time: T0 + MIN, shape: 'flag' }])
  const before = chart.getMarkers().map((m) => m.id)
  chart.addMarker({ time: T0 + 2 * MIN, shape: 'arrowUp' })
  const after = chart.getMarkers().map((m) => m.id)
  assert.deepEqual(after.slice(0, 2), before, 'existing ids must survive an add')
  assert.equal(new Set(after).size, 3)
  chart.destroy()
})

test('replacing the marker set clears a stale hover id', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.setMarkers([{ time: T0 + 10 * MIN, shape: 'circle' }])
  chart._hoverMarkerId = chart.getMarkers()[0].id
  chart.setMarkers([{ time: T0 + 20 * MIN, shape: 'flag' }])
  assert.equal(chart._hoverMarkerId, null)
  chart.destroy()
})

// ------------------------------------------------------------------ SSR
test('both entry points import cleanly with no DOM', async () => {
  const restore = restoreDom
  restore()                                   // tear the fake DOM down
  try {
    const core = await import('../src/chart/index.js?ssr=1')
    assert.equal(typeof core.createChart, 'function')
    const wc = await import('../src/adapters/webcomponent/index.js?ssr=1')
    assert.equal(typeof wc.register, 'function')
  } finally {
    restoreDom = installDom()                 // put it back for the rest of the file
  }
})

// -------------------------------------------- the frame path itself runs
test('a frame resolves marker indices and fits the price scale', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN))
  chart.setMarkers([{ time: T0 + 50 * MIN, shape: 'arrowUp' }])

  assert.equal(chart.getMarkers()[0].index, -1, 'unresolved before any frame')
  frame(chart)
  assert.equal(chart.getMarkers()[0].index, 50, 'the frame must resolve it')
  assert.ok(chart.ps.lo < 100 && chart.ps.hi > 100, 'and fit the scale to the bars')
  chart.destroy()
})

// ---------------------------------------------- gaps the mutation run found
test('every listener receives every distinct state, not just the first one served', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 400, MIN))

  const a = []
  const b = []
  chart.subscribe('visibleRange', (p) => a.push(`${p.from}:${p.to}`))
  chart.subscribe('visibleRange', (p) => b.push(`${p.from}:${p.to}`))

  for (let i = 0; i < 12; i++) {
    chart.ts.panBy(120)
    const r = chart.ts.visibleRange()
    chart._emitVisibleRange(r.from, r.to)
  }

  // A shared dedupe key serves whichever listener the loop reaches first and
  // silently skips the rest, so the two logs diverge.
  assert.deepEqual(b, a, 'both listeners must see the same sequence of states')
  assert.ok(a.length > 1, 'the window must actually have moved')
  chart.destroy()
})

test('inferTimeframe samples the middle, not the opening bars', () => {
  const DAY = 86_400_000
  // 250 daily bars, then 1000 minute bars. Sampling the opening gaps sees only
  // days; the middle window sits entirely in the minute region.
  const bars = [
    ...Array.from({ length: 250 }, (_, i) => ({ time: T0 + i * DAY })),
    ...Array.from({ length: 1000 }, (_, i) => ({ time: T0 + 250 * DAY + (i + 1) * MIN })),
  ]
  assert.equal(inferTimeframe(bars, 1), MIN,
    'reading only the opening gaps infers the wrong cadence')
})

test('a detached replay controller cannot swap bars even through internals', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  const first = chart.startReplay({ from: 20 })
  chart.startReplay({ from: 80 })

  const before = chart.bars.length
  // Reach past the transport guards straight at the one method that mutates
  // the chart — defence in depth is only depth if the inner layer holds.
  first._apply('seek')
  assert.equal(chart.bars.length, before, 'a detached controller must not reach the bars')
  chart.destroy()
})

test('replay trusts its own timeframe, not whatever the scale currently holds', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN))
  const replay = chart.startReplay({ from: 100 })

  // Something else corrupts the scale's idea of the timeframe.
  chart.ts.timeframeMs = SESSION_GAP
  chart.setMarkers([{ time: chart.bars[chart.bars.length - 1].time + 30 * MIN, shape: 'arrowUp', text: 'FUTURE' }])
  frame(chart)

  const shown = replay.markerFilter(chart.getMarkers())
  assert.ok(!shown.some((m) => m.text === 'FUTURE'),
    'a corrupted scale timeframe must not widen the future cut-off')
  chart.destroy()
})
