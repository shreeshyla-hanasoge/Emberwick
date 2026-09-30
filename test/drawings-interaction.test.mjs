/**
 * Drawings through the real seam: a real Chart, the real plugin hooks, the
 * real machine, snap, tools, scene and motion. Every gesture here is driven
 * the way a browser drives it — chart._onDown/_onMove/_onUp/_onKey — and
 * every assertion is about what a reader or a host would observe: the stored
 * points, the events, the cursor, the crosshair, the view.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, frame, settle, deferredFeed } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { enableDrawings, TOOL_PRESETS } = await import('../src/drawings/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

/** Bars whose highs and lows differ bar to bar, so a magnet has something to choose. */
const wavy = (n, t0 = T0) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7)
  return { time: t0 + i * MIN, open: c - 0.5, high: c + 1 + (i % 3) * 0.3, low: c - 1 - (i % 4) * 0.2, close: c + 0.3, volume: 10 + i }
})

const seq = () => { let n = 0; return () => 'd' + ++n }

// Presses a second apart unless a test says otherwise: never a double-click.
let clock = 10_000
const mouse = (x, y, o = {}) => ({ pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y, button: 0, buttons: 1, timeStamp: (clock += 1000), preventDefault() {}, ...o })
const moveTo = (x, y, o = {}) => mouse(x, y, { buttons: 0, ...o })
const touch = (x, y, o = {}) => ({ pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, button: 0, buttons: 1, timeStamp: (clock += 1000), ...o })
const key = (k, o = {}) => ({ key: k, prevented: false, preventDefault() { this.prevented = true }, ...o })

function setup({ drawings = {}, chart: chartOpts = {}, bars = wavy(300) } = {}) {
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
const slotOf = (chart, x) => Math.round(chart.ts.index(x))
const barTime = (chart, i) => chart.bars[i].time

function click(chart, x, y, o = {}) {
  chart._onMove(moveTo(x, y, o))
  chart._onDown(mouse(x, y, o))
  chart._onUp(mouse(x, y, o))
  chart._onClick(mouse(x, y, o))
}

function drag(chart, [x0, y0], [x1, y1], o = {}, steps = 6) {
  chart._onMove(moveTo(x0, y0, o))
  chart._onDown(mouse(x0, y0, o))
  for (let i = 1; i <= steps; i++) chart._onMove(mouse(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, o))
  chart._onUp(mouse(x1, y1, o))
}

/** A trendline between bars i0 and i1 at the given prices, added through the API. */
function line(chart, dc, i0, p0, i1, p1, extra = {}) {
  const id = dc.add({ type: 'trendLine', points: [{ time: barTime(chart, i0), price: p0 }, { time: barTime(chart, i1), price: p1 }], ...extra })
  frame(chart)
  return id
}

const events = (dc, names) => {
  const out = []
  for (const n of names) dc.subscribe(n, (p) => out.push([n, p]))
  // State events deliver on subscribe; the test cares about what follows.
  out.length = 0
  return out
}

// ------------------------------------------------------------------ creation

const EXPECT = {
  trendLine: { type: 'trendLine', options: { extend: 'none' } },
  ray: { type: 'trendLine', options: { extend: 'right' } },
  extendedLine: { type: 'trendLine', options: { extend: 'both' } },
  arrow: { type: 'trendLine', options: { endCap: 'arrow' } },
  horizontalLine: { type: 'horizontalLine', options: { extend: 'both' } },
  horizontalRay: { type: 'horizontalLine', options: { extend: 'right' } },
  verticalLine: { type: 'verticalLine', options: {} },
  rectangle: { type: 'rectangle', options: {} },
  parallelChannel: { type: 'parallelChannel', options: {} },
  fibRetracement: { type: 'fibRetracement', options: {} },
  measure: { type: 'measure', options: {} },
  long: { type: 'position', options: { side: 'long' } },
  short: { type: 'position', options: { side: 'short' } },
  text: { type: 'text', options: {} },
}

for (const mode of ['drag', 'click-click']) {
  test(`every preset creates its drawing by mouse (${mode}), selects it and disarms`, () => {
    for (const name of Object.keys(TOOL_PRESETS)) {
      const { chart, dc } = setup()
      const seen = events(dc, ['change', 'tool'])
      const type = TOOL_PRESETS[name].type
      const i0 = 240
      const x0 = X(chart, i0)
      const y0 = 150
      dc.setTool(name)
      if (mode === 'drag') {
        drag(chart, [x0, y0], [X(chart, 270), 220])
      } else {
        click(chart, x0, y0)
        if (['trendLine', 'rectangle', 'parallelChannel', 'fibRetracement', 'measure'].includes(type)) click(chart, X(chart, 270), 220)
      }
      if (type === 'parallelChannel') click(chart, X(chart, 255), 120)
      if (type === 'text') {
        const ta = chart.container.children.find((c) => c.tagName === 'TEXTAREA')
        assert.ok(ta && ta.focused, `${name}: the editor opened focused inside the up`)
        assert.equal(dc.getDrawings().length, 0, `${name}: a text draft is not a drawing yet (D25)`)
        ta.value = 'Note'
        ta.dispatch('keydown', { key: 'Enter', stopPropagation() {}, preventDefault() {} })
      }
      frame(chart)
      const all = dc.getDrawings()
      assert.equal(all.length, 1, `${name} (${mode}) made one drawing`)
      const d = all[0]
      assert.equal(d.type, EXPECT[name].type, name)
      for (const [k, v] of Object.entries(EXPECT[name].options)) assert.equal(d.options[k], v, `${name}.options.${k}`)
      // A one-point tool without press-drag creation carries its point along
      // a drag and places it on the up; everything else anchors P0 on the down.
      const follows = mode === 'drag' && ['horizontalLine', 'verticalLine', 'text'].includes(type)
      assert.equal(d.points[0].time, barTime(chart, follows ? 270 : i0), `${name}: P0 is on the pressed bar`)
      if (type !== 'position') assert.ok(Math.abs(d.points[0].price - chart.ps.price(follows ? 220 : y0)) < 1e-9, `${name}: P0 price is the pointer's`)
      if (type === 'text') assert.equal(d.options.text, 'Note')
      assert.deepEqual(dc.selection, [d.id], `${name}: the new drawing is selected`)
      assert.equal(dc.tool, null, `${name}: non-sticky tools disarm`)
      const changes = seen.filter(([n]) => n === 'change').map(([, p]) => p)
      assert.equal(changes.length, 1, `${name}: exactly one change`)
      assert.equal(changes[0].reason, 'create')
      assert.equal(changes[0].source, 'user')
      assert.equal(chart._owner, null, `${name}: no gesture left owned`)
      chart.destroy()
    }
  })
}

test('a sticky tool re-arms after each drawing', () => {
  const { chart, dc } = setup()
  dc.setTool('horizontalLine', { sticky: true })
  click(chart, 300, 150)
  click(chart, 300, 250)
  assert.equal(dc.getDrawings().length, 2)
  assert.equal(dc.tool, 'horizontalLine')
  assert.equal(chart.container.style.cursor, 'crosshair')
  dc.cancel()
  assert.deepEqual(dc.selection, [], 'Esc peels one layer: first the selection')
  assert.equal(dc.tool, 'horizontalLine')
  dc.cancel()
  assert.equal(dc.tool, null, 'then the tool')
})

test('a text commit with no text creates nothing and fires nothing', () => {
  const { chart, dc } = setup()
  const seen = events(dc, ['change', 'history'])
  dc.setTool('text')
  click(chart, 300, 150)
  const ta = chart.container.children.find((c) => c.tagName === 'TEXTAREA')
  ta.value = '   '
  ta.dispatch('keydown', { key: 'Enter', stopPropagation() {}, preventDefault() {} })
  assert.equal(dc.getDrawings().length, 0)
  assert.deepEqual(seen, [])
  assert.ok(ta.removed, 'the editor is gone')
})

// ------------------------------------------------------------------ select and drag

test('a press on a drawing selects it on down, and a drag moves it by whole bars', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const d0 = dc.get(id)
  const seen = events(dc, ['select', 'change'])
  const xm = X(chart, 250)
  const ym = Y(chart, 101)
  chart._onMove(moveTo(xm, ym))
  chart._onDown(mouse(xm, ym))
  assert.deepEqual(dc.selection, [id], 'selected on the down, before any move')
  assert.equal(seen[0][0], 'select')
  const dx = 3 * chart.ts.spacing
  chart._onMove(mouse(xm + dx / 2, ym + 10))
  chart._onMove(mouse(xm + dx, ym + 20))
  chart._onUp(mouse(xm + dx, ym + 20))
  const d1 = dc.get(id)
  assert.equal(d1.points[0].time, d0.points[0].time + 3 * MIN)
  assert.equal(d1.points[1].time, d0.points[1].time + 3 * MIN)
  const dp = chart.ps.price(ym + 20) - chart.ps.price(ym)
  assert.ok(Math.abs(d1.points[0].price - (100 + dp)) < 1e-6)
  assert.ok(Math.abs(d1.points[1].price - (102 + dp)) < 1e-6)
  const changes = seen.filter(([n]) => n === 'change')
  assert.equal(changes.length, 1)
  assert.equal(changes[0][1].reason, 'move')
})

