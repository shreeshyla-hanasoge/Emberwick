/**
 * Multi-pane. The case that motivates it: an RSI on 0..100 cannot share a
 * scale with a price near 24,000 without flattening the candles into a line.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps, drawnValues, drawnText } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { Pane, layoutPanes, paneAtY } = await import('../src/chart/core/Panes.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const osc = (n = 200) => Array.from({ length: n }, (_, i) => ({ time: T0 + i * MIN, value: 50 + 40 * Math.sin(i / 12) }))

// ------------------------------------------------------------ the model
test('one pane lays out to the whole band, exactly as before panes existed', () => {
  const panes = [new Pane('price', { weight: 3 })]
  layoutPanes(panes, 880, 460, 0)
  assert.deepEqual(panes[0].rect, { x: 0, y: 0, w: 880, h: 460 })
  assert.equal(panes[0].ps.top, 0)
})

test('pane heights plus gaps always sum to the plot height', () => {
  for (const [n, h, gap] of [[2, 460, 6], [3, 460, 6], [4, 301, 5], [2, 97, 0]]) {
    const panes = [new Pane('price', { weight: 3 }), ...Array.from({ length: n - 1 }, (_, i) => new Pane(`p${i}`))]
    layoutPanes(panes, 800, h, gap)
    const total = panes.reduce((a, p) => a + p.rect.h, 0) + gap * (n - 1)
    assert.equal(total, h, `${n} panes in ${h}px with ${gap}px gaps summed to ${total}`)
  }
})

test('each pane scale is laid out at its own offset', () => {
  const panes = [new Pane('price', { weight: 3 }), new Pane('rsi')]
  layoutPanes(panes, 800, 460, 6)
  assert.equal(panes[1].ps.top, panes[1].rect.y)
  assert.ok(panes[1].rect.y > panes[0].rect.h - 1, 'the second band starts below the first')
})

test('paneAtY finds the owning pane, and nothing below the last', () => {
  const panes = [new Pane('price', { weight: 3 }), new Pane('rsi')]
  layoutPanes(panes, 800, 460, 6)
  assert.equal(paneAtY(panes, 10).id, 'price')
  assert.equal(paneAtY(panes, panes[1].rect.y + 10).id, 'rsi')
  assert.equal(paneAtY(panes, 900), null, 'the time axis belongs to no pane')
})

// --------------------------------------------------------- the whole point
test('a sub-pane scales to its own series, leaving the price scale alone', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  settle(chart); frame(chart)
  const priceBefore = { lo: chart.ps.lo, hi: chart.ps.hi }

  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi', color: '#f0b' })
  settle(chart); frame(chart)

  assert.ok(Math.abs(chart.paneScale('price').hi - priceBefore.hi) < 1,
    'an oscillator must not touch the price scale')
  const rsi = chart.paneScale('rsi')
  assert.ok(rsi.lo >= 0 && rsi.lo < 5 && rsi.hi > 95 && rsi.hi <= 105,
    `the rsi pane should scale to 0..100, got ${rsi.lo}..${rsi.hi}`)
  chart.destroy()
})

test('the same series on the price pane WOULD flatten it — the control case', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.setSeries('rsi14', { data: osc() })   // no pane: the price pane
  settle(chart); frame(chart)
  assert.ok(chart.ps.lo < 100, 'this is the failure a sub-pane exists to avoid')
  chart.destroy()
})

test('a sub-pane series is stroked, and on its own band', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi', color: '#f0b' })
  settle(chart); clearOps(chart); frame(chart)

  assert.ok(drawnValues(chart, 'main', 'strokeStyle').includes('#f0b'))
  const band = chart.paneRect('rsi')
  const clips = chart.layers.canvas.main.ops.filter((o) => o.op === 'rect')
  assert.ok(clips.some((o) => o.args[1] === band.y && o.args[3] === band.h),
    'the series must clip to its own pane rect')
  chart.destroy()
})

test('every pane draws a price axis of its own', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  settle(chart); clearOps(chart); frame(chart)

  const labels = chart.layers.canvas.base.ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])
  assert.ok(labels.some((l) => Number(l) > 20000), `no price labels: ${JSON.stringify(labels)}`)
  assert.ok(labels.some((l) => Number(l) >= 0 && Number(l) <= 100), 'no oscillator labels')
  chart.destroy()
})

// ------------------------------------------------------------------- API
test('panes are addressable, and the price pane is permanent', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  assert.deepEqual(chart.panes().map((p) => p.id), ['price'])

  chart.addPane('rsi', { weight: 2, title: 'RSI 14' })
  assert.deepEqual(chart.panes().map((p) => p.id), ['price', 'rsi'])
  assert.equal(chart.pane('rsi').title, 'RSI 14')
  assert.equal(chart.pane('nope'), null)

  assert.throws(() => chart.addPane('rsi'), /already exists/)
  assert.throws(() => chart.removePane('price'), /cannot be removed/)
  assert.throws(() => chart.addPane(null), /needs an id/)
  chart.destroy()
})

test('setSeries refuses an unknown pane instead of silently using the price one', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN, 24000))
  assert.throws(
    () => chart.setSeries('rsi14', { data: osc(), pane: 'rsi' }),
    /names pane "rsi", which does not exist/,
  )
  assert.equal(chart.getSeries().length, 0, 'and must not half-create it')
  chart.destroy()
})

test('removing a pane removes the series routed to it', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.addPane('rsi')
  chart.setSeries('ema', { data: osc() })
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  assert.equal(chart.getSeries().length, 2)

  chart.removePane('rsi')
  assert.deepEqual(chart.getSeries().map((s) => s.id), ['ema'], 'orphaned series must go with it')
  assert.deepEqual(chart.panes().map((p) => p.id), ['price'])
  chart.destroy()
})

test('pane() reports which series it draws', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.addPane('rsi')
  chart.setSeries('a', { data: osc() })
  chart.setSeries('b', { data: osc(), pane: 'rsi' })
  assert.deepEqual(chart.pane('price').series, ['a'])
  assert.deepEqual(chart.pane('rsi').series, ['b'])
  chart.destroy()
})

// ------------------------------------------------------- back-compatibility
test('chart.ps and chart.plot still address the price pane', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.addPane('rsi')
  frame(chart)

  assert.equal(chart.ps, chart.paneScale('price'))
  assert.deepEqual(chart.plot, chart.paneRect('price'))
  assert.equal(chart.plot.y, 0, 'the price pane is always the top band')
  chart.destroy()
})

test('adding a pane shrinks the price pane rather than overflowing', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  const full = chart.plot.h
  chart.addPane('rsi')
  assert.ok(chart.plot.h < full, 'the price pane must give up height')
  assert.ok(chart.paneRect('rsi').y >= chart.plot.h, 'and the new band sits below it')
  chart.destroy()
})

test('a pane with no series draws no axis rather than inventing one', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN, 24000))
  chart.addPane('empty')
  settle(chart); clearOps(chart); frame(chart)

  assert.equal(chart.pane('empty').primed, false)
  const labels = chart.layers.canvas.base.ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])
  assert.ok(!labels.includes('0.10'), `an unprimed pane invented an axis: ${JSON.stringify(labels)}`)
  chart.destroy()
})

test('hiding every series in a pane unprimes nothing and crashes nothing', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  settle(chart); frame(chart)
  chart.setSeriesVisible('rsi14', false)
  assert.doesNotThrow(() => { settle(chart); frame(chart) })
  chart.destroy()
})

test('destroy resets to a single pane', () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 100, MIN))
  chart.addPane('rsi')
  chart.destroy()
  assert.deepEqual(chart.panes().map((p) => p.id), ['price'])
})

test('every pane ticks even while another is already animating', () => {
  // The trap: `animating = animating || pane.ps.tick(dt)` short-circuits, so
  // once the price pane reports motion no pane below it ticks again — their
  // scales freeze mid-ease and never reach their target.
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  settle(chart)

  const rsiScale = chart.paneScale('rsi')
  let ticks = 0
  const realTick = rsiScale.tick.bind(rsiScale)
  rsiScale.tick = (dt) => { ticks++; return realTick(dt) }

  // Put the price pane into motion. Autoscale off first: endFit() runs before
  // the tick loop and would otherwise re-fit the target straight back, so the
  // pane would not be animating when the loop is reached and the test would
  // prove nothing.
  chart.ps.auto = false
  chart.ps._lo.set(chart.ps._lo.value - 500)
  assert.equal(chart.ps.tick(0), true, 'the price pane must actually be easing')
  frame(chart)

  assert.equal(ticks, 1, 'the sub-pane scale must tick on a frame the price pane is animating')
  chart.destroy()
})

test('the crosshair event reports the pane under the pointer, on that pane scale', () => {
  // The crosshair is DRAWN in whichever pane the cursor is in. Before 0.9.1
  // the payload was bounded by the price pane's rect and read the price
  // pane's scale, so hovering an oscillator drew a crosshair and reported
  // null — the drawing and the event disagreed, and a legend went blank
  // exactly where the user was looking.
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  settle(chart); frame(chart)

  const seen = []
  chart.subscribe('crosshair', (p) => seen.push(p))
  const price = chart.paneRect('price')
  const rsi = chart.paneRect('rsi')

  chart._emitCrosshair({ x: 400, y: price.y + 50 })
  const inPrice = seen.at(-1)
  assert.equal(inPrice.pane, 'price')
  assert.ok(inPrice.price > 20000, 'the price pane reports a price')

  chart._emitCrosshair({ x: 400, y: rsi.y + 40 })
  const inRsi = seen.at(-1)
  assert.ok(inRsi, 'hovering a sub-pane must emit, not go silent')
  assert.equal(inRsi.pane, 'rsi')
  assert.ok(inRsi.price >= 0 && inRsi.price <= 100,
    `the sub-pane must report on ITS scale, got ${inRsi.price}`)

  chart._emitCrosshair({ x: 400, y: 9999 })
  assert.equal(seen.at(-1), null, 'the time axis belongs to no pane')
  chart.destroy()
})

// ------------------------------------------------------------ drag targeting
/** One pointer gesture, in CSS px. The container stub puts the origin at 0,0. */
function drag(chart, from, to, id = 1) {
  chart._onDown({ pointerId: id, clientX: from.x, clientY: from.y })
  chart._onMove({ pointerId: id, clientX: to.x, clientY: to.y })
  chart._onUp({ pointerId: id, clientX: to.x, clientY: to.y })
}

