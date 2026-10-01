/**
 * Session profiles over time and under the pointer: replay, live updates,
 * history prepends, hover, the naked POC, tags, the caption, export, theme
 * and the frame budget.
 *
 * Same harness as profiles-session.test.mjs.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps } from './dom-stub.mjs'
import { MIN, D0, read, paint, charted as chartedWith, session, data, binRects } from './profiles-helpers.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const core = await import('../src/chart/index.js')
const { createChart, defaultTheme, lightTheme } = core
const { createVolumeProfile } = await import('../src/profiles/index.js')
const { enableDrawings } = await import('../src/drawings/index.js')
const { profileColors } = await import('../src/profiles/theme.js')
const R = await import('../src/profiles/render.js')

const charted = (count, options, tf) => chartedWith(createChart, count, options, tf)
const mouse = (x, y, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra })
const touch = (x, y, id = 1) => ({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y })
const BINS = [1, 4, 9, 5, 1, 2, 3, 1]                 // total 26; POC bin 2 (99.5..99.75); value area bins 2..6
const POC = '#ff9f43'
const HOVER = 'rgba(226,232,244,0.55)'
const three = () => data([session(0, 39, BINS), session(40, 79, BINS), session(80, 119, BINS)])
const pocLines = (p) => p.lines.filter((l) => l.stroke === POC && l.width === 2)
const stripTop = (chart) => chart.plot.y + chart.plot.h - chart.plot.h * 0.18

/** Count host.timeToIndex calls: how many session edges were re-resolved. */
const spy = (vp) => {
  const calls = []
  const orig = vp._host.timeToIndex
  vp._host.timeToIndex = (t) => { calls.push(t); return orig(t) }
  return calls
}

/** A point on bin `i` of a session over bars [a, b]: one pixel inside its bar. */
const onBin = (chart, a, i, lo = 99, step = 0.25) => ({
  x: Math.round(R.spanLeft(chart.ts, a)) + 1,
  y: (chart.ps.y(lo + i * step) + chart.ps.y(lo + (i + 1) * step)) / 2,
})

// --------------------------------------------------------------------- replay

test('replay: a session is hidden until its last bar is revealed, and appears as the cursor reaches it', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: three() })
  assert.equal(pocLines(paint(chart)).length, 3, 'outside replay, all three')
  const replay = chart.startReplay({ from: 50 })
  assert.equal(pocLines(paint(chart)).length, 1, 'bar 50 is revealed: only the session that ended at bar 39')
  replay.seek(78)
  assert.equal(pocLines(paint(chart)).length, 1, 'bar 78: the second session is one bar short of finished')
  replay.seek(79)
  assert.equal(pocLines(paint(chart)).length, 2, 'bar 79, its last, is revealed: it appears')
  replay.seek(20)
  assert.equal(pocLines(paint(chart)).length, 0, 'scrubbing back hides them again: nothing has finished by bar 20')
  replay.seek(119)
  assert.equal(pocLines(paint(chart)).length, 3)
  chart.stopReplay()
  assert.equal(pocLines(paint(chart)).length, 3)
})

test('replay: a hidden session draws no bins, no value area and no tags either', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: three() })
  chart.startReplay({ from: 20 })
  const p = paint(chart)
  assert.equal(binRects(p).length, 0)
  assert.equal(p.lines.length, 0)
  assert.equal(p.texts.length, 0, 'a tag for a session still in the future would leak its POC')
})

test('replay: the tags follow the latest FINISHED session', () => {
  const chart = charted(120)
  const s = (a, b, lo) => ({ start: D0 + a * MIN, end: D0 + b * MIN, lo, bins: BINS })
  const vp = createVolumeProfile(chart, { data: data([s(0, 39, 99), s(40, 79, 99.4), s(80, 119, 99.25)]) })
  const tagged = () => paint(chart).texts.map((t) => t.text)
  const tagsOf = (lo) => [lo + 0.5, lo + 1.75, lo + 0.625].map((v) => vp._host.formatPrice(v))
  assert.deepEqual(tagged(), tagsOf(99.25), 'live: the newest session')
  const replay = chart.startReplay({ from: 50 })
  assert.deepEqual(tagged(), tagsOf(99))
  replay.seek(100)
  assert.deepEqual(tagged(), tagsOf(99.4))
})

test('replay: a session computed from finer data is finished when the bar holding its end is revealed', () => {
  const FIVE = 5 * MIN
  const chart = charted(60, undefined, FIVE)
  // Ends at the open of its last MINUTE: four minutes into 5-minute bar 19.
  createVolumeProfile(chart, { data: data([{ start: D0, end: D0 + 19 * FIVE + 4 * MIN, lo: 99, bins: BINS }]) })
  const replay = chart.startReplay({ from: 18 })
  assert.equal(pocLines(paint(chart)).length, 0, 'bar 18 revealed: the session has a bar to go')
  replay.seek(19)
  assert.equal(pocLines(paint(chart)).length, 1, 'bar 19 revealed, and a revealed bar is a closed bar: the session is done')
})

test('hideFutureInReplay:false draws a session before it has finished, which is the leak the default prevents', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: three(), hideFutureInReplay: false })
  chart.startReplay({ from: 50 })
  // Bar 50 is ten bars into the second session, and its whole-session profile is on screen.
  const open = paint(chart)
  assert.equal(pocLines(open).length, 2)
  assert.equal(open.texts.length, 3, 'tagged, too: the latest session is one from the future')
  vp.setOptions({ hideFutureInReplay: true })
  assert.equal(pocLines(paint(chart)).length, 1)
})