test('dragging an endpoint handle moves only that point', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.select(id)
  frame(chart)
  drag(chart, [X(chart, 260), Y(chart, 102)], [X(chart, 270), Y(chart, 99)])
  const d = dc.get(id)
  assert.deepEqual(d.points[0], { time: barTime(chart, 240), price: 100 })
  assert.equal(d.points[1].time, barTime(chart, 270))
  assert.ok(Math.abs(d.points[1].price - chart.ps.price(Y(chart, 99))) < 1e-9)
})

test('Alt+drag clones the drawing and leaves the original where it was', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const d0 = dc.get(id)
  dc.select(id)
  frame(chart)
  const seen = events(dc, ['change'])
  drag(chart, [X(chart, 250), Y(chart, 101)], [X(chart, 255), Y(chart, 101)], { altKey: true })
  const all = dc.getDrawings()
  assert.equal(all.length, 2)
  assert.deepEqual(dc.get(id), d0, 'the original did not move')
  const clone = all.find((d) => d.id !== id)
  assert.equal(clone.points[0].time, d0.points[0].time + 5 * MIN)
  assert.deepEqual(dc.selection, [clone.id])
  assert.equal(seen.length, 1)
  assert.equal(seen[0][1].reason, 'duplicate')
})

test('one change per gesture, and the drawing stream once per changed frame', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const changes = []
  const stream = []
  dc.subscribe('change', (p) => changes.push(p))
  dc.subscribe('drawing', (p) => stream.push(p))
  const xm = X(chart, 250)
  const ym = Y(chart, 101)
  chart._onMove(moveTo(xm, ym))
  chart._onDown(mouse(xm, ym))
  for (let i = 1; i <= 10; i++) {
    chart._onMove(mouse(xm + i * 4, ym + i))
    frame(chart)
  }
  const during = stream.length
  frame(chart)
  assert.equal(stream.length, during, 'a frame with no move emits nothing')
  chart._onUp(mouse(xm + 40, ym + 10))
  frame(chart)
  assert.equal(changes.length, 1, 'never per drag frame')
  assert.equal(during, 10)
  assert.equal(stream[0].phase, 'move')
  assert.equal(stream[0].drawing.id, id)
  assert.ok(Number.isFinite(stream[9].stats.bars))
})

