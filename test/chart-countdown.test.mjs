/**
 * The candle-close countdown in the last-price tag.
 *
 * The chart computes the TEXT (clock, replay phase, stale-data rule) and the
 * candle renderer only draws it, so most of this drives chart._countdown()
 * through a frame and reads the recorded tag back. The recording context's
 * measureText always answers 10, so every tag geometry below is exact.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps, drawnText } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart, fmtCountdown, RandomFeed } = await import('../src/chart/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const HOUR = 36e5
const DAY = 864e5

/** A chart on `count` bars of `tf`, with a fixed clock. */
const charted = (clock, { count = 50, tf = MIN, ...options } = {}) => {
  const chart = createChart(makeContainer(), { clock, ...options })
  chart.setData(makeBars(T0, count, tf, 100))
  settle(chart); frame(chart)
  return chart
}

const lastOpen = (chart) => chart.bars[chart.bars.length - 1].time

/** The last-price tag: its box and the texts drawn in it. */
const tag = (chart) => {
  clearOps(chart)
  frame(chart)
  const ops = chart.layers.canvas.main.ops
  const rects = ops.filter((o) => o.op === 'fillRect').map((o) => o.args)
  // The tag box is the only fillRect that starts past the plot's right edge.
  const box = rects.filter((r) => r[0] === chart.plot.w + 1)
  const texts = drawnText(chart, 'main').filter((t) => t.x === chart.plot.w + 8)
  return { box, texts }
}

// ------------------------------------------------------------- formatter --

test('fmtCountdown takes its shape from the timeframe, not from what is left', () => {
  assert.equal(fmtCountdown(59_000, MIN), '00:59')
  assert.equal(fmtCountdown(5 * MIN, 5 * MIN), '05:00')
  assert.equal(fmtCountdown(1_000, HOUR), '0:00:01')
  assert.equal(fmtCountdown(HOUR - 1, HOUR), '1:00:00')
  assert.equal(fmtCountdown(4 * HOUR - 1000, 4 * HOUR), '3:59:59')
  assert.equal(fmtCountdown(DAY - 1000, DAY), '0d 23:59:59')
  assert.equal(fmtCountdown(6 * DAY + 3 * HOUR + 1000, 7 * DAY), '6d 03:00:01')
})

test('fmtCountdown rounds seconds up and never goes below zero', () => {
  assert.equal(fmtCountdown(1, MIN), '00:01', 'a bar shows 00:01 until the instant it closes')
  assert.equal(fmtCountdown(0, MIN), '00:00')
  assert.equal(fmtCountdown(-5000, MIN), '00:00')
  assert.equal(fmtCountdown(59_001, MIN), '01:00')
})

test('the box widens to the countdown when it is wider than the price', () => {
  let now = 0
  const chart = charted(() => now, { tf: 4 * HOUR })
  now = lastOpen(chart) + 1000
  // 6px a character: '100.00' is 36 wide, '3:59:59' is 42.
  chart.layers.ctx.main.measureText = (t) => ({ width: String(t).length * 6 })
  const { box, texts } = tag(chart)
  assert.deepEqual(texts.map((t) => t.text), ['100.00', '3:59:59'])
  assert.equal(box[0][2], 42 + 14, 'the box is as wide as the wider of the two texts')
  chart.destroy()
})

// ------------------------------------------------------------------ rule --

test('history alone draws the single-row tag it always did', () => {
  const chart = charted(undefined)   // Date.now(), decades past T0
  const { box, texts } = tag(chart)
  const y = Math.round(chart.ps.y(100)) + 0.5
  assert.deepEqual(box, [[chart.plot.w + 1, y - 9, 24, 18]])
  assert.deepEqual(texts.map((t) => t.text), ['100.00'])
  assert.equal(chart._countdownTimer, null, 'no countdown, no timer')
  chart.destroy()
})

test('with the clock inside the forming bar the tag grows a countdown row', () => {
  let now = 0
  const chart = charted(() => now)
  now = lastOpen(chart) + 23_400
  const { box, texts } = tag(chart)
  const y = Math.round(chart.ps.y(100)) + 0.5
  assert.deepEqual(box, [[chart.plot.w + 1, y - 15, 24, 30]], 'one box, centred on the line')
  assert.deepEqual(texts, [
    { text: '100.00', x: chart.plot.w + 8, y: y - 7 },
    { text: '00:37', x: chart.plot.w + 8, y: y + 8 },
  ])
  chart.destroy()
})