const withOscillator = () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(2000), pane: 'rsi' })
  settle(chart); frame(chart)
  return chart
}

test('a drag is classified against the whole plot, not against the price pane', () => {
  // `plot.h` stopped meaning "the bottom of the plot" the moment a second pane
  // existed, so every pointer below the price pane read as being on the time
  // axis — 30% of the plot, where a drag zoomed instead of panning.
  const chart = withOscillator()
  const price = chart.paneRect('price')
  const rsi = chart.paneRect('rsi')

  assert.equal(chart._classifyDrag(400, price.y + 50).mode, 'pan')
  assert.equal(chart._classifyDrag(400, rsi.y + 40).mode, 'pan', 'a sub-pane is plot, and a drag in it pans')
  // Probed ON the boundary, not near it: paneAtY's bounds are inclusive, so the
  // last row of the last pane belongs to the pane and the first row past it is
  // the axis. A `>` that drifted to `>=` would disagree with paneAtY about
  // exactly one row, and the crosshair resolves through paneAtY.
  assert.equal(chart._classifyDrag(400, rsi.y + rsi.h).mode, 'pan', 'the last row of the last pane is still plot')
  assert.equal(chart._classifyDrag(400, rsi.y + rsi.h + 1).mode, 'time', 'and the first row past it is the time axis')
  assert.equal(paneAtY(chart._panes, rsi.y + rsi.h).id, 'rsi', 'which is the row paneAtY gives the pane')
  assert.equal(chart._classifyDrag(400, price.y + price.h + 3).mode, 'pan',
    'and the seam between two panes pans — panning never needed a pane to act on')
  chart.destroy()
})

