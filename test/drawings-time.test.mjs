/**
 * Drawing anchors: time <-> fractional bar index.
 *
 * A drawing is stored against time and drawn against the bar index, and the
 * mapping has to survive what real market data does: overnight session gaps,
 * a new session arriving, a page of history prepended, a switch from 1m to
 * 5m. Each test below is one of those, stated as the thing a trader would see
 * go wrong — a line whose right end slides into last night's gap, a note
 * drawn before the first bar that jumps when older history loads.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lowerBoundTime,
  timeToIndex,
  indexToTime,
  pointIndex,
  pointFromIndex,
} from '../src/drawings/model/time.js'
import { nearestIndex } from '../src/chart/overlays/annotations.js'

const MIN = 60_000
const DAY = 86_400_000
/** 2024-01-01 00:00, IST-as-if-UTC, as Traed stores it. */
const D0 = Date.UTC(2024, 0, 1)
const OPEN = (9 * 60 + 15) * MIN
const PER_SESSION = 375 // 09:15 .. 15:29

/** Minute bars for `days` NSE sessions, with the overnight gaps a real feed has. */
function sessions(days, firstDay = 0) {
  const bars = []
  for (let d = firstDay; d < firstDay + days; d++) {
    for (let i = 0; i < PER_SESSION; i++) {
      bars.push({ time: D0 + d * DAY + OPEN + i * MIN, open: 1, high: 1, low: 1, close: 1 })
    }
  }
  return bars
}

const even = (n, t0 = D0, tf = MIN) => Array.from({ length: n }, (_, i) => ({ time: t0 + i * tf }))

// ------------------------------------------------------------------ inside the data

test('a bar time maps to exactly its index, and back', () => {
  const bars = sessions(3)
  for (const i of [0, 1, 374, 375, 376, 749, 1124]) {
    assert.equal(timeToIndex(bars, bars[i].time, MIN), i)
    assert.equal(indexToTime(bars, i, MIN), bars[i].time)
  }
})

test('a time between two bars lands proportionally between them, not on the nearer bar', () => {
  const bars = even(10, D0, 5 * MIN)
  // A 1m time on 5m data: 2 minutes into bar 3.
  assert.equal(timeToIndex(bars, bars[3].time + 2 * MIN, MIN), 3.4)
  // 4 minutes in is nearer bar 4, and still reads 3.8.
  assert.ok(Math.abs(timeToIndex(bars, bars[3].time + 4 * MIN, MIN) - 3.8) < 1e-12)
})

test('a time in an overnight gap maps between the last and first bars of the two sessions, monotonically', () => {
  const bars = sessions(2)
  const close = bars[374].time
  const open = bars[375].time
  let prev = -Infinity
  for (let t = close; t <= open; t += 30 * MIN) {
    const u = timeToIndex(bars, t, MIN)
    assert.ok(u >= 374 && u <= 375, `u ${u} stays between the two bars`)
    assert.ok(u > prev, 'monotonic across the gap')
    prev = u
  }
  assert.equal(timeToIndex(bars, (close + open) / 2, MIN), 374.5)
})

test('fractional indices inside the data round-trip through time', () => {
  const bars = even(20)
  for (const u of [0.25, 3.5, 18.75]) {
    assert.ok(Math.abs(timeToIndex(bars, indexToTime(bars, u, MIN), MIN) - u) < 1e-9)
  }
})

// ------------------------------------------------------------------ outside the data

test('a time after the newest bar extrapolates at one timeframe per bar', () => {
  const bars = even(10)
  assert.equal(timeToIndex(bars, bars[9].time + 5 * MIN, MIN), 14)
  assert.equal(timeToIndex(bars, bars[9].time + 90_000, MIN), 10.5)
})

test('a time before the oldest bar extrapolates backwards instead of clamping to bar 0', () => {
  const bars = even(10)
  assert.equal(timeToIndex(bars, bars[0].time - 3 * MIN, MIN), -3)
  assert.equal(indexToTime(bars, -3, MIN), bars[0].time - 3 * MIN)
})

test('integer indices round-trip exactly over the data and 50 bars either side, across session gaps', () => {
  const bars = sessions(3)
  const n = bars.length
  for (let u = -50; u <= n + 50; u++) {
    const t = indexToTime(bars, u, MIN)
    assert.equal(timeToIndex(bars, t, MIN), u, `u = ${u}`)
  }
})

test('a missing timeframe falls back to one minute rather than dividing by zero', () => {
  const bars = even(3)
  assert.equal(timeToIndex(bars, bars[2].time + 2 * MIN, 0), 4)
  assert.equal(indexToTime(bars, 4, undefined), bars[2].time + 2 * MIN)
})

// ------------------------------------------------------------------ degenerate input

test('with no bars there is no index and no time: NaN and null, never a throw', () => {
  assert.ok(Number.isNaN(timeToIndex([], D0, MIN)))
  assert.equal(indexToTime([], 0, MIN), null)
  assert.equal(pointFromIndex([], 0, 100, MIN), null)
  assert.equal(pointFromIndex([], 5, 100, MIN), null)
  assert.ok(Number.isNaN(pointIndex([], { time: D0, price: 1, offset: 3 }, MIN)))
})

test('a non-finite index places nothing', () => {
  const bars = even(5)
  for (const u of [NaN, Infinity, -Infinity]) {
    assert.equal(indexToTime(bars, u, MIN), null)
    assert.equal(pointFromIndex(bars, u, 100, MIN), null)
  }
})

