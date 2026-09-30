/**
 * Issue #9, the acceptance test: a drawing is glued to the bar and the price
 * it was drawn on, on EVERY frame — not at rest, not "eventually", but on the
 * frame the view eases through, the frame a history page lands on, the frame a
 * replay scrubs to.
 *
 * The check is deliberately at the op level, and deliberately independent of
 * the drawings code: the expected screen position is `chart.ts.x(bar)` and
 * `pane.ps.y(price)`, the SAME functions the candles are drawn with, and the
 * actual one is what the plugins canvas was told to moveTo/lineTo. A tolerance
 * of 1e-9 px means a drawing that lags the candles by a single frame's worth of
 * easing fails, which is precisely the bug this test exists to catch.
 *
 * The fixture is a DIAGONAL trend line whose ends stay inside the plot on
 * every frame. Inside, so the tool's clip does not move the ends it draws
 * (helper `ends` fails loudly if a fixture ever leaves the plot, rather than
 * comparing a clipped segment); diagonal, so neither the half-pixel snapping
 * of an axis-aligned line nor its "extends forever" geometry can hide an error.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, frame, settle, clearOps, deferredFeed } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { enableDrawings } = await import('../src/drawings/index.js')
const { fwdOf, invOf } = await import('../src/drawings/render/motion.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const EPS = 1e-9

const wavy = (n, t0 = T0) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7)
  return { time: t0 + i * MIN, open: c - 0.5, high: c + 1 + (i % 3) * 0.3, low: c - 1 - (i % 4) * 0.2, close: c + 0.3, volume: 10 + i }
})

/**
 * Old and quiet: the first 200 bars swing 40 either side of 100, the last 100
 * barely move. The default view shows only the quiet part, so widening it to
 * the swinging part makes the price scale EASE across a huge range.
 */
const stepped = (n = 300) => Array.from({ length: n }, (_, i) => {
  const c = i < 200 ? 100 + 40 * Math.sin(i / 9) : 100 + Math.sin(i / 5)
  return { time: T0 + i * MIN, open: c - 0.5, high: c + 1, low: c - 1, close: c + 0.3, volume: 10 }
})

const seq = () => { let n = 0; return () => 'd' + ++n }
let clock = 10_000
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

/**
 * The first stroked segment on the plugins canvas: the drawing's line. While a
 * drawing is selected or mid-undo the scene strokes a soft glow at the very
 * same coordinates before it, then paints a stats pill after it, so the FIRST
 * pair is the line whatever else is on top of it.
 */
function firstEnds(chart, what = 'segment') {
  const ops = chart.layers.canvas.plugins.ops
  const mv = ops.find((o) => o.op === 'moveTo')
  const ln = ops.find((o) => o.op === 'lineTo')
  assert.ok(mv && ln, `${what}: a segment is painted`)
  return [mv.args[0], mv.args[1], ln.args[0], ln.args[1]]
}

/** The four numbers a single stroked segment on the plugins canvas was drawn with. */
function ends(chart, what = 'segment') {
  const ops = chart.layers.canvas.plugins.ops
  const mv = ops.filter((o) => o.op === 'moveTo')
  const ln = ops.filter((o) => o.op === 'lineTo')
  assert.equal(mv.length, 1, `${what}: exactly one moveTo on the plugins canvas (got ${mv.length})`)
  assert.equal(ln.length, 1, `${what}: exactly one lineTo on the plugins canvas (got ${ln.length})`)
  return [mv[0].args[0], mv[0].args[1], ln[0].args[0], ln[0].args[1]]
}

const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= EPS, `${msg}: drew ${a}, the candles are at ${b} (off by ${a - b})`)

/**
 * Bar index of an exact bar time, found by scanning: the expectation must not
 * lean on the drawings' own time mapping.
 */
const indexOfTime = (chart, t) => chart.bars.findIndex((b) => b.time === t)

/**
 * A guard on the fixture, not on the drawing: both expected ends inside the
 * plot, so the tool's clip cannot have moved them.
 */
function inside(chart, pane, xs, ys, msg) {
  const r = pane.rect
  for (const x of xs) assert.ok(x > 2 && x < chart.plot.w - 2, `${msg}: fixture left the plot horizontally (x=${x})`)
  for (const y of ys) assert.ok(y > r.y + 2 && y < r.y + r.h - 2, `${msg}: fixture left the pane vertically (y=${y})`)
}

/**
 * A trend line described by exact bar TIMES and prices, and its expected ends
 * as the candles' own scales place them — resolved by scanning, every time.
 */
function expectedEnds(chart, spec) {
  const pane = spec.pane ? chart._panes.find((p) => p.id === spec.pane) : chart._panes[0]
  const out = []
  for (const p of spec.points) {
    const u = spec.u ? spec.u(p) : indexOfTime(chart, p.time)
    assert.ok(u >= 0, 'the anchor time is in the data')
    out.push(chart.ts.x(u), pane.ps.y(p.price))
  }
  return { pane, exp: out }
}

