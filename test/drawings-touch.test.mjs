/**
 * Drawings under a finger.
 *
 * A finger is not a small mouse. It cannot hover, so nothing may be decided by
 * where it WAS; it lands tens of milliseconds before its partner in a pinch, so
 * nothing may be placed on the first touch; and it already means "pan" for the
 * chart, so a drawing may take it only when the reader has said so — by
 * arming a tool, or by selecting the drawing first. Each test here is one of
 * those promises, driven the way a browser drives it: chart._onDown/_onMove/
 * _onUp/_onCancel with pointer ids, through the real plugin hooks.
 *
 * Identity checks on the chart's own objects use assert.ok(a === b), never
 * assert.equal: the recording canvas answers every property, so a failing
 * equal that has to print a chart or a context can run for minutes.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, frame, settle, clearOps } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { enableDrawings } = await import('../src/drawings/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

const wavy = (n, t0 = T0) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7)
  return { time: t0 + i * MIN, open: c - 0.5, high: c + 1 + (i % 3) * 0.3, low: c - 1 - (i % 4) * 0.2, close: c + 0.3, volume: 10 + i }
})

const seq = () => { let n = 0; return () => 'd' + ++n }
let clock = 50_000
const finger = (id, x, y, o = {}) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0, buttons: 1, timeStamp: (clock += 1000), preventDefault() {}, ...o })
const f1 = (x, y, o) => finger(1, x, y, o)
const f2 = (x, y, o) => finger(2, x, y, o)
const f3 = (x, y, o) => finger(3, x, y, o)
const key = (k, o = {}) => ({ key: k, prevented: false, preventDefault() { this.prevented = true }, ...o })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function setup({ bars = wavy(300), drawings = {}, chart: chartOpts = {} } = {}) {
  const chart = createChart(makeContainer(), chartOpts)
  chart.setData(bars)
  settle(chart); frame(chart)
  const dc = enableDrawings(chart, {
    idFactory: seq(), magnet: 'off', platform: 'other', prefersReducedMotion: () => false, motion: 'none', ...drawings,
  })
  frame(chart)
  return { chart, dc }
}

const X = (chart, u) => chart.ts.x(u)
const Y = (chart, p) => chart.ps.y(p)
const T = (chart, i) => chart.bars[i].time
const slotOf = (chart, x) => Math.round(chart.ts.index(x))

function line(chart, dc, i0, p0, i1, p1, extra = {}) {
  const id = dc.add({ type: 'trendLine', points: [{ time: T(chart, i0), price: p0 }, { time: T(chart, i1), price: p1 }], ...extra })
  frame(chart)
  return id
}

function box(chart, dc, i0, p0, i1, p1, extra = {}) {
  const id = dc.add({ type: 'rectangle', points: [{ time: T(chart, i0), price: p0 }, { time: T(chart, i1), price: p1 }], ...extra })
  frame(chart)
  return id
}

/** A tap: down and up on the same spot. */
function tap(chart, x, y, id = 1) {
  chart._onDown(finger(id, x, y))
  chart._onUp(finger(id, x, y))
}

/** A one-finger drag in steps of at most 6 px. */
function swipe(chart, [x0, y0], [x1, y1], { id = 1, up = true } = {}) {
  chart._onDown(finger(id, x0, y0))
  const steps = Math.max(2, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 6))
  for (let i = 1; i <= steps; i++) chart._onMove(finger(id, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps))
  if (up) chart._onUp(finger(id, x1, y1))
}

const textarea = (chart) => chart.container.children.filter((c) => c.tagName === 'TEXTAREA').pop()

// ------------------------------------------------------------------ browsing (nothing selected)

test('a finger on an unselected drawing pans the chart and leaves the drawing alone', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102)
  const d0 = dc.get(id)
  const r0 = chart.ts.right
  const x = X(chart, 260)
  const y = Y(chart, 101)
  chart._onDown(f1(x, y))
  assert.ok(chart._owner === null, 'the plugin did not claim it')
  swipe(chart, [x, y], [x + 90, y], { up: false })
  chart._onUp(f1(x + 90, y))
  assert.ok(chart.ts.right < r0 - 5, 'the chart panned')
  assert.deepEqual(dc.get(id), d0, 'the drawing did not move')
  assert.deepEqual(dc.selection, [], 'and was not selected by being panned over')
})

