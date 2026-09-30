/**
 * Hit testing: which drawing, which part, in which order (§4.2), and the
 * Liang–Barsky clip every drawn segment goes through.
 *
 * Pure: slots are hand-built with two tiny fake tools, a segment and a box,
 * whose geometry is exactly what their `geom` says.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { distToSegment, clipLine, pickHit } from '../src/drawings/interaction/hit.js'

// ------------------------------------------------------------------ distToSegment

test('distToSegment is the distance to the nearest point of the segment', () => {
  assert.equal(distToSegment(5, 3, 0, 0, 10, 0), 3, 'perpendicular foot inside')
  assert.equal(distToSegment(-3, 4, 0, 0, 10, 0), 5, 'past A: distance to A')
  assert.equal(distToSegment(13, 4, 0, 0, 10, 0), 5, 'past B: distance to B')
  assert.equal(distToSegment(3, 4, 0, 0, 0, 0), 5, 'a zero-length segment is its point')
  assert.ok(Math.abs(distToSegment(0, 10, -1e200, 0, 1e200, 0) - 10) < 1e-6, 'huge coordinates do not overflow')
  assert.ok(Number.isNaN(distToSegment(0, 0, NaN, 0, 1, 1)), 'a broken anchor is never close')
})

// ------------------------------------------------------------------ clipLine

const RECT = { x: 0, y: 0, w: 100, h: 50 }
const clip = (ax, ay, bx, by, s, e, rect = RECT) => {
  const out = { ax: NaN, ay: NaN, bx: NaN, by: NaN }
  return clipLine(ax, ay, bx, by, s, e, rect, out) ? out : null
}

test('clipLine leaves a segment inside the rect untouched', () => {
  assert.deepEqual(clip(10, 10, 60, 40, false, false), { ax: 10, ay: 10, bx: 60, by: 40 })
})

test('clipLine extends per the extend flags and stops at the rect', () => {
  // Horizontal segment 40..60 at y 20.
  assert.deepEqual(clip(40, 20, 60, 20, false, false), { ax: 40, ay: 20, bx: 60, by: 20 }, 'none')
  assert.deepEqual(clip(40, 20, 60, 20, true, false), { ax: 0, ay: 20, bx: 60, by: 20 }, 'left (past A)')
  assert.deepEqual(clip(40, 20, 60, 20, false, true), { ax: 40, ay: 20, bx: 100, by: 20 }, 'right (past B)')
  assert.deepEqual(clip(40, 20, 60, 20, true, true), { ax: 0, ay: 20, bx: 100, by: 20 }, 'both')
  // A diagonal leaves through the top and bottom edges.
  const d = clip(40, 20, 50, 30, true, true)
  assert.deepEqual(d, { ax: 20, ay: 0, bx: 70, by: 50 })
})

test('clipLine bounds a far-off anchor to the rect, for every extend value', () => {
  // An anchor at a price of 1e12 on a 100-point chart projects absurdly far.
  for (const [s, e] of [[false, false], [true, false], [false, true], [true, true]]) {
    const r = clip(50, 25, 50 + 1e12, 25 - 1e12, s, e)
    assert.ok(r, `visible with extend ${s}/${e}`)
    for (const v of [r.ax, r.ay, r.bx, r.by]) assert.ok(v >= -1e-9 && v <= 100 + 1e-9, `bounded: ${v}`)
  }
})

test('clipLine reports a segment that misses the rect as invisible', () => {
  assert.equal(clip(150, 50, 250, -50, false, false), null, 'beside a corner, no extension')
  assert.equal(clip(-10, 60, 110, 60, true, true), null, 'a horizontal line below the rect')
  assert.equal(clip(120, 10, 130, 40, false, false), null, 'entirely to the right')
  assert.equal(clip(40, 20, 60, 20, false, false, { x: 0, y: 30, w: 100, h: 10 }), null)
  assert.equal(clip(Infinity, 0, 1, 1, true, true), null, 'non-finite input')
  assert.equal(clip(-1e308, 0, 1e308, 0, false, false), null, 'a difference that overflows')
})

test('a zero-length segment is a point whatever the extend flags say', () => {
  assert.deepEqual(clip(30, 30, 30, 30, true, true), { ax: 30, ay: 30, bx: 30, by: 30 })
  assert.equal(clip(130, 30, 130, 30, true, true), null)
})

// ------------------------------------------------------------------ pickHit

/** Segment tool: geom { ax, ay, bx, by }; handles at both ends. */
const lineTool = {
  hit(g, x, y, tol) { return distToSegment(x, y, g.ax, g.ay, g.bx, g.by) <= tol ? { part: 'body' } : null },
  handles(g, d, out) {
    out[0] = { x: g.ax, y: g.ay, index: 0, axis: 'xy', cursor: 'grab' }
    out[1] = { x: g.bx, y: g.by, index: 1, axis: 'xy', cursor: 'grab' }
    return 2
  },
}