/**
 * Run frames until the loop would sleep. `check(frameNo)` runs after each one,
 * on that frame's ops. Returns how many frames ran (so a test can prove the
 * ease it claims to cover really lasted a while).
 */
function eachFrame(chart, check, { max = 400, dt = 16 } = {}) {
  let n = 0
  for (;;) {
    const busy = step(chart, dt)
    check(n)
    n++
    if (!busy || n >= max) break
  }
  assert.ok(n < max, 'the view settled (no endless animation)')
  return n
}

/** One frame with a clean plugins log, so the ops read are this frame's. */
function step(chart, dt = 16) {
  clearOps(chart)
  return frame(chart, dt)
}

/** Assert that the segment on the plugins canvas sits on the candles' scales. */
function glued(chart, spec, msg = 'line', selected = false) {
  const got = selected ? firstEnds(chart, msg) : ends(chart, msg)
  const { pane, exp } = expectedEnds(chart, spec)
  inside(chart, pane, [exp[0], exp[2]], [exp[1], exp[3]], msg)
  near(got[0], exp[0], `${msg} x0`)
  near(got[1], exp[1], `${msg} y0`)
  near(got[2], exp[2], `${msg} x1`)
  near(got[3], exp[3], `${msg} y1`)
}

const T = (chart, i) => chart.bars[i].time

/** The fixture: bars 280 and 290, prices 100 and 101.5, added through the API. */
function addLine(chart, dc, i0 = 280, p0 = 100, i1 = 290, p1 = 101.5, extra = {}) {
  const points = [{ time: T(chart, i0), price: p0 }, { time: T(chart, i1), price: p1 }]
  const id = dc.add({ type: 'trendLine', points, ...extra })
  return { id, spec: { points } }
}

// ------------------------------------------------------------------ view motion

test('an eased wheel zoom keeps both ends on their bars on every frame', () => {
  const { chart, dc } = setup()
  const { spec } = addLine(chart, dc)
  step(chart)
  glued(chart, spec, 'at rest')
  // Zoom about the middle of the line: both ends stay in the plot while it grows.
  const x = chart.ts.x(285)
  chart._onWheel({ clientX: x, clientY: 200, deltaY: -300, preventDefault() {} })
  const s0 = chart.ts.spacing
  const n = eachFrame(chart, () => glued(chart, spec, 'zooming'))
  assert.ok(n > 5, `the zoom really eased (${n} frames)`)
  assert.ok(chart.ts.spacing > s0 * 1.05, 'and it zoomed')
  // And back out.
  chart._onWheel({ clientX: chart.ts.x(285), clientY: 200, deltaY: 500, preventDefault() {} })
  const m = eachFrame(chart, () => glued(chart, spec, 'zooming out'))
  assert.ok(m > 5)
})

test('a zoom that interrupts a zoom keeps the line glued through the retarget', () => {
  const { chart, dc } = setup()
  const { spec } = addLine(chart, dc)
  frame(chart)
  chart._onWheel({ clientX: chart.ts.x(285), clientY: 200, deltaY: -240, preventDefault() {} })
  for (let i = 0; i < 4; i++) { step(chart); glued(chart, spec, 'first zoom') }
  chart._onWheel({ clientX: chart.ts.x(285), clientY: 200, deltaY: 240, preventDefault() {} })
  eachFrame(chart, () => glued(chart, spec, 'retargeted zoom'))
})

test('a pan, whole and by inertia, keeps the line on its bars on every frame', () => {
  const { chart, dc } = setup()
  // Well inside the plot, so the drag and its inertia never carry it out.
  const { spec } = addLine(chart, dc, 250, 100, 260, 101.5)
  frame(chart)
  // A real drag on empty plot well away from the line, with velocity, then a release.
  chart._onMove(moveTo(100, 400))
  chart._onDown(mouse(100, 400))
  for (let i = 1; i <= 6; i++) {
    chart._onMove(mouse(100 + i * 6, 400, { timeStamp: 10_000_000 + i * 16 }))
    step(chart)
    glued(chart, spec, `dragging ${i}`)
  }
  // The core times a drag with the wall clock, which a synchronous test cannot
  // slow down: give the throw a velocity a hand could produce (0.5 px/ms, a
  // hundred pixels of coast) instead of the near-infinite one it measured.
  chart.inertia.v = 0.5
  chart._onUp(mouse(136, 400, { timeStamp: 10_000_000 + 7 * 16 }))
  const before = chart.ts.right
  const n = eachFrame(chart, () => glued(chart, spec, 'inertia'), { max: 600 })
  assert.ok(chart.ts.right < before, 'inertia carried the view')
  assert.ok(n > 3, `inertia lasted ${n} frames`)
})

