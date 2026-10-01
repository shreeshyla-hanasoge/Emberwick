/**
 * The visible-range profile: modes 'visible' and 'both'.
 *
 * One profile at the side of the price pane, the sum of every session that
 * overlaps the bars on screen. Same harness as profiles-session.test.mjs.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, frame, settle, clearOps } from './dom-stub.mjs'
import { MIN, D0, read, paint, charted as chartedWith, session, data, binRects } from './profiles-helpers.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const core = await import('../src/chart/index.js')
const { createChart, defaultTheme, DASH } = core
const { createVolumeProfile, computeValueArea } = await import('../src/profiles/index.js')
const R = await import('../src/profiles/render.js')

const charted = (count, options, tf) => chartedWith(createChart, count, options, tf)
const mouse = (x, y, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra })
const POC = '#ff9f43'
const HOVER = 'rgba(226,232,244,0.55)'
const at = (a, b, lo, bins) => ({ start: D0 + a * MIN, end: D0 + b * MIN, lo, bins })

/**
 * Three sessions on three different `lo`s, one step (0.25) apart or more:
 *
 *   price   98.75  99.00  99.25  99.50  99.75  100.00
 *   s0                1      2      3      4
 *   s1                              10     20     30
 *   s2        5      5
 *   sum       5      6      2     13     24     30      (lo 98.75, 6 bins, total 80)
 */
const S0 = at(0, 39, 99, [1, 2, 3, 4])
const S1 = at(40, 79, 99.5, [10, 20, 30])
const S2 = at(80, 119, 98.75, [5, 5])
const SUM = [5, 6, 2, 13, 24, 30]
const mixed = () => data([S0, S1, S2])
const aggBins = (vp) => [...vp._agg.bins.subarray(0, vp._agg.n)]
const right = (chart) => chart.plot.x + chart.plot.w
const fullLines = (p, chart) => p.lines.filter((l) => l.x1 === chart.plot.x && l.x2 === right(chart))

// ----------------------------------------------------------------- the sum

test('visible: the aggregate is the bin-by-bin sum of the overlapping sessions, aligned on their lo', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  paint(chart)
  assert.deepEqual(aggBins(vp), SUM)
  assert.deepEqual([vp._agg.lo, vp._agg.n, vp._agg.total, vp._agg.max], [98.75, 6, 80, 30])
})

test('visible: its POC and value area are computed from the sum', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  paint(chart)
  // total 80, target 56; POC bin 5 (30) is the top bin, so the area grows down:
  // + (24 + 13) = 67 >= 56. Bins 3..5.
  assert.deepEqual([vp._agg.pocBin, vp._agg.vaFrom, vp._agg.vaTo], [5, 3, 5])
  const va = computeValueArea(SUM, 98.75, 0.25)
  assert.deepEqual([vp._agg.poc, vp._agg.vah, vp._agg.val], [va.poc, va.vah, va.val])
  assert.deepEqual([va.poc, va.vah, va.val], [100.125, 100.25, 99.5])
})

test('visible: only the sessions that overlap the bars on screen are summed', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  chart.setVisibleRange({ from: 45, to: 75 })           // inside the second session
  settle(chart)
  paint(chart)
  assert.deepEqual(aggBins(vp), [10, 20, 30], 'the second session alone')
  assert.equal(vp._agg.lo, 99.5)
  chart.setVisibleRange({ from: 10, to: 60 })           // the first two
  settle(chart)
  paint(chart)
  assert.deepEqual(aggBins(vp), [1, 2, 13, 24, 30])
  assert.equal(vp._agg.lo, 99)
  chart.setVisibleRange({ from: 60, to: 119 })          // the last two
  settle(chart)
  paint(chart)
  assert.deepEqual(aggBins(vp), [5, 5, 0, 10, 20, 30], 'and a smaller sum leaves no stale bins from a bigger one')
})

test('visible: a session half on screen contributes all of its volume', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  chart.setVisibleRange({ from: 30, to: 50 })           // the tail of s0 and the head of s1
  settle(chart)
  paint(chart)
  assert.deepEqual(aggBins(vp), [1, 2, 13, 24, 30], 'whole sessions: the host sent a total per bin, not a bin per bar')
})