/** Box tool: stroke on the border, 'fill' inside, and an axis tag in the gutter at y = tag. */
const boxTool = {
  hit(g, x, y, tol) {
    if (g.tag != null && x > 600 && Math.abs(y - g.tag) <= 8) return { part: 'tag' }
    const inX = x >= g.x0 - tol && x <= g.x1 + tol
    const inY = y >= g.y0 - tol && y <= g.y1 + tol
    if (!inX || !inY) return null
    const nearEdge = Math.abs(x - g.x0) <= tol || Math.abs(x - g.x1) <= tol || Math.abs(y - g.y0) <= tol || Math.abs(y - g.y1) <= tol
    return { part: nearEdge ? 'body' : 'fill' }
  },
  handles(g, d, out, touch) {
    out[0] = { x: g.x0, y: g.y0, index: 0, axis: 'xy', cursor: 'nwse-resize' }
    out[1] = { x: g.x1, y: g.y1, index: 1, axis: 'xy', cursor: 'nwse-resize' }
    if (!touch) return 2
    out[2] = { x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2, index: -1, axis: 'xy', cursor: 'move', move: true }
    return 3
  },
}

const pricePane = { id: 'price', rect: { x: 0, y: 0, w: 600, h: 300 }, ps: { primed: true } }
const rsiPane = { id: 'rsi', rect: { x: 0, y: 310, w: 600, h: 100 }, ps: { primed: true } }

function slot(id, tool, geom, o = {}) {
  const d = { id, type: tool === lineTool ? 'trendLine' : 'rectangle', visible: true, locked: false, ...o.d }
  return { id, d, tool, geom, pane: pricePane, drawn: true, broken: null, inert: false, ...o, d }
}
const line = (id, ax, ay, bx, by, o) => slot(id, lineTool, { ax, ay, bx, by, clip: 'pane' }, o)
const box = (id, x0, y0, x1, y1, o) => slot(id, boxTool, { x0, y0, x1, y1, clip: 'pane', tag: o && o.tag }, o)
const pick = (slots, x, y, type = 'mouse', sel = null, clipRect) => pickHit(slots, x, y, type, sel, [], clipRect)

test('a line is hit within the line tolerance', () => {
  const s = [line('L', 100, 100, 300, 100)]
  const h = pick(s, 200, 104)
  assert.equal(h.id, 'L')
  assert.equal(h.part, 'body')
  assert.equal(h.locked, false)
  assert.equal(h.cursor, 'pointer', 'unselected')
  assert.equal(pick(s, 200, 106), null)
})

test('a finger gets the touch tolerance for lines and handles', () => {
  const s = [line('L', 100, 100, 300, 100)]
  assert.equal(pick(s, 200, 112, 'mouse'), null)
  assert.equal(pick(s, 200, 112, 'touch').id, 'L')
  const h = pick(s, 100, 100 - 20, 'touch', 'L')
  assert.equal(h.part, 'handle', 'a 44 pt target around the handle')
  assert.equal(pick(s, 100, 100 - 20, 'mouse', 'L'), null)
})

test('an interior-only hit is reported as fill', () => {
  const s = [box('B', 100, 100, 300, 200)]
  assert.equal(pick(s, 200, 150).part, 'fill')
  assert.equal(pick(s, 100, 150).part, 'body')
})

test('a line under a translucent box is still grabbable', () => {
  // The box is on top (later in z order); the line runs through its interior.
  const s = [line('L', 50, 150, 350, 150), box('B', 100, 100, 300, 200)]
  const h = pick(s, 200, 151)
  assert.equal(h.id, 'L')
  assert.equal(h.part, 'body')
  assert.equal(pick(s, 200, 120).id, 'B', 'away from the line, the fill still hits')
})

test('within a class the top of the z order wins', () => {
  const s = [line('low', 100, 100, 300, 100), line('high', 100, 101, 300, 101)]
  assert.equal(pick(s, 200, 100).id, 'high')
  const f = [box('b1', 100, 100, 300, 200), box('b2', 150, 120, 250, 180)]
  assert.equal(pick(f, 200, 150).id, 'b2')
})

test('the selected drawing’s handle beats any stroke on top of it', () => {
  const s = [line('sel', 100, 100, 300, 100), line('top', 90, 100, 110, 100)]
  const h = pick(s, 101, 101, 'mouse', 'sel')
  assert.equal(h.id, 'sel')
  assert.equal(h.part, 'handle')
  assert.equal(h.index, 0)
  assert.equal(h.hx, 100, 'where the handle is drawn, for the grab offset')
  assert.equal(h.hy, 100)
  assert.equal(h.cursor, 'grab')
  assert.equal(pick(s, 101, 101, 'mouse', null).id, 'top', 'without a selection the top stroke wins')
})