test('Delete removes the selection, but a locked drawing shakes and stays', () => {
  const { chart, dc } = setup()
  const a = line(chart, dc, 240, 100, 260, 102)
  const b = line(chart, dc, 230, 98, 250, 99, { locked: true })
  dc.select(b)
  const k1 = key('Delete')
  chart._onKey(k1)
  assert.ok(k1.prevented, 'consumed, so the core does nothing with it')
  assert.ok(dc.get(b), 'locked: kept')
  dc.select(a)
  const k2 = key('Delete')
  chart._onKey(k2)
  assert.equal(dc.get(a), null)
  assert.ok(k2.prevented)
})

test('Ctrl+Z undoes and Ctrl+Shift+Z / Ctrl+Y redo, with history as the source', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const seen = events(dc, ['change'])
  dc.select(id)
  chart._onKey(key('Delete'))
  assert.equal(dc.get(id), null)
  chart._onKey(key('z', { ctrlKey: true }))
  assert.ok(dc.get(id))
  assert.deepEqual(dc.selection, [id], 'undo selects what came back')
  chart._onKey(key('z', { ctrlKey: true, shiftKey: true }))
  assert.equal(dc.get(id), null)
  chart._onKey(key('z', { ctrlKey: true }))
  chart._onKey(key('y', { ctrlKey: true }))
  assert.equal(dc.get(id), null)
  assert.deepEqual(seen.map(([, p]) => `${p.source}:${p.reason}`), ['user:remove', 'history:undo', 'history:redo', 'history:undo', 'history:redo'])
})

test('arrow keys nudge the selection, and consecutive nudges undo as one', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.select(id)
  for (let i = 0; i < 3; i++) chart._onKey(key('ArrowRight'))
  assert.equal(dc.get(id).points[0].time, barTime(chart, 243))
  assert.equal(dc.get(id).points[1].time, barTime(chart, 263))
  const k = key('ArrowRight', { shiftKey: true })
  chart._onKey(k)
  assert.ok(k.prevented, 'no pan while a selection is nudged')
  assert.equal(dc.get(id).points[0].time, barTime(chart, 253))
  chart._onKey(key('ArrowUp'))
  assert.ok(dc.get(id).points[0].price > 100, 'up nudges the price up')
  dc.undo()
  assert.equal(dc.get(id).points[0].time, barTime(chart, 240), 'one undo reverts the whole run of nudges')
  assert.equal(dc.canUndo, true, 'the add is still there to undo')
  dc.undo()
  assert.equal(dc.get(id), null)
})

// ------------------------------------------------------------------ Esc, release, external aborts

test('Esc mid-drag reverts it with no change and hands the press back to the raw crosshair', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const d0 = dc.get(id)
  const seen = events(dc, ['change'])
  const xm = X(chart, 250)
  const ym = Y(chart, 101)
  chart._onMove(moveTo(xm, ym))
  chart._onDown(mouse(xm, ym))
  chart._onMove(mouse(xm + 30, ym + 30))
  const k = key('Escape')
  chart._onKey(k)
  assert.ok(k.prevented)
  assert.equal(chart._owner, null, 'released')
  const right = chart.ts.right
  chart._onMove(mouse(xm + 60, ym + 40))
  assert.equal(chart.ts.right, right, 'the rest of the press does not pan')
  assert.equal(chart.cursor.x, xm + 60, 'the crosshair tracks the raw pointer')
  assert.ok(!chart.cursor.exact)
  assert.equal(chart.container.style.cursor, 'crosshair')
  chart._onUp(mouse(xm + 60, ym + 40))
  assert.deepEqual(dc.get(id), d0)
  assert.deepEqual(seen, [])
})

test('an API remove of the dragged drawing aborts the drag and releases the press', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const xm = X(chart, 250)
  const ym = Y(chart, 101)
  chart._onMove(moveTo(xm, ym))
  chart._onDown(mouse(xm, ym))
  chart._onMove(mouse(xm + 30, ym))
  assert.ok(chart._owner)
  dc.remove(id)
  assert.equal(chart._owner, null, 'the plugin no longer owns the press')
  const right = chart.ts.right
  chart._onMove(mouse(xm + 90, ym))
  chart._onUp(mouse(xm + 90, ym))
  assert.equal(chart.ts.right, right, 'and the press does not turn into a pan')
  assert.equal(dc.getDrawings().length, 0)
})

test('an API edit of ANOTHER drawing leaves the drag alone', () => {
  const { chart, dc } = setup()
  const a = line(chart, dc, 240, 100, 260, 102)
  const b = line(chart, dc, 200, 95, 210, 96)
  const xm = X(chart, 250)
  const ym = Y(chart, 101)
  chart._onMove(moveTo(xm, ym))
  chart._onDown(mouse(xm, ym))
  chart._onMove(mouse(xm + 2 * chart.ts.spacing, ym))
  dc.update(b, { style: { color: '#ff0000' } })
  assert.ok(chart._owner, 'still dragging')
  chart._onUp(mouse(xm + 2 * chart.ts.spacing, ym))
  assert.equal(dc.get(a).points[0].time, barTime(chart, 242))
  assert.equal(dc.get(b).style.color, '#ff0000', 'and the other edit is not clobbered')
})