test('replay never re-resolves a session: the dataset it is resolved against does not change', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: three() })
  frame(chart)
  const replay = chart.startReplay({ from: 50 })
  frame(chart)
  const calls = spy(vp)
  for (const at of [60, 79, 20, 119]) { replay.seek(at); frame(chart) }
  assert.equal(calls.length, 0, 'seeking moved the cursor, not the sessions')
})

// ----------------------------------------------------------------------- live

test('live: upsertSession on the developing session re-reads and repaints that session only', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS), session(40, 79, BINS)]) })
  frame(chart)
  const calls = spy(vp)
  frame(chart)
  assert.equal(calls.length, 0, 'a steady frame resolves nothing')
  const [first, second] = vp._data.sessions

  chart.loop._dirty.clear()
  vp.upsertSession(session(80, 100, [1, 2, 6, 2], { developing: true }))
  assert.deepEqual([...chart.loop._dirty], ['pluginsBelow'], 'only the profile layer is asked to repaint')
  clearOps(chart)
  frame(chart, 16, ['pluginsBelow'])
  assert.deepEqual(calls, [D0 + 80 * MIN, D0 + 100 * MIN], 'one start and one end: the session that was upserted')
  assert.equal(chart.layers.canvas.main.ops.length, 0, 'not a candle repainted')
  assert.ok(vp._data.sessions[0] === first && vp._data.sessions[1] === second, 'the finished sessions were not rebuilt')

  // The next minute: same start, a later end, more volume.
  calls.length = 0
  vp.upsertSession(session(80, 101, [1, 3, 8, 2], { developing: true }))
  const p = paint(chart, 16, ['pluginsBelow'])
  assert.deepEqual(calls, [D0 + 80 * MIN, D0 + 101 * MIN])
  assert.equal(pocLines(p).length, 3)
  assert.equal(pocLines(p)[2].x2, chart.ts.x(101) + chart.ts.barWidth() / 2, 'it grew to the new end')
})

test('live: a tick into the forming bar resolves nothing; a new bar re-resolves and keeps every session in place', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: three() })
  frame(chart)
  const calls = spy(vp)
  chart.update({ ...chart.bars[119], close: 100.5 })
  settle(chart)
  assert.equal(calls.length, 0, 'update() replaces the last bar in place: no index moved')
  chart.append({ time: D0 + 120 * MIN, open: 100, high: 101, low: 99, close: 100, volume: 5 })
  settle(chart)
  assert.ok(calls.length >= 6, 'a new bar is a new bar array length')
  const p = paint(chart)
  assert.equal(pocLines(p)[0].x1, R.spanLeft(chart.ts, 0))
  assert.equal(pocLines(p)[2].x2, R.spanRight(chart.ts, 119))
})

test('live: a developing session that ends past the newest bar is drawn up to that bar', () => {
  const chart = charted(120)
  // The host's minute clock is two minutes ahead of the newest chart bar.
  createVolumeProfile(chart, { data: data([session(80, 121, BINS, { developing: true })]) })
  assert.equal(pocLines(paint(chart))[0].x2, R.spanRight(chart.ts, 119))
})

test('a history prepend re-resolves every session to its new indices', () => {
  const all = makeBars(D0 - 200 * MIN, 320, MIN, 100)    // 200 older bars, then the 120 the chart opens with
  const chart = createChart(makeContainer())
  chart.setData(all.slice(200))
  chart.fitContent(); settle(chart); frame(chart)
  const vp = createVolumeProfile(chart, { data: three() })
  const before = pocLines(paint(chart))
  assert.equal(before[0].x1, R.spanLeft(chart.ts, 0))
  const gen = vp._host.barGen
  const calls = spy(vp)

  // What a lazily loaded history page does: a new array in front, the view pinned.
  chart.bars = all.slice(0, 200).concat(chart.bars)
  chart.ts.barCount = chart.bars.length
  chart.ts._right.jump(chart.ts._right.value + 200)
  assert.equal(vp._host.barGen, gen, 'the premise: a prepend does not bump barGen')
  const after = pocLines(paint(chart))
  assert.equal(calls.length, 6, 'all three sessions, both edges')
  assert.equal(after[0].x1, R.spanLeft(chart.ts, 200), 'the first session now starts at bar 200')
  assert.deepEqual(after.map((l) => [l.x1, l.x2]), before.map((l) => [l.x1, l.x2]), 'and nothing moved on screen: the view was pinned to the same bars')
})

test('sessions outside the loaded bars are skipped without a word, and drawn once their bars load', () => {
  const chart = charted(120)
  const errs = []
  chart.subscribe('error', (e) => errs.push(e))
  const before = { start: D0 - 500 * MIN, end: D0 - 400 * MIN, lo: 99, bins: BINS }
  const after = { start: D0 + 300 * MIN, end: D0 + 400 * MIN, lo: 99, bins: BINS }
  const vp = createVolumeProfile(chart, { data: data([before, session(0, 39, BINS), after]) })
  const p = paint(chart)
  assert.equal(pocLines(p).length, 1, 'only the session that overlaps the bars')
  assert.deepEqual(errs, [])
  assert.deepEqual(vp._data.sessions.map((s) => s.on), [false, true, false])
  chart.setData(makeBars(D0 - 500 * MIN, 1000, MIN, 100))
  chart.fitContent(); settle(chart)
  assert.equal(pocLines(paint(chart)).length, 3, 'more history arrived: all three')
})

