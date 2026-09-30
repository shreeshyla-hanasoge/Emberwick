/**
 * Drawings and replay.
 *
 * A replay shows the past as if it were the present, so two rules hold at once
 * and are easy to break one with the other. Where a drawing IS never changes:
 * it is the reader's own mark, anchored to a moment, and stepping through the
 * run must not move it, re-resolve it, or hide the part of it that lies past
 * the cursor. What a drawing KNOWS does change: a magnet, an outcome, a volume
 * total may read only the bars the reader has been shown, or the chart tells
 * them the future.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, frame, settle, clearOps, drawnText } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { enableDrawings } = await import('../src/drawings/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const DAY = 86_400_000

const wavy = (n, t0 = T0, tf = MIN) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7)
  return { time: t0 + i * tf, open: c - 0.5, high: c + 1 + (i % 3) * 0.3, low: c - 1 - (i % 4) * 0.2, close: c + 0.3, volume: 10 + i }
})

const seq = () => { let n = 0; return () => 'd' + ++n }
let clock = 90_000
const mouse = (x, y, o = {}) => ({ pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, button: 0, buttons: 1, timeStamp: (clock += 1000), preventDefault() {}, ...o })
const moveTo = (x, y, o = {}) => mouse(x, y, { buttons: 0, ...o })

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

/** One frame with a clean plugins log. */
function step(chart, dt = 16) {
  clearOps(chart)
  return frame(chart, dt)
}

const texts = (chart) => drawnText(chart, 'plugins').map((t) => t.text)
const T = (bars, i) => bars[i].time
const slot = (dc, id, k = 0) => dc._slotById.get(id).u[k]

// ------------------------------------------------------------------ where a drawing is

test('seek, step and loop never move or re-resolve a drawing', () => {
  const bars = wavy(300)
  const { chart, dc } = setup({ bars })
  const id = dc.add({ type: 'trendLine', points: [{ time: T(bars, 120), price: 100 }, { time: T(bars, 200), price: 103 }] })
  const hid = dc.add({ type: 'horizontalLine', points: [{ time: T(bars, 150), price: 101 }] })
  const rp = chart.startReplay({ from: 60, loop: true })
  step(chart)
  const resolved = dc._resolveCount
  assert.equal(slot(dc, id, 0), 120)
  assert.equal(slot(dc, id, 1), 200)
  assert.equal(slot(dc, hid), 150)
  for (const to of [61, 90, 130, 260, 299, 10, 60]) {
    rp.seek(to)
    step(chart)
    assert.equal(slot(dc, id, 0), 120, `seek ${to}`)
    assert.equal(slot(dc, id, 1), 200, `seek ${to}`)
  }
  for (let i = 0; i < 30; i++) { rp.step(1); step(chart) }
  // Playing on its own: the transport ticks and appends a bar per interval.
  rp.setSpeed && rp.setSpeed(500)
  rp.play()
  for (let i = 0; i < 60; i++) step(chart, 200)
  rp.pause()
  assert.equal(dc._resolveCount, resolved, 'not one re-resolution across seek, step and play')
  assert.equal(slot(dc, id, 1), 200)
  assert.equal(dc.get(id).points[1].time, T(bars, 200), 'and the stored document is untouched')
})

test('a drawing in the whitespace past the newest revealed bar stays where it was drawn and stays painted', () => {
  const bars = wavy(300)
  const { chart, dc } = setup({ bars })
  const id = dc.add({ type: 'trendLine', points: [{ time: T(bars, 103), price: 100 }, { time: T(bars, 109), price: 103 }] })
  const rp = chart.startReplay({ from: 100 })
  clearOps(chart); frame(chart)
  // The cursor is at bar 100; the line lives at 103..109, right of it, inside the view.
  assert.equal(chart.bars.length, 101)
  assert.equal(slot(dc, id, 0), 103, 'resolved against the whole source, not the revealed prefix')
  const ops = chart.layers.canvas.plugins.ops
  const mv = ops.find((o) => o.op === 'moveTo')
  const ln = ops.find((o) => o.op === 'lineTo')
  assert.ok(mv && ln, 'painted past the cursor')
  assert.ok(Math.abs(mv.args[0] - chart.ts.x(103)) < 1e-9)
  assert.ok(Math.abs(ln.args[0] - chart.ts.x(109)) < 1e-9)
  rp.step(5)
  clearOps(chart); frame(chart)
  const mv2 = chart.layers.canvas.plugins.ops.find((o) => o.op === 'moveTo')
  assert.ok(Math.abs(mv2.args[0] - chart.ts.x(103)) < 1e-9, 'and follows its bar as the cursor walks toward it')
})