test('a price-axis drag targets the pane beside the pointer', () => {
  const chart = withOscillator()
  const rsi = chart.paneRect('rsi')
  const gutter = chart.plot.w + 20

  assert.equal(chart._classifyDrag(gutter, 40).pane.id, 'price')
  assert.equal(chart._classifyDrag(gutter, rsi.y + 40).pane.id, 'rsi',
    'the gutter beside an oscillator belongs to the oscillator')
  assert.equal(chart._classifyDrag(gutter, 9999).pane.id, 'rsi',
    'the corner where both gutters meet resolves to the nearest pane, as it always has with one')
  // The seam belongs to no pane, but a gesture in flight has no "no pane" to
  // act on — so it resolves to the NEARER side, from either direction.
  const price = chart.paneRect('price')
  const nearPrice = chart._classifyDrag(gutter, price.y + price.h + 1)
  const nearRsi = chart._classifyDrag(gutter, rsi.y - 1)
  assert.equal(nearPrice.mode, 'price', 'the seam is still axis, beside the axis')
  assert.ok(nearPrice.pane, 'and resolves to a pane rather than to nothing — there is no null scale to stretch')
  assert.equal(nearPrice.pane.id, 'price', 'one pixel below the price pane is still nearest to it')
  assert.equal(nearRsi.pane.id, 'rsi', 'and one pixel above the oscillator is nearest to that')
  chart.destroy()
})