test('with no bars, or before the price scale has a range, nothing is drawn and nothing throws', () => {
  const chart = createChart(makeContainer())
  createVolumeProfile(chart, { data: three() })
  const p = paint(chart)
  assert.equal(p.clip, null)
  assert.equal(p.rects.length, 0)
  chart.setData(makeBars(D0, 120, MIN, 100))
  chart.fitContent(); settle(chart)
  assert.equal(pocLines(paint(chart)).length, 3)
})

// ------------------------------------------------------------------- layering

test('with drawings enabled, drawings still paint above the candles and still get input first', () => {
  for (const profileFirst of [true, false]) {
    const chart = charted(120)
    let vp
    let drawings
    if (profileFirst) { vp = createVolumeProfile(chart, { data: three() }); drawings = enableDrawings(chart) }
    else { drawings = enableDrawings(chart); vp = createVolumeProfile(chart, { data: three() }) }
    assert.deepEqual(chart.layers.names, ['base', 'pluginsBelow', 'main', 'plugins', 'overlay'])
    assert.deepEqual(chart._plugins.map((r) => r.plugin), [vp, drawings], 'the profile is below in the stack, whatever the attach order')
    drawings.setTool('trendLine')
    const pt = onBin(chart, 0, 2)
    chart._onDown(mouse(pt.x, pt.y))
    assert.ok(chart._owner && chart._owner.rec.plugin === drawings, 'a press over a profile bin, with a tool armed, belongs to the drawing')
    chart._onUp(mouse(pt.x, pt.y))
    clearOps(chart)
    frame(chart)
    assert.ok(chart.layers.canvas.pluginsBelow.ops.some((o) => o.op === 'fillRect'), 'the profile is on the layer under the candles')
    const profileFill = (o) => o.op === 'set' && o.prop === 'fillStyle' && /226,232,244/.test(String(o.value))
    assert.ok(chart.layers.canvas.pluginsBelow.ops.some(profileFill))
    assert.ok(!chart.layers.canvas.plugins.ops.some(profileFill), 'and never on the drawings\' layer')
  }
})

// ---------------------------------------------------------------------- hover

test('hover: the bin under the pointer is reported with its price range, volume, share and value-area flag', () => {
  const chart = charted(120)
  const raw = session(0, 39, BINS)
  const vp = createVolumeProfile(chart, { data: data([raw, session(40, 79, BINS)]) })
  frame(chart)
  const heard = []
  vp.on('hover', (h) => heard.push(h))
  const pt = onBin(chart, 0, 3)
  chart._onMove(mouse(pt.x, pt.y))
  assert.equal(heard.length, 1)
  const h = heard[0]
  assert.ok(h.session === raw, 'the host\'s own session object')
  assert.deepEqual([h.binLow, h.binHigh, h.volume, h.inValueArea], [99.75, 100, 5, true])
  assert.equal(h.pct, (5 / 26) * 100, 'this bin\'s share of the session, in percent')
  assert.ok(h.price > 99.75 && h.price < 100, 'the price under the pointer')

  const edge = onBin(chart, 0, 7)
  chart._onMove(mouse(edge.x, edge.y))
  assert.deepEqual([heard[1].binLow, heard[1].binHigh, heard[1].volume, heard[1].inValueArea], [100.75, 101, 1, false], 'bin 7 is outside the value area')
})

test('hover: null away from a drawn bin, once; and nothing while the pointer stays in one bin', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  frame(chart)
  const heard = []
  vp.on('hover', (h) => heard.push(h && h.binLow))
  const pt = onBin(chart, 0, 2)
  chart._onMove(mouse(600, 100))
  assert.deepEqual(heard, [], 'never over a bin: nothing to report')
  chart._onMove(mouse(pt.x, pt.y))
  chart._onMove(mouse(pt.x + 2, pt.y + 1))
  chart._onMove(mouse(pt.x + 3, pt.y - 1))
  assert.deepEqual(heard, [99.5], 'one event for one bin, however much the pointer moves inside it')
  // Past the end of this bin's bar: the row is the same, but nothing is drawn there.
  const { left, right } = { left: R.spanLeft(chart.ts, 0), right: R.spanRight(chart.ts, 39) }
  const len = R.barLength(9, 9, 0.3 * (right - left))
  chart._onMove(mouse(Math.round(left) + len + 2, pt.y))
  assert.deepEqual(heard, [99.5, null], 'beyond the bar\'s end is not a hit')
  chart._onMove(mouse(Math.round(left) + len + 6, pt.y))
  assert.deepEqual(heard, [99.5, null], 'and null is said once')
  // Above the profile's bins, inside the session's span.
  chart._onMove(mouse(pt.x, chart.ps.y(101.1)))
  assert.deepEqual(heard, [99.5, null])
  // In the volume strip, under the clip.
  chart._onMove(mouse(pt.x, pt.y)); chart._onMove(mouse(pt.x, stripTop(chart) + 5))
  assert.deepEqual(heard, [99.5, null, 99.5, null])
})