test('an API edit of another drawing does not abort a creation in progress', () => {
  const { chart, dc } = setup()
  const b = line(chart, dc, 200, 95, 210, 96)
  dc.setTool('trendLine')
  click(chart, X(chart, 240), 150)
  assert.equal(dc._state.name, 'PLACING', 'the first click of a click-click creation is placed')
  dc.update(b, { style: { color: '#ff0000' } })
  assert.equal(dc._state.name, 'PLACING', 'the creation is not aborted: the drawing being made is not stored, so no other id can touch it')
  assert.equal(dc.tool, 'trendLine')
  click(chart, X(chart, 270), 220)
  assert.equal(dc.getDrawings().length, 2, 'the second click still completes it')
})

test('clear() with only carried rows changes nothing and leaves a creation in progress alone', () => {
  const { chart, dc } = setup()
  dc.setDrawings([{ type: 'future', id: 'f' }])
  dc.setTool('trendLine')
  click(chart, X(chart, 240), 150)
  assert.equal(dc._state.name, 'PLACING')
  assert.equal(dc.clear(), 0)
  assert.equal(dc._state.name, 'PLACING', 'nothing was cleared, so nothing was aborted')
  assert.equal(dc.tool, 'trendLine')
  click(chart, X(chart, 270), 220)
  assert.equal(dc.getDrawings().length, 2, 'the carried row and the new drawing')
})

test('a host select listener that removes the drawing inside pointerDown leaves no owner', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.subscribe('select', (p) => { if (p.ids.length) dc.remove(p.ids[0]) })
  const xm = X(chart, 250)
  const ym = Y(chart, 101)
  chart._onMove(moveTo(xm, ym))
  chart._onDown(mouse(xm, ym))
  assert.equal(dc.get(id), null)
  assert.equal(chart._owner, null)
})

// ------------------------------------------------------------------ locked, markers, fills

test('a mouse drag starting on a locked fib pans the chart; a click on it selects it', () => {
  const { chart, dc } = setup()
  const id = dc.add({ type: 'fibRetracement', locked: true, points: [{ time: barTime(chart, 230), price: 96 }, { time: barTime(chart, 270), price: 104 }] })
  frame(chart)
  const d0 = dc.get(id)
  const x = X(chart, 250)
  const y = Y(chart, 100)
  assert.equal(dc.drawingAt(x, y).locked, true, 'the fib is under the pointer')
  click(chart, x, y)
  assert.deepEqual(dc.selection, [id], 'a click selects it, so it can be unlocked')
  dc.select(null)
  const right = chart.ts.right
  drag(chart, [x, y], [x + 60, y])
  assert.notEqual(chart.ts.right, right, 'the chart panned')
  assert.deepEqual(dc.get(id), d0)
  assert.deepEqual(dc.selection, [], 'and the pan did not select it')
})

test('a trade marker inside a position box still hovers and clicks; the box border selects the position', () => {
  const { chart, dc } = setup()
  const k = 250
  chart.setMarkers([{ time: barTime(chart, k), shape: 'circle', id: 'm1' }])
  frame(chart)
  const h = chart._markerHits.find((m) => m.marker.id === 'm1')
  assert.ok(h)
  const pE = chart.ps.price(h.y + 25)
  const id = dc.add({
    type: 'position',
    points: [
      { time: barTime(chart, k - 6), price: pE },
      { time: barTime(chart, k + 6), price: chart.ps.price(h.y - 60) },
      { time: barTime(chart, k + 6), price: chart.ps.price(h.y + 80) },
    ],
  })
  frame(chart)
  assert.equal(dc.drawingAt(h.x, h.y).part, 'fill')
  const hovers = []
  const clicks = []
  chart.subscribe('markerHover', (m) => hovers.push(m && m.id))
  chart.subscribe('markerClick', (m) => clicks.push(m.id))
  chart._onMove(moveTo(h.x, h.y))
  assert.deepEqual(hovers, ['m1'], 'the fill yields its hover to the marker')
  chart._onDown(mouse(h.x, h.y)); chart._onUp(mouse(h.x, h.y)); chart._onClick(mouse(h.x, h.y))
  assert.deepEqual(clicks, ['m1'])
  assert.deepEqual(dc.selection, [])
  click(chart, h.x, Y(chart, pE))
  assert.deepEqual(dc.selection, [id], 'the entry line is a stroke: it wins over the marker')
})

test('a drag that ends over a marker fires no markerClick', () => {
  const { chart, dc } = setup()
  chart.setMarkers([{ time: barTime(chart, 262), shape: 'circle', id: 'm1' }])
  const id = line(chart, dc, 240, 100, 250, 101)
  const h = chart._markerHits.find((m) => m.marker.id === 'm1')
  const clicks = []
  chart.subscribe('markerClick', (m) => clicks.push(m.id))
  drag(chart, [X(chart, 245), Y(chart, 100.5)], [h.x, h.y])
  chart._onClick(mouse(h.x, h.y))
  assert.deepEqual(clicks, [])
  assert.notDeepEqual(dc.get(id).points[0].time, barTime(chart, 240))
})

test('a quick click-click trendline does not reset the view on the dblclick it makes', () => {
  const { chart, dc } = setup()
  chart.ts.panBy(120)
  settle(chart); frame(chart)
  const right = chart.ts.right
  const edits = []
  dc.subscribe('edit', (p) => edits.push(p))
  dc.setTool('trendLine')
  click(chart, 300, 150)
  click(chart, 400, 180)
  chart._onDbl({ clientX: 400, clientY: 180 })
  assert.equal(dc.getDrawings().length, 1)
  assert.equal(chart.ts._right.target, right, 'no view reset')
  assert.deepEqual(edits, [], 'and the new line does not open for editing')
})

// ------------------------------------------------------------------ cursor and crosshair