test('a tap selects a drawing without dropping a crosshair, and the next drag moves it', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102)
  const d0 = dc.get(id)
  const x = X(chart, 260)
  const y = Y(chart, 101)
  tap(chart, x, y)
  assert.deepEqual(dc.selection, [id])
  assert.ok(chart.cursor === null, 'consumed: no crosshair on touch')
  assert.equal(chart._stickyCursor, false)
  clearOps(chart)
  frame(chart)
  // The selection's chrome is drawn for a finger: handles at the touch size (7), not the mouse's 4.5.
  const radii = chart.layers.canvas.plugins.ops.filter((o) => o.op === 'arc').map((o) => o.args[2])
  assert.ok(radii.filter((r) => Math.abs(r - 7) < 1e-9).length >= 2, `finger-sized handles: ${radii}`)
  // Now selected: a finger on its body drags it, by whole bars.
  const dx = 5 * chart.ts.spacing
  const r0 = chart.ts.right
  swipe(chart, [x, y], [x + dx, y - 20])
  assert.equal(chart.ts.right, r0, 'the chart did not pan')
  const d1 = dc.get(id)
  assert.equal(d1.points[0].time, d0.points[0].time + 5 * MIN)
  assert.equal(d1.points[1].time, d0.points[1].time + 5 * MIN)
})

test('a one-finger drag inside a selected rectangle\'s fill pans the chart, and never moves the box', () => {
  const { chart, dc } = setup()
  const id = box(chart, dc, 240, 104, 275, 97)
  dc.select(id)
  frame(chart)
  const d0 = dc.get(id)
  const r0 = chart.ts.right
  // Inside the fill, clear of the touch move handle at its centre.
  const x = X(chart, 250)
  const y = Y(chart, 102)
  assert.equal(dc.drawingAt(x, y).part, 'fill')
  swipe(chart, [x, y], [x - 80, y])
  assert.notEqual(chart.ts.right, r0, 'the chart panned')
  assert.deepEqual(dc.get(id), d0, 'the box stayed')
  assert.deepEqual(dc.selection, [id], 'and stayed selected')
})

test('a long press inside a selected rectangle\'s fill still scrubs the crosshair', async () => {
  const { chart, dc } = setup({ chart: { touchCrosshairDelay: 10 } })
  const id = box(chart, dc, 240, 104, 275, 97)
  dc.select(id)
  frame(chart)
  const x = X(chart, 250)
  const y = Y(chart, 102)
  chart._onDown(f1(x, y))
  await sleep(40)
  assert.ok(chart.cursor, 'the hold placed a crosshair')
  chart._onUp(f1(x, y))
})

test('the move handle at the middle of a selected line drags the whole line, from a finger that is off the line itself', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102)
  dc.select(id)
  frame(chart)
  const d0 = dc.get(id)
  const mx = (X(chart, 250) + X(chart, 270)) / 2
  const my = (Y(chart, 100) + Y(chart, 102)) / 2
  // 19 px below the middle: outside a finger's 14 px reach of the line, inside the 22 px of the move handle.
  assert.equal(dc.drawingAt(mx, my + 19), null, 'a mouse would miss the line here entirely; only the touch-only handle reaches it')
  swipe(chart, [mx, my + 19], [mx + 4 * chart.ts.spacing, my + 19])
  const d1 = dc.get(id)
  assert.equal(d1.points[0].time, d0.points[0].time + 4 * MIN)
  assert.equal(d1.points[1].time, d0.points[1].time + 4 * MIN)
})

test('the same finger on a line that is NOT selected has no move handle to find: it pans', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102)
  const d0 = dc.get(id)
  const mx = (X(chart, 250) + X(chart, 270)) / 2
  const my = (Y(chart, 100) + Y(chart, 102)) / 2
  const r0 = chart.ts.right
  swipe(chart, [mx, my + 19], [mx + 80, my + 19])
  assert.notEqual(chart.ts.right, r0)
  assert.deepEqual(dc.get(id), d0)
})