test('an unreadable time is NaN, and a null time is not the epoch', () => {
  const bars = even(5)
  assert.ok(Number.isNaN(timeToIndex(bars, null, MIN)))
  assert.ok(Number.isNaN(timeToIndex(bars, 'soon', MIN)))
  assert.equal(timeToIndex(bars, String(bars[2].time), MIN), 2, 'numeric strings are accepted')
})

test('a single bar still extrapolates both ways and interpolates nothing', () => {
  const bars = even(1)
  assert.equal(timeToIndex(bars, D0, MIN), 0)
  assert.equal(timeToIndex(bars, D0 + 2 * MIN, MIN), 2)
  assert.equal(timeToIndex(bars, D0 - MIN, MIN), -1)
  assert.equal(indexToTime(bars, 0.5, MIN), D0 + 30_000)
  assert.deepEqual(pointFromIndex(bars, 0, 5, MIN), { time: D0, price: 5 })
})

test('lowerBoundTime agrees with the core nearestIndex on every exact hit', () => {
  const bars = sessions(2)
  for (let i = 0; i < bars.length; i += 17) {
    assert.equal(lowerBoundTime(bars, bars[i].time), nearestIndex(bars, bars[i].time))
  }
  assert.equal(lowerBoundTime(bars, bars[0].time - 1), 0)
  assert.equal(lowerBoundTime(bars, bars[bars.length - 1].time + 1), bars.length)
})

// ------------------------------------------------------------------ stored form

test('a point past the newest bar is stored as the newest bar plus a bar count and its timeframe', () => {
  const bars = sessions(1)
  const p = pointFromIndex(bars, bars.length - 1 + 10, 101.5, MIN)
  assert.deepEqual(p, { time: bars[374].time, price: 101.5, offset: 10, tf: MIN })
})

test('a point before the oldest bar is stored as the oldest bar minus a bar count', () => {
  const bars = sessions(1)
  const p = pointFromIndex(bars, -7, 99, MIN)
  assert.deepEqual(p, { time: bars[0].time, price: 99, offset: -7, tf: MIN })
  assert.equal(pointIndex(bars, p, MIN), -7)
})

test('a point inside the data is stored as plain (interpolated) time, with no offset', () => {
  const bars = sessions(2)
  assert.deepEqual(pointFromIndex(bars, 374.5, 1, MIN), { time: (bars[374].time + bars[375].time) / 2, price: 1 })
  assert.deepEqual(pointFromIndex(bars, 12, 1, MIN), { time: bars[12].time, price: 1 })
})

test('a stored bar count is rescaled when the chart switches timeframe', () => {
  const bars1 = even(100)
  const p = { time: bars1[99].time, price: 1, offset: 10, tf: MIN }
  assert.equal(pointIndex(bars1, p, MIN), 109)
  const bars5 = even(20, D0, 5 * MIN)
  // The same anchor on 5m data: 10 one-minute bars is 2 five-minute bars.
  const p5 = { time: bars5[19].time, price: 1, offset: 10, tf: MIN }
  assert.equal(pointIndex(bars5, p5, 5 * MIN), 21)
  // Absent tf reads the current timeframe.
  assert.equal(pointIndex(bars5, { time: bars5[19].time, price: 1, offset: 10 }, 5 * MIN), 29)
})

test('an offset point keeps its bar count when the next session arrives after the overnight gap', () => {
  const day1 = sessions(1)
  // Drawn 10 bars right of 15:29 — which by the clock is 15:39, a closed market.
  const p = pointFromIndex(day1, day1.length - 1 + 10, 100, MIN)
  const both = sessions(2)
  // Next morning's bars arrived: it is bar 374 + 10, i.e. 09:24 of day 2.
  assert.equal(pointIndex(both, p, MIN), 384)
  assert.equal(both[384].time, D0 + DAY + OPEN + 9 * MIN)
})

test('control: the same point stored as clock time collapses into the overnight gap', () => {
  const day1 = sessions(1)
  const clock = { time: day1[374].time + 10 * MIN, price: 100 }
  assert.equal(pointIndex(day1, clock, MIN), 384, 'identical while the future is empty')
  const both = sessions(2)
  const u = pointIndex(both, clock, MIN)
  assert.ok(u > 374 && u < 375, `collapsed to ${u}, inside the gap`)
})

test('a point before the first bar keeps its slot relative to the bars across an intraday history prepend', () => {
  const later = sessions(1).slice(200) // the view opened mid-session
  const p = pointFromIndex(later, -12, 100, MIN)
  assert.equal(pointIndex(later, p, MIN), -12)
  // The earlier 200 bars of the same session load in front: every index shifts
  // by 200, and the TimeScale jumps by the same 200, so the point stays put on
  // screen only if its index shifted by exactly 200 as well.
  const full = sessions(1)
  assert.equal(pointIndex(full, p, MIN), 188)
  assert.equal(pointIndex(full, p, MIN) - pointIndex(later, p, MIN), 200)
})

test('a prepend across a session gap still shifts a pre-first-bar point by exactly the prepended bar count', () => {
  const day2 = sessions(1, 1)
  const p = pointFromIndex(day2, -3, 100, MIN)
  const both = sessions(2)
  assert.equal(pointIndex(both, p, MIN), PER_SESSION - 3)
})