test('hover never changes the cursor, never takes the crosshair, and never claims a press', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  frame(chart)
  vp.on('hover', () => {})
  const pt = onBin(chart, 0, 2)
  chart._onMove(mouse(pt.x, pt.y))
  assert.equal(chart.container.style.cursor, 'crosshair')
  assert.deepEqual(chart.cursor, { x: pt.x, y: pt.y }, 'the crosshair is the raw pointer')
  assert.equal(chart._pluginHit, null, 'no plugin hit is recorded')
  const right = chart.ts._right.target
  chart._onDown(mouse(pt.x, pt.y)); chart._onMove(mouse(pt.x - 80, pt.y)); chart._onUp(mouse(pt.x - 80, pt.y))
  assert.equal(chart._owner, null)
  assert.notEqual(chart.ts._right.target, right, 'a drag that starts on a bin pans the chart')
})

test('a marker over a profile bin is still hovered and still clickable', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  chart.setMarkers([{ time: chart.bars[1].time, position: 'atPrice', price: 99.625, shape: 'circle', id: 'm1' }])
  frame(chart)
  const m = chart._markerHits.find((x) => x.marker.id === 'm1')
  const hovered = []
  const bins = []
  const clicks = []
  chart.subscribe('markerHover', (x) => hovered.push(x && x.id))
  chart.subscribe('markerClick', (x) => clicks.push(x.id))
  vp.on('hover', (h) => bins.push(h && h.binLow))
  chart._onMove(mouse(m.x, m.y))
  assert.deepEqual(bins, [99.5], 'the premise: the marker sits on a profile bin')
  assert.deepEqual(hovered, ['m1'])
  assert.equal(chart.container.style.cursor, 'pointer')
  chart._onDown(mouse(m.x, m.y)); chart._onUp(mouse(m.x, m.y)); chart._onClick(mouse(m.x, m.y))
  assert.deepEqual(clicks, ['m1'])
  // And away from every bin, marker hover is what it always was.
  chart.setMarkers([{ time: chart.bars[100].time, shape: 'circle', id: 'm2' }])
  frame(chart)
  const m2 = chart._markerHits.find((x) => x.marker.id === 'm2')
  chart._onMove(mouse(m2.x, m2.y))
  assert.equal(hovered[hovered.length - 1], 'm2')
})

test('the hovered bin is highlighted on the profile layer only, and un-highlighted when the pointer leaves', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  frame(chart)
  const pt = onBin(chart, 0, 2)
  chart.loop._dirty.clear()
  chart._onMove(mouse(pt.x, pt.y))
  assert.ok(chart.loop._dirty.has('pluginsBelow') && !chart.loop._dirty.has('main') && !chart.loop._dirty.has('all'))
  let p = paint(chart, 16, ['pluginsBelow', 'overlay'])
  const hi = p.rects.filter((r) => r.fill === HOVER)
  const bin = binRects(p)[2]
  assert.equal(hi.length, 1)
  assert.deepEqual([hi[0].x, hi[0].y, hi[0].w, hi[0].h], [bin.x, bin.y, bin.w, bin.h], 'the highlight is that bin\'s own rect')
  assert.ok(hi[0].at > bin.at, 'painted over it')
  chart._onLeave()
  p = paint(chart, 16, [...chart.loop._dirty])
  assert.equal(p.rects.filter((r) => r.fill === HOVER).length, 0)
})

test('hover(null): leaving the chart or starting a pan reports null', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  frame(chart)
  const heard = []
  vp.on('hover', (h) => heard.push(h && h.binLow))
  const pt = onBin(chart, 0, 2)
  chart._onMove(mouse(pt.x, pt.y))
  chart._onLeave()
  assert.deepEqual(heard, [99.5, null])
  chart._onLeave()
  assert.deepEqual(heard, [99.5, null], 'null is not repeated')
  chart._onMove(mouse(pt.x, pt.y))
  chart._onDown(mouse(pt.x, pt.y))
  assert.deepEqual(heard, [99.5, null, 99.5, null], 'a pan press: the highlight must not ride along')
  chart._onUp(mouse(pt.x, pt.y))
})

test('touch never hover-tests a profile', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  frame(chart)
  const heard = []
  vp.on('hover', (h) => heard.push(h))
  const pt = onBin(chart, 0, 2)
  chart._onDown(touch(pt.x, pt.y)); chart._onMove(touch(pt.x + 1, pt.y)); chart._onUp(touch(pt.x + 1, pt.y))
  assert.deepEqual(heard, [])
})

test('when the view moves under a still pointer the hovered bin is re-tested, and announced after the frame', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  frame(chart)
  const heard = []
  let mainOps = -1
  vp.on('hover', (h) => { heard.push(h && h.binLow); mainOps = chart.layers.canvas.main.ops.length })
  const pt = onBin(chart, 0, 2)
  chart._onMove(mouse(pt.x, pt.y))
  assert.deepEqual(heard, [99.5])
  // The price scale is dragged down by three bins' worth: bin 2 leaves the pointer, bin 5 arrives.
  chart.ps.panBy(chart.ps.y(99.5) - chart.ps.y(100.25))
  clearOps(chart)
  frame(chart)
  assert.deepEqual(heard, [99.5, 100.25], 'the same pixel is now a different bin')
  assert.ok(mainOps > 0, 'told from afterFrame: the candles were already drawn')
  frame(chart)
  assert.equal(heard.length, 2, 'and not again on the next frame')
})