test('visible: the sum is rebuilt when the overlap set or the data changes, and not on a zoom or an ease', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  paint(chart)
  const built = vp._aggBuilds
  assert.ok(built >= 1)

  // A zoom that keeps all three sessions on screen.
  chart.ts.zoomAt(400, 1.05)
  let frames = 0
  while (frame(chart, 16, [])) frames++
  assert.ok(frames > 2, 'the zoom eased over several frames')
  // A price-scale ease.
  chart.update({ ...chart.bars[119], high: 102 })
  settle(chart)
  // A crosshair move, a hover frame, a plain repaint.
  chart._onMove(mouse(300, 200))
  frame(chart, 16, ['overlay'])
  frame(chart)
  assert.equal(vp._aggBuilds, built, 'none of that changed which sessions are on screen: re-projected only')

  chart.setVisibleRange({ from: 45, to: 75 })
  settle(chart); frame(chart)
  assert.equal(vp._aggBuilds, built + 1, 'the overlap set changed: one rebuild')
  frame(chart); frame(chart)
  assert.equal(vp._aggBuilds, built + 1)

  vp.upsertSession(at(40, 79, 99.5, [10, 20, 31]))
  frame(chart, 16, ['pluginsBelow'])
  assert.equal(vp._aggBuilds, built + 2, 'the data changed: one rebuild')
  assert.deepEqual(aggBins(vp), [10, 20, 31])
})

test('visible: a lo off the common grid by float noise still lands on its bin', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([at(0, 39, 99, [1, 1, 1]), at(40, 79, 99.25 - 1e-10, [7, 7])]), mode: 'visible' })
  paint(chart)
  assert.deepEqual(aggBins(vp), [1, 8, 8], 'a hair under 99.25 is still the second bin, not the first')
  vp.setData(data([at(0, 39, 99, [1, 1, 1]), at(40, 79, 99.25 + 1e-10, [7, 7])]))
  paint(chart)
  assert.deepEqual(aggBins(vp), [1, 8, 8], 'and a hair over')
})

test('visible: sessions with nothing in them, or none on screen, leave no profile and no error', () => {
  const chart = charted(120)
  const errs = []
  chart.subscribe('error', (e) => errs.push(e))
  const vp = createVolumeProfile(chart, { data: data([at(0, 39, 99, [0, 0]), at(40, 79, 99, [])]), mode: 'visible' })
  let p = paint(chart)
  assert.equal(binRects(p).length, 0)
  assert.equal(p.lines.length, 0)
  assert.equal(p.texts.length, 0)
  vp.setData(data([{ start: D0 - 900 * MIN, end: D0 - 800 * MIN, lo: 99, bins: [1, 2] }]))
  p = paint(chart)
  assert.equal(binRects(p).length, 0, 'the only session is outside the loaded bars')
  assert.deepEqual(errs, [])
})

test('visible: sessions a million steps apart are refused as a sum, not allocated', () => {
  const chart = charted(120)
  // 100 and 221 are 1.21 million steps of 0.0001 apart.
  const vp = createVolumeProfile(chart, { data: { version: 1, step: 0.0001, sessions: [at(0, 39, 100, [1, 2, 3]), at(40, 79, 221, [1, 2, 3])] }, mode: 'both' })
  const p = paint(chart)
  assert.equal(vp._agg.n, 0)
  assert.equal(vp._agg.bins.length, 0, 'no buffer was sized to span them')
  assert.equal(p.lines.filter((l) => l.stroke === POC).length, 2, 'each session still has its own profile and POC; only the sum is skipped')
  assert.ok(binRects(p).length >= 1)
})

// ---------------------------------------------------------------- geometry

test('visible: one profile from the right edge of the price pane, its longest bar width × the pane width', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: mixed(), mode: 'visible', width: 0.25 })
  const rects = binRects(paint(chart))
  const maxLen = 0.25 * chart.plot.w
  // Bin 0 (98.75..99) is behind the volume strip in this view, and culled with it.
  const shown = SUM.map((v, i) => ({ v, i })).filter(({ i }) => chart.ps.y(98.75 + (i + 1) * 0.25) < chart.plot.y + chart.plot.h * 0.82)
  assert.equal(rects.length, shown.length)
  rects.forEach((r, k) => {
    const { v, i } = shown[k]
    const len = Math.max(1, Math.round((v / 30) * maxLen))
    assert.equal(r.w, len, `bin ${i}`)
    assert.equal(r.x, right(chart) - len, `bin ${i}: grown leftward from the right edge`)
    assert.equal(r.y, Math.round(chart.ps.y(98.75 + (i + 1) * 0.25)), `bin ${i}: fixed in price`)
  })
  assert.equal(Math.max(...rects.map((r) => r.w)), Math.round(maxLen))
})