test('a future anchor on gapped data lands on its true slot, not a slot counted in clock time', () => {
  // A session gap: bars 150+ start a day later.
  const bars = wavy(300).map((b, i) => (i >= 150 ? { ...b, time: b.time + DAY } : b))
  const { chart, dc } = setup({ bars })
  const on = dc.add({ type: 'verticalLine', points: [{ time: T(bars, 200), price: 100 }] })
  const between = dc.add({ type: 'verticalLine', points: [{ time: T(bars, 149) + (T(bars, 150) - T(bars, 149)) / 2, price: 100 }] })
  const rp = chart.startReplay({ from: 60 })
  step(chart)
  assert.equal(slot(dc, on), 200)
  assert.ok(Math.abs(slot(dc, between) - 149.5) < 1e-9, 'halfway across the gap is halfway between the two bars, not 700 bars right')
  rp.seek(120); step(chart)
  rp.seek(280); step(chart)
  assert.equal(slot(dc, on), 200)
  assert.ok(Math.abs(slot(dc, between) - 149.5) < 1e-9)
})

test('stopReplay re-resolves once, to the same indices', () => {
  const bars = wavy(300)
  const { chart, dc } = setup({ bars })
  const id = dc.add({ type: 'trendLine', points: [{ time: T(bars, 120), price: 100 }, { time: T(bars, 200), price: 103 }] })
  const fut = dc.add({ type: 'verticalLine', points: [{ time: T(bars, 299), price: 100, offset: 4 }] })
  chart.startReplay({ from: 60 })
  step(chart)
  const before = [slot(dc, id, 0), slot(dc, id, 1), slot(dc, fut)]
  const n0 = dc._resolveCount
  chart.stopReplay()
  step(chart)
  assert.deepEqual([slot(dc, id, 0), slot(dc, id, 1), slot(dc, fut)], before)
  assert.equal(dc._resolveCount - n0, 2, 'each of the two drawings re-resolved once, no more')
  step(chart)
  step(chart)
  assert.equal(dc._resolveCount - n0, 2, 'and then stays put')
})

test('replay from a different dataset re-resolves once against it, then never again', () => {
  const bars = wavy(300)
  const { chart, dc } = setup({ bars })
  const id = dc.add({ type: 'verticalLine', points: [{ time: T(bars, 200), price: 100 }] })
  // A dataset that shifted the same bar to index 190: replay resolves against the NEW source.
  const other = wavy(300, T0 + 10 * MIN)
  const rp = chart.startReplay({ bars: other, from: 100 })
  step(chart)
  assert.equal(slot(dc, id), 190)
  const n0 = dc._resolveCount
  rp.seek(150); step(chart)
  rp.seek(50); step(chart)
  assert.equal(dc._resolveCount, n0)
  assert.equal(slot(dc, id), 190)
})

// ------------------------------------------------------------------ what a drawing reads

test('the magnet reads revealed bars only: it never snaps to a bar the replay has not shown', () => {
  const bars = wavy(300)
  const { chart, dc } = setup({ bars, drawings: { magnet: 'strong' } })
  chart.startReplay({ from: 100 })
  settle(chart); frame(chart)
  dc.setTool('horizontalLine')
  // A pointer exactly at the (unrevealed) bar 108's high, in the whitespace right of the cursor.
  const future = bars[108]
  const px = chart.ts.x(108)
  // Two pixels off the high: a pointer exactly on it would read as the high
  // with no magnet at all, and prove nothing.
  const py = chart.ps.y(future.high) + 2
  chart._onMove(moveTo(px, py))
  chart._onDown(mouse(px, py))
  chart._onUp(mouse(px, py))
  const d = dc.getDrawings()[0]
  assert.notEqual(d.points[0].price, future.high, 'did not snap to a high nobody has seen')
  // The same gesture on a revealed bar does snap.
  dc.clear()
  dc.setTool('horizontalLine')
  const seen = bars[96]
  const sx = chart.ts.x(96)
  const sy = chart.ps.y(seen.high) - 3
  chart._onMove(moveTo(sx, sy))
  chart._onDown(mouse(sx, sy))
  chart._onUp(mouse(sx, sy))
  const d2 = dc.getDrawings()[0]
  assert.equal(d2.points[0].price, seen.high, 'a revealed bar is still a magnet target')
})

/** A long position from bar 90 to bar 130 whose target is reached on bar 115 and whose stop never is. */
function positionRun() {
  const bars = wavy(300).map((b, i) => ({ ...b }))
  // Flatten the run so the outcome is decided by exactly the bars this test names.
  for (let i = 0; i < bars.length; i++) Object.assign(bars[i], { open: 100, high: 101, low: 99, close: 100 })
  bars[115].high = 106
  return bars
}

