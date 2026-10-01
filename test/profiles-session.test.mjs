/**
 * Session-mode rendering: one profile per session, under the candles.
 *
 * Real frames through dom-stub, and assertions on the recorded canvas
 * operations. Every expected number is computed in the test from the chart's
 * own scales (chart.ts, chart.ps), the way a reader with a ruler would.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps } from './dom-stub.mjs'
import { MIN, D0, read, paint, charted as chartedWith, session, data, binRects, bars } from './profiles-helpers.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const core = await import('../src/chart/index.js')
const { createChart, defaultTheme, lightTheme, DASH } = core
const { createVolumeProfile } = await import('../src/profiles/index.js')
const R = await import('../src/profiles/render.js')

const charted = (count, options, tf) => chartedWith(createChart, count, options, tf)
const mouse = (x, y, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra })
const BINS = [1, 4, 9, 5, 1, 2, 3, 1]                 // total 26; POC bin 2; value area bins 2..6
const FILL = 'rgba(226,232,244,0.18)'
const VA_FILL = 'rgba(226,232,244,0.32)'
const POC = '#ff9f43'

/** Left and right pixel edges of a session over bars [a, b], from the scale as it is now. */
const span = (chart, a, b) => {
  const half = chart.ts.barWidth() / 2
  return { left: chart.ts.x(a) - half, right: chart.ts.x(b) + half }
}
const stripTop = (chart) => chart.plot.y + chart.plot.h - chart.plot.h * 0.18

// ------------------------------------------------------------------ geometry

test('a session spans from half a bar before its first bar to half a bar after its last', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS), session(40, 79, BINS)]) })
  const p = paint(chart)
  assert.ok(chart.ts.barWidth() > 1, 'the fixture has real candle widths')
  const poc = p.lines.filter((l) => l.stroke === POC)
  assert.equal(poc.length, 2)
  for (const [k, [a, b]] of [[0, 39], [40, 79]].entries()) {
    const { left, right } = span(chart, a, b)
    assert.equal(poc[k].x1, left, `session ${k}: the left edge is x(start) - barWidth/2`)
    assert.equal(poc[k].x2, right, `session ${k}: the right edge is x(end) + barWidth/2`)
    assert.equal(R.spanLeft(chart.ts, a), left)
    assert.equal(R.spanRight(chart.ts, b), right)
  }
})

test('bars grow rightward from the left edge, and the longest is width × the session\'s pixel span', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)]), width: 0.4 })
  const rects = binRects(paint(chart))
  const { left, right } = span(chart, 0, 39)
  const maxLen = 0.4 * (right - left)
  assert.equal(rects.length, BINS.length)
  for (const r of rects) assert.equal(r.x, Math.round(left), 'every bar starts at the session\'s left edge')
  assert.deepEqual(rects.map((r) => r.w), BINS.map((v) => Math.max(1, Math.round((v / 9) * maxLen))))
  assert.equal(Math.max(...rects.map((r) => r.w)), Math.round(maxLen), 'the POC bin is exactly width × span long')
})

test('each session is scaled within itself', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, [1, 2]), session(40, 79, [1000, 2000])]) })
  const rects = binRects(paint(chart))
  assert.equal(rects.length, 4)
  assert.deepEqual(rects.slice(0, 2).map((r) => r.w), rects.slice(2).map((r) => r.w),
    'a session a thousand times busier draws bars no longer: the longest bin of each fills its own width')
})

test('bins map to ps.y of their price edges, rounded to the pixel grid, with a row between tall bins', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  const rects = binRects(paint(chart))
  const y = (price) => Math.round(chart.ps.y(price))
  rects.forEach((r, i) => {
    const top = y(99 + (i + 1) * 0.25)
    const bottom = y(99 + i * 0.25)
    assert.equal(r.y, top, `bin ${i}: its top is the high edge, ${99 + (i + 1) * 0.25}`)
    assert.ok(bottom - top >= 3, 'the fixture has tall bins')
    assert.equal(r.h, bottom - top - 1, `bin ${i}: down to its low edge, less the one-pixel row that separates bins`)
  })
  // No two rects share a pixel row: translucent fills must not double up into seams.
  for (let i = 1; i < rects.length; i++) assert.ok(rects[i].y + rects[i].h <= rects[i - 1].y)
})

