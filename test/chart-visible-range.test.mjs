/**
 * Setting the visible window.
 *
 * The case that motivates it: a finished backtest of tens of thousands of
 * bars, which must OPEN on its first hundred with the whole run still loaded
 * behind it. Fitting everything is the honest view of the dataset and a
 * useless first impression.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const osc = (n) => Array.from({ length: n }, (_, i) => ({ time: T0 + i * MIN, value: 50 + 40 * Math.sin(i / 12) }))

const charted = (bars = 2000) => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, bars, MIN, 24000))
  settle(chart); frame(chart)
  return chart
}

/**
 * visibleRange() is NOT the identity of setVisibleRange, and asserting that it
 * is would be wrong rather than strict. It reports every bar with any pixel on
 * screen — `floor(index(0)) - 1` to `ceil(index(width)) + 1` — so it always
 * answers a bar or two wider than the window that was set. Worse, the lower
 * end is float-dependent: width / (width / span) is not span, so at some plot
 * widths index(0) lands on 98.99999999999999 and floor() drops a whole bar.
 *
 * So: assert the named window is COVERED, and that it is not covered by
 * accident. `ts.right` is the value to assert exactly — it is jumped, not
 * computed.
 */
const covers = (chart, from, to) => {
  const v = chart.ts.visibleRange()
  assert.ok(v.from <= from && v.to >= to, `window ${from}..${to} is not covered by ${v.from}..${v.to}`)
  assert.ok(v.from >= from - 3, `...and not covered by accident: ${v.from}..${v.to}`)
}

// ------------------------------------------------------------ the whole point
test('a window opens on the bars asked for, with the whole run still loaded', () => {
  const chart = charted(29105)
  assert.equal(chart.setVisibleRange({ from: 0, to: 99 }), true)
  frame(chart)

  covers(chart, 0, 99)
  assert.equal(chart.ts.right, 99, 'the named last bar IS the right edge')
  // The left edge, pinned by arithmetic rather than by the padded read-back:
  // exactly (to - from + 1) bars span the plot, so the named first bar sits on
  // the left edge and nothing wider fits.
  assert.equal(chart.ts.spacing, chart.plot.w / 100,
    'exactly 100 bars across the plot — not 99, not 101')
  // Bars are drawn CENTRED on their slot, so the named first bar sits one slot
  // in from the left edge — the convention fitContent has always used.
  assert.ok(Math.abs(chart.ts.x(0) - chart.ts.spacing) < 1e-9,
    `bar 0 should sit one slot in, at x=${chart.ts.spacing}, got ${chart.ts.x(0)}`)
  assert.equal(chart.bars.length, 29105, 'a window is a view, not a filter')
  assert.ok(chart.ts.spacing > 8 && chart.ts.spacing < 9,
    `100 bars across an 832px plot is ~8.3px each, got ${chart.ts.spacing}`)

  // and the rest of the run is still reachable
  chart.ts.panBy(-1200)
  assert.ok(chart.ts.visibleRange().from > 99, 'the remaining 29,000 bars must still be pannable')
  chart.destroy()
})

test('setting a window invalidates the frame — the whole reason ts.fitContent() was not enough', () => {
  // Issue #1 was not "the arithmetic is missing", it was that TimeScale holds
  // no reference to the loop, so reaching it directly repaints nothing.
  const chart = charted()
  chart.loop._dirty.clear()
  chart.setVisibleRange({ from: 0, to: 99 })
  assert.ok(chart.loop._dirty.has('all'), 'setVisibleRange must mark the frame dirty')

  chart.loop._dirty.clear()
  chart.fitContent()
  assert.ok(chart.loop._dirty.has('all'), 'and so must fitContent')

  // and the frame it schedules actually redraws the candles
  chart.loop._dirty.clear()
  chart.setVisibleRange({ from: 500, to: 599 })
  clearOps(chart)
  frame(chart, 16, [...chart.loop._dirty])
  assert.ok(chart.layers.canvas.main.ops.length > 0, 'the scheduled frame must draw')
  chart.destroy()
})

test('a windowed open is not animated — it lands on the first frame', () => {
  const chart = charted()
  const seen = []
  chart.subscribe('visibleRange', (r) => seen.push(r))
  chart.setVisibleRange({ from: 400, to: 499 })

  assert.equal(chart.ts.settled, true, 'both values are jumped, not eased')
  assert.equal(frame(chart), false, 'nothing may still be moving after the first frame')
  assert.equal(seen.at(-1).settled, true,
    'the first event of the gesture already carries settled:true — a consumer deferring work must not wait forever')
  chart.destroy()
})