test('a price-scale ease keeps the line on its price on every frame', () => {
  const { chart, dc } = setup()
  const { spec } = addLine(chart, dc, 280, 100, 290, 101.5)
  step(chart)
  glued(chart, spec, 'at rest')
  const hi0 = chart.ps.hi
  // A spike in the newest bar: the time axis does not move at all, and the
  // price range eases up to swallow it. This is the pure price-scale glide.
  const last = chart.bars[299]
  chart.update({ ...last, high: 140 })
  const n = eachFrame(chart, () => glued(chart, spec, 'autoscale'))
  assert.ok(n > 8, `the price scale really eased (${n} frames)`)
  assert.ok(chart.ps.hi > hi0 + 20, 'and the range moved a long way')
})

test('a zoom out that reveals a far wider price range eases both scales and keeps the line glued', () => {
  const { chart, dc } = setup({ bars: stepped() })
  const { spec } = addLine(chart, dc, 280, 100, 290, 101.5)
  frame(chart)
  const lo0 = chart.ps.lo
  chart._onWheel({ clientX: chart.ts.x(285), clientY: 200, deltaY: 600, preventDefault() {} })
  const n = eachFrame(chart, () => glued(chart, spec, 'zoom + autoscale'))
  assert.ok(n > 8)
  assert.ok(chart.ps.lo < lo0 - 10, 'the price range widened while the zoom eased')
})

test('a drawing never widens the price range', () => {
  const plain = setup()
  const withDrawings = setup()
  // Far above and below anything on screen, and a stray ray through it all.
  withDrawings.dc.add({ type: 'horizontalLine', points: [{ time: T(withDrawings.chart, 250), price: 5000 }] })
  withDrawings.dc.add({ type: 'horizontalLine', points: [{ time: T(withDrawings.chart, 250), price: -5000 }] })
  withDrawings.dc.add({ type: 'trendLine', points: [{ time: T(withDrawings.chart, 250), price: 1e6 }, { time: T(withDrawings.chart, 290), price: -1e6 }] })
  for (const { chart } of [plain, withDrawings]) { settle(chart); frame(chart) }
  assert.equal(withDrawings.chart.ps.lo, plain.chart.ps.lo)
  assert.equal(withDrawings.chart.ps.hi, plain.chart.ps.hi)
})

// ------------------------------------------------------------------ data under the drawing

async function withFeed(n = 100) {
  const chart = createChart(makeContainer())
  const feed = deferredFeed({ symbol: 'A', timeframe: MIN })
  const p = chart.setFeed(feed)
  feed.release(0, wavy(n, T0))
  await p
  settle(chart); frame(chart)
  const dc = enableDrawings(chart, { idFactory: seq(), magnet: 'off', platform: 'other', prefersReducedMotion: () => false, motion: 'none' })
  frame(chart)
  const prepend = async (k) => {
    const load = chart._maybeLoadHistory()
    feed.release(feed.pendingCount - 1, wavy(k, chart.bars[0].time - k * MIN))
    await load
  }
  return { chart, dc, feed, prepend }
}

test('a history prepend leaves every anchor on its bar and its pixel, frame by frame', async () => {
  const { chart, dc, prepend } = await withFeed(100)
  const { spec } = addLine(chart, dc, 60, 100, 80, 102)
  step(chart)
  glued(chart, spec, 'before')
  const x0 = chart.ts.x(60)
  const x1 = chart.ts.x(80)
  await prepend(50)
  assert.equal(chart.bars.length, 150)
  // The very first frame after the page landed, and every one until idle.
  const n = eachFrame(chart, (i) => {
    glued(chart, spec, `prepend frame ${i}`)
  })
  assert.ok(n >= 1)
  assert.equal(indexOfTime(chart, spec.points[0].time), 110, 'the anchor bar renumbered by the page size')
  // The screen did not move under the reader either (nothing was panned).
  near(chart.ts.x(110), x0, 'the first anchor stayed at the same pixel')
  near(chart.ts.x(130), x1, 'the second anchor stayed at the same pixel')
})

test('a prepend between a hit test and a paint is already applied to the hit', async () => {
  const { chart, dc, prepend } = await withFeed(100)
  const { id } = addLine(chart, dc, 60, 100, 80, 102)
  frame(chart)
  const y = chart.ps.y(101)
  const x = chart.ts.x(70)
  assert.equal(dc.drawingAt(x, y).id, id)
  await prepend(50)
  // No frame has run: the answer must already reflect the renumbered bars.
  assert.equal(dc.drawingAt(x, y).id, id, 'still under the same pixel')
})

