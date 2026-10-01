/**
 * The demo site's host-side binning (src/components/profileData.js).
 *
 * It is demo code, not library code, but the landing page and the playground
 * both hand its output to createVolumeProfile and call that "what a host
 * does". So it is held to the contract here: what it builds must be valid
 * ProfileData, on the price grid it claims, holding the volume it was given.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { niceStep, binBars, splitSessions, stepFor, buildProfiles, hourOf } from '../src/components/profileData.js'
import { normalizeData } from '../src/profiles/data.js'

const MIN = 60_000
const bar = (i, low, high, volume) => ({ time: i * MIN, open: low, high, low, close: high, volume })

test('niceStep rounds up to 1, 2, 2.5 or 5 times a power of ten', () => {
  assert.deepEqual([0.037, 0.05, 0.18, 0.21, 0.3, 7, 12].map(niceStep), [0.05, 0.05, 0.2, 0.25, 0.5, 10, 20])
  assert.equal(niceStep(0), 1)
  assert.equal(niceStep(NaN), 1)
  assert.equal(String(niceStep(0.047)), '0.05', 'no float dust in the step')
})

test('binBars spreads each bar\'s volume over the prices it traded through, and keeps the total', () => {
  const s = binBars([bar(0, 100, 100.5, 100), bar(1, 100.25, 100.25, 40), bar(2, 99.75, 100, 60)], 0.25)
  assert.deepEqual([s.start, s.end, s.lo], [0, 2 * MIN, 99.75])
  // bar 0: 100 over 100..100.5, two bins, 50 each. bar 1: all 40 in 100.25..100.5.
  // bar 2: all 60 in 99.75..100.
  assert.deepEqual(s.bins, [60, 50, 90])
  assert.equal(s.bins.reduce((a, b) => a + b, 0), 200)
})

test('binBars puts lo on the step grid and never loses a bar off either end', () => {
  const s = binBars([bar(0, 100.07, 100.93, 500)], 0.25)
  assert.equal(s.lo, 100)
  assert.equal(s.bins.length, 4, '100 to 101 in quarters')
  assert.ok(Math.abs(s.bins.reduce((a, b) => a + b, 0) - 500) <= 2, 'rounded per bin, so within a unit or two')
  assert.equal(binBars([], 0.25), null)
  assert.deepEqual(binBars([{ time: 5, low: 10, high: 10, volume: 0 }], 1).bins, [0], 'a bar with no volume still makes a session')
})

test('splitSessions cuts on the session key, and stepFor sizes the step from the quiet sessions', () => {
  const bars = Array.from({ length: 180 }, (_, i) => bar(i, 100 + (i % 7) * 0.1, 100.4 + (i % 7) * 0.1, 10))
  const groups = splitSessions(bars, (t) => Math.floor(t / (60 * MIN)))
  assert.deepEqual(groups.map((g) => g.length), [60, 60, 60])
  assert.equal(stepFor(groups, 10), 0.1, 'each hour ranges 1.0: ten bins of 0.1')
  assert.equal(stepFor([]), 1)
  // hourOf cuts on LOCAL clock hours: two times in one local hour share a key, and the next hour does not.
  const at = new Date(2024, 0, 2, 9, 5).getTime()
  assert.equal(hourOf(at), hourOf(at + 50 * MIN))
  assert.equal(hourOf(at + 60 * MIN), hourOf(at) + 1)
})

test('buildProfiles makes ProfileData the library accepts as it is', () => {
  const bars = Array.from({ length: 150 }, (_, i) => bar(i, 100 + Math.sin(i / 9), 100.6 + Math.sin(i / 9), 50 + (i % 5) * 10))
  const data = buildProfiles(bars, { sessionOf: (t) => Math.floor(t / (60 * MIN)), source: 'demo tape', developing: true })
  assert.equal(data.version, 1)
  assert.equal(data.source, 'demo tape')
  assert.ok(data.step > 0)
  assert.equal(data.sessions.length, 3)
  assert.deepEqual(data.sessions.map((s) => !!s.developing), [false, false, true], 'only the last session is still forming')
  const read = normalizeData(data)
  assert.equal(read.sessions.length, 3)
  for (const s of read.sessions) {
    assert.ok(s.total > 0 && s.poc !== null && s.vah > s.val, 'every session has a POC and a value area')
    assert.ok(Math.abs(s.lo / data.step - Math.round(s.lo / data.step)) < 1e-6, 'lo is on the step grid, so sessions align')
  }
  assert.equal(buildProfiles(bars, { sessionOf: () => 0, step: 0.5 }).step, 0.5, 'a given step is kept')
  assert.equal('source' in buildProfiles(bars, { sessionOf: () => 0 }), false)
})

// ------------------------------------------------------------ the demo tape

const { aggregate } = await import('../src/components/profileData.js')
const { createTape, sessionOf, sessionOpen, SESSION_MINUTES } = await import('../src/components/profileTape.js')

test('aggregate coarsens fine bars into candles that start on the session open and keep the volume', () => {
  const fine = Array.from({ length: 12 }, (_, i) => ({ time: 1000 + i * MIN, open: 10 + i, high: 11 + i, low: 9 + i, close: 10.5 + i, volume: 100 }))
  const c = aggregate(fine, 5 * MIN)
  assert.deepEqual(c.map((b) => b.time), [1000, 1000 + 5 * MIN, 1000 + 10 * MIN], 'aligned to the first bar, not to the clock')
  assert.deepEqual(c[0], { time: 1000, open: 10, high: 15, low: 9, close: 14.5, volume: 500 })
  assert.deepEqual([c[2].open, c[2].close, c[2].volume], [20, 21.5, 200], 'a short last candle is still a candle')
  assert.deepEqual(aggregate([], 5 * MIN), [])
})

test('the demo tape is deterministic, session-shaped, and bins into profiles the library reads', () => {
  const run = () => { const t = createTape({ seed: 7 }); return Array.from({ length: SESSION_MINUTES * 2 + 30 }, () => t.next()) }
  const mins = run()
  assert.deepEqual(mins, run(), 'the same seed is the same tape')
  for (let i = 1; i < mins.length; i++) assert.ok(mins[i].time > mins[i - 1].time, 'ascending')
  for (const b of mins) assert.ok(b.high >= Math.max(b.open, b.close) && b.low <= Math.min(b.open, b.close) && b.volume > 0)
  assert.equal(mins[0].time, sessionOpen(0))
  assert.equal(mins[SESSION_MINUTES].time, sessionOpen(1), 'the minute after the close is the next session\'s open')
  assert.equal(sessionOf(mins[5].time), sessionOpen(0))
  assert.equal(sessionOf(mins[SESSION_MINUTES + 5].time), sessionOpen(1))

  // Heavy at the open and into the close, quiet in the middle: what makes the profile believable.
  const vol = (a, b) => mins.slice(a, b).reduce((s, x) => s + x.volume, 0) / (b - a)
  assert.ok(vol(0, 20) > 1.5 * vol(180, 220), 'the open is busier than midday')
  assert.ok(vol(SESSION_MINUTES - 20, SESSION_MINUTES) > 1.3 * vol(180, 220), 'and so is the close')

  const data = buildProfiles(mins, { sessionOf, source: 'tape', developing: true })
  const read = normalizeData(data)
  assert.equal(read.sessions.length, 3)
  assert.deepEqual(read.sessions.map((s) => s.developing), [false, false, true])
  for (const s of read.sessions) assert.ok(s.n >= 8 && s.poc > s.val && s.poc < s.vah, `a session of ${s.n} bins with its POC inside its value area`)
  assert.equal(splitSessions(mins, sessionOf).flatMap((g) => aggregate(g, 5 * MIN)).length, 78 * 2 + 6, '78 five-minute candles a session')
})
