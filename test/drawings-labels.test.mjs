/**
 * The words and numbers drawings print.
 *
 * Plain strings in, plain strings out: every label a tool draws goes through
 * these, and a host building its own readout from the `drawing` event can
 * format exactly as the canvas does.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  formatSpan, formatDelta, formatPercent, formatVolume, formatLevel, statsLines, cachedStats, anchorTime,
  pick, flag, textOpt, colorOpt, rawObject,
} from '../src/drawings/render/labels.js'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const fmt2 = (p) => p.toFixed(2)

test('a span reads in at most two units: 45m, 6h 20m, 2d 3h', () => {
  assert.equal(formatSpan(45 * MIN), '45m')
  assert.equal(formatSpan(6 * HOUR + 20 * MIN), '6h 20m')
  assert.equal(formatSpan(2 * DAY + 3 * HOUR), '2d 3h')
  assert.equal(formatSpan(2 * DAY + 3 * HOUR + 14 * MIN), '2d 3h')
  assert.equal(formatSpan(3 * HOUR), '3h')
  assert.equal(formatSpan(5 * DAY), '5d')
  assert.equal(formatSpan(30_000), '30s')
  assert.equal(formatSpan(0), '0s')
})

test('a span rounds before it picks its unit, so it never reads 60s or 0h 60m', () => {
  assert.equal(formatSpan(59_600), '1m')
  assert.equal(formatSpan(HOUR - 100), '1h')
  assert.equal(formatSpan(DAY - 20_000), '1d')
})

test('a span is unsigned, approximate on request, and a dash when unknown', () => {
  assert.equal(formatSpan(-45 * MIN), '45m')
  assert.equal(formatSpan(20 * MIN, true), '≈20m')
  assert.equal(formatSpan(NaN), '—')
  assert.equal(formatSpan(null), '—')
  assert.equal(formatSpan(String(45 * MIN)), '45m', 'a numeric string is a number')
})

test('a delta is signed with a real minus sign and formatted by the pane', () => {
  assert.equal(formatDelta(12.4, fmt2), '+12.40')
  assert.equal(formatDelta(-2.1, fmt2), '−2.10')
  assert.equal(formatDelta(0, fmt2), '0.00')
  assert.equal(formatDelta(1.5), '+1.50', 'two decimals without a formatter')
  assert.equal(formatDelta(NaN, fmt2), '—')
})

test('a percentage guards a zero or unknown base instead of printing Infinity', () => {
  assert.equal(formatPercent(1.52, 100), '+1.52%')
  assert.equal(formatPercent(-2.1, 148.2), '−1.42%')
  assert.equal(formatPercent(1, 0), '—')
  assert.equal(formatPercent(1, NaN), '—')
  assert.equal(formatPercent(0, 100), '0.00%')
  assert.equal(formatPercent(-0.00001, 100), '0.00%', 'a rounded zero is unsigned')
  assert.equal(formatPercent(2, -4), '+50.00%', 'measured against the base magnitude')
})

test('volume reads 1.24M, 12.5K, 950', () => {
  assert.equal(formatVolume(1_240_000), '1.24M')
  assert.equal(formatVolume(12_500), '12.5K')
  assert.equal(formatVolume(950), '950')
  assert.equal(formatVolume(3.2e9), '3.20B')
  assert.equal(formatVolume('12500'), '12.5K')
  assert.equal(formatVolume(-1), '—')
  assert.equal(formatVolume(undefined), '—')
})

test('a fib level prints as its ratio, at most four decimals', () => {
  assert.equal(formatLevel(0.618), '0.618')
  assert.equal(formatLevel(0.5), '0.5')
  assert.equal(formatLevel(1), '1')
  assert.equal(formatLevel(0), '0')
  assert.equal(formatLevel(-0.272), '−0.272')
  assert.equal(formatLevel(1 / 3), '0.3333')
})

const T0 = 1_700_000_000_000
const ctx = {
  formatPrice: fmt2,
  timeAt: (u) => T0 + u * MIN,
}

test('stats lines read the change and the bar count with the clock span', () => {
  const p0 = { u: 10, time: T0 + 10 * MIN, price: 816, approx: false }
  // 38 bars that took 6h 20m by the clock: the span crosses a session gap.
  const p1 = { u: 48, time: T0 + 10 * MIN + 6 * HOUR + 20 * MIN, price: 828.4, approx: false }
  assert.deepEqual(statsLines(p0, p1, ctx), ['+12.40 (+1.52%)', '38 bars · 6h 20m'])
  const one = { u: 11, time: T0 + 11 * MIN, price: 816, approx: false }
  assert.equal(statsLines(p0, one, ctx)[1], '1 bar · 1m')
})

test('stats for a point stored as a bar count use its extrapolated time and read approximate', () => {
  const p0 = { u: 90, time: T0 + 90 * MIN, price: 100, approx: false }
  // Stored time is the newest bar's; the point itself is 11 bars past it.
  const p1 = { u: 110, time: T0 + 99 * MIN, price: 99, approx: true }
  assert.equal(anchorTime(p1, ctx), T0 + 110 * MIN)
  assert.deepEqual(statsLines(p0, p1, ctx), ['−1.00 (−1.00%)', '20 bars · ≈20m'])
})

test('stats use the context span formatter when it has one, and fill a given array', () => {
  const out = ['stale']
  const withSpan = { ...ctx, formatSpan: (ms, approx) => `${ms / MIN}min${approx ? '?' : ''}` }
  const p0 = { u: 0, time: T0, price: 1, approx: false }
  const p1 = { u: 5, time: T0 + 5 * MIN, price: 1, approx: false }
  assert.equal(statsLines(p0, p1, withSpan, out), out)
  assert.deepEqual(out, ['0.00 (0.00%)', '5 bars · 5min'])
})

test('cached stats rebuild only when the drawing, anchors, revision, formatter or range change', () => {
  let calls = 0
  const c = { ...ctx, dataRev: 1, pane: { ps: { lo: 90, hi: 110 } }, formatPrice: (p) => { calls++; return p.toFixed(2) } }
  const g = {}
  const d = {}
  const p0 = { u: 0, time: T0, price: 100, approx: false }
  const p1 = { u: 5, time: T0 + 5 * MIN, price: 101, approx: false }
  const first = cachedStats(g, d, p0, p1, c)
  const n = calls
  assert.equal(cachedStats(g, d, p0, p1, c), first)
  assert.equal(calls, n, 'nothing changed: nothing formatted')
  c.pane.ps.lo = 80
  cachedStats(g, d, p0, p1, c)
  assert.ok(calls > n, 'the axis range changed: the decimals may have too')
  const m = calls
  c.dataRev = 2
  cachedStats(g, d, p0, p1, c)
  assert.ok(calls > m)
})

test('option coercion: enums by membership, strict booleans, capped text, bounded colours', () => {
  const SET = new Set(['a', 'b'])
  assert.equal(pick('a', SET, 'b'), 'a')
  assert.equal(pick('c', SET, 'b'), 'b')
  assert.equal(pick(undefined, SET, 'b'), 'b')
  assert.equal(flag(true, false), true)
  assert.equal(flag('yes', false), false)
  assert.equal(flag(1, true), true)
  assert.equal(textOpt(undefined, 'Text'), 'Text')
  assert.equal(textOpt(42, ''), '42')
  assert.equal(textOpt({ toString: () => 'x' }, 'd'), 'd', 'objects are not text')
  assert.equal(textOpt('x'.repeat(5000), '').length, 1000)
  assert.equal(colorOpt('#fff'), '#fff')
  assert.equal(colorOpt(''), null)
  assert.equal(colorOpt('x'.repeat(65)), null)
  assert.equal(colorOpt(3), null)
  assert.deepEqual(rawObject(null), {})
  assert.deepEqual(rawObject([1]), {})
  const o = { a: 1 }
  assert.equal(rawObject(o), o)
})
