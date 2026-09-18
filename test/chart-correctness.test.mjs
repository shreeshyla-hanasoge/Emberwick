/**
 * Regression tests for the 0.5.0 correctness batch.
 *
 * Same harness as chart-feed-race.test.mjs: real modules, plain Node, a
 * minimal DOM, and a requestAnimationFrame that never fires on its own.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { inferTimeframe } = await import('../src/chart/core/Chart.js')
const { PriceScale } = await import('../src/chart/core/PriceScale.js')
const { Loop } = await import('../src/chart/core/Loop.js')
const { priceTicks } = await import('../src/chart/core/formatters.js')
const { normalizeMarkers, resolveMarkers } = await import('../src/chart/overlays/annotations.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

/** Run fn with console.error silenced; returns how many times it was called. */
function quiet(fn) {
  const real = console.error
  let n = 0
  console.error = () => { n++ }
  try { fn() } finally { console.error = real }
  return n
}

// ------------------------------------------------------------------ append
test('an out-of-order tick is dropped, not applied over the newest bar', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 3, MIN))
  const before = chart.bars.length

  chart.update({ time: T0 + MIN, open: 9, high: 9, low: 9, close: 9, volume: 1 })

  assert.equal(chart.bars.length, before, 'no bar may be added or removed')
  assert.equal(chart.bars[2].time, T0 + 2 * MIN, 'the newest bar must survive')
  const times = chart.bars.map((b) => b.time)
  assert.equal(new Set(times).size, times.length, 'no duplicate timestamps')
  chart.destroy()
})

test('a re-sent forming candle still replaces in place', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 3, MIN))
  chart.update({ time: T0 + 2 * MIN, open: 1, high: 2, low: 0.5, close: 1.5, volume: 7 })

  assert.equal(chart.bars.length, 3, 'an equal timestamp is a replace, not an append')
  assert.equal(chart.bars[2].close, 1.5)
  chart.destroy()
})

// -------------------------------------------------------------- timeframe
test('timeframe survives a session gap between the first two bars', () => {
  // A day ending, then the next session opening 17.75h later, then normal
  // minute bars — exactly what an NSE minute feed looks like at a day boundary.
  const bars = [
    { time: T0 },
    { time: T0 + 63_900_000 },
    ...Array.from({ length: 50 }, (_, i) => ({ time: T0 + 63_900_000 + (i + 1) * MIN })),
  ]
  assert.equal(inferTimeframe(bars, 1), MIN, 'the median gap is the timeframe')
  assert.equal(inferTimeframe([{ time: T0 }], 12345), 12345, 'fallback below two bars')
  assert.equal(inferTimeframe([], 999), 999)
})

test('setData infers the timeframe from the median, not the first pair', () => {
  const chart = createChart(makeContainer())
  chart.setData([
    { time: T0, open: 1, high: 1, low: 1, close: 1 },
    { time: T0 + 63_900_000, open: 1, high: 1, low: 1, close: 1 },
    ...Array.from({ length: 30 }, (_, i) => ({
      time: T0 + 63_900_000 + (i + 1) * MIN, open: 1, high: 1, low: 1, close: 1,
    })),
  ])
  assert.equal(chart.ts.timeframeMs, MIN)
  chart.destroy()
})

// ------------------------------------------------------------- price scale
test('a null OHLC value cannot drag the price range to zero', () => {
  const ps = new PriceScale()
  ps.layout(0, 400)
  const bars = [
    { low: 100, high: 110 },
    { low: null, high: undefined }, // isFinite(null) === true
    { low: 102, high: 108 },
  ]
  ps.fit(bars, 0, 2)
  assert.ok(ps.lo > 50, `lo collapsed to ${ps.lo} — the null was treated as 0`)
  assert.ok(ps.hi < 160)
})

test('log mode ignores non-positive prices instead of collapsing', () => {
  const ps = new PriceScale({ mode: 'log' })
  ps.layout(0, 400)
  ps.fit([{ low: 0, high: 110 }, { low: 100, high: 120 }], 0, 1)
  // log(1e-9) would put the low ~20 decades below the high.
  assert.ok(ps.lo > 1, `lo is ${ps.lo} — a zero price leaked into log space`)
  assert.ok(ps.hi < 1000)
})

test('marginBottom actually pads the low side', () => {
  const mk = (marginBottom) => {
    const ps = new PriceScale({ marginTop: 0.1, marginBottom })
    ps.layout(0, 400)
    ps.fit([{ low: 100, high: 200 }], 0, 0)
    return ps.lo
  }
  assert.ok(mk(0.5) < mk(0.1), 'a bigger marginBottom must push the low further down')
})

// -------------------------------------------------------------------- loop
test('a throwing frame keeps its dirty layers and reschedules', () => {
  let pending = null
  const savedRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => { pending = fn; return 1 }

  const seen = []
  let boom = true
  const loop = new Loop((dirty) => {
    seen.push([...dirty].sort())
    if (boom) throw new Error('render blew up')
    return false
  })

  quiet(() => {
    loop.start()             // invalidate('all')
    pending(performance.now() + 16)   // frame 1 throws
    assert.ok(pending, 'must have rescheduled after the throw')
    boom = false
    pending(performance.now() + 32)   // frame 2 succeeds
  })

  assert.deepEqual(seen[1], ['all'], 'the dirty set must survive a throwing frame')
  globalThis.requestAnimationFrame = savedRaf
})