test('a position\'s outcome label reads revealed bars only, and flips on the step that reveals the target', () => {
  const bars = positionRun()
  const { chart, dc } = setup({ bars })
  const id = dc.add({
    type: 'position',
    points: [{ time: T(bars, 90), price: 100 }, { time: T(bars, 130), price: 105 }, { time: T(bars, 130), price: 97 }],
    options: { side: 'long' },
  })
  const rp = chart.startReplay({ from: 100 })
  step(chart)
  assert.ok(texts(chart).some((t) => t.startsWith('Open')), `open while the target bar is unrevealed: ${texts(chart).join(' | ')}`)
  assert.ok(!texts(chart).some((t) => t.startsWith('Target hit')))
  let flippedAt = -1
  for (let i = 101; i <= 125; i++) {
    rp.seek(i)
    step(chart)
    const hit = texts(chart).some((t) => t.startsWith('Target hit'))
    if (hit && flippedAt < 0) flippedAt = i
    if (i < 115) assert.ok(!hit, `not yet at ${i}`)
  }
  assert.equal(flippedAt, 115, 'flipped on exactly the step that revealed bar 115')
  // Stepping back hides it again.
  rp.seek(110)
  step(chart)
  assert.ok(!texts(chart).some((t) => t.startsWith('Target hit')), 'the future is unlearned when the cursor goes back')
  assert.ok(dc.get(id))
})

test('a measure\'s volume counts revealed bars only', () => {
  const bars = wavy(300)
  const { chart, dc } = setup({ bars })
  const id = dc.add({ type: 'measure', points: [{ time: T(bars, 90), price: 100 }, { time: T(bars, 130), price: 103 }] })
  dc.select(id)
  const rp = chart.startReplay({ from: 100 })
  step(chart)
  const volumeLine = () => texts(chart).find((t) => /vol/i.test(t)) || ''
  const at100 = volumeLine()
  assert.ok(at100, `a volume line is drawn: ${texts(chart).join(' | ')}`)
  // bars 91..100 revealed: volumes 10+i sum. Compare against the whole span read from the source.
  rp.seek(130)
  step(chart)
  const at130 = volumeLine()
  assert.notEqual(at100, at130, 'more volume once more bars are revealed')
  rp.seek(100)
  step(chart)
  assert.equal(volumeLine(), at100, 'and the same again when the cursor comes back')
})

test('update() of the forming bar crossing the stop flips the outcome', () => {
  const bars = positionRun()
  const { chart, dc } = setup({ bars })
  // Entry on bar 296, a target far above, a stop that the newest bar can reach.
  dc.add({
    type: 'position',
    points: [{ time: T(bars, 296), price: 100 }, { time: T(bars, 299), price: 105 }, { time: T(bars, 299), price: 98 }],
    options: { side: 'long' },
  })
  step(chart)
  assert.ok(texts(chart).some((t) => t.startsWith('Open')), texts(chart).join(' | '))
  const last = chart.bars[299]
  chart.update({ ...last, low: 97 })
  step(chart)
  assert.ok(texts(chart).some((t) => t.startsWith('Stopped')), `flipped on the forming bar: ${texts(chart).join(' | ')}`)
})

test('a timeframe switch changes the bar-count label and keeps the drawing on its moments', () => {
  const bars = wavy(300)
  const { chart, dc } = setup({ bars })
  const id = dc.add({ type: 'measure', points: [{ time: T(bars, 200), price: 100 }, { time: T(bars, 260), price: 103 }] })
  dc.select(id)
  step(chart)
  const label = () => texts(chart).find((t) => /bars/.test(t)) || ''
  assert.ok(/60 bars/.test(label()), label())
  // The same hours as 5-minute bars: 60 one-minute bars are 12 five-minute bars.
  chart.setData(wavy(60, T0, 5 * MIN))
  step(chart)
  assert.ok(/12 bars/.test(label()), `re-counted in the new timeframe: ${label()}`)
  assert.ok(Math.abs(slot(dc, id, 0) - 40) < 1e-9, '200 minutes in is bar 40 of 5-minute bars')
  assert.ok(Math.abs(slot(dc, id, 1) - 52) < 1e-9)
})

test('replay respects the schema for offsets: a future point keeps its bar count while the cursor walks', () => {
  const bars = wavy(300)
  const { chart, dc } = setup({ bars })
  const id = dc.add({ type: 'verticalLine', points: [{ time: T(bars, 299), price: 100, offset: 5 }] })
  const rp = chart.startReplay({ from: 100 })
  step(chart)
  assert.equal(slot(dc, id), 304)
  rp.seek(200); step(chart)
  assert.equal(slot(dc, id), 304)
})
