/**
 * Regression tests for the three feed-lifecycle defects fixed in 0.4.1.
 *
 * All three are races across an `await`, so they are invisible to a render
 * test and were originally found by driving the real modules under Node —
 * which is exactly what this file does. No jsdom, no browser, no frames.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, deferredFeed } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { TimeScale } = await import('../src/chart/core/TimeScale.js')

const T0 = 1_700_000_000_000
const TF = 60_000

/** Pan far enough left that the <=80-bar paging threshold is satisfied. */
const panToLeftEdge = (chart) => chart.ts.panBy(4000)

// ---------------------------------------------------------------- finding 1
test('a slow setFeed resolving after a newer one does not overwrite its bars', async () => {
  const chart = createChart(makeContainer())
  const reliance = deferredFeed({ symbol: 'RELIANCE', timeframe: TF })
  const tcs = deferredFeed({ symbol: 'TCS', timeframe: TF })

  const slow = chart.setFeed(reliance)
  const fast = chart.setFeed(tcs)

  // TCS answers first, RELIANCE second — the out-of-order case.
  tcs.release(0, makeBars(T0, 200, TF, 3900))
  await fast
  reliance.release(0, makeBars(T0, 500, TF, 1200))
  await slow

  assert.equal(chart.feed, tcs, 'feed must still be the newest one')
  assert.equal(chart.bars.length, 200, 'stale page must not replace the bars')
  assert.equal(chart.bars[0].close, 3900, 'bars must belong to TCS')
  assert.equal(reliance.subscribed, false, 'stale feed must never subscribe')
  assert.equal(tcs.subscribed, true, 'the live feed must stay subscribed')

  chart.destroy()
})

test('a stale subscription cannot write into the forming candle', async () => {
  const chart = createChart(makeContainer())
  const a = deferredFeed({ symbol: 'A', timeframe: TF })
  const b = deferredFeed({ symbol: 'B', timeframe: TF })

  const pa = chart.setFeed(a)
  a.release(0, makeBars(T0, 100, TF, 100))
  await pa

  const pb = chart.setFeed(b)
  b.release(0, makeBars(T0, 100, TF, 500))
  await pb

  const lastTime = chart.bars[chart.bars.length - 1].time
  // A's socket keeps delivering. Same timeframe => same forming-candle slot.
  a.forceTick({ type: 'update', bar: { time: lastTime, open: 1, high: 1, low: 1, close: 1, volume: 1 } })

  assert.equal(chart.bars[chart.bars.length - 1].close, 500,
    'a superseded feed must not reach the bar array')

  chart.destroy()
})

// ---------------------------------------------------------------- finding 4
test('a rejected setFeed surfaces as an error event instead of an unhandled rejection', async () => {
  const chart = createChart(makeContainer())
  const seen = []
  chart.subscribe('error', (e) => seen.push(e))

  await chart.setFeed({
    symbol: 'X', timeframe: TF,
    getBars: () => Promise.reject(new Error('502 Bad Gateway')),
    subscribe: () => () => {},
  })

  assert.equal(seen.length, 1, 'error event must fire')
  assert.match(seen[0].message, /502/)
  assert.equal(chart.bars.length, 0)

  chart.destroy()
})

// ---------------------------------------------------------------- finding 2
test('a history page belonging to a detached feed is dropped, and cannot latch _exhausted', async () => {
  const chart = createChart(makeContainer())
  const nifty = deferredFeed({ symbol: 'NIFTY', timeframe: TF })
  const bank = deferredFeed({ symbol: 'BANKNIFTY', timeframe: TF })

  const p1 = chart.setFeed(nifty)
  nifty.release(0, makeBars(T0, 500, TF, 22000))
  await p1

  panToLeftEdge(chart)
  const paging = chart._maybeLoadHistory()   // NIFTY asks for older bars

  const p2 = chart.setFeed(bank)             // user switches instrument
  bank.release(0, makeBars(T0, 500, TF, 48000))
  await p2

  // NIFTY's page arrives late and empty — the "no more history" signal.
  nifty.release(1, [])
  await paging

  assert.equal(chart.bars.length, 500, 'stale page must not extend the array')
  assert.equal(chart.bars[0].close, 48000, 'bars must still be BANKNIFTY')
  assert.equal(chart._exhausted, false,
    'a stale feed must not disable paging for the new instrument')

  chart.destroy()
})