test('a future anchor and a before-the-first-bar anchor keep their screen slots across a prepend', async () => {
  const { chart, dc, prepend } = await withFeed(100)
  const future = dc.add({ type: 'verticalLine', points: [{ time: T(chart, 99), price: 100, offset: 6 }] })
  const past = dc.add({ type: 'verticalLine', points: [{ time: T(chart, 0), price: 100, offset: -3 }] })
  chart.setVisibleRange(0, 99)
  frame(chart)
  const slotOf = (id) => dc._slotById.get(id).u[0]
  assert.equal(slotOf(future), 105)
  assert.equal(slotOf(past), -3)
  const xf = chart.ts.x(105)
  const xp = chart.ts.x(-3)
  await prepend(50)
  frame(chart)
  // Renumbered by the page, and NOT still pinned to clock time.
  // Each keeps the SCREEN slot it had (the page renumbered every bar, nothing
  // was panned), and the pre-first-bar point counts from the bar it was drawn
  // against, not from the new first bar.
  assert.equal(slotOf(future), 155)
  assert.equal(slotOf(past), 47)
  near(chart.ts.x(155), xf, 'the future anchor stayed at its pixel')
  near(chart.ts.x(47), xp, 'the pre-first-bar anchor stayed at its pixel')
})

test('setData with identical bars, and with the same length shifted in time, re-resolves every anchor', () => {
  const { chart, dc } = setup()
  const { spec } = addLine(chart, dc)
  step(chart)
  glued(chart, spec, 'first load')
  chart.setData(wavy(300))
  eachFrame(chart, () => glued(chart, spec, 'same bars again'))
  // Seven bars later, same count: the anchor times are now at bars 273 and 283.
  chart.setData(wavy(300, T0 + 7 * MIN))
  assert.equal(indexOfTime(chart, spec.points[0].time), 273)
  eachFrame(chart, () => glued(chart, spec, 'shifted load'))
})

test('setData with the same length and the same ends but a moved interior gap re-resolves an interior anchor', () => {
  const { chart, dc } = setup()
  const { spec } = addLine(chart, dc)
  frame(chart)
  const old = chart.bars.map((b) => ({ ...b }))
  // Bars 269..297 now carry the time of the bar after them; the last is
  // nudged half a minute back so the series stays ascending. n, first time
  // and last time are all unchanged: only an interior bar moved.
  const moved = old.map((b) => ({ ...b }))
  for (let i = 269; i <= 297; i++) moved[i].time = old[i + 1].time
  moved[298].time = old[299].time - 30_000
  assert.equal(moved.length, old.length)
  assert.equal(moved[0].time, old[0].time)
  assert.equal(moved[299].time, old[299].time)
  chart.setData(moved)
  assert.equal(indexOfTime(chart, spec.points[0].time), 279, 'the fixture really moved the anchor bar')
  eachFrame(chart, () => glued(chart, spec, 'after the gap moved'))
})

test('log mode: the line follows the log scale, in both directions', () => {
  const { chart, dc } = setup()
  const { spec } = addLine(chart, dc)
  frame(chart)
  chart.setPriceMode('log')
  eachFrame(chart, () => glued(chart, spec, 'log'))
  chart.setPriceMode('linear')
  eachFrame(chart, () => glued(chart, spec, 'linear again'))
})

test('a zoom in log mode keeps the line glued', () => {
  const { chart, dc } = setup({ bars: stepped() })
  const { spec } = addLine(chart, dc, 280, 100, 290, 101.5)
  chart.setPriceMode('log')
  frame(chart)
  chart.setVisibleRange(110, 299)
  eachFrame(chart, () => glued(chart, spec, 'log autoscale'))
})

// ------------------------------------------------------------------ replay

test('a replay scrub, step and stop keep the line on its bar on every frame', () => {
  const { chart, dc } = setup()
  const { spec } = addLine(chart, dc, 40, 100, 55, 101)
  frame(chart)
  const rp = chart.startReplay({ from: 70 })
  eachFrame(chart, () => glued(chart, spec, 'replay start'))
  for (const to of [90, 60, 120, 75]) {
    rp.seek(to)
    eachFrame(chart, () => glued(chart, spec, `seek ${to}`))
  }
  for (let i = 0; i < 6; i++) {
    rp.step(1)
    step(chart)
    glued(chart, spec, `step ${i}`)
  }
  chart.stopReplay()
  // Stopping snaps the view back to the newest bar; bring the line into it.
  chart.setVisibleRange({ from: 20, to: 100 })
  eachFrame(chart, () => glued(chart, spec, 'after stop'))
})

// ------------------------------------------------------------------ panes

function withRsi(bars = wavy(300)) {
  const { chart, dc } = setup({ bars })
  chart.addPane('rsi')
  chart.setSeries('r', { pane: 'rsi', data: chart.bars.map((b, i) => ({ time: b.time, value: 50 + 20 * Math.sin(i / 5) })) })
  settle(chart); frame(chart)
  return { chart, dc }
}