test('when the data changes under a still pointer the hovered bin is re-tested too', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  frame(chart)
  const heard = []
  vp.on('hover', (h) => heard.push(h && h.volume))
  const pt = onBin(chart, 0, 2)
  chart._onMove(mouse(pt.x, pt.y))
  /** The frame the loop would run for what was just invalidated: the profile layer, and no more. */
  const step = (change) => {
    chart.loop._dirty.clear()
    change()
    assert.deepEqual([...chart.loop._dirty], ['pluginsBelow'], 'not a full frame: the view did not move')
    frame(chart, 16, ['pluginsBelow'])
  }
  step(() => vp.upsertSession(session(0, 39, [1, 4, 0, 5, 1, 2, 3, 9])))
  assert.deepEqual(heard, [9, null], 'the bin under the pointer no longer traded')
  step(() => vp.upsertSession(session(0, 39, [1, 4, 6, 5, 1, 2, 3, 6])))
  assert.deepEqual(heard, [9, null, 6])
  step(() => vp.setData(null))
  assert.deepEqual(heard, [9, null, 6, null])
})

test('a throwing hover listener is reported through the chart and does not stop the others', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  frame(chart)
  const errs = []
  const heard = []
  chart.subscribe('error', (e) => errs.push(e.message))
  vp.on('hover', () => { throw new Error('host readout bug') })
  vp.on('hover', (h) => heard.push(!!h))
  const pt = onBin(chart, 0, 2)
  chart._onMove(mouse(pt.x, pt.y))
  assert.deepEqual(errs, ['host readout bug'])
  assert.deepEqual(heard, [true])
  assert.equal(chart._plugins.length, 1, 'the profile is still attached')
})

// --------------------------------------------------------------------- export

test('toImage paints the profile under the candles, without the hover highlight', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)], { source: 'futures' }) })
  frame(chart)
  const pt = onBin(chart, 0, 2)
  chart._onMove(mouse(pt.x, pt.y))
  const live = paint(chart)
  assert.equal(live.rects.filter((r) => r.fill === HOVER).length, 1, 'on screen the bin is highlighted')

  const created = []
  const doc = globalThis.document
  const make = doc.createElement
  doc.createElement = (tag) => { const c = make(tag); created.push(c); return c }
  try { chart.toImage() } finally { doc.createElement = make }
  const out = created[created.length - 1]
  const images = out.ops.map((o, i) => (o.op === 'drawImage' ? [chart.layers.names.find((n) => chart.layers.canvas[n] === o.args[0]), i] : null)).filter(Boolean)
  assert.deepEqual(images.map((x) => x[0]), ['base', 'main', 'overlay'], 'the live profile canvas is not flattened in')
  const pass = read(out.ops.slice(images[0][1] + 1, images[1][1]))
  assert.equal(binRects(pass).length, 8, 'the export pass, between base and main, has every bin')
  assert.equal(pocLines(pass).length, 1)
  assert.deepEqual(pass.texts.map((t) => t.text).slice(0, 1), ['Vol: futures'])
  assert.equal(pass.rects.filter((r) => r.fill === HOVER).length, 0, 'and no hover highlight')
})

// ---------------------------------------------------------------------- theme

test('theme: dark and light defaults differ, and both derive from the background', () => {
  const dark = profileColors(defaultTheme)
  const light = profileColors(lightTheme)
  assert.deepEqual(dark, {
    fill: 'rgba(226,232,244,0.18)', valueArea: 'rgba(226,232,244,0.32)', poc: '#ff9f43',
    vaLine: defaultTheme.text, hover: 'rgba(226,232,244,0.55)',
  })
  assert.deepEqual(light, {
    fill: 'rgba(31,41,55,0.18)', valueArea: 'rgba(31,41,55,0.32)', poc: '#c2570c',
    vaLine: lightTheme.text, hover: 'rgba(31,41,55,0.55)',
  })
  for (const k of ['fill', 'valueArea', 'poc', 'hover']) assert.notEqual(dark[k], light[k], k)
  assert.equal(profileColors({ ...defaultTheme, background: '#f4f1ea' }).poc, '#c2570c', 'any light background, not only the bundled theme')
  assert.deepEqual(profileColors(undefined).poc, '#ff9f43', 'a missing theme reads as the dark house theme')
})

test('theme: the four profile keys win over the derived colours, and `colors` wins over the theme', () => {
  const themed = { ...defaultTheme, profileFill: '#111', profileValueArea: '#222', profilePoc: '#333', profileVaLine: '#444' }
  assert.deepEqual(profileColors(themed), { fill: '#111', valueArea: '#222', poc: '#333', vaLine: '#444', hover: 'rgba(226,232,244,0.55)' })
  assert.deepEqual(profileColors(themed, { poc: '#abc', hover: '#def' }),
    { fill: '#111', valueArea: '#222', poc: '#abc', vaLine: '#444', hover: '#def' }, 'a partial override leaves the rest to the theme')
})