test('visible: side left grows rightward from the left edge', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible', side: 'left' })
  let rects = binRects(paint(chart))
  assert.ok(rects.length > 3)
  for (const r of rects) assert.equal(r.x, chart.plot.x)
  vp.setOptions({ side: 'right' })
  rects = binRects(paint(chart, 16, ['pluginsBelow']))
  for (const r of rects) assert.equal(r.x + r.w, right(chart))
})

test('visible: the value-area bins are tinted, and POC, VAH and VAL run the width of the pane, with tags', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  const p = paint(chart)
  const fills = binRects(p).map((r) => r.fill)
  assert.deepEqual(fills.slice(-3), ['rgba(226,232,244,0.32)', 'rgba(226,232,244,0.32)', 'rgba(226,232,244,0.32)'], 'bins 3..5')
  assert.ok(fills.slice(0, -3).every((f) => f === 'rgba(226,232,244,0.18)'))

  const lines = fullLines(p, chart)
  assert.deepEqual(lines.map((l) => [l.y1, l.width, l.dash, l.stroke]), [
    [Math.round(chart.ps.y(100.25)) + 0.5, 1, DASH.dashed, defaultTheme.text],
    [Math.round(chart.ps.y(99.5)) + 0.5, 1, DASH.dashed, defaultTheme.text],
    [Math.round(chart.ps.y(100.125)), 2, DASH.solid, POC],
  ])
  assert.equal(p.lines.length, 3, 'and no per-session line')
  const tags = p.texts.filter((t) => t.at > p.restoreAt).map((t) => t.text)
  const fmt = (v) => vp._host.formatPrice(v)
  assert.deepEqual(tags, [fmt(99.5), fmt(100.25), fmt(100.125)], 'VAL, VAH, POC of the aggregate')
  assert.deepEqual(p.ops.filter((o) => o.op === 'setLineDash').pop().args[0], [])
})

test('visible: the options apply to it: valueArea, poc and tags', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible', valueArea: false })
  let p = paint(chart)
  assert.deepEqual([...new Set(binRects(p).map((r) => r.fill))], ['rgba(226,232,244,0.18)'])
  assert.deepEqual(p.lines.map((l) => l.stroke), [POC])
  assert.equal(p.texts.length, 1)
  vp.setOptions({ valueArea: true, poc: false })
  p = paint(chart)
  assert.equal(p.lines.filter((l) => l.stroke === POC).length, 0)
  assert.equal(p.lines.length, 2)
  assert.equal(p.texts.length, 2)
  vp.setOptions({ tags: false })
  assert.equal(paint(chart).texts.length, 0)
})

test('visible: it is clipped with everything else, to the price pane above the strip', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  const p = paint(chart)
  assert.deepEqual(p.clip, [0, 0, chart.plot.w, chart.plot.h - chart.plot.h * 0.18])
  for (const r of binRects(p)) assert.ok(r.at > p.clipAt && r.at < p.restoreAt)
  for (const l of p.lines) assert.ok(l.at > p.clipAt && l.at < p.restoreAt)
})

// --------------------------------------------------------------------- both

test('both: the session profiles, then the visible profile on top of them', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'both' })
  const p = paint(chart)
  const rects = binRects(p)
  const fromLeft = rects.filter((r) => r.x + r.w < right(chart))
  const fromRight = rects.filter((r) => r.x + r.w === right(chart))
  assert.ok(fromLeft.length >= 7, 'session bins grow from their sessions')
  assert.ok(fromRight.length >= 4, 'aggregate bins end at the right edge')
  assert.ok(Math.min(...fromRight.map((r) => r.at)) > Math.max(...fromLeft.map((r) => r.at)), 'the aggregate is filled after every session bin')
  const isAgg = (l) => l.x1 === chart.plot.x && l.x2 === right(chart)
  const sessionPocs = p.lines.filter((l) => l.stroke === POC && !isAgg(l))
  const aggPoc = p.lines.filter((l) => l.stroke === POC && isAgg(l))
  assert.equal(sessionPocs.length, 3)
  assert.equal(aggPoc.length, 1)
  assert.ok(aggPoc[0].at > sessionPocs[2].at)

  // Tags: the latest session's three, then the aggregate's three on top.
  const fmt = (v) => vp._host.formatPrice(v)
  const tags = p.texts.filter((t) => t.at > p.restoreAt).map((t) => t.text)
  assert.deepEqual(tags.slice(-3), [fmt(99.5), fmt(100.25), fmt(100.125)])
  assert.ok(tags.length > 3, 'and the latest session is tagged too')
})