test('cursor styles: pointer on a line, move once selected, grab on a handle, crosshair while armed', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const xm = X(chart, 250)
  const ym = Y(chart, 101)
  chart._onMove(moveTo(xm, ym))
  assert.equal(chart.container.style.cursor, 'pointer')
  dc.select(id)
  frame(chart)
  chart._onMove(moveTo(xm, ym + 0.5))
  assert.equal(chart.container.style.cursor, 'move')
  chart._onMove(moveTo(X(chart, 260), Y(chart, 102)))
  assert.equal(chart.container.style.cursor, 'grab')
  chart._onMove(moveTo(600, 400))
  assert.equal(chart.container.style.cursor, 'crosshair', 'nothing under the pointer defers to the chart')
  dc.setTool('trendLine')
  chart._onMove(moveTo(xm, ym))
  assert.equal(chart.container.style.cursor, 'crosshair')
})

test('the crosshair shows the snapped price during a creation drag, and the raw pointer after it', () => {
  const { chart, dc } = setup({ drawings: { magnet: 'strong' } })
  const prices = []
  chart.subscribe('crosshair', (p) => prices.push(p && p.price))
  dc.setTool('trendLine')
  const x1 = X(chart, 262)
  chart._onMove(moveTo(X(chart, 240), 150))
  chart._onDown(mouse(X(chart, 240), 150))
  chart._onMove(mouse(x1 - 20, 170))
  chart._onMove(mouse(x1, 170))
  assert.equal(chart.cursor.exact, true)
  const b = chart.bars[262]
  assert.ok([b.open, b.high, b.low, b.close].includes(chart.cursor.price), 'a bar value, not a y round-trip')
  assert.equal(prices[prices.length - 1], chart.cursor.price, 'the crosshair event carries it')
  chart._onUp(mouse(x1, 170))
  assert.ok(!chart.cursor.exact, 'no stale exact point outlives the gesture')
  chart.ts.panBy(40)
  frame(chart)
  assert.equal(prices[prices.length - 1], chart.ps.price(chart.cursor.y), 'the label reads the scale again')
})

test('while a multi-point tool is placed, exactly one tag describes the point that follows the mouse', () => {
  const { chart, dc } = setup()
  dc.setTool('trendLine')
  chart._onMove(moveTo(X(chart, 262), 170))
  assert.equal(chart.cursor.exact, true)
  assert.equal(chart.cursor.tags, undefined, 'armed: no draft yet, so the core draws the reticle\'s tags')
  click(chart, X(chart, 240), 150)
  chart._onMove(moveTo(X(chart, 250), 160))
  chart._onMove(moveTo(X(chart, 262), 170))
  assert.ok(dc._preview, 'the plugin\'s draft draws an accent tag for the followed point')
  assert.equal(chart.cursor.exact, true)
  assert.equal(chart.cursor.tags, false, 'so the core\'s own tag for it is suppressed')
  assert.equal(chart.cursor.price, dc._preview.d.points[1].price, 'both describe one point')
  click(chart, X(chart, 262), 170)
  assert.equal(dc.getDrawings().length, 1, 'the second click still creates it')
})

test('armed under a still mouse costs no frames', () => {
  const { chart, dc } = setup({ drawings: { motion: 'full' } })
  dc.setTool('trendLine')
  chart._onMove(moveTo(300, 200))
  settle(chart)
  assert.equal(frame(chart), false)
})

test('armed, still mouse, wheel zoom: the reticle and the exact crosshair re-snap at the pointer', () => {
  const { chart, dc } = setup()
  dc.setTool('horizontalLine')
  const px = 333
  const py = 211
  chart._onMove(moveTo(px, py))
  chart._onWheel({ clientX: 500, clientY: 200, deltaY: -400, preventDefault() {} })
  settle(chart)
  frame(chart)
  assert.equal(chart.cursor.exact, true)
  assert.equal(chart.cursor.x, chart.ts.x(slotOf(chart, px)))
  assert.equal(chart.cursor.price, chart.ps.price(py))
})

test('a held handle stays under a still pointer while the view zooms', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.select(id)
  frame(chart)
  const px = X(chart, 270)
  const py = Y(chart, 99)
  chart._onMove(moveTo(X(chart, 260), Y(chart, 102)))
  chart._onDown(mouse(X(chart, 260), Y(chart, 102)))
  chart._onMove(mouse(px - 10, py))
  chart._onMove(mouse(px, py))
  chart._onWheel({ clientX: 100, clientY: 200, deltaY: -300, preventDefault() {} })
  settle(chart)
  frame(chart)
  chart._onUp(mouse(px, py))
  const p1 = dc.get(id).points[1]
  assert.equal(p1.time, barTime(chart, slotOf(chart, px)), 'the handle is on the bar under the pointer now')
  assert.equal(p1.price, chart.ps.price(py))
})

test('releasing Shift mid-drag with a still mouse drops the 45° constraint', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.select(id)
  frame(chart)
  const x0 = X(chart, 240)
  const y0 = Y(chart, 100)
  const px = X(chart, 262)
  const py = y0 - (px - x0) * 0.8
  chart._onMove(moveTo(X(chart, 260), Y(chart, 102)))
  chart._onDown(mouse(X(chart, 260), Y(chart, 102), { shiftKey: true }))
  chart._onMove(mouse(px - 5, py, { shiftKey: true }))
  chart._onMove(mouse(px, py, { shiftKey: true }))
  chart.container.dispatch('keyup', { key: 'Shift', shiftKey: false })
  frame(chart)
  chart._onUp(mouse(px, py))
  const p1 = dc.get(id).points[1]
  assert.equal(p1.price, chart.ps.price(py), 'no longer constrained to 45°')
})