test('value-area bins take the stronger fill; valueArea:false draws every bin in the base fill', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  assert.deepEqual(binRects(paint(chart)).map((r) => r.fill),
    [FILL, FILL, VA_FILL, VA_FILL, VA_FILL, VA_FILL, VA_FILL, FILL], 'bins 2..6 are the value area')
  vp.setOptions({ valueArea: false })
  const p = paint(chart)
  assert.deepEqual([...new Set(binRects(p).map((r) => r.fill))], [FILL])
  assert.equal(p.lines.filter((l) => l.dash.length).length, 0, 'and no VAH or VAL line')
})

test('a bin with no volume draws nothing, and a session where nothing traded draws no lines', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, [3, 0, 0, 5, 0]), session(40, 79, [0, 0, 0])]) })
  const p = paint(chart)
  assert.equal(binRects(p).length, 2)
  assert.equal(p.lines.filter((l) => l.stroke === POC).length, 1, 'one POC: the empty session has none')
})

test('the POC is a solid line across the session, and VAH and VAL thinner dashed ones', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  const p = paint(chart)
  const { left, right } = span(chart, 0, 39)
  const poc = p.lines.filter((l) => l.stroke === POC)
  assert.deepEqual(poc.map((l) => [l.x1, l.y1, l.x2, l.y2, l.width, l.dash]),
    [[left, Math.round(chart.ps.y(99.625)), right, Math.round(chart.ps.y(99.625)), 2, DASH.solid]],
    'the POC is the centre of bin 2: 99.5 to 99.75')
  const va = p.lines.filter((l) => l.dash.length)
  assert.deepEqual(va.map((l) => [l.x1, l.y1, l.x2, l.y2, l.width, l.dash, l.stroke]), [
    [left, Math.round(chart.ps.y(100.75)) + 0.5, right, Math.round(chart.ps.y(100.75)) + 0.5, 1, DASH.dashed, defaultTheme.text],
    [left, Math.round(chart.ps.y(99.5)) + 0.5, right, Math.round(chart.ps.y(99.5)) + 0.5, 1, DASH.dashed, defaultTheme.text],
  ], 'VAH is the high edge of bin 6, VAL the low edge of bin 2')
  const lastDash = p.ops.filter((o) => o.op === 'setLineDash').pop()
  assert.deepEqual(lastDash.args[0], [], 'the dash is put back before anything else is stroked')
  assert.ok(poc[0].at > va[0].at, 'the POC is stroked after the value-area lines, so it sits on top')
})

test('poc:false draws no POC line; the bins and the value area stay', () => {
  const chart = charted(120)
  const vp = createVolumeProfile(chart, { data: data([session(0, 39, BINS)]), poc: false })
  const p = paint(chart)
  assert.equal(p.lines.filter((l) => l.stroke === POC).length, 0)
  assert.equal(p.lines.filter((l) => l.dash.length).length, 2)
  assert.equal(binRects(p).length, 8)
  vp.setOptions({ poc: true })
  assert.equal(paint(chart).lines.filter((l) => l.stroke === POC).length, 1)
})

test('a session whose end is a finer time than the chart draws lands between bars, not on one', () => {
  // 5-minute candles, a profile computed from 1-minute data: the session ends
  // at the open of its last MINUTE, four minutes into the last 5-minute bar.
  const FIVE = 5 * MIN
  const chart = charted(60, undefined, FIVE)
  const end = D0 + 19 * FIVE + 4 * MIN
  createVolumeProfile(chart, { data: data([{ start: D0, end, lo: 99, bins: BINS }]) })
  const poc = paint(chart).lines.find((l) => l.stroke === POC)
  assert.equal(poc.x2, chart.ts.x(19.8) + chart.ts.barWidth() / 2, 'four fifths of the way from bar 19 to bar 20')
})

// ------------------------------------------------------- fixed bins, easing

test('fixed bins under easing: every frame the rects follow ps.y, and the bin count never changes', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  // A spike on the newest bar: the price scale eases to a wider range.
  chart.update({ ...chart.bars[119], high: 103, low: 97, close: 102 })
  const seenTops = new Set()
  let frames = 0
  for (let f = 0; f < 40; f++) {
    clearOps(chart)
    const more = frame(chart, 16, [])
    const p = read(chart.layers.canvas.pluginsBelow.ops.slice())
    if (!p.clip) break
    const rects = binRects(p)
    assert.equal(rects.length, BINS.length, `frame ${f}: eight bins, as in the data`)
    rects.forEach((r, i) => {
      assert.equal(r.y, Math.round(chart.ps.y(99 + (i + 1) * 0.25)), `frame ${f}, bin ${i}: its high edge through ps.y, this frame`)
    })
    seenTops.add(rects[2].y)
    frames++
    if (!more) break
  }
  assert.ok(frames > 5, `the scale eased over several frames (${frames})`)
  assert.ok(seenTops.size > 3, 'and the bins moved with it on the way')
})