test('an endpoint handle moves that end only, and it does not jump under the finger', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102)
  dc.select(id)
  frame(chart)
  const d0 = dc.get(id)
  // Land 14 px right and 10 px below the end handle, inside a touch target.
  const hx = X(chart, 270)
  const hy = Y(chart, 102)
  const s = chart.ts.spacing
  chart._onDown(f1(hx + 14, hy + 10))
  chart._onMove(f1(hx + 14 + 3, hy + 10))
  chart._onMove(f1(hx + 14 + 30, hy + 10))
  frame(chart)
  chart._onUp(f1(hx + 14 + 30, hy + 10))
  const d1 = dc.get(id)
  assert.deepEqual(d1.points[0], d0.points[0], 'the other end did not move')
  // The handle keeps its offset from the finger: it moved by the finger's travel (30px), not to the finger.
  const expectedU = slotOf(chart, hx + 30)
  assert.equal(d1.points[1].time, T(chart, expectedU))
  assert.ok(Math.abs(s * (expectedU - 270)) <= 30 + s, 'a whole-bar move of about the finger\'s travel')
})

test('a tap on empty plot with a selection deselects it, with no crosshair', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102)
  dc.select(id)
  frame(chart)
  tap(chart, X(chart, 200), Y(chart, 108))
  assert.deepEqual(dc.selection, [])
  assert.ok(chart.cursor === null, 'consumed on touch')
  // A second tap on empty plot is then an ordinary crosshair tap.
  tap(chart, X(chart, 200), Y(chart, 108))
  assert.ok(chart.cursor, 'nothing left to deselect: the core places its crosshair')
})

test('a tap on a locked drawing selects it; a drag from it pans the chart', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102, { locked: true })
  const x = X(chart, 260)
  const y = Y(chart, 101)
  tap(chart, x, y)
  assert.deepEqual(dc.selection, [id])
  frame(chart)
  const r0 = chart.ts.right
  const d0 = dc.get(id)
  swipe(chart, [x, y], [x + 60, y])
  assert.notEqual(chart.ts.right, r0, 'a locked drawing is no dead zone')
  assert.deepEqual(dc.get(id), d0)
})

// ------------------------------------------------------------------ creating

test('armed: a one-finger drag creates a drawing, with no hold and no scrub', async () => {
  const { chart, dc } = setup({ chart: { touchCrosshairDelay: 5 } })
  dc.setTool('trendLine')
  const x0 = X(chart, 240)
  const y0 = Y(chart, 100)
  chart._onDown(f1(x0, y0))
  await sleep(30)
  assert.ok(chart.cursor === null, 'the hold timer never started: no scrub crosshair')
  const r0 = chart.ts.right
  for (let i = 1; i <= 8; i++) chart._onMove(f1(x0 + i * 10, y0 - i * 4))
  chart._onUp(f1(x0 + 80, y0 - 32))
  assert.equal(chart.ts.right, r0, 'one finger does not pan while a tool is armed')
  assert.ok(chart.cursor === null)
  const all = dc.getDrawings()
  assert.equal(all.length, 1)
  assert.equal(all[0].points[0].time, T(chart, 240))
})

test('slop catch-up loses no distance: the final anchor moves exactly as far as the finger did', () => {
  const { chart, dc } = setup()
  dc.setTool('trendLine')
  const x0 = X(chart, 240)
  const y0 = Y(chart, 100)
  const s = chart.ts.spacing
  chart._onDown(f1(x0, y0))
  // One move that crosses the 10 px slop in a single event, and then a long way further.
  chart._onMove(f1(x0 + 15, y0))
  chart._onMove(f1(x0 + 15 + 8 * s, y0 - 30))
  chart._onUp(f1(x0 + 15 + 8 * s, y0 - 30))
  const d = dc.getDrawings()[0]
  assert.equal(d.points[0].time, T(chart, 240), 'P0 is where the finger went DOWN')
  assert.equal(d.points[1].time, T(chart, slotOf(chart, x0 + 15 + 8 * s)), 'P1 is where the finger ENDED, not slop-short of it')
  assert.ok(Math.abs(d.points[1].price - chart.ps.price(y0 - 30)) < 1e-9)
})