test('dragging inside an oscillator pans the chart instead of zooming it', () => {
  const chart = withOscillator()
  const rsi = chart.paneRect('rsi')
  const spacing = chart.ts.spacing
  const right = chart.ts.right

  drag(chart, { x: 600, y: rsi.y + 40 }, { x: 400, y: rsi.y + 40 })
  assert.equal(chart.ts.spacing, spacing, 'the time scale must not zoom')
  assert.ok(chart.ts.right > right, 'the view must have moved back in time')
  chart.destroy()
})

test('dragging the gutter beside an oscillator stretches THAT pane, not the price scale', () => {
  const chart = withOscillator()
  const rsi = chart.paneRect('rsi')
  const gutter = chart.plot.w + 20

  drag(chart, { x: gutter, y: rsi.y + 40 }, { x: gutter, y: rsi.y + 100 })
  assert.equal(chart.paneScale('rsi').auto, false, 'the pane under the pointer is the one that moved')
  assert.equal(chart.ps.auto, true, 'the pane the user was NOT pointing at must be untouched')
  chart.destroy()
})

test('the drag target is latched for the gesture, not re-resolved on every move', () => {
  // One continuous finger movement must go on stretching the scale it started
  // on. Re-resolving per move would silently hand the gesture to a second pane
  // halfway through.
  const chart = withOscillator()
  const rsi = chart.paneRect('rsi')
  const gutter = chart.plot.w + 20

  chart._onDown({ pointerId: 1, clientX: gutter, clientY: rsi.y + 40 })
  chart._onMove({ pointerId: 1, clientX: gutter, clientY: rsi.y + 10 })
  chart._onMove({ pointerId: 1, clientX: gutter, clientY: 60 })   // now beside the PRICE pane
  chart._onUp({ pointerId: 1, clientX: gutter, clientY: 60 })

  assert.equal(chart.paneScale('rsi').auto, false, 'the pane the gesture started on')
  assert.equal(chart.ps.auto, true, 'and only that one, however far the pointer wandered')
  chart.destroy()
})

test('double-click returns every pane to autoscale, not just the price pane', () => {
  // The README promises "price scale back to autoscale"; a sub-pane the user
  // just stretched had no documented way back.
  const chart = withOscillator()
  chart.paneScale('rsi').scaleBy(2)
  chart.ps.scaleBy(2)

  chart._onDbl()
  assert.equal(chart.ps.auto, true)
  assert.equal(chart.paneScale('rsi').auto, true)
  chart.destroy()
})

test('snapToRealtime returns every pane to autoscale', () => {
  const chart = withOscillator()
  chart.paneScale('rsi').scaleBy(2)
  chart.snapToRealtime()
  assert.equal(chart.paneScale('rsi').auto, true)
  chart.destroy()
})