test('bins are fixed in price in log mode too', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  chart.setPriceMode('log')
  settle(chart)
  const rects = binRects(paint(chart))
  assert.equal(rects.length, 8)
  rects.forEach((r, i) => assert.equal(r.y, Math.round(chart.ps.y(99 + (i + 1) * 0.25))))
})

// --------------------------------------------------------- sub-pixel merging

test('bins shorter than a pixel are merged into one rect per pixel row, as long as the longest of them', () => {
  const chart = charted(120)
  // 1,000 bins of 0.002 across 99..101: well under half a pixel each.
  const bins = Array.from({ length: 1000 }, (_, i) => 1 + (i % 7))
  createVolumeProfile(chart, { data: { version: 1, step: 0.002, sessions: [{ start: D0, end: D0 + 39 * MIN, lo: 99, bins }] } })
  const p = paint(chart)
  const rects = binRects(p)
  const px = Math.round(chart.ps.y(99)) - Math.round(chart.ps.y(101))
  assert.ok(px < 500, `the fixture is sub-pixel: 1000 bins in ${px} rows`)
  assert.ok(rects.length <= px && rects.length > px / 2, `${rects.length} rects for ${px} pixel rows: merged, not dropped`)
  for (const r of rects) assert.ok(r.h >= 1, 'every merged run is at least a pixel tall')
  for (let i = 1; i < rects.length; i++) assert.ok(rects[i].y + rects[i].h <= rects[i - 1].y, 'and no two overlap')
  const { left, right } = span(chart, 0, 39)
  const maxLen = 0.3 * (right - left)
  assert.equal(Math.max(...rects.map((r) => r.w)), Math.round(maxLen), 'the outline keeps its longest bin')
  // Each rect is as long as the LONGEST bin it merged. Volumes cycle 1..7 and
  // every row holds at least two bins, so no row's longest can be the 1.
  assert.ok(Math.min(...rects.map((r) => r.w)) >= Math.round((2 / 7) * maxLen))
})

test('a profile squeezed to a few pixels is still drawn', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: { version: 1, step: 0.0001, sessions: [{ start: D0, end: D0 + 39 * MIN, lo: 100, bins: [1, 2, 3, 2, 1] }] } })
  const rects = binRects(paint(chart))
  assert.equal(rects.length, 1, 'five bins inside one pixel row: one rect')
  assert.equal(rects[0].h, 1)
  assert.equal(rects[0].y, Math.round(chart.ps.y(100.0005)) - 1, 'on the row above its rounded edge, which a neighbour below would own')
})

test('a bin that traded at all is at least a pixel long, however small beside the POC', () => {
  const chart = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, [1, 100000, 3])]) })
  const rects = binRects(paint(chart))
  assert.equal(rects.length, 3)
  assert.deepEqual([rects[0].w, rects[2].w], [1, 1])
  assert.equal(R.barLength(1, 100000, 80), 1)
  assert.equal(R.barLength(50, 100, 81), 41, 'whole pixels: 40.5 rounds')
  assert.equal(R.barLength(100, 100, 80), 80)
})

test('binAt: the bin holding a price, low edge inclusive, and -1 outside the profile', () => {
  assert.equal(R.binAt(99, 99, 0.25, 8), 0)
  assert.equal(R.binAt(99.2499, 99, 0.25, 8), 0)
  assert.equal(R.binAt(99.25, 99, 0.25, 8), 1, 'a bin\'s low edge belongs to it')
  assert.equal(R.binAt(100.99, 99, 0.25, 8), 7)
  assert.equal(R.binAt(101, 99, 0.25, 8), -1, 'the top edge of the last bin is outside')
  assert.equal(R.binAt(98.99, 99, 0.25, 8), -1)
  assert.equal(R.binAt(NaN, 99, 0.25, 8), -1)
})

test('bins outside the visible price range are skipped, not drawn and clipped', () => {
  const chart = charted(120)
  // 4,000 bins from 50 to 150; the pane shows roughly 98.8 to 101.2.
  const bins = new Array(4000).fill(5)
  createVolumeProfile(chart, { data: { version: 1, step: 0.025, sessions: [{ start: D0, end: D0 + 39 * MIN, lo: 50, bins }] } })
  const rects = binRects(paint(chart))
  const onScreen = Math.ceil((chart.ps.price(chart.plot.y) - chart.ps.price(stripTop(chart))) / 0.025)
  assert.ok(rects.length <= onScreen + 2, `${rects.length} rects for ${onScreen} bins in view, of 4000`)
  assert.ok(rects.length > onScreen / 2)
})