test('Shift holds a handle at 45° while it is down', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.select(id)
  frame(chart)
  const x0 = X(chart, 240)
  const y0 = Y(chart, 100)
  const px = X(chart, 262)
  const py = y0 - (px - x0) * 0.8
  chart._onMove(moveTo(X(chart, 260), Y(chart, 102)))
  chart._onDown(mouse(X(chart, 260), Y(chart, 102), { shiftKey: true }))
  chart._onMove(mouse(px, py, { shiftKey: true }))
  chart._onUp(mouse(px, py, { shiftKey: true }))
  const p1 = dc.get(id).points[1]
  assert.ok(Math.abs(Y(chart, p1.price) - (y0 - (X(chart, 262) - x0))) < 1e-6, '45° on screen')
})

test('the hover highlight clears when the view slides the line away from a still mouse', () => {
  const { chart, dc } = setup()
  line(chart, dc, 240, 100, 260, 102)
  const xm = X(chart, 250)
  const ym = Y(chart, 101)
  chart._onMove(moveTo(xm, ym))
  assert.equal(chart.container.style.cursor, 'pointer')
  chart.ts.panBy(200)
  frame(chart)
  assert.equal(chart.container.style.cursor, 'crosshair')
})

// ------------------------------------------------------------------ focus, box, context menu, container

test('setTool and select focus the container unless told not to', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const el = chart.container
  el.focused = false
  dc.setTool('trendLine')
  assert.equal(el.focused, true)
  assert.deepEqual(el.focusOpts, { preventScroll: true })
  el.focused = false
  dc.setTool('rectangle', { focus: false })
  assert.equal(el.focused, false)
  dc.setTool(null)
  dc.select(id, { focus: false })
  assert.equal(el.focused, false)
  dc.select(id)
  assert.equal(el.focused, true)
})

test('the box event follows the selection through a vertical pan that changes no visibleRange', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const boxes = []
  const ranges = []
  dc.subscribe('box', (p) => boxes.push(p))
  chart.subscribe('visibleRange', (p) => ranges.push(p))
  assert.deepEqual(boxes[0], { id: null, box: null }, 'delivered on subscribe')
  dc.select(id)
  frame(chart)
  assert.equal(boxes.length, 2)
  assert.equal(boxes[1].id, id)
  const y0 = boxes[1].box.y
  ranges.length = 0
  chart.ps.panBy(40)
  frame(chart)
  assert.equal(ranges.length, 0, 'the time window did not move')
  assert.equal(boxes.length, 3)
  assert.ok(Math.abs(boxes[2].box.y - (y0 + 40)) < 1e-6)
  frame(chart)
  assert.equal(boxes.length, 3, 'deduped while nothing moves')
})

test('a right-click on a drawing selects it; the native menu is prevented only for a listener', () => {
  const { chart, dc } = setup()
  const id = line(chart, dc, 240, 100, 260, 102)
  const xm = X(chart, 250)
  const ym = Y(chart, 101)
  const e1 = key('', { clientX: xm, clientY: ym })
  chart._onContextMenu(e1)
  assert.equal(e1.prevented, false)
  assert.deepEqual(dc.selection, [id])
  const menus = []
  dc.subscribe('contextmenu', (p) => menus.push(p))
  const e2 = key('', { clientX: xm, clientY: ym })
  chart._onContextMenu(e2)
  assert.equal(e2.prevented, true)
  assert.equal(menus.length, 1)
  assert.equal(menus[0].id, id)
  assert.equal(menus[0].part, 'body')
  assert.equal(menus[0].event, e2)
})

test('the container does not select text while drawings are enabled, and is restored after', () => {
  const chart = createChart(makeContainer())
  chart.container.style.userSelect = 'auto'
  const dc = enableDrawings(chart, { idFactory: seq() })
  assert.equal(chart.container.style.userSelect, 'none')
  assert.equal(chart.container.style.webkitUserSelect, 'none')
  assert.equal(chart.container.style.webkitTouchCallout, 'none')
  assert.equal(chart.container.listeners.get('keyup').size, 1)
  dc.destroy()
  assert.equal(chart.container.style.userSelect, 'auto')
  assert.equal(chart.container.style.webkitTouchCallout, undefined)
  assert.equal(chart.container.listeners.get('keyup').size, 0)
})

test('a selection made in pointerDown schedules a frame by itself', () => {
  const { chart, dc } = setup({ drawings: { motion: 'full' } })
  line(chart, dc, 240, 100, 260, 102)
  settle(chart)
  chart.loop._dirty = new Set()
  chart._onDown(mouse(X(chart, 250), Y(chart, 101)))
  assert.ok(chart.loop._dirty.size > 0)
})

// ------------------------------------------------------------------ motion glue

test('dragging a handle across bars never glides: drags are crisp', () => {
  const { chart, dc } = setup({ drawings: { motion: 'full' } })
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.select(id)
  settle(chart)
  chart._onMove(moveTo(X(chart, 260), Y(chart, 102)))
  chart._onDown(mouse(X(chart, 260), Y(chart, 102)))
  for (let i = 1; i <= 5; i++) {
    chart._onMove(mouse(X(chart, 260 + i), Y(chart, 102) + i))
    assert.equal(dc._motion.residual(id, 1), null, `no residual after a bar-slot change (${i})`)
  }
  chart._onUp(mouse(X(chart, 265), Y(chart, 102) + 5))
})