test('the row counts down as the clock advances', () => {
  let now = 0
  const chart = charted(() => now)
  now = lastOpen(chart)
  assert.equal(chart._countdown(), '01:00')
  now += 30_000
  assert.equal(chart._countdown(), '00:30')
  now += 29_999
  assert.equal(chart._countdown(), '00:01')
  chart.destroy()
})

test('a closed bar whose successor has not arrived reads 00:00; a whole bar later it is stale and hidden', () => {
  let now = 0
  const chart = charted(() => now)
  const close = lastOpen(chart) + MIN
  now = close
  assert.equal(chart._countdown(), '00:00')
  now = close + MIN - 1
  assert.equal(chart._countdown(), '00:00')
  now = close + MIN
  assert.equal(chart._countdown(), null)
  chart.destroy()
})

test('a clock slightly behind the bars clamps to a full bar rather than blinking the tag', () => {
  let now = 0
  const chart = charted(() => now)
  now = lastOpen(chart) - 2_000
  assert.equal(chart._countdown(), '01:00')
  now = lastOpen(chart) - MIN
  assert.equal(chart._countdown(), '01:00')
  now = lastOpen(chart) - MIN - 1
  assert.equal(chart._countdown(), null, 'more than a bar behind is a different clock, not skew')
  chart.destroy()
})

test('the shape follows the chart timeframe', () => {
  let now = 0
  const chart = charted(() => now, { tf: HOUR })
  now = lastOpen(chart) + 61_000
  assert.equal(chart._countdown(), '0:58:59')
  chart.destroy()
})

test('a non-numeric clock, or a bar without a time, hides the row instead of throwing', () => {
  const chart = charted(() => NaN)
  assert.equal(chart._countdown(), null)
  chart.options.clock = () => 'soon'
  assert.equal(chart._countdown(), null)
  chart.options.clock = () => lastOpen(chart)
  chart.bars[chart.bars.length - 1].time = 'noon'
  assert.doesNotThrow(() => frame(chart))
  assert.equal(chart._countdown(), null)
  chart.destroy()
})

// --------------------------------------------------------------- options --

test('countdown: false and setCountdown() switch the row off and on', () => {
  let now = 0
  const chart = charted(() => now, { countdown: false })
  now = lastOpen(chart) + 1000
  assert.equal(chart._countdown(), null)
  assert.equal(tag(chart).box[0][3], 18)

  chart.setCountdown(true)
  assert.equal(chart.options.countdown, true)
  assert.equal(chart._countdown(), '00:59')
  assert.equal(tag(chart).box[0][3], 30)

  chart.setCountdown(false)
  assert.equal(chart.options.countdown, false)
  assert.equal(tag(chart).box[0][3], 18)
  chart.destroy()
})

test('the clock is options.clock, else the feed\'s now(), else Date.now()', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 10, MIN))
  settle(chart)
  const open = lastOpen(chart)
  assert.equal(chart._countdown(), null, 'Date.now() is decades past T0')

  chart.feed = { now: () => open + 10_000 }
  assert.equal(chart._countdown(), '00:50', 'the feed knows its own clock')

  chart.options.clock = () => open + 40_000
  assert.equal(chart._countdown(), '00:20', 'the host\'s clock wins over the feed\'s')
  chart.destroy()
})

test('RandomFeed.now() runs `speed` times faster inside the forming slot, so its bar counts a whole timeframe down', () => {
  const feed = new RandomFeed({ timeframe: MIN, speed: 60 })
  const real = Date.now()
  const slot = Math.floor(real / 1000) * 1000
  const now = feed.now()
  // Within the slot the synthetic clock has advanced 60x the real time.
  assert.ok(now >= slot && now < slot + MIN, `${now} should lie in the forming bar [${slot}, ${slot + MIN})`)
  assert.ok(Math.abs(now - (slot + (Date.now() - slot) * 60)) <= 60 * 50, 'off by at most ~50ms real time')
  feed.destroy()
})