test('theme: setTheme repaints the profile in the new theme\'s colours', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  let p = paint(chart)
  assert.deepEqual([...new Set(binRects(p).map((r) => r.fill))], ['rgba(226,232,244,0.18)', 'rgba(226,232,244,0.32)'])
  chart.loop._dirty.clear()
  chart.setTheme(lightTheme)
  p = paint(chart, 16, [...chart.loop._dirty])
  assert.deepEqual([...new Set(binRects(p).map((r) => r.fill))], ['rgba(31,41,55,0.18)', 'rgba(31,41,55,0.32)'])
  assert.equal(p.lines.filter((l) => l.stroke === '#c2570c').length, 1)
  assert.equal(p.lines.filter((l) => l.stroke === lightTheme.text).length, 2)
  chart.setTheme({ profilePoc: '#00ff00' })
  assert.equal(paint(chart).lines.filter((l) => l.stroke === '#00ff00').length, 1, 'a theme key set later is picked up')
})

test('theme: the colors option overrides, and null gives the theme back', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]), colors: { fill: '#010101', valueArea: '#020202', poc: '#030303', vaLine: '#040404' } })
  let p = paint(chart)
  assert.deepEqual([...new Set(binRects(p).map((r) => r.fill))], ['#010101', '#020202'])
  assert.equal(p.lines.filter((l) => l.stroke === '#030303').length, 1)
  assert.equal(p.lines.filter((l) => l.stroke === '#040404').length, 2)
  assert.deepEqual([...new Set(p.rects.filter((r) => r.at > p.restoreAt).map((r) => r.fill))], ['#040404', '#030303'], 'the tags follow')
  vp.setOptions({ colors: null })
  p = paint(chart, 16, ['pluginsBelow'])
  assert.equal(p.lines.filter((l) => l.stroke === POC).length, 1)
})

// ------------------------------------------------------------------- naked POC

/** 40 bars around 105, then 80 around 100: a session whose POC the later bars never reach. */
const steppedBars = () => makeBars(D0, 40, MIN, 105).concat(makeBars(D0 + 40 * MIN, 80, MIN, 100))
const stepped = (bars = steppedBars()) => {
  const chart = createChart(makeContainer())
  chart.setData(bars)
  chart.fitContent(); settle(chart); frame(chart)
  return chart
}
const highSession = () => ({ start: D0, end: D0 + 39 * MIN, lo: 104, bins: BINS })   // POC 104.625
const extension = (p) => p.lines.filter((l) => l.stroke === POC && l.width === 1)

test('extendPoc: a POC no later bar trades through runs to the right edge of the pane', () => {
  const chart = stepped()
  const vp = createVolumeProfile(chart, { data: data([highSession()]) })
  assert.equal(extension(paint(chart)).length, 0, 'off by default')
  vp.setOptions({ extendPoc: true })
  const p = paint(chart)
  const ext = extension(p)
  const y = Math.round(chart.ps.y(104.625)) + 0.5
  assert.deepEqual(ext.map((l) => [l.x1, l.y1, l.x2, l.y2]), [[R.spanRight(chart.ts, 39), y, chart.plot.x + chart.plot.w, y]])
  assert.equal(pocLines(p).length, 1, 'the session\'s own POC line is still drawn, thicker')
  assert.ok(ext[0].at > p.clipAt && ext[0].at < p.restoreAt, 'inside the clip: it stops at the pane, not in the gutter')
})

test('extendPoc: it ends at the first later bar that trades through it', () => {
  const bars = steppedBars()
  bars[70] = { ...bars[70], high: 105 }                // bar 70 spikes through 104.625
  bars[90] = { ...bars[90], high: 106 }                // and so does bar 90, later
  const chart = stepped(bars)
  createVolumeProfile(chart, { data: data([highSession()]), extendPoc: true })
  const ext = extension(paint(chart))
  assert.equal(ext.length, 1)
  assert.equal(ext[0].x2, chart.ts.x(70), 'the FIRST touch, bar 70')
  assert.equal(R.firstTouch(bars, 40, 104.625), 70)
  assert.equal(R.firstTouch(bars, 71, 104.625), 90)
  assert.equal(R.firstTouch(bars, 91, 104.625), -1)
  assert.equal(R.firstTouch(bars, 0, 104.625), 0, 'a bar\'s own range counts: low <= poc <= high')
  assert.equal(R.firstTouch([{ low: 110, high: 112 }, { low: 90, high: 95 }], 0, 104.625), -1, 'a bar wholly above or wholly below never touched it')
  assert.equal(R.firstTouch([{ low: 104.625, high: 112 }], 0, 104.625), 0, 'touching at the bar\'s low is a touch')
  assert.equal(R.firstTouch([{ low: 90, high: 104.625 }], 0, 104.625), 0, 'and at its high')
  assert.equal(R.firstTouch(bars, -5, 104.625), 0, 'a negative start is the first bar')
  assert.equal(R.firstTouch(bars.map((b) => ({ ...b, low: String(b.low), high: String(b.high) })), 40, 104.625), 70, 'numeric strings are prices')
})

test('extendPoc: a bar inside the session does not end it, only a later one', () => {
  const chart = stepped()
  createVolumeProfile(chart, { data: data([highSession()]), extendPoc: true })
  // Every bar of the session itself trades through its POC; none after does.
  assert.equal(extension(paint(chart))[0].x2, chart.plot.x + chart.plot.w)
})