test('a magnet engaged by the view moving under a held handle glides, and that frame keeps the loop awake', () => {
  const { chart, dc } = setup({ drawings: { motion: 'full', magnet: 'weak' } })
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.select(id)
  settle(chart)
  const i = 265
  const b = chart.bars[i]
  const px = X(chart, i)
  const top = Math.max(b.open, b.high, b.low, b.close)
  const py = Y(chart, top) - 32
  chart._onMove(moveTo(X(chart, 260), Y(chart, 102)))
  chart._onDown(mouse(X(chart, 260), Y(chart, 102)))
  chart._onMove(mouse(px, py - 20))
  chart._onMove(mouse(px, py))
  assert.equal(dc._drag.cur.points[1].price, chart.ps.price(py), 'out of magnet range: the pointer price')
  settle(chart)
  assert.equal(frame(chart), false, 'idle before the view moves')
  chart.ps.panBy(-16)
  assert.equal(frame(chart), true, 'the glide seeded by this frame\'s re-derive keeps it awake')
  assert.ok(dc._motion.residual(id, 1), 'a snap-kind change glides')
  assert.ok(settle(chart) > 0)
  assert.equal(frame(chart), false)
  chart._onUp(mouse(px, py))
  assert.equal(dc.get(id).points[1].price, b.high)
})

/** A held handle out of any snap's reach, then the magnet engaging in the very frame the view jumps. */
function heldThenJump(jump) {
  const { chart, dc } = setup({ drawings: { motion: 'full', magnet: 'off' } })
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.select(id)
  settle(chart)
  const px = X(chart, 265)
  const py = Y(chart, 101)
  chart._onMove(moveTo(X(chart, 260), Y(chart, 102)))
  chart._onDown(mouse(X(chart, 260), Y(chart, 102)))
  chart._onMove(mouse(px - 12, py))
  chart._onMove(mouse(px, py))
  settle(chart)
  assert.equal(dc._motion.residual(id, 1), null, 'nothing is gliding before the jump')
  const before = dc._drag.cur.points[1]
  dc.setMagnet('strong')
  jump(chart)
  assert.equal(frame(chart), true)
  return { chart, dc, id, before, px, py }
}

test('a snap that engages in the frame the view jumps glides by its own pull, not by the size of the jump', () => {
  const { chart, dc, id, before } = heldThenJump((c) => c.ts.panBy(40 * c.ts.spacing))
  const now = dc._drag.cur.points[1]
  assert.ok(Math.abs((now.time - before.time) / MIN) >= 30, 'the jump really moved the point under the pointer by dozens of bars')
  const r = dc._motion.residual(id, 1)
  assert.ok(r, 'the snap still glides')
  assert.equal(r.ru, 0, 'the glide has no bar offset: the snapped and unsnapped points share one bar at this view')
  assert.ok(r.rv !== 0 && Math.abs(r.rv) < 5, `a price pull of the size of the snap (${r.rv}), not of the jump`)
  chart._onUp(mouse(chart.cursor.x, chart.cursor.y))
})

test('a snap engaging as the view is refitted (fitContent) never sweeps the handle either', () => {
  const { chart, dc, id } = heldThenJump((c) => { c.setVisibleRange({ from: 20, to: 120 }); c.fitContent() })
  const r = dc._motion.residual(id, 1)
  assert.ok(!r || r.ru === 0, `no bar offset in the glide (${r && r.ru})`)
  chart._onUp(mouse(chart.cursor.x, chart.cursor.y))
})

test('a creation draft\'s snap glide is measured within one frame as well', () => {
  const { chart, dc } = setup({ drawings: { motion: 'full', magnet: 'off' } })
  dc.setTool('trendLine')
  click(chart, X(chart, 240), 150)
  chart._onMove(moveTo(X(chart, 258), 170))
  chart._onMove(moveTo(X(chart, 265), 180))
  settle(chart)
  const draft = '\u0000draft'
  assert.equal(dc._motion.residual(draft, 1), null)
  dc.setMagnet('strong')
  chart.ts.panBy(40 * chart.ts.spacing)
  assert.equal(frame(chart), true)
  const r = dc._motion.residual(draft, 1)
  assert.ok(r, 'the snap glides')
  assert.equal(r.ru, 0, 'and not by the size of the view jump')
})

test('a handle that stays snapped to a rail while it slides along it seeds no more glides', () => {
  const { chart, dc } = setup({ drawings: { motion: 'full', magnet: 'off' } })
  const rail = dc.add({ type: 'horizontalLine', points: [{ time: barTime(chart, 250), price: 103 }] })
  const id = line(chart, dc, 240, 100, 260, 102)
  dc.select(id)
  settle(chart)
  assert.ok(rail)
  chart._onMove(moveTo(X(chart, 260), Y(chart, 102)))
  chart._onDown(mouse(X(chart, 260), Y(chart, 102)))
  chart._onMove(mouse(X(chart, 262), Y(chart, 103) + 3))
  chart._onMove(mouse(X(chart, 264), Y(chart, 103) + 3))
  assert.equal(dc._drag.cur.points[1].price, 103, 'engaged on the rail')
  assert.ok(dc._motion.residual(id, 1), 'engaging glided')
  settle(chart)
  for (let i = 1; i <= 4; i++) {
    chart._onMove(mouse(X(chart, 264 + i), Y(chart, 103) + 3))
    assert.equal(dc._motion.residual(id, 1), null, `sliding along the rail is crisp (${i})`)
  }
  chart._onUp(mouse(X(chart, 268), Y(chart, 103) + 3))
})

// ------------------------------------------------------------------ data under the drawings

test('an interior bar that moved (same length, same ends) re-resolves: the bar generation is part of the key', () => {
  const { chart, dc } = setup()
  const t = barTime(chart, 250)
  const id = dc.add({ type: 'verticalLine', points: [{ time: t, price: 100 }] })
  frame(chart)
  assert.equal(dc._slotById.get(id).u[0], 250)
  // Same count, same first and last time; the session gap moved so bar 250's
  // time is now bar 245's.
  const bars = chart.bars.map((b) => ({ ...b }))
  for (let i = 1; i < 299; i++) bars[i].time = i < 245 ? T0 + i * MIN : t + (i - 245) * MIN * 0.25
  bars.sort((a, b) => a.time - b.time)
  chart.setData(bars)
  frame(chart)
  assert.equal(dc._slotById.get(id).u[0], 245)
})