// ------------------------------------------------------------------ clipping

test('everything is clipped to the price pane above the volume strip', () => {
  const chart = charted(120)
  chart.addPane('rsi', { weight: 1 })
  chart.setSeries('r', { pane: 'rsi', data: chart.bars.map((b, i) => ({ time: b.time, value: 30 + (i % 40) })) })
  settle(chart); frame(chart)
  // Bins from far below the pane to far above it.
  createVolumeProfile(chart, { data: { version: 1, step: 0.25, source: 'x', sessions: [{ start: D0, end: D0 + 39 * MIN, lo: 90, bins: new Array(80).fill(3) }] } })
  const p = paint(chart)
  const plot = chart.plot
  assert.deepEqual(p.clip, [plot.x, plot.y, plot.w, stripTop(chart) - plot.y], 'the clip is the price pane, less the strip')
  assert.ok(stripTop(chart) < plot.y + plot.h && plot.y + plot.h < chart._paneById.get('rsi').rect.y, 'so it ends above the strip, the pane seam and the oscillator')
  const names = p.ops.slice(0, p.clipAt + 1).map((o) => o.op)
  assert.deepEqual(names.slice(-4), ['save', 'beginPath', 'rect', 'clip'], 'clipped before anything is filled')
  const drawOps = new Set(['fillRect', 'stroke', 'fillText', 'strokeRect', 'fill'])
  const before = p.ops.slice(0, p.clipAt).filter((o) => drawOps.has(o.op))
  assert.deepEqual(before, [], 'nothing is painted outside the clip, before it')
  const inside = p.ops.slice(p.clipAt, p.restoreAt)
  assert.ok(inside.filter((o) => o.op === 'fillRect').length > 5 && inside.some((o) => o.op === 'stroke'), 'bins and lines are inside it')
  // After the restore, only the axis tags: all in the gutter, right of the plot, in the price pane's band.
  const after = p.rects.filter((r) => r.at > p.restoreAt)
  for (const r of after) {
    assert.ok(r.x > plot.w, 'a tag is in the price-axis gutter')
    assert.ok(r.y + 9 >= plot.y && r.y + 9 <= plot.y + plot.h, 'and in the price pane\'s band, never the oscillator\'s')
  }
  // And the bins themselves never reach past the pane: they are culled to the rows the clip can show.
  for (const r of binRects(p)) assert.ok(r.y + r.h > plot.y && r.y < stripTop(chart) + 1)
})

test('with no volume on screen there is no strip, so the clip is the whole pane', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(D0, 120, MIN, 100).map(({ volume, ...b }) => b))
  chart.fitContent(); settle(chart); frame(chart)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)]) })
  const p = paint(chart)
  assert.deepEqual(p.clip, [0, 0, chart.plot.w, chart.plot.h])
  const zero = createChart(makeContainer(), { volumeRatio: 0 })
  zero.setData(makeBars(D0, 120, MIN, 100))
  zero.fitContent(); settle(zero); frame(zero)
  createVolumeProfile(zero, { data: data([session(0, 39, BINS)]) })
  assert.deepEqual(paint(zero).clip, [0, 0, zero.plot.w, zero.plot.h], 'nor with volumeRatio 0')
})

test('the layer is pluginsBelow: under the candles, and nothing is drawn on any other layer', () => {
  const chart = charted(120)
  const plain = charted(120)
  createVolumeProfile(chart, { data: data([session(0, 39, BINS)], { source: 'x' }) })
  clearOps(chart); clearOps(plain)
  frame(chart); frame(plain)
  assert.deepEqual(chart.layers.names, ['base', 'pluginsBelow', 'main', 'overlay'])
  assert.ok(+chart.layers.canvas.pluginsBelow.style.zIndex < +chart.layers.canvas.main.style.zIndex, 'stacked under the candles')
  for (const n of ['base', 'main', 'overlay']) {
    assert.equal(JSON.stringify(chart.layers.canvas[n].ops), JSON.stringify(plain.layers.canvas[n].ops), `${n} is what a chart with no profile records`)
  }
  assert.ok(chart.layers.canvas.pluginsBelow.ops.some((o) => o.op === 'fillRect'))
})