test('extendPoc under replay looks only at revealed bars: a future touch must not show', () => {
  const bars = steppedBars()
  bars[70] = { ...bars[70], high: 105 }
  const chart = stepped(bars)
  createVolumeProfile(chart, { data: data([highSession()]), extendPoc: true })
  const right = () => chart.plot.x + chart.plot.w
  const replay = chart.startReplay({ from: 60 })
  assert.equal(extension(paint(chart))[0].x2, right(), 'bar 70 is not revealed: the POC is still naked')
  replay.seek(70)
  assert.equal(extension(paint(chart))[0].x2, chart.ts.x(70), 'revealed: it ends there')
  replay.seek(100)
  assert.equal(extension(paint(chart))[0].x2, chart.ts.x(70))
  replay.seek(65)
  assert.equal(extension(paint(chart))[0].x2, right(), 'scrubbed back before the touch: naked again')
})

test('extendPoc on a live chart: a tick that trades through the POC ends the line at the forming bar', () => {
  const chart = stepped()
  chart.ts.panBy(-60)                                   // room to the right of the newest bar, as a live chart has
  createVolumeProfile(chart, { data: data([highSession()]), extendPoc: true })
  assert.equal(extension(paint(chart))[0].x2, chart.plot.x + chart.plot.w)
  assert.ok(chart.ts.x(119) < chart.plot.w - 50, 'the newest bar is short of the edge')
  chart.update({ ...chart.bars[119], high: 104.7 })     // replaced in place: same length, same times
  settle(chart)
  assert.equal(extension(paint(chart))[0].x2, chart.ts.x(119))
})

test('extendPoc: a session scrolled off to the left still carries its line across the view', () => {
  const chart = stepped()
  createVolumeProfile(chart, { data: data([highSession()]), extendPoc: true })
  chart.setVisibleRange({ from: 60, to: 119 })
  settle(chart)
  const p = paint(chart)
  assert.equal(pocLines(p).length, 0, 'the session itself is off screen')
  assert.equal(binRects(p).length, 0)
  const ext = extension(p)
  assert.equal(ext.length, 1)
  assert.deepEqual([ext[0].x1, ext[0].x2], [chart.plot.x, chart.plot.x + chart.plot.w], 'from the left edge of the pane to the right')
})

test('extendPoc needs poc: with the POC hidden there is no extension either', () => {
  const chart = stepped()
  createVolumeProfile(chart, { data: data([highSession()]), extendPoc: true, poc: false })
  const p = paint(chart)
  assert.equal(p.lines.filter((l) => l.stroke === POC).length, 0)
})

// ----------------------------------------------------------------------- tags

test('tags: POC, VAH and VAL in the gutter, for the latest session only, through host.drawPriceTag', () => {
  const chart = charted(120)
  const s = (a, b, lo) => ({ start: D0 + a * MIN, end: D0 + b * MIN, lo, bins: BINS })
  const vp = createVolumeProfile(chart, { data: data([s(0, 39, 99), s(40, 79, 99.5), s(80, 119, 99.25)]) })
  const p = paint(chart)
  const tags = p.texts.filter((t) => t.at > p.restoreAt)
  const fmt = (v) => vp._host.formatPrice(v)
  // The latest session: lo 99.25, so VAL 99.75, VAH 101, POC 99.875.
  assert.deepEqual(tags.map((t) => t.text), [fmt(99.75), fmt(101), fmt(99.875)], 'VAL, VAH, then the POC on top')
  assert.deepEqual(tags.map((t) => [t.x, t.y]), [99.75, 101, 99.875].map((v) => [chart.plot.w + 8, Math.round(chart.ps.y(v)) + 0.5]))
  const boxes = p.rects.filter((r) => r.at > p.restoreAt)
  assert.deepEqual(boxes.map((r) => r.fill), [defaultTheme.text, defaultTheme.text, POC])
  assert.deepEqual(boxes.map((r) => [r.x, r.w, r.h]), [[chart.plot.w + 1, 24, 18], [chart.plot.w + 1, 24, 18], [chart.plot.w + 1, 24, 18]], 'a price line\'s own tag box')
})

test('tags follow the options: none with tags:false, POC only without the value area, VA only without the POC', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  const tags = () => { const p = paint(chart); return p.rects.filter((r) => r.at > p.restoreAt).map((r) => r.fill) }
  assert.deepEqual(tags(), [defaultTheme.text, defaultTheme.text, POC])
  vp.setOptions({ valueArea: false })
  assert.deepEqual(tags(), [POC])
  vp.setOptions({ valueArea: true, poc: false })
  assert.deepEqual(tags(), [defaultTheme.text, defaultTheme.text])
  vp.setOptions({ poc: true, tags: false })
  assert.deepEqual(tags(), [])
})

test('tags: a latest session where nothing traded has none', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS), session(40, 79, [0, 0])]) })
  const p = paint(chart)
  assert.equal(p.texts.length, 0, 'the newest session is the one tagged, and it has no POC')
})

// -------------------------------------------------------------------- caption