test('a late history page cannot break the ascending-by-time invariant', async () => {
  const chart = createChart(makeContainer())
  const shallow = deferredFeed({ symbol: 'SHALLOW', timeframe: TF })
  const deep = deferredFeed({ symbol: 'DEEP', timeframe: TF })

  const p1 = chart.setFeed(shallow)
  shallow.release(0, makeBars(T0, 500, TF))
  await p1

  panToLeftEdge(chart)
  const paging = chart._maybeLoadHistory()

  // DEEP starts far EARLIER, so SHALLOW's page would splice into the middle.
  const p2 = chart.setFeed(deep)
  deep.release(0, makeBars(T0 - 5000 * TF, 500, TF))
  await p2

  shallow.release(1, makeBars(T0 - 1000 * TF, 1000, TF))
  await paging

  const ascending = chart.bars.every((b, i) => i === 0 || b.time > chart.bars[i - 1].time)
  assert.ok(ascending, 'bars must remain strictly ascending by time')

  chart.destroy()
})

// ---------------------------------------------------------------- finding 3
test('prepending history shifts the viewport exactly once', async () => {
  const chart = createChart(makeContainer())
  const feed = deferredFeed({ symbol: 'NIFTY', timeframe: TF })

  const p1 = chart.setFeed(feed)
  feed.release(0, makeBars(T0, 500, TF))
  await p1

  panToLeftEdge(chart)
  const rightBefore = chart.ts._right.value

  const paging = chart._maybeLoadHistory()
  feed.release(1, makeBars(T0 - 1000 * TF, 1000, TF))
  await paging

  assert.equal(chart.bars.length, 1500)
  assert.equal(chart.ts._right.value, rightBefore + 1000, 'view must follow its bars')
  assert.equal(chart.ts._right.target, chart.ts._right.value,
    'value and target must agree — a divergence is the double shift easing away')

  const maxRight = chart.bars.length - 1 + chart.ts.rightOffset
  assert.ok(chart.ts._right.target <= maxRight,
    `view must not sit past the newest bar (${chart.ts._right.target} > ${maxRight})`)

  const { from, to } = chart.ts.visibleRange()
  assert.ok(from < to, 'the visible range must not collapse to a single bar')

  chart.destroy()
})

test('Smoothed.jump moves value and target together, so one call is the whole shift', () => {
  // The unit fact the fix rests on: jump() already writes both, so the old
  // follow-up set(target + n) was re-reading a value it had just moved.
  const ts = new TimeScale()
  ts.resize(900)
  ts.setBarCount(500)
  ts.panBy(4000)

  const before = ts._right.value
  ts._right.jump(ts._right.value + 1000)

  assert.equal(ts._right.value, before + 1000)
  assert.equal(ts._right.target, before + 1000)
})

// ---------------------------------------------------------------- lifecycle
test('destroy is idempotent', async () => {
  const chart = createChart(makeContainer())
  const feed = deferredFeed({ symbol: 'A', timeframe: TF })
  const p = chart.setFeed(feed)
  feed.release(0, makeBars(T0, 50, TF))
  await p

  chart.destroy()
  assert.doesNotThrow(() => chart.destroy(), 'a second destroy must be a no-op')
})

test('a feed resolving after destroy is dropped', async () => {
  const chart = createChart(makeContainer())
  const feed = deferredFeed({ symbol: 'A', timeframe: TF })
  const p = chart.setFeed(feed)

  chart.destroy()
  feed.release(0, makeBars(T0, 100, TF))
  await p

  assert.equal(chart.bars.length, 0, 'destroy must win')
  assert.equal(feed.subscribed, false, 'must not subscribe to a destroyed chart')
})