test('tap-tap creation places one anchor per tap, and survives a pinch between the taps', () => {
  const { chart, dc } = setup()
  dc.setTool('trendLine')
  tap(chart, X(chart, 240), Y(chart, 100))
  assert.equal(dc.getDrawings().length, 0, 'one tap places one anchor, not a drawing')
  assert.equal(dc.tool, 'trendLine')
  const r0 = chart.ts.right
  const s0 = chart.ts.spacing
  // A pinch: two fingers down, apart, up.
  chart._onDown(f1(300, 250))
  chart._onDown(f2(400, 250))
  for (let i = 1; i <= 5; i++) { chart._onMove(f1(300 - i * 8, 250)); chart._onMove(f2(400 + i * 8, 250)) }
  chart._onUp(f2(440, 250))
  chart._onUp(f1(260, 250))
  assert.notEqual(chart.ts.spacing, s0, 'the pinch zoomed')
  assert.ok(r0 !== undefined)
  assert.equal(dc.getDrawings().length, 0, 'the pinch made nothing')
  assert.equal(dc.tool, 'trendLine', 'and the tool is still armed')
  // The second tap completes the line from the FIRST anchor's bar.
  tap(chart, X(chart, 270), Y(chart, 103))
  const all = dc.getDrawings()
  assert.equal(all.length, 1, 'the line completed')
  assert.equal(all[0].points[0].time, T(chart, 240), 'P0 kept its bar through the pinch')
  assert.equal(all[0].points[1].time, T(chart, 270))
})

test('armed + pinch: no ripple and no ghost is seeded, and nothing is placed', () => {
  const { chart, dc } = setup({ drawings: { motion: 'full' } })
  dc.setTool('trendLine')
  settle(chart)
  chart._onDown(f1(300, 250))
  assert.equal(dc._motion.ripples.size, 0, 'the first finger places nothing visible yet')
  chart._onDown(f2(400, 250))
  for (let i = 1; i <= 4; i++) { chart._onMove(f1(300 - i * 8, 250)); chart._onMove(f2(400 + i * 8, 250)) }
  chart._onUp(f2(432, 250))
  chart._onUp(f1(268, 250))
  assert.equal(dc._motion.ripples.size, 0, 'no ripple')
  assert.equal(dc._motion.ghosts.size, 0, 'no ghost')
  assert.equal(dc.getDrawings().length, 0)
  assert.equal(dc._state.name, 'ARMED')
})

test('armed + two-finger drag pans the chart and places nothing', () => {
  const { chart, dc } = setup()
  dc.setTool('trendLine')
  const r0 = chart.ts.right
  chart._onDown(f1(300, 250))
  chart._onDown(f2(400, 250))
  for (let i = 1; i <= 6; i++) { chart._onMove(f1(300 + i * 10, 250)); chart._onMove(f2(400 + i * 10, 250)) }
  chart._onUp(f2(460, 250))
  chart._onUp(f1(360, 250))
  assert.ok(chart.ts.right < r0 - 3, 'two fingers panned')
  assert.equal(dc.getDrawings().length, 0)
  assert.equal(dc._state.name, 'ARMED')
})

test('PLACING + two-finger pan keeps the placed anchor', () => {
  const { chart, dc } = setup()
  dc.setTool('trendLine')
  tap(chart, X(chart, 240), Y(chart, 100))
  assert.equal(dc._state.name, 'PLACING')
  chart._onDown(f1(300, 250))
  chart._onDown(f2(400, 250))
  for (let i = 1; i <= 6; i++) { chart._onMove(f1(300 + i * 10, 250)); chart._onMove(f2(400 + i * 10, 250)) }
  chart._onUp(f2(460, 250))
  chart._onUp(f1(360, 250))
  assert.equal(dc._state.name, 'PLACING', 'the pan did not disturb the creation')
  assert.equal(dc._state.points.length, 1)
  assert.equal(dc._state.points[0].time, T(chart, 240), 'the anchor is still on its bar')
})