test('a drawing on the RSI pane follows that pane\'s scale through a zoom and a pan', () => {
  const { chart, dc } = withRsi()
  const points = [{ time: T(chart, 280), price: 45 }, { time: T(chart, 290), price: 58 }]
  dc.add({ type: 'trendLine', pane: 'rsi', points })
  const spec = { pane: 'rsi', points }
  step(chart)
  glued(chart, spec, 'rsi at rest')
  assert.ok(chart._panes[1].ps.y(45) > chart._panes[0].rect.y + chart._panes[0].rect.h, 'the line is below the price pane')
  chart._onWheel({ clientX: chart.ts.x(285), clientY: chart._panes[1].rect.y + 20, deltaY: -300, preventDefault() {} })
  eachFrame(chart, () => glued(chart, spec, 'rsi zoom'))
  chart.ts.panBy(30)
  step(chart)
  glued(chart, spec, 'rsi pan')
})

test('removePane orphans the drawing, addPane brings it back to the same bar and price', () => {
  const { chart, dc } = withRsi()
  const points = [{ time: T(chart, 280), price: 45 }, { time: T(chart, 290), price: 58 }]
  const id = dc.add({ type: 'trendLine', pane: 'rsi', points })
  const spec = { pane: 'rsi', points }
  step(chart)
  glued(chart, spec, 'before')
  chart.removePane('rsi')
  step(chart)
  assert.deepEqual(dc.orphans(), [id])
  assert.equal(chart.layers.canvas.plugins.ops.filter((o) => o.op === 'moveTo').length, 0, 'an orphan paints nothing')
  assert.equal(dc.getDrawings().length, 1, 'and is kept')
  chart.addPane('rsi')
  chart.setSeries('r', { pane: 'rsi', data: chart.bars.map((b, i) => ({ time: b.time, value: 50 + 20 * Math.sin(i / 5) })) })
  eachFrame(chart, () => glued(chart, spec, 'restored'))
  assert.deepEqual(dc.orphans(), [])
})

// ------------------------------------------------------------------ morph

/** Where a residual-carrying anchor should be, straight from Motion and the candles' scales. */
function morphing(chart, dc, id, points) {
  const s = dc._slotById.get(id)
  const pane = chart._panes[0]
  const out = []
  points.forEach((p, k) => {
    const r = dc._motion.residual(id, k) || { ru: 0, rv: 0 }
    const u = indexOfTime(chart, p.time) + r.ru
    const price = invOf(pane.ps.mode, fwdOf(pane.ps.mode, p.price) + r.rv)
    out.push(chart.ts.x(u), pane.ps.y(price))
  })
  assert.ok(s)
  return out
}

test('an undo morph glides through data space: ends equal ts.x(u + ru) and the residual price, even across a pan', () => {
  const { chart, dc } = setup({ drawings: { motion: 'full' } })
  const { id, spec } = addLine(chart, dc, 275, 100, 285, 101.5)
  frame(chart); settle(chart)
  const moved = [{ time: T(chart, 281), price: 101 }, { time: T(chart, 290), price: 103 }]
  dc.update(id, { points: moved })
  settle(chart)
  step(chart)
  glued(chart, { points: moved }, 'moved, at rest')
  dc.undo()
  let sawResidual = 0
  let panned = false
  const n = eachFrame(chart, (i) => {
    const got = firstEnds(chart, `morph ${i}`)
    const exp = morphing(chart, dc, id, spec.points)
    for (let k = 0; k < 4; k++) near(got[k], exp[k], `morph frame ${i} coordinate ${k}`)
    if (dc._motion.residual(id, 0)) sawResidual++
    // A pan in the middle of the morph: the residual is data space, so the
    // line must follow the bars while it is still gliding.
    if (i === 3 && !panned) { panned = true; chart.ts.panBy(25) }
  })
  assert.ok(sawResidual >= 4, `the undo really glided (${sawResidual} frames with a residual)`)
  assert.ok(n > 4)
  step(chart)
  glued(chart, spec, 'settled on the restored points', true)
})

// ------------------------------------------------------------------ axis-aligned tools

test('axis-aligned tools sit on the half pixel of the candles\' own scale, through a zoom', () => {
  const { chart, dc } = setup()
  const h = dc.add({ type: 'horizontalLine', points: [{ time: T(chart, 285), price: 101 }] })
  const v = dc.add({ type: 'verticalLine', points: [{ time: T(chart, 285), price: 101 }] })
  frame(chart)
  chart._onWheel({ clientX: chart.ts.x(285), clientY: 200, deltaY: -300, preventDefault() {} })
  let n = 0
  eachFrame(chart, () => {
    const ops = chart.layers.canvas.plugins.ops
    const mv = ops.filter((o) => o.op === 'moveTo')
    const ln = ops.filter((o) => o.op === 'lineTo')
    assert.equal(mv.length, 2, 'one segment per line')
    const hy = Math.round(chart.ps.y(101)) + 0.5
    // The vertical line: the candle wick formula, x = floor(ts.x) + 0.5 - ish; compare with the candles.
    const horizontal = mv.find((m, i) => m.args[1] === ln[i].args[1] && m.args[0] !== ln[i].args[0])
    const vertical = mv.find((m, i) => m.args[0] === ln[i].args[0] && m.args[1] !== ln[i].args[1])
    assert.ok(horizontal, 'a horizontal segment')
    assert.ok(vertical, 'a vertical segment')
    near(horizontal.args[1], hy, 'horizontal y')
    // The candle wick's own formula (drawCandles): the line runs through the middle of the bar's wick.
    near(vertical.args[0], Math.round(chart.ts.x(285)) + (chart.ts.barWidth() % 2 ? 0.5 : 0), 'vertical x')
    n++
  })
  assert.ok(n > 5)
  assert.ok(h && v)
})