test('replay resolves anchors against the whole source: a drawing past the cursor keeps its bar', () => {
  // A session gap: bars 150+ start a day later.
  const bars = wavy(300).map((b, i) => (i >= 150 ? { ...b, time: b.time + 86_400_000 } : b))
  const { chart, dc } = setup({ bars })
  const id = dc.add({ type: 'verticalLine', points: [{ time: bars[200].time, price: 100 }] })
  frame(chart)
  const resolved = dc._resolveCount
  const rp = chart.startReplay({ from: 60 })
  frame(chart)
  assert.equal(dc._slotById.get(id).u[0], 200)
  const after = dc._resolveCount
  assert.ok(after >= resolved)
  rp.seek(90); frame(chart)
  rp.seek(120); frame(chart)
  assert.equal(dc._slotById.get(id).u[0], 200)
  assert.equal(dc._resolveCount, after, 'seeking never re-resolves')
  chart.stopReplay()
})

test('a drawing on a removed pane is orphaned: kept, not drawn, not hit; it returns with the pane', () => {
  const { chart, dc } = setup()
  chart.addPane('rsi')
  chart.setSeries('r', { pane: 'rsi', data: chart.bars.map((b, i) => ({ time: b.time, value: 50 + 20 * Math.sin(i / 5) })) })
  settle(chart); frame(chart)
  const id = dc.add({ type: 'horizontalLine', pane: 'rsi', points: [{ time: barTime(chart, 250), price: 50 }] })
  frame(chart)
  assert.deepEqual(dc.orphans(), [])
  chart.removePane('rsi')
  frame(chart)
  assert.deepEqual(dc.orphans(), [id])
  assert.ok(dc.get(id), 'kept')
  assert.equal(dc.getDrawings().length, 1)
  const y = chart._panes[0].rect.y + chart._panes[0].rect.h / 2
  assert.equal(dc.drawingAt(300, y), null)
  chart.addPane('rsi')
  frame(chart)
  assert.deepEqual(dc.orphans(), [])
})

test('an armed press on a sub-pane that is not primed yet is not claimed and stores nothing', () => {
  const { chart, dc } = setup()
  chart.addPane('rsi')
  frame(chart)
  const r = chart._panes[1].rect
  assert.equal(chart._panes[1].ps.primed, false)
  dc.setTool('horizontalLine')
  chart._onDown(touch(300, r.y + r.h / 2))
  assert.equal(chart._owner, null, 'touch: not claimed')
  chart._onUp(touch(300, r.y + r.h / 2))
  click(chart, 300, r.y + r.h / 2)
  assert.equal(dc.getDrawings().length, 0)
})

async function prependable() {
  const chart = createChart(makeContainer())
  const feed = deferredFeed({ symbol: 'A', timeframe: MIN })
  const p = chart.setFeed(feed)
  feed.release(0, wavy(100, T0))
  await p
  settle(chart); frame(chart)
  const dc = enableDrawings(chart, { idFactory: seq(), magnet: 'off', platform: 'other', prefersReducedMotion: () => false, motion: 'none' })
  frame(chart)
  const prepend = async (k) => {
    const load = chart._maybeLoadHistory()
    feed.release(feed.pendingCount - 1, wavy(k, T0 - k * MIN))
    await load
  }
  return { chart, dc, prepend }
}

test('a body drag across a history prepend lands where the pointer is, not k bars right', async () => {
  const { chart, dc, prepend } = await prependable()
  const id = line(chart, dc, 40, 100, 60, 102)
  const d0 = dc.get(id)
  const xm = X(chart, 50)
  const ym = Y(chart, 101)
  chart._onMove(moveTo(xm, ym))
  chart._onDown(mouse(xm, ym))
  chart._onMove(mouse(xm + 10, ym))
  await prepend(50)
  assert.equal(chart.bars.length, 150)
  const dx = 4 * chart.ts.spacing
  chart._onMove(mouse(xm + dx, ym))
  // Released before any frame has run since the prepend.
  chart._onUp(mouse(xm + dx, ym))
  const d = dc.get(id)
  assert.equal(d.points[0].time, d0.points[0].time + 4 * MIN)
  assert.equal(d.points[1].time, d0.points[1].time + 4 * MIN)
})

test('an angle drag right after an async prepend reads fresh anchors, not a page behind', async () => {
  const { chart, dc, prepend } = await prependable()
  const id = line(chart, dc, 40, 100, 60, 102)
  dc.select(id)
  frame(chart)
  const x0 = X(chart, 40)
  chart._onMove(moveTo(X(chart, 60), Y(chart, 102)))
  chart._onDown(mouse(X(chart, 60), Y(chart, 102), { shiftKey: true }))
  chart._onMove(mouse(X(chart, 60) - 5, Y(chart, 102) - 5, { shiftKey: true }))
  await prepend(50)
  // Straight up from P0: a vertical constraint copies P0's u exactly.
  chart._onMove(mouse(x0 + 1, Y(chart, 100) - 150, { shiftKey: true }))
  chart._onUp(mouse(x0 + 1, Y(chart, 100) - 150, { shiftKey: true }))
  const d = dc.get(id)
  assert.equal(d.points[1].time, d.points[0].time)
  // A stale origin (a page behind) reads the same drag as LEVEL, which lands on
  // P0's own time too: only a price that followed the pointer proves it was
  // read as vertical.
  assert.ok(d.points[1].price > d.points[0].price + 1, 'vertical: the price followed the pointer up, it did not stay level')
})