test('the finger a pinch leaves behind keeps panning and does not place an anchor when lifted', () => {
  const { chart, dc } = setup()
  dc.setTool('trendLine')
  chart._onDown(f1(300, 250))
  chart._onDown(f2(400, 250))
  chart._onMove(f1(310, 250))
  chart._onMove(f2(410, 250))
  chart._onUp(f2(410, 250))
  const r0 = chart.ts.right
  chart._onMove(f1(340, 250))
  assert.ok(chart.ts.right < r0, 'the remaining finger pans')
  chart._onUp(f1(340, 250))
  assert.equal(dc.getDrawings().length, 0)
  assert.equal(dc._state.name, 'ARMED')
  assert.ok(chart.cursor === null)
})

test('pointercancel reverts a creation drag; the tool stays armed and nothing is stored', () => {
  const { chart, dc } = setup()
  dc.setTool('trendLine')
  chart._onDown(f1(X(chart, 240), Y(chart, 100)))
  chart._onMove(f1(X(chart, 240) + 30, Y(chart, 100) - 10))
  chart._onMove(f1(X(chart, 240) + 60, Y(chart, 100) - 20))
  chart._onCancel(f1(X(chart, 240) + 60, Y(chart, 100) - 20))
  assert.equal(dc.getDrawings().length, 0)
  assert.equal(dc.tool, 'trendLine')
  assert.ok(chart._owner === null)
})

test('a second finger mid-drag reverts the drag and hands the pair to the pinch', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102)
  dc.select(id)
  frame(chart)
  const d0 = dc.get(id)
  const hx = X(chart, 270)
  const hy = Y(chart, 102)
  chart._onDown(f1(hx, hy))
  chart._onMove(f1(hx + 20, hy))
  chart._onMove(f1(hx + 40, hy))
  const s0 = chart.ts.spacing
  chart._onDown(f2(hx - 100, hy))
  assert.ok(chart._owner === null, 'the drag no longer owns the pointer')
  chart._onMove(f2(hx - 130, hy))
  chart._onMove(f1(hx + 70, hy))
  chart._onUp(f2(hx - 130, hy))
  chart._onUp(f1(hx + 70, hy))
  assert.deepEqual(dc.get(id), d0, 'the half-made drag was reverted')
  assert.notEqual(chart.ts.spacing, s0, 'and the pinch zoomed')
  assert.equal(dc._state.name, 'IDLE')
  assert.equal(dc.canUndo, true, 'only the add is on the history')
})

test('a third finger during a drawing pinch neither claims nor creates', () => {
  const { chart, dc } = setup()
  dc.setTool('horizontalLine', { sticky: true })
  chart._onDown(f1(300, 250))
  chart._onDown(f2(400, 250))
  chart._onDown(f3(500, 250))
  assert.ok(chart._owner === null, 'not claimed')
  chart._onMove(f3(520, 260))
  chart._onUp(f3(520, 260))
  chart._onUp(f2(400, 250))
  chart._onUp(f1(300, 250))
  assert.equal(dc.getDrawings().length, 0)
})

test('a tap while armed on a sticky tool places one drawing per tap', () => {
  const { chart, dc } = setup()
  dc.setTool('horizontalLine', { sticky: true })
  tap(chart, X(chart, 240), Y(chart, 100))
  tap(chart, X(chart, 240), Y(chart, 104))
  assert.equal(dc.getDrawings().length, 2)
  assert.equal(dc.tool, 'horizontalLine')
})

test('an armed press on a sub-pane that is not primed yet is not claimed and stores nothing', () => {
  const { chart, dc } = setup()
  chart.addPane('rsi')
  frame(chart)
  const r = chart._panes[1].rect
  assert.equal(chart._panes[1].ps.primed, false)
  dc.setTool('horizontalLine')
  chart._onDown(f1(300, r.y + r.h / 2))
  assert.ok(chart._owner === null)
  chart._onUp(f1(300, r.y + r.h / 2))
  assert.equal(dc.getDrawings().length, 0)
})

// ------------------------------------------------------------------ text