// ------------------------------------------------------------------ a held handle

/**
 * The dragged line, as painted: its stroke (the selected line strokes a soft
 * glow first, at the same coordinates, then the line itself, then the stats
 * pill's rounded corners) and its two handles, which are the circles.
 */
function drafted(chart) {
  const ops = chart.layers.canvas.plugins.ops
  const mv = ops.find((o) => o.op === 'moveTo')
  const ln = ops.find((o) => o.op === 'lineTo')
  const arcs = ops.filter((o) => o.op === 'arc')
  assert.ok(mv && ln, 'the dragged line is painted')
  assert.equal(arcs.length, 2, 'and its two handles')
  const [x0, y0] = mv.args
  const [x1, y1] = ln.args
  // A handle is drawn exactly on its anchor: the two agree, always.
  near(arcs[0].args[0], x0, 'the first handle is on the first end')
  near(arcs[0].args[1], y0, 'the first handle is on the first end')
  near(arcs[1].args[0], x1, 'the second handle is on the second end')
  near(arcs[1].args[1], y1, 'the second handle is on the second end')
  return [x0, y0, x1, y1]
}

test('a held handle stays under a still pointer on every frame of a wheel zoom', () => {
  const { chart, dc } = setup()
  const { id } = addLine(chart, dc, 270, 100, 285, 101.5)
  dc.select(id)
  frame(chart)
  const px = chart.ts.x(290)
  const py = chart.ps.y(103)
  chart._onMove(moveTo(chart.ts.x(285), chart.ps.y(101.5)))
  chart._onDown(mouse(chart.ts.x(285), chart.ps.y(101.5)))
  chart._onMove(mouse(px - 8, py))
  chart._onMove(mouse(px, py))
  frame(chart)
  chart._onWheel({ clientX: chart.ts.x(272), clientY: 200, deltaY: -300, preventDefault() {} })
  eachFrame(chart, (i) => {
    const e = drafted(chart)
    // The end being dragged is under the pointer: on the slot of the bar
    // under it (magnet off) and exactly at its height.
    near(e[3], py, `frame ${i}: the handle's y is the pointer's`)
    near(e[2], chart.ts.x(Math.round(chart.ts.index(px))), `frame ${i}: the handle sits on the bar slot under the pointer`)
  })
  chart._onUp(mouse(px, py))
})

test('a held handle stays under a still pointer while the price scale eases', () => {
  const { chart, dc } = setup({ bars: stepped() })
  const { id } = addLine(chart, dc, 270, 100, 285, 101.5)
  dc.select(id)
  frame(chart)
  const px = chart.ts.x(290)
  const py = chart.ps.y(100.5)
  chart._onMove(moveTo(chart.ts.x(285), chart.ps.y(101.5)))
  chart._onDown(mouse(chart.ts.x(285), chart.ps.y(101.5)))
  chart._onMove(mouse(px - 8, py))
  chart._onMove(mouse(px, py))
  frame(chart)
  chart.update({ ...chart.bars[299], high: 140 })
  const n = eachFrame(chart, (i) => {
    const e = drafted(chart)
    near(e[3], py, `frame ${i}: y is the pointer's while the range eases`)
  })
  assert.ok(n > 8)
  chart._onUp(mouse(px, py))
  assert.ok(Math.abs(dc.get(id).points[1].price - chart.ps.price(py)) < 1e-9)
})

test('a held handle stays under a still pointer across a history prepend', async () => {
  const { chart, dc, prepend } = await withFeed(100)
  const { id } = addLine(chart, dc, 40, 100, 60, 102)
  const fixedTime = chart.bars[40].time
  dc.select(id)
  frame(chart)
  const px = chart.ts.x(70)
  const py = chart.ps.y(99)
  chart._onMove(moveTo(chart.ts.x(60), chart.ps.y(102)))
  chart._onDown(mouse(chart.ts.x(60), chart.ps.y(102)))
  chart._onMove(mouse(px - 6, py))
  chart._onMove(mouse(px, py))
  frame(chart)
  await prepend(50)
  eachFrame(chart, (i) => {
    const e = drafted(chart)
    near(e[3], py, `frame ${i}: y`)
    near(e[2], chart.ts.x(Math.round(chart.ts.index(px))), `frame ${i}: x`)
    // The other end did not move on screen: the prepend shifted indices, not pixels.
    near(e[0], chart.ts.x(indexOfTime(chart, fixedTime)), `frame ${i}: the fixed end is on its (renumbered) bar`)
  })
  chart._onUp(mouse(px, py))
  const p1 = dc.get(id).points[1]
  assert.equal(indexOfTime(chart, p1.time), Math.round(chart.ts.index(px)))
})