test('the price scale fits the WINDOW, not the run', () => {
  const chart = createChart(makeContainer())
  // A ramp, so the first hundred bars and the whole run have different ranges.
  const bars = Array.from({ length: 2000 }, (_, i) => {
    const p = 24000 + i
    return { time: T0 + i * MIN, open: p, high: p + 1, low: p - 1, close: p, volume: 10 }
  })
  chart.setData(bars)
  settle(chart); frame(chart)

  chart.setVisibleRange({ from: 0, to: 99 })
  settle(chart); frame(chart)
  assert.ok(chart.ps.hi < 24200, `the scale must fit the window, got up to ${chart.ps.hi}`)
  chart.destroy()
})

// ------------------------------------------------------------------ follow
test('a window short of the newest bar is not yanked by the next bar', () => {
  const chart = charted(2000)
  chart.setVisibleRange({ from: 0, to: 99 })
  assert.equal(chart.ts.follow, false, 'the right edge is not the newest bar, so the chart is not following')

  chart.append({ time: T0 + 2000 * MIN, open: 24000, high: 24001, low: 23999, close: 24000, volume: 1 })
  settle(chart); frame(chart)
  assert.equal(chart.ts.right, 99, 'an append must not drag a pinned window away')
  chart.destroy()
})

test('a window that ends on the newest bar goes on following', () => {
  const chart = charted(400)
  chart.setVisibleRange({ from: 300, to: 399 })
  assert.equal(chart.ts.follow, true, 'the window ends at the newest bar, so this IS the live view')

  chart.append({ time: T0 + 400 * MIN, open: 24000, high: 24001, low: 23999, close: 24000, volume: 1 })
  settle(chart); frame(chart)
  assert.ok(chart.ts.right > 399, 'a live window must glide the new bar in')
  chart.destroy()
})

// ------------------------------------------------- the same move, wider window
test('setVisibleRange over everything IS fitContent', () => {
  const a = charted(2000)
  const b = charted(2000)
  a.fitContent()
  b.setVisibleRange({ from: 0, to: 1999 })
  assert.equal(b.ts.spacing, a.ts.spacing)
  assert.equal(b.ts.right, a.ts.right)
  assert.equal(b.ts.follow, a.ts.follow)
  assert.equal(b.ts.minSpacing, a.ts.minSpacing)
  // Both delegate to _window, so equality alone would hold even if _window were
  // wrong. Pin the absolute answer too.
  assert.equal(a.ts.right, 1999)
  assert.equal(a.ts.spacing, a.plot.w / 2000)
  assert.equal(a.ts.follow, true)
  a.destroy(); b.destroy()
})

test('zooming IN leaves the interactive floor alone; a window wider than the floor lowers it', () => {
  const chart = charted(20000)
  const floor = chart.ts.minSpacing
  chart.setVisibleRange({ from: 0, to: 99 })
  assert.equal(chart.ts.minSpacing, floor,
    'a hundred bars needs 8px each — ten times the floor, which must therefore not move')

  chart.setVisibleRange({ from: 0, to: 4999 })
  assert.ok(chart.ts.minSpacing < floor, 'a 5,000-bar window needs less than the floor allows')
  assert.equal(chart.ts.minSpacing, chart.plot.w / 5000, 'lowered to exactly what the window needs')
  covers(chart, 0, 4999)
  assert.equal(chart.ts.right, 4999,
    'clamping to the floor here would show a different window from the one named, and still report success')
  chart.destroy()
})

// ---------------------------------------------------------------- the edges
test('ends outside the data clamp rather than refusing', () => {
  const chart = charted(200)
  assert.equal(chart.setVisibleRange({ from: -500, to: 99 }), true)
  assert.equal(chart.ts.right, 99)
  assert.equal(chart.ts.spacing, chart.plot.w / 100,
    'clamped to bar 0 — an unclamped -500 would fit 600 slots into the plot')

  assert.equal(chart.setVisibleRange({ from: 150, to: 99999 }), true)
  assert.equal(chart.ts.right, 199, 'the far end clamps to the last loaded bar')
  chart.destroy()
})

test('a reversed window is swapped, not refused', () => {
  const chart = charted(200)
  assert.equal(chart.setVisibleRange({ from: 99, to: 10 }), true)
  assert.equal(chart.ts.right, 99, '(to, from) has exactly one possible meaning')

  // Reversed AND fractional: the swap has to happen BEFORE the rounding, or
  // floor/ceil land on the wrong ends and the window arrives a bar narrower at
  // each end instead of a bar wider.
  chart.setVisibleRange({ from: 99.5, to: 0.4 })
  assert.equal(chart.ts.right, 100, 'ceil applies to the HIGH end after the swap')
  assert.equal(chart.ts.spacing, chart.plot.w / 101, 'and floor to the low one: 0..100 inclusive')
  chart.destroy()
})

test('a one-bar window is widened to two, and keeps the bar that was named', () => {
  const chart = charted(200)
  assert.equal(chart.setVisibleRange({ from: 50, to: 50 }), true)
  assert.equal(chart.ts.right, 51, 'widened forwards')

  assert.equal(chart.setVisibleRange({ from: 199, to: 199 }), true)
  assert.equal(chart.ts.right, 199, 'at the last bar there is nowhere forward, so it widens backwards')
  chart.destroy()
})