test('creating a text by touch: the editor is focused before the up returns; a tap on the selected text reopens it', () => {
  const { chart, dc } = setup()
  dc.setTool('text')
  const x = X(chart, 250)
  const y = Y(chart, 100)
  chart._onDown(f1(x, y))
  chart._onUp(f1(x, y))
  const ta = textarea(chart)
  assert.ok(ta, 'an editor exists')
  assert.equal(ta.focused, true, 'focused synchronously inside the up (iOS raises the keyboard only then)')
  assert.equal(dc.getDrawings().length, 0, 'a draft is not a drawing yet')
  ta.value = 'Note'
  ta.dispatch('keydown', { key: 'Enter', stopPropagation() {}, preventDefault() {} })
  frame(chart)
  const [d] = dc.getDrawings()
  assert.equal(d.options.text, 'Note')
  assert.deepEqual(dc.selection, [d.id])
  // The new text is selected. A second tap on it reopens it, again focused in the up.
  const b = dc.screenBox(d.id)
  assert.ok(b && b.w > 0, 'the text has a screen box')
  const tx = b.x + b.w / 2
  const ty = b.y + b.h / 2
  chart._onDown(f1(tx, ty))
  chart._onUp(f1(tx, ty))
  const ta2 = textarea(chart)
  assert.notEqual(ta2, ta, 'a fresh editor')
  assert.equal(ta2.focused, true, 'focused inside the up')
  assert.equal(ta2.value, 'Note')
})

test('a tap on an UNSELECTED text selects it and does not open the editor', () => {
  const { chart, dc } = setup()
  const id = dc.add({ type: 'text', points: [{ time: T(chart, 250), price: 100 }], options: { text: 'Hello' } })
  frame(chart)
  const b = dc.screenBox(id)
  const tx = b.x + b.w / 2
  const ty = b.y + b.h / 2
  chart._onDown(f1(tx, ty))
  chart._onUp(f1(tx, ty))
  assert.deepEqual(dc.selection, [id])
  assert.equal(textarea(chart), undefined, 'no editor yet')
})

// ------------------------------------------------------------------ double tap

test('a double-tap is hit-tested with the finger tolerance, a double-click with the mouse\'s', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102)
  const seen = []
  dc.subscribe('edit', (p) => seen.push(p))
  const x = X(chart, 260)
  // 10 px straight below the line: outside a mouse's 5 px, inside a finger's 14.
  const y = Y(chart, 101) + 10
  chart._onDown(f1(x, y)); chart._onUp(f1(x, y))
  chart._onDown(f1(x, y)); chart._onUp(f1(x, y))
  chart._onDbl({ clientX: x, clientY: y, preventDefault() {} })
  assert.equal(seen.length, 1, 'the double-tap reached the drawing')
  assert.equal(seen[0].id, id)
  // The same coordinates with a mouse's presses are a miss: the view resets instead.
  const mouse = (o) => ({ pointerId: 9, pointerType: 'mouse', clientX: x, clientY: y, button: 0, buttons: 1, timeStamp: (clock += 1000), preventDefault() {}, ...o })
  chart._onDown(mouse()); chart._onUp(mouse())
  chart._onDown(mouse()); chart._onUp(mouse())
  chart._onDbl({ clientX: x, clientY: y, preventDefault() {} })
  assert.equal(seen.length, 1, 'a mouse 10 px away is not on the line')
})

test('a double-tap on empty plot still resets the view', () => {
  const { chart, dc } = setup()
  assert.ok(dc)
  chart.ts.panBy(120)
  chart._onDown(f1(200, 300)); chart._onUp(f1(200, 300))
  chart._onDown(f1(200, 300)); chart._onUp(f1(200, 300))
  const r0 = chart.ts.right
  chart._onDbl({ clientX: 200, clientY: 300, preventDefault() {} })
  assert.ok(chart.ts._right.target > r0, 'the view is going home')
})

// ------------------------------------------------------------------ keys never leak into a gesture

test('a touch drag the plugin owns ignores the keyboard for the arrows', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 250, 100, 270, 102)
  dc.select(id)
  frame(chart)
  const d0 = dc.get(id)
  chart._onDown(f1(X(chart, 270), Y(chart, 102)))
  chart._onMove(f1(X(chart, 270) + 20, Y(chart, 102)))
  const k = key('ArrowRight')
  chart._onKey(k)
  chart._onUp(f1(X(chart, 270) + 20, Y(chart, 102)))
  assert.notDeepEqual(dc.get(id), d0)
  assert.equal(dc.get(id).points[0].time, d0.points[0].time, 'an arrow mid-drag nudged nothing extra')
})