test('a single-pane chart classifies exactly as it always did', () => {
  // The fix must not move one pixel of behaviour on a chart with no sub-pane:
  // with one pane the nearest pane is always the price pane.
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  settle(chart); frame(chart)
  const plot = chart.plot

  // A pan now carries a pane too, because it is free in both axes and dy has
  // to land on one scale. On a single-pane chart that is always the price pane,
  // so nothing a reader can see has changed here.
  const pan = chart._classifyDrag(400, 100)
  assert.equal(pan.mode, 'pan')
  assert.equal(pan.pane.id, 'price')
  assert.equal(chart._classifyDrag(400, plot.h + 10).mode, 'time')
  assert.equal(chart._classifyDrag(plot.w + 20, 100).pane.id, 'price')
  assert.equal(chart._classifyDrag(plot.w + 20, plot.h + 10).pane.id, 'price',
    'including the bottom-right corner, which has always stretched the price scale')
  chart.destroy()
})

test('a drag beside a pane that has never been fitted does not strand it blank', () => {
  // auto = false makes endFit() return early, and drawPriceAxis declines to
  // draw an unprimed axis — so a pane dragged before it had a range could
  // never acquire one. Reachable only since a gutter drag started addressing
  // the pane beside the pointer.
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.addPane('rsi')                       // no series yet: never primed
  settle(chart); frame(chart)
  assert.equal(chart.paneScale('rsi').primed, false)

  const rsi = chart.paneRect('rsi')
  const gutter = chart.plot.w + 20
  drag(chart, { x: gutter, y: rsi.y + 40 }, { x: gutter, y: rsi.y + 100 })

  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  settle(chart); frame(chart)
  const ps = chart.paneScale('rsi')
  assert.equal(ps.primed, true, 'the pane must still be able to fit its first series')
  assert.ok(ps.lo < 5 && ps.hi > 95, `and fit it properly, got ${ps.lo}..${ps.hi}`)
  chart.destroy()
})

test('the crosshair time tag sits below the LAST pane, not inside the candles', () => {
  // drawCrosshair is handed the hovered PANE's rect, so plot.h is that pane's
  // height. Hovering an oscillator put the timestamp a third of the way up the
  // chart. Same defect as the 0.9.0 time-axis fix, in the renderer that sweep
  // missed.
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(), pane: 'rsi' })
  settle(chart); frame(chart)

  const rsi = chart.paneRect('rsi')
  const bottom = rsi.y + rsi.h
  chart.cursor = { x: 400, y: rsi.y + 40 }
  clearOps(chart)
  frame(chart, 16, ['overlay'])

  const ys = drawnText(chart, 'overlay')
  const timeTag = ys.find((t) => /\d{4}-\d{2}-\d{2}/.test(t.text))
  assert.ok(timeTag, 'the time tag must be drawn')
  assert.ok(timeTag.y > bottom, `the time tag belongs below the plot (${bottom}), was at ${timeTag.y}`)
  chart.destroy()
})

test('replacing the bars on an overlapping range keeps the window AND the axis', () => {
  // setData unprimes the scale so the next fit jumps rather than gliding — but
  // unpriming a manual window it has deliberately KEPT leaves a range that is
  // real and an axis that is never drawn.
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, 200, MIN, 24000))
  settle(chart); frame(chart)
  chart.ps.scaleBy(1.4)
  settle(chart); frame(chart)
  const kept = { lo: chart.ps.lo, hi: chart.ps.hi }

  chart.setData(makeBars(T0, 300, MIN, 24000))   // same instrument, more bars
  settle(chart); clearOps(chart); frame(chart)

  assert.equal(chart.ps.auto, false, "the reader's window survives overlapping data")
  assert.ok(Math.abs(chart.ps.lo - kept.lo) < 0.01, 'and is unchanged')
  assert.equal(chart.ps.primed, true, 'and stays drawable')
  const labels = drawnText(chart, 'base').filter((t) => /^\d{4,}/.test(t.text))
  assert.ok(labels.length > 0, 'a kept window must still draw its price axis')
  chart.destroy()
})