test('a body drag released between the async prepend and the next frame commits where the pointer is', async () => {
  const { chart, dc, prepend } = await withFeed(100)
  const { id } = addLine(chart, dc, 40, 100, 60, 102)
  const d0 = dc.get(id)
  frame(chart)
  const xm = chart.ts.x(50)
  const ym = chart.ps.y(101)
  chart._onMove(moveTo(xm, ym))
  chart._onDown(mouse(xm, ym))
  chart._onMove(mouse(xm + 12, ym))
  await prepend(50)
  const dx = 3 * chart.ts.spacing
  // No frame has run since the page landed: the pointer events alone must see the renumbered bars.
  chart._onMove(mouse(xm + dx, ym))
  chart._onUp(mouse(xm + dx, ym))
  const d1 = dc.get(id)
  assert.equal(d1.points[0].time, d0.points[0].time + 3 * MIN)
  assert.equal(d1.points[1].time, d0.points[1].time + 3 * MIN)
  step(chart)
  const mx = (chart.ts.x(indexOfTime(chart, d1.points[0].time)) + chart.ts.x(indexOfTime(chart, d1.points[1].time))) / 2
  const my = (chart.ps.y(d1.points[0].price) + chart.ps.y(d1.points[1].price)) / 2
  assert.equal(dc.drawingAt(mx, my).id, id, 'and the drawing is under the pixel it was dropped on')
})

test('a body drag across a prepend keeps its grab in data space, frame by frame', async () => {
  const { chart, dc, prepend } = await withFeed(100)
  const { id } = addLine(chart, dc, 40, 100, 60, 102)
  const d0 = dc.get(id)
  frame(chart)
  const xm = chart.ts.x(50)
  const ym = chart.ps.y(101)
  chart._onMove(moveTo(xm, ym))
  chart._onDown(mouse(xm, ym))
  chart._onMove(mouse(xm + 12, ym))
  frame(chart)
  await prepend(50)
  const dx = 4 * chart.ts.spacing
  chart._onMove(mouse(xm + dx, ym))
  eachFrame(chart, (i) => {
    const e = drafted(chart)
    // 4 bars right of where it was, in DATA space: bars 44 and 64 before the page.
    near(e[0], chart.ts.x(indexOfTime(chart, d0.points[0].time) + 4), `frame ${i}: P0 is 4 bars from its own bar`)
    near(e[2], chart.ts.x(indexOfTime(chart, d0.points[1].time) + 4), `frame ${i}: P1 is 4 bars from its own bar`)
  })
  chart._onUp(mouse(xm + dx, ym))
  const d1 = dc.get(id)
  assert.equal(d1.points[0].time, d0.points[0].time + 4 * MIN)
})

// ------------------------------------------------------------------ far-off anchors

/**
 * Every geometry op on the plugins canvas, and the largest coordinate it was
 * given. The canvas keeps its coordinates in 32-bit floats: a rectangle
 * millions of pixels wide has an edge that lands several pixels from where it
 * should even when a clip hides the rest.
 */
function biggest(chart) {
  let worst = 0
  let where = ''
  const ops = chart.layers.canvas.plugins.ops
  for (const o of ops) {
    if (!['moveTo', 'lineTo', 'rect', 'fillRect', 'strokeRect', 'arc', 'quadraticCurveTo', 'fillText'].includes(o.op)) continue
    for (const a of o.args) {
      if (typeof a !== 'number') continue
      if (!Number.isFinite(a)) return { worst: Infinity, where: `${o.op}(${o.args})` }
      if (Math.abs(a) > worst) { worst = Math.abs(a); where = `${o.op}(${o.args.map((v) => (typeof v === 'number' ? +v.toFixed(1) : v))})` }
    }
  }
  return { worst, where }
}

/**
 * A flat, extended trend line whose two anchors are about half a million bars
 * before the first one — what a drawing looks like after the data under it was
 * replaced by another date range (a symbol switch the host had not yet
 * answered with setDrawings, or a reload of a different window).
 */
function farLine(chart, dc) {
  return dc.add({
    type: 'trendLine',
    points: [{ time: T(chart, 0), price: 101.3, offset: -500_000 }, { time: T(chart, 0), price: 101.3, offset: -499_990 }],
    options: { extend: 'both' },
  })
}