test('a paused RandomFeed stops its clock, and resuming restarts it', async () => {
  const feed = new RandomFeed({ timeframe: MIN, speed: 60 })
  const off = feed.subscribe(() => {})
  feed.setPaused(true)
  const frozen = feed.now()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(feed.now(), frozen, 'paused, now() holds')
  feed.setPaused(false)
  await new Promise((r) => setTimeout(r, 30))
  assert.notEqual(feed.now(), frozen, 'running again, it moves')
  off()
  feed.destroy()
})

// ---------------------------------------------------------------- replay --

test('under replay the countdown is the replay phase, not the clock', () => {
  const chart = charted(() => Date.now(), { count: 200, tf: 5 * MIN })
  const replay = chart.startReplay({ from: 100, speed: 1, baseInterval: 1000 })
  assert.equal(chart._countdown(), '05:00', 'a seek starts the bar afresh')
  replay.play()
  frame(chart, 250)
  assert.equal(chart._countdown(), '03:45')
  frame(chart, 500)
  assert.equal(chart._countdown(), '01:15')
  replay.pause()
  frame(chart, 500)
  assert.equal(chart._countdown(), '05:00', 'pause() drops the partial bar: paused, the bar is whole')
  replay.play()
  frame(chart, 250)
  assert.equal(chart._countdown(), '03:45', 'and play() starts it afresh')
  frame(chart, 1000)
  assert.equal(replay.index, 101)
  assert.equal(chart._countdown(), '03:45', 'the next bar opened and is a quarter played')
  assert.equal(chart._countdownTimer, null, 'replay keeps its own time; no timer')
  chart.destroy()
})

test('replay.phase is the fraction of the current bar played, 0..1', () => {
  const chart = charted(undefined, { count: 50 })
  const replay = chart.startReplay({ from: 10, baseInterval: 2000 })
  assert.equal(replay.phase, 0)
  replay.play()
  frame(chart, 400)
  assert.ok(Math.abs(replay.phase - 0.2) < 1e-9, `phase ${replay.phase} should be 400ms of a 2000ms bar`)
  replay.seek(20)
  assert.equal(replay.phase, 0, 'a seek starts the bar afresh')
  chart.destroy()
})

// ----------------------------------------------------------------- timer --

test('a frame that draws a countdown arms one repaint at the next second; destroy() clears it', () => {
  let now = 0
  const calls = []
  const realSet = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  globalThis.setTimeout = (fn, ms) => { calls.push({ fn, ms }); return { id: calls.length, unref() {} } }
  globalThis.clearTimeout = (t) => calls.push({ cleared: t })
  try {
    const chart = charted(() => now)
    now = lastOpen(chart) + 12_345
    clearOps(chart); frame(chart)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].ms, 1000 - 345 + 1, 'due just past the next whole second of the clock')
    const timer = chart._countdownTimer
    assert.ok(timer, 'the timer is held so destroy() can clear it')

    frame(chart)
    assert.equal(calls.length, 1, 'at most one pending')

    // The timer fires: it marks main dirty, and the next frame re-arms.
    calls[0].fn()
    assert.equal(chart._countdownTimer, null)
    assert.ok(chart.loop._dirty.has('main'))
    frame(chart)
    assert.equal(calls.length, 2)

    chart.destroy()
    assert.ok(calls.some((c) => c.cleared && c.cleared.id === 2), 'the pending timer was cleared')
    assert.equal(chart._countdownTimer, null)
    chart._armCountdown()
    assert.equal(calls.length, 3, 'nothing arms after destroy()')
  } finally {
    globalThis.setTimeout = realSet
    globalThis.clearTimeout = realClear
  }
})

test('a timer that fires after destroy() does not touch the loop', () => {
  let now = 0
  let fired = null
  const realSet = globalThis.setTimeout
  globalThis.setTimeout = (fn) => { fired = fn; return 1 }
  try {
    const chart = charted(() => now)
    now = lastOpen(chart)
    frame(chart)
    assert.ok(fired)
    chart.destroy()
    chart._countdownTimer = 1 // pretend destroy() missed it
    assert.doesNotThrow(() => fired())
    assert.ok(!chart.loop._dirty.has('main'))
  } finally {
    globalThis.setTimeout = realSet
  }
})