test('both: switching modes at runtime draws exactly what each mode names', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed() })
  const shape = () => {
    const p = paint(chart, 16, ['pluginsBelow'])
    const pocs = p.lines.filter((l) => l.stroke === POC)
    const isAgg = (l) => l.x1 === chart.plot.x && l.x2 === right(chart)
    return [pocs.filter((l) => !isAgg(l)).length, pocs.filter(isAgg).length]
  }
  assert.deepEqual(shape(), [3, 0], 'session')
  vp.setOptions({ mode: 'visible' })
  assert.deepEqual(shape(), [0, 1], 'visible')
  vp.setOptions({ mode: 'both' })
  assert.deepEqual(shape(), [3, 1], 'both')
  vp.setOptions({ mode: 'session' })
  assert.deepEqual(shape(), [3, 0])
})

// ------------------------------------------------------------------- replay

test('replay: the visible profile sums only the sessions that have finished', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  const replay = chart.startReplay({ from: 60 })
  paint(chart)
  assert.deepEqual(aggBins(vp), [1, 2, 3, 4], 'bar 60: only the first session is done; the one in progress would leak')
  replay.seek(79)
  paint(chart)
  assert.deepEqual(aggBins(vp), [1, 2, 13, 24, 30])
  replay.seek(119)
  paint(chart)
  assert.deepEqual(aggBins(vp), SUM)
  replay.seek(20)
  const p = paint(chart)
  assert.equal(vp._agg.n, 0)
  assert.equal(p.lines.length + p.texts.length + binRects(p).length, 0, 'nothing has finished: nothing is drawn')
})

// -------------------------------------------------------------------- hover

/** A point on aggregate bin `i`, two pixels in from the pane edge it grows from. */
const onAgg = (chart, i, side = 'right') => ({
  x: side === 'right' ? right(chart) - 2 : chart.plot.x + 2,
  y: (chart.ps.y(98.75 + i * 0.25) + chart.ps.y(98.75 + (i + 1) * 0.25)) / 2,
})

test('hover on the visible profile: session is null, and pct is the share of the summed volume', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  frame(chart)
  const heard = []
  vp.on('hover', (h) => heard.push(h))
  const pt = onAgg(chart, 4)
  chart._onMove(mouse(pt.x, pt.y))
  assert.equal(heard.length, 1)
  assert.deepEqual([heard[0].session, heard[0].binLow, heard[0].binHigh, heard[0].volume, heard[0].inValueArea], [null, 99.75, 100, 24, true])
  assert.equal(heard[0].pct, (24 / 80) * 100)
  const low = onAgg(chart, 2)
  chart._onMove(mouse(low.x, low.y))
  assert.deepEqual([heard[1].volume, heard[1].inValueArea], [2, false], 'bin 2 is below the value area')
  // Bin 2 holds 2 of a max of 30: its bar is short. Further in than it reaches is a miss.
  chart._onMove(mouse(right(chart) - R.barLength(2, 30, 0.3 * chart.plot.w) - 3, low.y))
  assert.equal(heard[2], null)
})

test('hover on the visible profile: a bin of the sum that holds nothing is not a hit, even at the very edge', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  chart.setVisibleRange({ from: 60, to: 119 })          // the last two sessions: [5, 5, 0, 10, 20, 30]
  settle(chart); frame(chart)
  assert.deepEqual(aggBins(vp), [5, 5, 0, 10, 20, 30])
  const heard = []
  vp.on('hover', (h) => heard.push(h && h.volume))
  const gap = onAgg(chart, 2)
  chart._onMove(mouse(right(chart) - 0.5, gap.y))
  assert.deepEqual(heard, [], 'bin 2 is empty: nothing is drawn there, so nothing is under the pointer')
  const full = onAgg(chart, 3)
  chart._onMove(mouse(right(chart) - 0.5, full.y))
  assert.deepEqual(heard, [10])
})