test('fractional ends widen outwards — they never hide the bar they name', () => {
  const chart = charted(200)
  chart.setVisibleRange({ from: 0.4, to: 99.5 })
  assert.equal(chart.ts.right, 100, 'ceil, so bar 99 keeps every pixel it had')
  chart.destroy()
})

test('what is refused, and why each one cannot be rescued by clamping', () => {
  const chart = charted(200)
  assert.equal(chart.setVisibleRange({ from: NaN, to: 99 }), false)
  assert.equal(chart.setVisibleRange({ from: null, to: 99 }), false,
    '`+null` is 0, so an unguarded null would silently read as bar 0')
  assert.equal(chart.setVisibleRange({ from: undefined, to: 99 }), false)
  assert.equal(chart.setVisibleRange({}), false)
  assert.equal(chart.setVisibleRange(null), false)
  chart.destroy()

  const empty = createChart(makeContainer())
  assert.equal(empty.setVisibleRange({ from: 0, to: 99 }), false,
    'a call that raced the data load must be loud, not show some other window')
  empty.setData(makeBars(T0, 1, MIN, 24000))
  assert.equal(empty.setVisibleRange({ from: 0, to: 0 }), false, 'one bar is not a window')
  empty.destroy()

  // Separately, and with bars: destroy() empties chart.bars but leaves the time
  // scale's own barCount alone, so without the _destroyed guard this call would
  // sail through the bar-count one.
  const dead = charted(2000)
  assert.ok(dead.ts.barCount > 1)
  dead.destroy()
  assert.equal(dead.setVisibleRange({ from: 0, to: 99 }), false, 'a destroyed chart has no view to set')
  assert.equal(dead.fitContent(), false)
})

test('a chart the browser has not laid out yet refuses, rather than fitting against one pixel', () => {
  // The killer is silent: width is clamped to a minimum of 1, so a window
  // computed here succeeds, craters minSpacing to the fit floor, and nothing
  // recomputes it when the real layout arrives.
  const chart = createChart(makeContainer({ width: 0, height: 0 }))
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  const floor = chart.ts.minSpacing
  assert.equal(chart.setVisibleRange({ from: 0, to: 99 }), false)
  assert.equal(chart.fitContent(), false)
  assert.equal(chart.ts.minSpacing, floor, 'and the interactive floor is left alone')
  chart.destroy()
})

test('an in-flight pan glide does not drag the window that was just set', () => {
  // A flick, then a toolbar button calling setVisibleRange. The pointerdown
  // that would have stopped the glide never happened, because the click landed
  // outside the chart.
  const chart = charted(2000)
  for (let i = 0; i < 5; i++) chart.inertia.sample(40, 16)
  chart.inertia.release()

  chart.setVisibleRange({ from: 0, to: 99 })
  assert.equal(frame(chart, 16), false, 'nothing may still be gliding')
  for (let i = 0; i < 40; i++) frame(chart, 16)
  assert.equal(chart.ts.right, 99, 'the window must be exactly where it was set')
  chart.destroy()
})

// -------------------------------------------------------------- every pane
test('a new window returns EVERY pane to autoscale, not just the price pane', () => {
  const chart = charted(2000)
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(2000), pane: 'rsi' })
  settle(chart); frame(chart)

  chart.paneScale('rsi').scaleBy(2)
  chart.ps.scaleBy(2)
  assert.equal(chart.paneScale('rsi').auto, false)

  chart.setVisibleRange({ from: 0, to: 99 })
  assert.equal(chart.ps.auto, true)
  assert.equal(chart.paneScale('rsi').auto, true,
    'a sub-pane left hand-stretched is describing bars that are no longer on screen')
  chart.destroy()
})

test('fitContent returns every pane to autoscale too — the two are one move', () => {
  const chart = charted(2000)
  chart.addPane('rsi')
  chart.setSeries('rsi14', { data: osc(2000), pane: 'rsi' })
  settle(chart); frame(chart)

  chart.paneScale('rsi').scaleBy(2)
  chart.fitContent()
  assert.equal(chart.paneScale('rsi').auto, true)
  chart.destroy()
})

// ------------------------------------------------------------- the round trip
test('visibleRange() is not the exact round trip of setVisibleRange', () => {
  // Pinned deliberately: it reports every bar with any pixel on screen, so it
  // reads a little wider than the window that was set. Feeding it back creeps
  // outwards. Nobody should "fix" either half to match the other.
  const chart = charted(2000)
  chart.setVisibleRange({ from: 100, to: 199 })
  const first = chart.ts.visibleRange()
  assert.ok(first.from < 100 || first.to > 199, 'the reported window is wider than the one set')

  chart.setVisibleRange(first)
  const second = chart.ts.visibleRange()
  assert.ok(second.from <= first.from && second.to >= first.to, 'so a round trip creeps outward, never inward')
  chart.destroy()
})