test('caption: "Vol: <source>" in the top-left of the price pane, as a translucent label pill', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)], { source: 'near-month futures' }) })
  const p = paint(chart)
  const cap = p.texts.find((t) => t.at < p.restoreAt)
  assert.deepEqual([cap.text, cap.x, cap.y, cap.fill], ['Vol: near-month futures', chart.plot.x + 14, chart.plot.y + 8, defaultTheme.labelText])
  const box = p.rects.find((r) => r.fill === defaultTheme.labelBg)
  assert.deepEqual([box.x, box.y, box.w, box.h], [chart.plot.x + 8, chart.plot.y, 10 + 12, 15])
  assert.ok(box.y + box.h <= chart.plot.y + 16, 'clear of the chart\'s own wordmark, which starts sixteen pixels down')
  const alphas = p.ops.filter((o) => o.op === 'set' && o.prop === 'globalAlpha').map((o) => o.value)
  assert.deepEqual(alphas, [0.72, 1], 'translucent box, opaque text, and the alpha is put back')
  assert.ok(p.ops.some((o) => o.op === 'set' && o.prop === 'font' && o.value === defaultTheme.font))
  assert.ok(cap.at > binRects(p).pop().at, 'over the bins, not under them')
})

test('caption: nothing without a source, and nothing with label:false', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  const captions = () => { const p = paint(chart); return p.texts.filter((t) => t.at < p.restoreAt).length }
  assert.equal(captions(), 0, 'no source')
  vp.setData(data([session(0, 39, BINS)], { source: '' }))
  assert.equal(captions(), 0, 'an empty source')
  vp.setData(data([session(0, 39, BINS)], { source: 'futures' }))
  assert.equal(captions(), 1)
  vp.setOptions({ label: false })
  assert.equal(captions(), 0)
})

// --------------------------------------------------------------- frame budget

test('budget: 20 sessions of 80 bins cost at most one fillRect per bin, and nothing is resolved per frame', () => {
  const chart = charted(600)
  const bins = Array.from({ length: 80 }, (_, i) => 1 + ((i * 7) % 23))
  const sessions = Array.from({ length: 20 }, (_, k) => ({ start: D0 + k * 30 * MIN, end: D0 + (k * 30 + 29) * MIN, lo: 99, bins }))
  const vp = createVolumeProfile(chart, { data: { version: 1, step: 0.025, source: 'x', sessions } })
  frame(chart)
  const calls = spy(vp)
  const counts = []
  for (let f = 0; f < 5; f++) {
    const p = paint(chart)
    const fills = p.ops.filter((o) => o.op === 'fillRect').length
    const strokes = p.ops.filter((o) => o.op === 'stroke').length
    assert.ok(binRects(p).length <= 20 * 80, `${binRects(p).length} bin rects for 1600 bins`)
    assert.ok(fills <= 20 * 80 + 1 + 3, `${fills} fillRects: at most one per bin, the caption box and three tags`)
    assert.equal(strokes, 2, 'two strokes for forty-odd lines: every VA line in one path, every POC in another')
    assert.ok(binRects(p).length > 20 * 40, 'and the profiles really are on screen')
    counts.push(p.ops.length)
  }
  assert.equal(calls.length, 0, 'five frames, no time-to-index lookup: the ranges are cached')
  assert.equal(new Set(counts).size, 1, 'and every frame issues the same operations')
})

test('budget: the fill style is set when it changes, not per bin', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: three() })
  const p = paint(chart)
  const inClip = p.ops.slice(p.clipAt, p.restoreAt)
  const sets = inClip.filter((o) => o.op === 'set' && o.prop === 'fillStyle').length
  assert.equal(binRects(p).length, 24)
  // Each session is base, value area, base. The first sets all three; the
  // next two start in the base fill the one before ended in, so they set two.
  assert.equal(sets, 3 + 2 + 2, 'the style carries across sessions')
})

test('budget: an idle chart with a profile keeps nothing awake and repaints nothing', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: three() })
  settle(chart)
  clearOps(chart)
  assert.equal(frame(chart, 16, []), false, 'no frame is requested: zero CPU at rest')
  assert.equal(chart.layers.canvas.pluginsBelow.ops.length, 0)
  assert.equal(vp.tick(16, { full: false, dt: 16, exporting: false }), undefined, 'tick never asks for a keep-alive')
  assert.equal(vp.tick(16, { full: true, dt: 16, exporting: false }), undefined)
})

test('a crosshair move repaints the overlay and leaves the profile alone', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: three() })
  settle(chart)
  chart.loop._dirty.clear()
  chart._onMove(mouse(700, 60))                        // nowhere near a bin
  assert.deepEqual([...chart.loop._dirty], ['overlay'])
  clearOps(chart)
  frame(chart, 16, ['overlay'])
  assert.equal(chart.layers.canvas.pluginsBelow.ops.length, 0)
})

test('mode visible draws no per-session profile, and reports no session bin', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: three(), mode: 'visible' })
  const p = paint(chart)
  const starts = new Set(binRects(p).map((r) => r.x))
  assert.ok(![0, 40, 80].some((a) => starts.has(Math.round(R.spanLeft(chart.ts, a)))), 'no bar grows from a session\'s left edge')
  assert.deepEqual(pocLines(p).map((l) => [l.x1, l.x2]), [[chart.plot.x, chart.plot.x + chart.plot.w]], 'the one POC is the visible profile\'s, across the pane')
  const heard = []
  vp.on('hover', (h) => heard.push(h))
  const pt = onBin(chart, 0, 2)
  chart._onMove(mouse(pt.x, pt.y))
  assert.ok(heard.every((h) => !h || h.session === null), 'whatever is hit there, it is not a session\'s bin')
})