test('hover on the visible profile follows the side it is drawn on', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible', side: 'left' })
  frame(chart)
  const heard = []
  vp.on('hover', (h) => heard.push(h && h.volume))
  const l = onAgg(chart, 4, 'left')
  const r = onAgg(chart, 4, 'right')
  chart._onMove(mouse(r.x, r.y))
  assert.deepEqual(heard, [], 'nothing is drawn at the right edge now')
  chart._onMove(mouse(l.x, l.y))
  assert.deepEqual(heard, [24])
})

test('hover in both mode: the visible profile is on top where it is drawn, and session bins answer elsewhere', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'both' })
  frame(chart)
  const heard = []
  vp.on('hover', (h) => heard.push(h && [h.session, h.volume]))
  const pt = onAgg(chart, 5)
  chart._onMove(mouse(pt.x, pt.y))
  assert.deepEqual(heard[0], [null, 30], 'the right edge is the aggregate\'s')
  const s = { x: Math.round(R.spanLeft(chart.ts, 0)) + 1, y: (chart.ps.y(99.75) + chart.ps.y(100)) / 2 }
  chart._onMove(mouse(s.x, s.y))
  assert.ok(heard[1][0] === S0 && heard[1][1] === 4, 'a session bin, with the host\'s own session object')
})

test('the hovered aggregate bin is highlighted with its own rect, and not in an export', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  frame(chart)
  const pt = onAgg(chart, 4)
  chart._onMove(mouse(pt.x, pt.y))
  const p = paint(chart)
  const hi = p.rects.filter((r) => r.fill === HOVER)
  assert.equal(hi.length, 1)
  const bin = binRects(p).filter((r) => r.fill !== HOVER).find((r) => r.y === Math.round(chart.ps.y(100)))
  assert.deepEqual([hi[0].x, hi[0].y, hi[0].w, hi[0].h], [bin.x, bin.y, bin.w, bin.h])

  const created = []
  const doc = globalThis.document
  const make = doc.createElement
  doc.createElement = (tag) => { const c = make(tag); created.push(c); return c }
  try { chart.toImage() } finally { doc.createElement = make }
  const out = read(created[created.length - 1].ops)
  assert.ok(out.rects.some((r) => r.x + r.w === right(chart) && r.fill === 'rgba(226,232,244,0.32)'), 'the export has the aggregate')
  assert.equal(out.rects.filter((r) => r.fill === HOVER).length, 0)
})

test('when panning changes the sessions on screen, the hovered aggregate bin is re-tested', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: mixed(), mode: 'visible' })
  frame(chart)
  const heard = []
  vp.on('hover', (h) => heard.push(h && h.volume))
  const pt = onAgg(chart, 5)
  chart._onMove(mouse(pt.x, pt.y))
  assert.deepEqual(heard, [30])
  chart.setVisibleRange({ from: 0, to: 30 })            // only the first session: its bins stop at 100
  // The pointer has not moved, but 100..100.25 no longer holds anything.
  for (let i = 0; i < 80 && frame(chart); i++) { /* settle */ }
  frame(chart)
  assert.equal(heard[heard.length - 1], null)
})

// ------------------------------------------------------------------- budget

test('budget: 20 sessions of 80 bins in both mode stay within one fillRect per drawn bin', () => {
  const chart = charted(600)
  const bins = Array.from({ length: 80 }, (_, i) => 1 + ((i * 7) % 23))
  const sessions = Array.from({ length: 20 }, (_, k) => ({ start: D0 + k * 30 * MIN, end: D0 + (k * 30 + 29) * MIN, lo: 99, bins }))
  const vp = createVolumeProfile(chart, { data: { version: 1, step: 0.025, source: 'x', sessions }, mode: 'both' })
  frame(chart)
  const built = vp._aggBuilds
  const counts = []
  for (let f = 0; f < 5; f++) {
    const p = paint(chart)
    const fills = p.ops.filter((o) => o.op === 'fillRect').length
    assert.ok(fills <= 21 * 80 + 1 + 6, `${fills} fillRects for 20 session profiles, one aggregate, a caption and six tags`)
    assert.equal(p.ops.filter((o) => o.op === 'stroke').length, 4, 'two paths for the sessions, two for the aggregate')
    counts.push(p.ops.length)
  }
  assert.equal(vp._aggBuilds, built, 'five frames, no re-aggregation')
  assert.equal(new Set(counts).size, 1)
  assert.equal(vp._agg.n, 80)
  assert.deepEqual(aggBins(vp), bins.map((v) => v * 20))
})