test('a selected drawing anchored millions of pixels away hands the canvas only bounded coordinates', () => {
  const { chart, dc } = setup()
  const id = farLine(chart, dc)
  dc.select(id)
  eachFrame(chart, () => {}, { max: 60 })
  step(chart)
  const { worst, where } = biggest(chart)
  assert.ok(worst < 1e5, `the selection bands and tags stay bounded (${where})`)
  // The bands still say where the anchors are: this one is off the left of the plot, so no time band at all.
  assert.ok(chart.layers.canvas.plugins.ops.some((o) => o.op === 'stroke'), 'and the (infinite) line is still drawn through the plot')
})

test('a selected drawing with one anchor off each side of the plot still gets a band across the strip', () => {
  const { chart, dc } = setup()
  const id = dc.add({
    type: 'trendLine',
    points: [{ time: T(chart, 0), price: 100, offset: -500_000 }, { time: T(chart, 299), price: 103, offset: 500_000 }],
    options: { extend: 'both' },
  })
  dc.select(id)
  step(chart)
  const bands = chart.layers.canvas.plugins.ops.filter((o) => o.op === 'fillRect' && o.args[1] === chart.plot.h)
  assert.ok(bands.length >= 1, 'a time band is drawn')
  assert.equal(bands[0].args[0], 0, 'from the strip\'s left edge')
  assert.equal(bands[0].args[2], chart.plot.w, 'to its right edge')
  assert.ok(biggest(chart).worst < 1e5)
})

test('an alignment guide to a far-off anchor is drawn to the edge of the plot, not to the anchor', () => {
  const { chart, dc } = setup()
  farLine(chart, dc)
  frame(chart)
  dc.setTool('trendLine')
  // Level with the far line's price: another anchor at this height lends it, with a dashed guide.
  const y = chart.ps.y(101.3) + 1.5
  chart._onMove(moveTo(chart.ts.x(250), y))
  clearOps(chart)
  frame(chart)
  const dashed = chart.layers.canvas.plugins.ops.some((o) => o.op === 'setLineDash' && o.args[0] && o.args[0].length === 2)
  assert.ok(dashed, 'the guide is drawn (the fixture engaged an alignment snap)')
  const { worst, where } = biggest(chart)
  assert.ok(worst < 1e5, `bounded: ${where}`)
})

test('a selected drawing priced a trillion away keeps its price band inside the gutter', () => {
  const { chart, dc } = setup()
  const id = dc.add({ type: 'trendLine', points: [{ time: T(chart, 250), price: 1e12 }, { time: T(chart, 280), price: -1e12 }] })
  dc.select(id)
  step(chart)
  const { worst, where } = biggest(chart)
  assert.ok(worst < 1e5, `bounded: ${where}`)
  const band = chart.layers.canvas.plugins.ops.find((o) => o.op === 'fillRect' && o.args[0] === chart.plot.w)
  assert.ok(band, 'the price band is drawn')
  assert.equal(band.args[1], chart._panes[0].rect.y, 'from the top of the pane')
  assert.equal(band.args[3], chart._panes[0].rect.h, 'to the bottom of it')
})

// ------------------------------------------------------------------ the text editor

test('the text editor stays glued to its text on every frame of a zoom and of an autoscale ease', () => {
  const { chart, dc } = setup({ bars: stepped() })
  const id = dc.add({ type: 'text', points: [{ time: T(chart, 285), price: 100 }], options: { text: 'Hello' } })
  frame(chart)
  assert.equal(dc.editText(id), true)
  const ta = chart.container.children.filter((c) => c.tagName === 'TEXTAREA').pop()
  assert.ok(ta && !ta.removed, 'the editor is open')
  const off = () => [parseFloat(ta.style.left) - chart.ts.x(285), parseFloat(ta.style.top) - chart.ps.y(100)]
  frame(chart)
  const [ox, oy] = off()
  assert.ok(Number.isFinite(ox) && Number.isFinite(oy))
  // A zoom out reveals the wide part of the data (both scales ease), and the
  // zoom back in narrows it again: the editor must ride along on every frame of both.
  for (const deltaY of [400, -300]) {
    const [rx, ry] = off()
    chart._onWheel({ clientX: chart.ts.x(285), clientY: 200, deltaY, preventDefault() {} })
    const n = eachFrame(chart, (i) => {
      const [x, y] = off()
      // Within a pixel: the text sits on a whole-pixel grid, and the editor on that grid's box.
      // A frame of lag during this zoom would be tens of pixels.
      assert.ok(Math.abs(x - rx) <= 1, `frame ${i} (wheel ${deltaY}): the editor's x moved ${x - rx}px off its text`)
      assert.ok(Math.abs(y - ry) <= 1, `frame ${i} (wheel ${deltaY}): the editor's y moved ${y - ry}px off its text`)
    })
    assert.ok(n > 5, `the zoom eased (${n} frames)`)
  }
})
