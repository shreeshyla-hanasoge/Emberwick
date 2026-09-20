/**
 * fitContent and timeZone — the two things a finished dataset needs that a
 * live chart does not: the whole run in view, and labels in the zone the
 * session is defined in.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { createTimeFormatter } = await import('../src/chart/core/formatters.js')
const { TimeScale } = await import('../src/chart/core/TimeScale.js')

const MIN = 60_000
/** 09:15 IST == 03:45 UTC — the NSE open. */
const OPEN = Date.UTC(2026, 8, 18, 3, 45)
const session = (dayOffset = 0, n = 375) =>
  Array.from({ length: n }, (_, i) => ({
    time: OPEN + dayOffset * 86_400_000 + i * MIN,
    open: 100, high: 101, low: 99, close: 100.5,
  }))
const axisLabels = (chart) =>
  chart.layers.canvas.base.ops
    .filter((o) => o.op === 'fillText')
    .map((o) => o.args[0])
    .filter((t) => /^\d{2}:\d{2}$|^\d+ [A-Z][a-z]{2}$/.test(t))

// ------------------------------------------------------------- fitContent
test('fitContent puts the whole dataset on screen', () => {
  for (const n of [375, 4000]) {
    const chart = createChart(makeContainer())
    chart.setData(makeBars(OPEN, n, MIN))
    assert.equal(chart.fitContent(), true)
    settle(chart)
    const { from, to } = chart.ts.visibleRange()
    assert.equal(from, 0, `${n} bars: the first bar must be in view`)
    assert.equal(to, n - 1, `${n} bars: so must the last`)
    chart.destroy()
  }
})

test('fitContent is not animated', () => {
  // Easing 4,000 bars from 9px to 0.2px reads as a glitch, not as polish.
  const chart = createChart(makeContainer())
  chart.setData(makeBars(OPEN, 2000, MIN))
  settle(chart)
  chart.fitContent()
  assert.equal(chart.ts._spacing.value, chart.ts._spacing.target, 'spacing must land immediately')
  assert.equal(chart.ts._right.value, chart.ts._right.target)
  chart.destroy()
})

test('fitting past minSpacing lowers it, so the next zoom is continuous', () => {
  // minSpacing exists to stop a wheel gesture burying the chart in mush. An
  // explicit fit is a different intent, and clamping it would both hide part
  // of the dataset and make the first zoom-in jump back to the old floor.
  const ts = new TimeScale()
  ts.resize(900)
  const before = ts.minSpacing
  ts.fitContent(4000)
  assert.ok(ts.spacing < before, 'the fit must actually go below the interactive floor')
  assert.ok(ts.minSpacing <= ts.spacing, 'and the floor must follow it down')

  const at = ts.spacing
  ts.zoomAt(450, 1.05)
  assert.ok(ts._spacing.target / at < 1.5,
    'a small zoom must stay small, not snap back up to the old floor')
})

test('fitContent declines when there is nothing to fit', () => {
  const chart = createChart(makeContainer())
  assert.equal(chart.fitContent(), false, 'no bars')
  chart.setData(makeBars(OPEN, 1, MIN))
  assert.equal(chart.fitContent(), false, 'one bar has no span')
  chart.setData(makeBars(OPEN, 10, MIN))
  assert.equal(chart.fitContent(), true)
  chart.destroy()
  assert.equal(chart.fitContent(), false, 'destroyed')
})

test('fitContent returns the price scale to autoscale', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(OPEN, 200, MIN))
  chart.ps.scaleBy(2)                 // a manual axis drag clears auto
  assert.equal(chart.ps.auto, false)
  chart.fitContent()
  assert.equal(chart.ps.auto, true, 'fitting the content means fitting it vertically too')
  chart.destroy()
})

// --------------------------------------------------------------- timeZone
test('the formatter renders each zone correctly', () => {
  const kolkata = createTimeFormatter('Asia/Kolkata')
  const utc = createTimeFormatter('UTC')
  const ny = createTimeFormatter('America/New_York')

  assert.equal(kolkata.axis(OPEN, MIN), '09:15', 'the NSE open is 09:15 in Kolkata')
  assert.equal(utc.axis(OPEN, MIN), '03:45')
  assert.equal(ny.axis(OPEN, MIN), '23:45', 'and the previous evening in New York')

  assert.equal(kolkata.full(OPEN), '2026-09-18 09:15')
  assert.equal(ny.full(OPEN), '2026-09-17 23:45')
  assert.equal(kolkata.date(OPEN), '18 Sep')
})