test('a permanently throwing frame gives up instead of spinning forever', () => {
  let pending = null
  const savedRaf = globalThis.requestAnimationFrame
  globalThis.requestAnimationFrame = (fn) => { pending = fn; return 1 }

  let frames = 0
  const loop = new Loop(() => { frames++; throw new Error('always') })

  quiet(() => {
    loop.start()
    for (let i = 0; i < 50 && pending; i++) {
      const fn = pending
      pending = null
      fn(performance.now() + i * 16)
    }
  })

  assert.ok(frames <= 10, `ran ${frames} failing frames; should stop at 10`)
  assert.equal(loop._running, false, 'the loop must have stopped')
  globalThis.requestAnimationFrame = savedRaf
})

// ---------------------------------------------------------- state events
test('a late subscriber cannot suppress an update for existing ones', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 300, MIN))

  const a = []
  chart.subscribe('visibleRange', (p) => a.push(p))
  const afterSubscribe = a.length

  chart.ts.panBy(600)                    // the window moves; no frame has run
  chart.subscribe('visibleRange', () => {})  // late subscriber records current

  const r = chart.ts.visibleRange()
  chart._emitVisibleRange(r.from, r.to)

  assert.equal(a.length, afterSubscribe + 1,
    'the original listener must still receive the changed window')
  chart.destroy()
})

test('unsubscribing drops the listener key too', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  const fn = () => {}
  const off = chart.subscribe('visibleRange', fn)
  assert.equal(chart._stateKeys.visibleRange.has(fn), true)
  off()
  assert.equal(chart._stateKeys.visibleRange.has(fn), false, 'key map must not leak')
  chart.destroy()
})

// ---------------------------------------------------------------- replay
test('Replay.seek(NaN) is ignored rather than blanking the chart', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  const replay = chart.startReplay({ from: 40 })

  replay.seek(NaN)
  assert.equal(replay.index, 40)
  replay.seek(undefined)
  assert.equal(replay.index, 40)
  replay.seek('not a number')
  assert.equal(replay.index, 40)
  assert.ok(chart.bars.length > 0, 'the chart must still have bars')

  replay.seek(55)
  assert.equal(replay.index, 55, 'valid seeks still work')
  chart.destroy()
})

test('a replaced replay controller can no longer drive the chart', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))

  const first = chart.startReplay({ from: 20 })
  const second = chart.startReplay({ from: 80 })
  assert.notEqual(first, second)

  const barsNow = chart.bars.length
  first.seek(5)          // the caller still holds the old controller
  first.play()

  assert.equal(chart.bars.length, barsNow, 'the orphan must not swap bars in')
  assert.equal(first.playing, false, 'a detached controller must not play')
  assert.equal(chart.replay, second)
  chart.destroy()
})

test('stopReplay detaches the controller it hands back', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  const replay = chart.startReplay({ from: 30 })
  chart.stopReplay()

  const full = chart.bars.length
  replay.seek(10)
  assert.equal(chart.bars.length, full, 'the whole dataset must stay revealed')
  chart.destroy()
})

// --------------------------------------------------------------- markers
test('setData invalidates the marker index cache', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart._resolveKey = 'stale'
  chart.setData(makeBars(T0 + 500 * MIN, 100, MIN))
  assert.equal(chart._resolveKey, '', 'indices must be re-resolved against new bars')
  chart.destroy()
})

test('generated marker ids do not collide after a remove and an add', () => {
  const first = normalizeMarkers([{ time: T0 }, { time: T0 + MIN }])
  const second = normalizeMarkers([{ time: T0 + 2 * MIN }])
  const ids = new Set([...first, ...second].map((m) => m.id))
  assert.equal(ids.size, 3, `ids collided: ${[...first, ...second].map((m) => m.id)}`)
})

test('a marker far outside the loaded range is hidden, not clamped to an end bar', () => {
  const bars = makeBars(T0, 100, MIN)
  const markers = normalizeMarkers([
    { time: T0 - 180 * 24 * 3600_000 },  // six months before the window
    { time: T0 - MIN / 4 },              // just before bar 0 — legitimately bar 0
    { time: T0 + 50 * MIN },             // inside
    { time: T0 + 5000 * MIN },           // far after
  ])
  resolveMarkers(markers, bars, MIN)
  const byTime = Object.fromEntries(markers.map((m) => [m.time, m.index]))

  assert.equal(byTime[T0 - 180 * 24 * 3600_000], -1, 'ancient marker must be hidden')
  assert.equal(byTime[T0 - MIN / 4], 0, 'within tolerance still snaps to bar 0')
  assert.equal(byTime[T0 + 50 * MIN], 50)
  assert.equal(byTime[T0 + 5000 * MIN], -1, 'far-future marker must be hidden')
})

// ------------------------------------------------------------- formatters
test('priceTicks returns instead of hanging on a non-finite bound', () => {
  assert.deepEqual(priceTicks(-Infinity, 100, 5).ticks, [])
  assert.deepEqual(priceTicks(0, Infinity, 5).ticks, [])
  assert.deepEqual(priceTicks(NaN, NaN, 5).ticks, [])
  assert.deepEqual(priceTicks(100, 50, 5).ticks, [], 'inverted bounds yield nothing')

  const { ticks } = priceTicks(100, 110, 5)
  assert.ok(ticks.length > 1 && ticks.length < 20)
  assert.ok(ticks.every(Number.isFinite))
})
