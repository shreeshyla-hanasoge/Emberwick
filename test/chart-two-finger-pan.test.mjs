/**
 * Two-finger pan and pinch hygiene.
 *
 * A pinch used to be a zoom and nothing else: moving both fingers together
 * did nothing, a third finger froze the pinch and started a pan of its own,
 * and lifting one finger of a zoom left the other driving a crosshair. On a
 * phone the pair is the only way to reposition while one finger belongs to
 * something else — a drawing tool, most of all — so the pair has to pan.
 *
 * Every test drives the real handlers with pointerType 'touch', as
 * chart-touch does.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`)

/** Two fingers down at x0 and x1 (same y), plus one still move to record the midpoint. */
const pinch = (chart, x0, x1, y = 200) => {
  chart._onDown(touch(x0, y, 1))
  chart._onDown(touch(x1, y, 2))
  chart._onMove(touch(x0, y, 1))
}

// ------------------------------------------------------------------- pan

test('moving both fingers together pans by the midpoint delta', () => {
  const chart = charted()
  pinch(chart, 300, 500)
  const s0 = chart.ts._spacing.target
  const barAt400 = chart.ts.index(400)

  // Each finger moves 40px left, one event at a time — the distance changes
  // in between, so this is a pan with a zoom and its exact undo inside it.
  chart._onMove(touch(260, 200, 1))
  chart._onMove(touch(460, 200, 2))
  settle(chart)

  near(chart.ts.spacing, s0, 'the zoom came back to where it started')
  near(chart.ts.index(360), barAt400, 'the bar that was under the midpoint followed it 40px left')
})

test('the bar under the midpoint stays under it on every move, not after an ease', () => {
  // panBy() jumps; if the zoom eased, the next move's panBy() would throw the
  // right-edge half of it away and the pinch would slide off the fingers.
  const chart = charted()
  pinch(chart, 300, 500)
  const moves = [[1, 250], [2, 560], [1, 200], [2, 520], [1, 240]]
  const at = { 1: 300, 2: 500 }
  let mid = 400
  let bar = chart.ts.index(mid)
  for (const [id, x] of moves) {
    at[id] = x
    chart._onMove(touch(x, 200, id))
    frame(chart)                        // a browser draws between two moves
    const m = (at[1] + at[2]) / 2
    near(chart.ts.index(m), bar, `after finger ${id} moved to ${x}, the bar is still under the midpoint`, 1e-6)
    mid = m
    bar = chart.ts.index(mid)
  }
})

test('a pure spread zooms at the midpoint and does not pan', () => {
  const chart = charted()
  pinch(chart, 300, 500)
  const s0 = chart.ts._spacing.target
  const barAt400 = chart.ts.index(400)

  chart._onMove(touch(250, 200, 1))
  chart._onMove(touch(550, 200, 2))
  settle(chart)

  near(chart.ts.spacing, s0 * 1.5, 'spread 200 -> 300 zooms by 1.5')
  near(chart.ts.index(400), barAt400, 'the bar under the fingers did not move')
})

test('lifting the fingers forgets the midpoint, so the next pinch starts with no jump', () => {
  const chart = charted()
  pinch(chart, 300, 500)
  chart._onUp(touch(300, 200, 1))
  chart._onUp(touch(500, 200, 2))

  const right = chart.ts._right.target
  // A new pair somewhere else. With a stale midpoint of 400, the first move
  // would pan the chart by 250px towards the new pair.
  chart._onDown(touch(100, 200, 3))
  chart._onDown(touch(200, 200, 4))
  chart._onMove(touch(100, 200, 3))
  assert.equal(chart.ts._right.target, right, 'the first move of a new pinch pans nothing')
})

// --------------------------------------------------------- a third finger

test('a third finger during a pinch neither pans nor freezes the pinch', async () => {
  const chart = charted({ touchCrosshairDelay: 10 })
  pinch(chart, 300, 500)
  const right = chart.ts._right.target
  const s0 = chart.ts._spacing.target

  chart._onDown(touch(700, 300, 3))
  chart._onMove(touch(640, 300, 3))
  chart._onMove(touch(580, 300, 3))
  assert.equal(chart.ts._right.target, right, 'the third finger did not pan')
  await sleep(30)
  assert.equal(chart.cursor, null, 'nor did it start a hold that drops a crosshair')

  chart._onMove(touch(600, 200, 2))
  assert.notEqual(chart.ts._spacing.target, s0, "the pair's next move still zooms")
  assert.equal(chart.cursor, null, 'and still draws no crosshair')
})

test('a finger leaving a three-finger touch re-seeds the pinch from the pair that remains', () => {
  const chart = charted()
  pinch(chart, 300, 500)
  chart._onDown(touch(800, 200, 3))
  chart._onUp(touch(300, 200, 1))       // the pair is now fingers 2 and 3, 300px apart

  const s0 = chart.ts._spacing.target
  chart._onMove(touch(800, 200, 3))     // a still move
  near(chart.ts._spacing.target, s0, 'a still move does not zoom by 300/200')
})

// ------------------------------------------------------ the finger left behind

test('after one pinch finger lifts, the other pans and draws no crosshair', () => {
  const chart = charted()
  pinch(chart, 300, 500)
  chart._onUp(touch(500, 200, 2))

  const right = chart.ts._right.target
  const s = chart.ts.spacing
  chart._onMove(touch(250, 200, 1))
  assert.equal(chart.cursor, null, 'no crosshair tracks the remaining finger')
  near(chart.ts._right.target - right, 50 / s, 'it panned by exactly the 50px it moved')

  chart._onUp(touch(250, 200, 1))
  assert.equal(chart.cursor, null, 'and its lift is not a tap')
})

test('the finger left behind pans horizontally only, so the pane keeps autoscale', () => {
  const chart = charted()
  pinch(chart, 300, 500)
  chart._onUp(touch(500, 200, 2))
  const lo = chart.ps.lo
  chart._onMove(touch(300, 260, 1))
  chart._onMove(touch(300, 320, 1))
  assert.equal(chart.ps.auto, true, 'no vertical pan took the pane out of autoscale')
  assert.equal(chart.ps.lo, lo)
})

test('a pinch still dismisses a crosshair the first finger placed', () => {
  const chart = charted()
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  assert.ok(chart.cursor, 'the tap placed one')
  pinch(chart, 300, 500)
  assert.equal(chart.cursor, null)
})