test('midnight renders as 00:00, not 24:00', () => {
  const f = createTimeFormatter('Asia/Kolkata')
  const midnightIST = Date.UTC(2026, 8, 19, 18, 30)
  assert.equal(f.axis(midnightIST, MIN), '00:00')
  assert.equal(f.full(midnightIST).slice(-5), '00:00')
})

test('dayKey rolls at the zone midnight, not the browser one', () => {
  const kolkata = createTimeFormatter('Asia/Kolkata')
  const justBefore = Date.UTC(2026, 8, 19, 18, 29)
  const justAfter = Date.UTC(2026, 8, 19, 18, 30) // 00:00 in Kolkata
  assert.notEqual(kolkata.dayKey(justBefore), kolkata.dayKey(justAfter))
  assert.equal(kolkata.dayKey(justAfter) - kolkata.dayKey(justBefore), 1)

  // The assertion that actually pins zone-awareness: at that instant it is
  // still the PREVIOUS day in New York. A dayKey computed from browser-local
  // time passes the check above whenever the machine happens to be in IST.
  const ny = createTimeFormatter('America/New_York')
  assert.equal(ny.dayKey(justAfter), 20260919)
  assert.equal(kolkata.dayKey(justAfter), 20260920)
})

test('a daily timeframe labels dates rather than times', () => {
  const f = createTimeFormatter('UTC')
  assert.equal(f.axis(OPEN, 86_400_000), '18 Sep')
})

test('axis labels are rendered in the configured zone', () => {
  const bars = session()
  const inZone = (zone) => {
    const chart = createChart(makeContainer(), zone ? { timeZone: zone } : {})
    chart.setData(bars)
    chart.fitContent()
    settle(chart)
    clearOps(chart)
    frame(chart)
    const out = axisLabels(chart)
    chart.destroy()
    return out
  }
  const ist = inZone('Asia/Kolkata')
  const utc = inZone('UTC')

  assert.ok(ist.length > 1 && utc.length > 1, 'both must actually label the axis')
  assert.notDeepEqual(ist, utc, 'a zone change must move the labels')
  // Every IST label is 5h30m ahead of the UTC one at the same tick.
  assert.ok(ist.some((l) => l.startsWith('1')), `IST session labels look wrong: ${ist}`)
})

test('setTimeZone re-labels a live chart', () => {
  const chart = createChart(makeContainer(), { timeZone: 'UTC' })
  chart.setData(session())
  chart.fitContent()
  settle(chart); clearOps(chart); frame(chart)
  const utc = axisLabels(chart)

  chart.setTimeZone('Asia/Kolkata')
  settle(chart); clearOps(chart); frame(chart)
  const ist = axisLabels(chart)

  assert.notDeepEqual(ist, utc)
  chart.setTimeZone(null)
  assert.equal(chart.fmt.zone, null, 'null returns to the browser zone')
  chart.destroy()
})

test('a multi-day intraday chart labels its day boundaries', () => {
  // The old rule only printed a date at local midnight — a moment an
  // intraday instrument never trades, so a three-day chart showed none.
  const chart = createChart(makeContainer(), { timeZone: 'Asia/Kolkata' })
  chart.setData([...session(0), ...session(1), ...session(2)])
  chart.fitContent()
  settle(chart); clearOps(chart); frame(chart)

  const dates = axisLabels(chart).filter((l) => /^\d+ [A-Z][a-z]{2}$/.test(l))
  assert.ok(dates.length >= 2, `expected date labels at the session boundaries, got ${JSON.stringify(axisLabels(chart))}`)
  chart.destroy()
})

test('a single-day chart does not label a boundary that is not there', () => {
  const chart = createChart(makeContainer(), { timeZone: 'Asia/Kolkata' })
  chart.setData(session())
  chart.fitContent()
  settle(chart); clearOps(chart); frame(chart)
  const dates = axisLabels(chart).filter((l) => /^\d+ [A-Z][a-z]{2}$/.test(l))
  assert.equal(dates.length, 0, 'one session, no day change')
  chart.destroy()
})

test('no timeZone keeps the browser-local behaviour', () => {
  const local = createTimeFormatter(null)
  const d = new Date(OPEN)
  const pad = (n) => String(n).padStart(2, '0')
  assert.equal(local.axis(OPEN, MIN), `${pad(d.getHours())}:${pad(d.getMinutes())}`)
  assert.equal(local.zone, null)
})
