/**
 * Touch crosshair.
 *
 * A finger cannot hover. The mouse model — track on move, pan while a button
 * is held — collapses on touch, because the only way a finger produces a
 * pointermove is by touching, which is also the pan gesture. Before this, one
 * finger drove both at once: the crosshair tracked correctly but the bars slid
 * out from under it, and a tap that never moved drew no crosshair at all.
 *
 * So the two gestures are separated in time instead: tap places, long-press
 * scrubs, an immediate drag pans.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

const charted = (options) => {
  const chart = createChart(makeContainer(), options)
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  settle(chart); frame(chart)
  return chart
}

const touch = (x, y, id = 1) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y })
const mouse = (x, y, id = 1) => ({ pointerId: id, pointerType: 'mouse', clientX: x, clientY: y })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Long enough to outlast a default hold, without slowing the suite down. */
const FAST = { touchCrosshairDelay: 10 }

// ------------------------------------------------------------------ tap

test('a tap places a crosshair that survives the finger lifting', () => {
  const chart = charted()
  assert.equal(chart.cursor, null, 'no crosshair before the tap')

  chart._onDown(touch(400, 200))
  chart._onUp(touch(400, 200))

  assert.ok(chart.cursor, 'the tap placed a crosshair')
  assert.equal(chart.cursor.x, 400)
  assert.equal(chart.cursor.y, 200)

  // pointerleave lands immediately after pointerup on touch, because the
  // pointer stops existing. It must not take the crosshair with it.
  chart._onLeave()
  assert.ok(chart.cursor, 'crosshair survived the pointerleave that follows a lift')
})

test('a tap emits the crosshair payload a readout subscribes to', () => {
  const chart = charted()
  const seen = []
  chart.subscribe('crosshair', (p) => seen.push(p))

  chart._onDown(touch(400, 200))
  chart._onUp(touch(400, 200))

  assert.equal(seen.length, 1)
  assert.ok(seen[0], 'payload is not null')
  assert.ok(Number.isFinite(seen[0].price), 'carries a price')
})

test('a second tap moves the crosshair rather than adding one', () => {
  const chart = charted()
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  chart._onDown(touch(600, 300)); chart._onUp(touch(600, 300))
  assert.equal(chart.cursor.x, 600)
  assert.equal(chart.cursor.y, 300)
})

test('a tap does not pan the chart', () => {
  const chart = charted()
  const before = chart.ts._right.target
  chart._onDown(touch(400, 200))
  chart._onUp(touch(400, 200))
  assert.equal(chart.ts._right.target, before)
})

// ------------------------------------------------------------- long press

test('long-press then drag scrubs the crosshair and does not pan', async () => {
  const chart = charted(FAST)
  const rightBefore = chart.ts._right.target
  const loBefore = chart.ps.lo

  chart._onDown(touch(400, 200))
  await sleep(30)                       // the hold elapses
  assert.ok(chart.cursor, 'the crosshair appears on the hold, before any movement')
  assert.equal(chart.cursor.x, 400, 'it appears where the finger went down')

  chart._onMove(touch(300, 260))
  assert.equal(chart.cursor.x, 300, 'crosshair followed the finger')
  assert.equal(chart.cursor.y, 260)

  assert.equal(chart.ts._right.target, rightBefore, 'not one pixel of horizontal pan')
  assert.equal(chart.ps.lo, loBefore, 'not one pixel of vertical pan')
  assert.equal(chart.ps.auto, true, 'autoscale untouched, so nothing cleared it')

  chart._onUp(touch(300, 260))
  assert.ok(chart.cursor, 'the scrubbed crosshair stays put after the lift')
})

test('a scrub does not fling the chart when the finger lifts', async () => {
  const chart = charted(FAST)
  chart._onDown(touch(400, 200))
  await sleep(30)
  chart._onMove(touch(200, 200))        // fast, far — would be a flick if panning
  chart._onUp(touch(200, 200))
  settle(chart)
  assert.equal(chart.ts._right.target, chart.ts._clampRight(chart.ts._right.target),
    'no inertia carried the view anywhere')
})

// -------------------------------------------------------------------- pan

test('an immediate drag still pans, and hides the crosshair while it does', () => {
  const chart = charted()
  const before = chart.ts._right.target

  chart._onDown(touch(400, 200))
  chart._onMove(touch(340, 200))        // past the slop, before any hold
  chart._onMove(touch(280, 200))
  assert.equal(chart.cursor, null, 'no crosshair during a pan')
  assert.notEqual(chart.ts._right.target, before, 'the chart panned')

  chart._onUp(touch(280, 200))
  assert.equal(chart.cursor, null, 'and none left behind')
})

test('a drag past the slop dismisses a crosshair an earlier tap placed', () => {
  const chart = charted()
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  assert.ok(chart.cursor)

  chart._onDown(touch(400, 200))
  chart._onMove(touch(320, 200))
  assert.equal(chart.cursor, null, 'panning cleared the stale crosshair')
})