test('handles belong to the selected drawing only', () => {
  const s = [line('L', 100, 100, 300, 100)]
  assert.equal(pick(s, 100, 100, 'mouse', null).part, 'body')
})

test('the selected drawing’s axis tag beats strokes on top of it', () => {
  const s = [box('sel', 100, 100, 300, 200, { tag: 150 }), line('top', 0, 150, 900, 150)]
  // x 620 is in the price-axis gutter, outside every pane rect.
  const h = pick(s, 620, 150, 'mouse', 'sel')
  assert.equal(h.id, 'sel')
  assert.equal(h.part, 'tag')
  assert.equal(h.cursor, 'move')
  assert.equal(pick(s, 620, 150, 'mouse', null).id, 'sel', 'an unselected tag is still a tag hit')
})

test('a touch move handle is reported as part move', () => {
  const s = [box('B', 100, 100, 300, 200)]
  const h = pick(s, 200, 150, 'touch', 'B')
  assert.equal(h.part, 'move')
  assert.equal(h.cursor, 'move')
})

test('hidden, orphaned, inert, broken, unpainted and unprimed drawings are never hit', () => {
  const base = () => line('L', 100, 100, 300, 100)
  const cases = {
    hidden: (s) => { s.d = { ...s.d, visible: false } },
    orphaned: (s) => { s.pane = null },
    inert: (s) => { s.inert = true },
    broken: (s) => { s.broken = s.d },
    unpainted: (s) => { s.drawn = false },
    unprimed: (s) => { s.pane = { ...pricePane, ps: { primed: false } } },
  }
  for (const [name, spoil] of Object.entries(cases)) {
    const s = base()
    spoil(s)
    assert.equal(pick([s], 200, 100), null, name)
    assert.equal(pick([s], 100, 100, 'mouse', 'L'), null, `${name} (selected)`)
  }
  const fixed = base()
  fixed.broken = { ...fixed.d }
  assert.equal(pick([fixed], 200, 100).id, 'L', 'a broken identity that has since been replaced is hittable again')
})

test('a hidden drawing on top does not shadow the one beneath', () => {
  const hidden = line('H', 100, 100, 300, 100, { d: { visible: false } })
  const s = [line('V', 100, 100, 300, 100), hidden]
  assert.equal(pick(s, 200, 100).id, 'V')
})

test('locked drawings are hit, and say so', () => {
  const s = [line('L', 100, 100, 300, 100, { d: { locked: true } }), box('B', 400, 100, 500, 200, { d: { locked: true } })]
  const h = pick(s, 200, 100)
  assert.equal(h.locked, true)
  assert.equal(h.cursor, 'pointer', 'a click selects it')
  const f = pick(s, 450, 150)
  assert.equal(f.part, 'fill')
  assert.equal(f.cursor, null, 'a locked fill shows the chart’s own cursor')
})

test('a hit outside the slot’s clip rect does not count', () => {
  // The line runs on into the RSI pane's band, but it is clipped to its pane.
  const s = [line('L', 100, 100, 100, 1000)]
  assert.equal(pick(s, 100, 350), null)
  assert.equal(pick(s, 100, 200).id, 'L')
})

test("a full-height vertical line (clip 'plot') is hittable in the sub-pane", () => {
  const v = line('V', 100, 0, 100, 410)
  v.geom.clip = 'plot'
  const plot = { x: 0, y: 0, w: 600, h: 410 }
  const clipRect = (s) => (s.geom.clip === 'plot' ? plot : s.pane.rect)
  assert.equal(pick([v], 100, 350, 'mouse', null, clipRect).id, 'V')
  assert.equal(pick([v], 100, 350, 'mouse', null), null, 'the pane rect alone excludes it')
})

test('a drawing on another pane is hit in its own pane', () => {
  const r = line('R', 100, 350, 300, 350, { pane: rsiPane })
  assert.equal(pick([r], 200, 350).id, 'R')
})

test('a tool whose hit throws is a miss, and the others still hit', () => {
  const bad = { ...lineTool, hit() { throw new Error('custom tool bug') } }
  const s = [line('ok', 100, 100, 300, 100), slot('bad', bad, { ax: 100, ay: 100, bx: 300, by: 100 })]
  assert.equal(pick(s, 200, 100).id, 'ok')
})

test('a non-finite pointer hits nothing', () => {
  assert.equal(pick([line('L', 100, 100, 300, 100)], NaN, 100), null)
})