test('finger drift under the slop is a tap, not a pan', () => {
  const chart = charted()
  const before = chart.ts._right.target
  chart._onDown(touch(400, 200))
  chart._onMove(touch(404, 203))        // a still finger is never perfectly still
  chart._onUp(touch(404, 203))
  assert.equal(chart.ts._right.target, before, 'drift did not pan')
  assert.ok(chart.cursor, 'drift was read as a tap')
})

test('the pan starts from where the finger is, not where it went down', () => {
  // Otherwise the chart jumps by the slop distance the moment it commits.
  const chart = charted()
  const before = chart.ts._right.target
  chart._onDown(touch(400, 200))
  chart._onMove(touch(389, 200))        // 11px: just past the slop, commits
  assert.equal(chart.ts._right.target, before, 'the committing move itself pans nothing')

  chart._onMove(touch(379, 200))        // 10px further
  // panBy(dx) moves the right edge by -dx/spacing, and dx is negative here.
  const moved = chart.ts._right.target - before
  assert.ok(Math.abs(moved - 10 / chart.ts.spacing) < 1e-6,
    `panned ${moved}, expected exactly the 10px travelled after committing`)
})

// ------------------------------------------------------------------ pinch

test('a second finger dismisses the crosshair and cancels a pending hold', async () => {
  const chart = charted(FAST)
  chart._onDown(touch(400, 200, 1))
  chart._onDown(touch(500, 200, 2))
  await sleep(30)
  assert.equal(chart.cursor, null, 'the hold did not fire under a pinch')

  const before = chart.ts._right.target
  chart._onMove(touch(560, 200, 2))
  assert.notEqual(chart.ts._right.target, before, 'pinch still zooms')
})

// ------------------------------------------------------------- the gutters

test('a long press on the price gutter is still an axis drag', async () => {
  const chart = charted(FAST)
  const gutter = chart.plot.w + 10      // _classifyDrag: x > plot.w is the axis
  chart._onDown(touch(gutter, 200))
  await sleep(30)
  assert.equal(chart.cursor, null, 'no crosshair in the gutter')

  const span = chart.ps.hi - chart.ps.lo
  chart._onMove(touch(gutter, 260))
  settle(chart)                         // the price range eases to its target
  assert.notEqual(chart.ps.hi - chart.ps.lo, span, 'the axis still scaled')
})

// ------------------------------------------------------------- the escapes

test('the page stealing the gesture takes the crosshair with it', async () => {
  const chart = charted(FAST)
  chart._onDown(touch(400, 200))
  await sleep(30)
  assert.ok(chart.cursor)
  chart._onCancel(touch(400, 200))
  assert.equal(chart.cursor, null, 'a cancelled gesture leaves no crosshair')
})

test('hideCrosshair() dismisses a sticky one and reports null to subscribers', () => {
  const chart = charted()
  const seen = []
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  chart.subscribe('crosshair', (p) => seen.push(p))

  chart.hideCrosshair()
  assert.equal(chart.cursor, null)
  assert.deepEqual(seen, [null], 'the readout was told to empty')
})

test('touchCrosshair: false keeps the old one-finger behaviour', () => {
  const chart = charted({ touchCrosshair: false })
  const before = chart.ts._right.target
  chart._onDown(touch(400, 200))
  chart._onMove(touch(340, 200))
  assert.notEqual(chart.ts._right.target, before, 'panned from the first move')
  assert.ok(chart.cursor, 'and tracked the crosshair at the same time, as it used to')
})

test('destroy() during a pending hold leaves no timer behind', async () => {
  const chart = charted(FAST)
  chart._onDown(touch(400, 200))
  chart.destroy()
  await sleep(30)
  assert.equal(chart.cursor, null, 'the hold did not fire into a dead chart')
})

// -------------------------------------------------------------- the mouse

test('a mouse still tracks on hover with no button down', () => {
  const chart = charted()
  chart._onMove(mouse(400, 200))
  assert.ok(chart.cursor, 'hover placed the crosshair')
  assert.equal(chart.cursor.x, 400)
})

test('a mouse drag pans and tracks at once, as it always has', () => {
  const chart = charted()
  const before = chart.ts._right.target
  chart._onDown(mouse(400, 200))
  chart._onMove(mouse(340, 200))
  assert.notEqual(chart.ts._right.target, before, 'panned immediately, no slop')
  assert.ok(chart.cursor, 'and kept tracking')
})

test('a mouse leaving the element still clears the crosshair', () => {
  const chart = charted()
  chart._onMove(mouse(400, 200))
  assert.ok(chart.cursor)
  chart._onLeave()
  assert.equal(chart.cursor, null)
})

test('an event with no pointerType is treated as a mouse', () => {
  // Every existing test, and any consumer driving the chart synthetically.
  const chart = charted()
  const before = chart.ts._right.target
  chart._onDown({ pointerId: 1, clientX: 400, clientY: 200 })
  chart._onMove({ pointerId: 1, clientX: 340, clientY: 200 })
  assert.notEqual(chart.ts._right.target, before)
})
