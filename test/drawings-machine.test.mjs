/**
 * The interaction state machine (§5.2), row by row, as a pure reducer.
 *
 * No chart, no canvas, no timers: `env` is a fake whose hit test and snap
 * are a few lines each, so every assertion is about the machine's decision
 * alone. The snap stand-in puts bar u at x = 10·u and price p at
 * y = 400 − 2p, honours Alt (free) and Shift+origin (level with the origin),
 * and records every call so the per-gesture options can be checked.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reduce, initialState, ownsPress } from '../src/drawings/interaction/machine.js'
import { keyIntent, keyEvent } from '../src/drawings/interaction/keys.js'

const MIN = 60_000
const PANE = { id: 'price', rect: { x: 0, y: 0, w: 600, h: 400 }, ps: { primed: true } }
const RSI = { id: 'rsi', rect: { x: 0, y: 410, w: 600, h: 90 }, ps: { primed: false } }

const TOOLS = new Map([
  ['trendLine', { type: 'trendLine', anchors: 2, creation: 'points', angleOrigin: (d, h) => (h === 1 ? 0 : h === 0 ? 1 : -1) }],
  ['horizontalLine', { type: 'horizontalLine', anchors: 1, creation: 'single' }],
  ['parallelChannel', { type: 'parallelChannel', anchors: 3, creation: 'points' }],
  ['position', { type: 'position', anchors: 3, creation: 'single', dragCreate: true }],
  ['text', { type: 'text', anchors: 1, creation: 'single' }],
  ['measure', { type: 'measure', anchors: 2, creation: 'points' }],
  ['rectangle', { type: 'rectangle', anchors: 2, creation: 'points' }],
])

const spec = (type, o = {}) => ({ type, preset: type, sticky: false, ...o })

function fakeSnap(p, opts) {
  if (!opts.paneId) return null
  const u = p.alt ? p.x / 10 : Math.round(p.x / 10)
  let price = (400 - p.y) / 2
  let kind = p.alt ? 'free' : 'slot'
  if (!p.alt && p.shift && opts.allowAngle && opts.origin) { price = opts.origin.price; kind = 'angle' }
  const point = { time: 1000 * MIN + u * MIN, price }
  return {
    u, point, x: u * 10, y: 400 - price * 2, kind, tag: null, targetId: null, guide: null,
    state: { kind, targetId: null, tag: null, x: u * 10, y: 400 - price * 2 },
  }
}

/**
 * A fake env. `drawings` maps id -> Drawing; `hits` is a list of
 * { id, part, box: [x0, y0, x1, y1], locked, cursor, hx, hy } tested in order.
 */
function makeEnv(o = {}) {
  const drawings = new Map(Object.entries(o.drawings || {}))
  const env = {
    tools: TOOLS,
    selection: [],
    readOnly: false,
    quickMeasure: true,
    sticky: false,
    textEditor: true,
    invertKey: 'ctrlKey',
    hits: [],
    snapCalls: [],
    hitAt(x, y) {
      for (const h of env.hits) {
        const [x0, y0, x1, y1] = h.box
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
          return { id: h.id, part: h.part || 'body', index: h.index == null ? -1 : h.index, locked: !!h.locked, cursor: h.cursor || null, hx: h.hx, hy: h.hy }
        }
      }
      return null
    },
    paneReady: (p) => !!p && p.ps.primed !== false,
    snap(p, opts) { env.snapCalls.push({ p, opts }); return env.bars === 0 ? null : fakeSnap(p, opts) },
    anchorsOf: (id) => (env.anchors && env.anchors[id]) || [],
    drawing: (id) => drawings.get(id) || null,
    paneAt: (y) => (y >= 0 && y <= 400 ? PANE : y >= 410 && y <= 500 ? RSI : null),
    ...o,
  }
  env.drawings = drawings
  return env
}

const TL = { id: 'tl', type: 'trendLine', pane: 'price', locked: false, points: [{ time: 1, price: 150 }, { time: 2, price: 160 }] }
const BOX = { id: 'box', type: 'rectangle', pane: 'price', locked: false, points: [] }
const TXT = { id: 'txt', type: 'text', pane: 'price', locked: false, points: [] }
const LOCKED = { id: 'lk', type: 'fibRetracement', pane: 'price', locked: true, points: [] }

let seqT = 0
const P = (x, y, o = {}) => ({
  x, y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
  shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
  region: 'plot', pane: PANE, timeStamp: 0, event: null, ...o,
})
const T = (x, y, o = {}) => P(x, y, { pointerType: 'touch', ...o })

const types = (r) => r.effects.map((e) => e.type)
const find = (r, type) => r.effects.find((e) => e.type === type)
const all = (r, type) => r.effects.filter((e) => e.type === type)

/** Feed events in order; returns every result, the last one as `.last`. */
function run(env, s, events) {
  const out = []
  for (const ev of events) {
    const r = reduce(s, ev, env)
    out.push(r)
    s = r.state
  }
  out.last = out[out.length - 1]
  return out
}

const down = (e) => ({ type: 'down', e })
const move = (e) => ({ type: 'move', e })
const up = (e) => ({ type: 'up', e })
const tap = (e) => ({ type: 'tap', e })
const hover = (e, reason) => ({ type: 'hover', e, reason })
const k = (intent, o = {}) => ({ type: 'key', intent, ...o })

function armedWith(env, type, o = {}) {
  return reduce(initialState(), { type: 'setTool', tool: spec(type, o) }, env).state
}

// ------------------------------------------------------------------ IDLE hover

test('row 1: hovering a drawing highlights it and asks for a cursor by part', () => {
  const env = makeEnv({ drawings: { tl: TL } })
  env.hits = [{ id: 'tl', part: 'body', box: [0, 0, 100, 100] }]
  const r = reduce(initialState(), hover(P(50, 50)), env)
  assert.deepEqual(find(r, 'hover'), { type: 'hover', id: 'tl', part: 'body' })
  assert.equal(find(r, 'cursor').css, 'pointer', 'an unselected body')
  assert.deepEqual(find(r, 'crosshair'), { type: 'crosshair', s: null }, 'the core keeps its own crosshair')
  assert.equal(r.result, false)
  env.selection = ['tl']
  assert.equal(find(reduce(initialState(), hover(P(50, 50)), env), 'cursor').css, 'move')
  assert.equal(find(reduce(initialState(), hover(P(50, 50, { altKey: true })), env), 'cursor').css, 'copy', 'Alt: a clone')
  env.hits = [{ id: 'tl', part: 'handle', box: [0, 0, 100, 100], cursor: 'grab' }]
  assert.equal(find(reduce(initialState(), hover(P(50, 50)), env), 'cursor').css, 'grab')
})

test('row 1: a locked fill asks for no cursor; a locked stroke for pointer', () => {
  const env = makeEnv({ drawings: { lk: LOCKED } })
  env.hits = [{ id: 'lk', part: 'fill', locked: true, box: [0, 0, 100, 100] }]
  assert.equal(find(reduce(initialState(), hover(P(50, 50)), env), 'cursor').css, null)
  env.hits = [{ id: 'lk', part: 'body', locked: true, box: [0, 0, 100, 100] }]
  assert.equal(find(reduce(initialState(), hover(P(50, 50)), env), 'cursor').css, 'pointer')
})

test('row 1a: a hover with no pointer clears the highlight', () => {
  const r = reduce(initialState(), hover(null, 'leave'), makeEnv())
  assert.deepEqual(find(r, 'hover'), { type: 'hover', id: null, part: null })
})

// ------------------------------------------------------------------ IDLE presses

test('row 2: a mouse press on a drawing selects it on down and claims', () => {
  const env = makeEnv({ drawings: { tl: TL } })
  env.hits = [{ id: 'tl', box: [0, 0, 100, 100] }]
  const r = reduce(initialState(), down(P(50, 50)), env)
  assert.equal(r.result, true)
  assert.equal(r.state.name, 'PRESSED')
  assert.deepEqual(find(r, 'select'), { type: 'select', ids: ['tl'] })
  assert.ok(find(r, 'claim'))
  assert.equal(ownsPress(r.state), true)
})

test('row 3: a mouse press on a locked drawing is not claimed and leaves the selection', () => {
  const env = makeEnv({ drawings: { lk: LOCKED } })
  env.hits = [{ id: 'lk', box: [0, 0, 100, 100], locked: true }]
  const r = reduce(initialState(), down(P(50, 50)), env)
  assert.equal(r.result, false)
  assert.equal(r.state.name, 'IDLE')
  assert.deepEqual(r.effects, [])
})

test('row 3: a press on a locked handle shakes, and still pans', () => {
  const env = makeEnv({ drawings: { lk: LOCKED } })
  env.selection = ['lk']
  env.hits = [{ id: 'lk', part: 'handle', index: 0, box: [0, 0, 100, 100], locked: true }]
  const r = reduce(initialState(), down(P(50, 50)), env)
  assert.equal(r.result, false)
  assert.deepEqual(r.effects, [{ type: 'shake', id: 'lk' }])
})

test('row 8: a mouse click on a locked drawing selects it, unconsumed', () => {
  const env = makeEnv({ drawings: { lk: LOCKED } })
  env.hits = [{ id: 'lk', box: [0, 0, 100, 100], locked: true }]
  const r = reduce(initialState(), tap(P(50, 50)), env)
  assert.deepEqual(r.effects, [{ type: 'select', ids: ['lk'] }])
  assert.equal(r.result, false, 'markerClick still fires under it')
})

test('row 4: a finger on the selected drawing claims it, with the grab offset', () => {
  const env = makeEnv({ drawings: { tl: TL } })
  env.selection = ['tl']
  env.hits = [{ id: 'tl', part: 'handle', index: 1, box: [0, 0, 100, 100], hx: 60, hy: 40, cursor: 'grab' }]
  const r = reduce(initialState(), down(T(50, 50)), env)
  assert.equal(r.result, true)
  assert.equal(r.state.name, 'PRESSED')
  assert.deepEqual(r.state.grab, { dx: 10, dy: -10 })
  assert.equal(find(r, 'select'), undefined, 'already selected')
})

test('row 4a: a finger on a selected box’s fill is not claimed, so it pans', () => {
  const env = makeEnv({ drawings: { box: BOX } })
  env.selection = ['box']
  env.hits = [{ id: 'box', part: 'fill', box: [0, 0, 100, 100] }]
  const r = reduce(initialState(), down(T(50, 50)), env)
  assert.equal(r.result, false)
  assert.equal(r.state.name, 'IDLE')
})

test('row 5: a finger on an unselected drawing is not claimed and changes nothing', () => {
  const env = makeEnv({ drawings: { tl: TL } })
  env.hits = [{ id: 'tl', box: [0, 0, 100, 100] }]
  const r = reduce(initialState(), down(T(50, 50)), env)
  assert.equal(r.result, false)
  assert.deepEqual(r.effects, [])
})

test('an unselected line’s axis tag does not claim a press; a click selects the line', () => {
  const env = makeEnv({ drawings: { tl: TL } })
  env.hits = [{ id: 'tl', part: 'tag', box: [600, 0, 700, 100] }]
  assert.equal(reduce(initialState(), down(P(650, 50, { region: 'priceAxis' })), env).result, false)
  assert.deepEqual(reduce(initialState(), tap(T(650, 50, { region: 'priceAxis' })), env).effects, [{ type: 'select', ids: ['tl'] }])
  env.selection = ['tl']
  assert.equal(reduce(initialState(), down(P(650, 50, { region: 'priceAxis' })), env).result, true, 'selected: drag it by its label')
})

test('row 7: a plain press on empty plot is the core’s', () => {
  const r = reduce(initialState(), down(P(50, 50)), makeEnv())
  assert.equal(r.result, false)
  assert.deepEqual(r.effects, [])
  assert.equal(reduce(initialState(), down(P(50, 50, { button: 2 })), makeEnv()).result, false, 'right button')
})

test('read-only: presses are the core’s, taps still select', () => {
  const env = makeEnv({ drawings: { tl: TL }, readOnly: true })
  env.hits = [{ id: 'tl', box: [0, 0, 100, 100] }]
  assert.equal(reduce(initialState(), down(P(50, 50)), env).result, false)
  assert.deepEqual(reduce(initialState(), tap(P(50, 50)), env).effects, [{ type: 'select', ids: ['tl'] }])
  assert.equal(reduce(initialState(), { type: 'setTool', tool: spec('trendLine') }, env).state.name, 'IDLE')
})

// ------------------------------------------------------------------ taps

test('row 8: a finger tap selects and is consumed (no crosshair)', () => {
  const env = makeEnv({ drawings: { tl: TL } })
  env.hits = [{ id: 'tl', box: [0, 0, 100, 100] }]
  const r = reduce(initialState(), tap(T(50, 50)), env)
  assert.deepEqual(r.effects, [{ type: 'select', ids: ['tl'] }])
  assert.equal(r.result, true)
})

test('rows 9 and 10: a tap on nothing deselects; consumed on touch only', () => {
  const env = makeEnv()
  env.selection = ['tl']
  const t = reduce(initialState(), tap(T(300, 300)), env)
  assert.deepEqual(t.effects, [{ type: 'select', ids: [] }])
  assert.equal(t.result, true)
  const m = reduce(initialState(), tap(P(300, 300)), env)
  assert.deepEqual(m.effects, [{ type: 'select', ids: [] }])
  assert.equal(m.result, false, 'markerClick still fires on mouse')
  env.selection = []
  assert.equal(reduce(initialState(), tap(T(300, 300)), env).result, false, 'no selection: the core’s tap crosshair')
})

// ------------------------------------------------------------------ double-click

test('row 11: a double-click on a text opens its editor', () => {
  const env = makeEnv({ drawings: { txt: TXT } })
  env.hits = [{ id: 'txt', box: [0, 0, 100, 100] }]
  const r = reduce(initialState(), { type: 'dblclick', e: P(50, 50) }, env)
  assert.equal(r.state.name, 'EDITING')
  assert.deepEqual(find(r, 'openEditor'), { type: 'openEditor', id: 'txt' })
  assert.equal(r.result, true)
})

test('row 12: a double-click on another drawing asks the host to edit it', () => {
  const env = makeEnv({ drawings: { tl: TL } })
  env.hits = [{ id: 'tl', box: [0, 0, 100, 100] }]
  const r = reduce(initialState(), { type: 'dblclick', e: P(50, 50) }, env)
  assert.deepEqual(r.effects, [{ type: 'emitEdit', id: 'tl' }])
  assert.equal(r.result, true)
  assert.equal(reduce(initialState(), { type: 'dblclick', e: P(300, 300) }, env).result, false, 'on nothing: the view resets')
})

test('a double-click while a tool is armed never resets the view', () => {
  const env = makeEnv()
  assert.equal(reduce(armedWith(env, 'trendLine'), { type: 'dblclick', e: P(50, 50) }, env).result, true)
})

// ------------------------------------------------------------------ arming

test('row 13: setTool arms, clears the hover and focuses the container', () => {
  const env = makeEnv()
  const r = reduce(initialState(), { type: 'setTool', tool: spec('trendLine') }, env)
  assert.equal(r.state.name, 'ARMED')
  assert.deepEqual(types(r), ['tool', 'hover', 'cursor', 'focus'])
  assert.equal(find(r, 'tool').tool.type, 'trendLine')
  assert.equal(reduce(initialState(), { type: 'setTool', tool: spec('nope') }, env).state.name, 'IDLE', 'an unknown tool is refused')
})

test('row 14: armed hover shows the reticle at the snapped point with an exact crosshair', () => {
  const env = makeEnv()
  const r = reduce(armedWith(env, 'trendLine'), hover(P(53, 100)), env)
  const pv = find(r, 'preview')
  assert.equal(pv.s.u, 5)
  assert.deepEqual(pv.points, [])
  assert.equal(pv.ephemeral, false)
  assert.equal(find(r, 'crosshair').s, pv.s)
  assert.equal(find(r, 'crosshair').tags, undefined, 'the reticle keeps the core’s axis tags')
  assert.equal(find(r, 'cursor').css, 'crosshair')
  assert.ok(r.state.ptr)
})

test('row 14a: leaving hides the reticle, keeps placed anchors and forgets the pointer', () => {
  const env = makeEnv()
  const placing = run(env, armedWith(env, 'parallelChannel'), [down(P(50, 100)), up(P(50, 100)), hover(P(80, 90))]).last.state
  assert.equal(placing.name, 'PLACING')
  const r = reduce(placing, hover(null, 'leave'), env)
  assert.equal(find(r, 'preview').hidden, true)
  assert.equal(r.state.points.length, 1)
  assert.equal(r.state.ptr, null)
  assert.deepEqual(types(reduce(r.state, { type: 'rederive' }, env)), [], 'nothing re-derives from a pointer that left')
})

test('row 15b: an armed press on an unprimed pane (or with zero bars) is not claimed', () => {
  const env = makeEnv()
  const a = armedWith(env, 'trendLine')
  assert.equal(reduce(a, down(P(50, 450, { pane: RSI })), env).result, false)
  env.bars = 0
  assert.equal(reduce(a, down(P(50, 100)), env).result, false)
})

test('row 16: Esc while armed disarms', () => {
  const env = makeEnv()
  const r = reduce(armedWith(env, 'trendLine'), k('escape'), env)
  assert.equal(r.state.name, 'IDLE')
  assert.deepEqual(find(r, 'tool'), { type: 'tool', tool: null })
  const n = reduce(armedWith(env, 'trendLine'), { type: 'setTool', tool: null }, env)
  assert.equal(n.state.name, 'IDLE')
  assert.deepEqual(find(n, 'tool'), { type: 'tool', tool: null })
})

// ------------------------------------------------------------------ creation

test('drag creation: press places P0, a drag past the slop pulls P1, the up creates', () => {
  const env = makeEnv()
  const [d, m0, m1, u] = run(env, armedWith(env, 'trendLine'), [down(P(50, 100)), move(P(51, 101)), move(P(120, 60)), up(P(120, 60))])
  assert.equal(d.result, true)
  assert.equal(d.state.name, 'PRESS_CREATE')
  assert.deepEqual(d.state.points, [{ time: 1005 * MIN, price: 150 }])
  assert.deepEqual(m0.effects, [], 'below the slop nothing moves')
  assert.equal(m1.state.name, 'CREATE_DRAG')
  const pv = find(m1, 'preview')
  assert.deepEqual(pv.points.map((p) => p.time), [1005 * MIN, 1012 * MIN])
  assert.equal(find(m1, 'crosshair').tags, false, 'the plugin draws the dragged point’s own tags')
  const c = find(u, 'create')
  assert.deepEqual(c.points, [{ time: 1005 * MIN, price: 150 }, { time: 1012 * MIN, price: 170 }])
  assert.equal(c.spec.type, 'trendLine')
  assert.equal(u.state.name, 'IDLE', 'not sticky: back to IDLE')
  assert.deepEqual(find(u, 'tool'), { type: 'tool', tool: null })
  assert.deepEqual(find(u, 'crosshairRaw'), { type: 'crosshairRaw', x: 120, y: 60 })
  assert.equal(ownsPress(u.state), false)
})

test('click-click creation makes the same drawing as a drag', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'trendLine'), [
    down(P(50, 100)), up(P(50, 100)), hover(P(90, 80)), hover(P(120, 60)), down(P(120, 60)), up(P(120, 60)),
  ])
  assert.equal(rs[1].state.name, 'PLACING', 'row 19: a click places P0 and waits')
  assert.deepEqual(find(rs[3], 'preview').points.map((p) => p.time), [1005 * MIN, 1012 * MIN], 'row 22: P1 follows the mouse')
  assert.equal(rs[4].state.name, 'PRESS_CREATE', 'row 23')
  assert.deepEqual(find(rs.last, 'create').points, [{ time: 1005 * MIN, price: 150 }, { time: 1012 * MIN, price: 170 }])
})

test('while placing, the crosshair leaves the followed point\'s axis tags to the draft that draws them (D10)', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'trendLine'), [down(P(50, 100)), up(P(50, 100)), hover(P(90, 80)), down(P(120, 60))])
  // The reticle before anything is placed has no draft, so the core keeps its tags.
  assert.equal(find(reduce(armedWith(env, 'trendLine'), hover(P(90, 80)), env), 'crosshair').tags, undefined)
  assert.equal(find(rs[0], 'crosshair').tags, false, 'row 15: the press draws the first anchor\'s tags')
  assert.equal(find(rs[2], 'crosshair').tags, false, 'row 22: the point that follows the pointer')
  assert.equal(find(rs[3], 'crosshair').tags, false, 'row 23: the second click')
  const ch = run(env, armedWith(env, 'parallelChannel'), [down(P(50, 100)), move(P(150, 100)), up(P(150, 100))])
  assert.equal(ch[2].state.name, 'PLACING')
  assert.equal(find(ch[2], 'crosshair').tags, false, 'row 21: the channel\'s baseline end, awaiting its width')
})

test('row 23: a second click on the same slot as the first places nothing', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'trendLine'), [down(P(50, 100)), up(P(50, 100)), down(P(51, 101)), up(P(51, 101))])
  assert.equal(rs[2].result, true, 'claimed, so the core does not pan')
  assert.equal(rs[2].state.name, 'PLACING')
  assert.equal(all(rs[3], 'create').length, 0)
  assert.equal(rs[3].state.name, 'PLACING')
  assert.equal(rs[3].state.points.length, 1)
})

test('a second click can be dragged to adjust the point it placed', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'trendLine'), [down(P(50, 100)), up(P(50, 100)), down(P(120, 60)), move(P(150, 40)), up(P(150, 40))])
  assert.deepEqual(find(rs.last, 'create').points.map((p) => p.time), [1005 * MIN, 1015 * MIN])
})

test('Shift constrains the second anchor from the first (the origin reaches the snap)', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'trendLine'), [down(P(50, 100)), move(P(120, 60, { shiftKey: true }))])
  const call = env.snapCalls[env.snapCalls.length - 1]
  assert.equal(call.opts.allowAngle, true)
  assert.equal(call.opts.origin.price, 150)
  assert.equal(call.opts.placing, 1)
  assert.equal(find(rs.last, 'preview').s.kind, 'angle')
})

test('rows 20, 21, 22: a channel drags its baseline, then places its width with a click', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'parallelChannel'), [
    down(P(50, 100)), move(P(150, 100)), up(P(150, 100)), hover(P(120, 40)), down(P(120, 40)), up(P(120, 40)),
  ])
  assert.equal(rs[2].state.name, 'PLACING')
  assert.equal(rs[2].state.points.length, 2)
  const call = env.snapCalls.find((c) => c.opts.placing === 2)
  assert.ok(call, 'the width point is snapped as point 2, so the controller can offer the fit')
  assert.equal(call.opts.allowAngle, false, 'the width point has no angle')
  assert.equal(find(rs.last, 'create').points.length, 3)
})

test('row 17a/20: a position press-drag hands the drag Snapped to complete()', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'position'), [down(P(50, 200)), move(P(150, 120)), up(P(150, 120))])
  const pv = find(rs[1], 'preview')
  assert.deepEqual(pv.points.length, 1, 'entry only; the rest comes from complete()')
  assert.equal(pv.drag.u, 15)
  const c = find(rs.last, 'create')
  assert.equal(c.points.length, 1)
  assert.equal(c.drag.u, 15)
  assert.equal(c.drag.point.price, 140)
})

test('row 18: a single click places a single-click tool; the click alone has no drag', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'horizontalLine'), [down(P(50, 100)), up(P(50, 100))])
  const c = find(rs.last, 'create')
  assert.deepEqual(c.points, [{ time: 1005 * MIN, price: 150 }])
  assert.equal(c.drag, null)
  const pos = run(env, armedWith(env, 'position'), [down(P(50, 100)), up(P(50, 100))])
  assert.equal(find(pos.last, 'create').drag, null, 'position by click: complete(points, ctx, null)')
})

test('sticky tools re-arm after a create; non-sticky ones disarm', () => {
  const env = makeEnv()
  const s = run(env, armedWith(env, 'horizontalLine', { sticky: true }), [down(P(50, 100)), up(P(50, 100))])
  assert.equal(s.last.state.name, 'ARMED')
  assert.equal(all(s.last, 'tool').length, 0)
  env.sticky = true
  const d = run(env, reduce(initialState(), { type: 'setTool', tool: { type: 'horizontalLine', preset: 'h' } }, env).state, [down(P(50, 100)), up(P(50, 100))])
  assert.equal(d.last.state.name, 'ARMED', 'the options default applies when the spec does not say')
})

test('a sticky re-arm under a still mouse shows the reticle on the next frame', () => {
  const env = makeEnv()
  const s = run(env, armedWith(env, 'horizontalLine', { sticky: true }), [down(P(50, 100)), up(P(50, 100))]).last.state
  const r = reduce(s, { type: 'rederive' }, env)
  assert.equal(find(r, 'preview').s.u, 5)
})

test('an armed reticle is hidden over an axis; a press on an axis while placing is the axis’s', () => {
  const env = makeEnv()
  const r = reduce(armedWith(env, 'trendLine'), hover(P(650, 100, { region: 'priceAxis' })), env)
  assert.equal(find(r, 'preview').hidden, true)
  const placing = run(env, armedWith(env, 'trendLine'), [down(P(50, 100)), up(P(50, 100))]).last.state
  assert.equal(reduce(placing, down(P(650, 100, { region: 'priceAxis' })), env).result, false)
  assert.equal(reduce(armedWith(env, 'trendLine'), down(P(650, 100, { region: 'priceAxis' })), env).result, false)
})

test('row 15a: a sticky horizontal-line double-click (downs 200 ms apart, same slot) creates one drawing', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'horizontalLine', { sticky: true }), [
    down(P(50, 100, { timeStamp: 1000 })), up(P(50, 100, { timeStamp: 1080 })),
    down(P(51, 100, { timeStamp: 1200 })), up(P(51, 100, { timeStamp: 1260 })),
  ])
  assert.equal(rs.reduce((n, r) => n + all(r, 'create').length, 0), 1)
  assert.equal(rs[2].result, true, 'the swallowed press is still claimed')
  assert.equal(rs.last.state.name, 'ARMED')
})

test('row 15a: a later, distant or timestamp-less second press still creates', () => {
  const count = (events) => {
    const env = makeEnv()
    return run(env, armedWith(env, 'horizontalLine', { sticky: true }), events).reduce((n, r) => n + all(r, 'create').length, 0)
  }
  assert.equal(count([down(P(50, 100, { timeStamp: 1000 })), up(P(50, 100, { timeStamp: 1080 })), down(P(50, 100, { timeStamp: 1700 })), up(P(50, 100))]), 2, '620 ms later')
  assert.equal(count([down(P(50, 100, { timeStamp: 1000 })), up(P(50, 100, { timeStamp: 1080 })), down(P(80, 100, { timeStamp: 1200 })), up(P(80, 100))]), 2, 'another bar')
  assert.equal(count([down(P(50, 100)), up(P(50, 100)), down(P(50, 100)), up(P(50, 100))]), 2, 'no timeStamp never matches')
})

test('row 18t: a text click opens the editor on a draft and creates nothing', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'text'), [down(P(50, 100)), up(P(50, 100))])
  assert.equal(rs.last.state.name, 'EDITING_NEW')
  assert.equal(all(rs.last, 'create').length, 0)
  const open = find(rs.last, 'openEditor')
  assert.equal(open.id, null)
  assert.deepEqual(open.draft.points, [{ time: 1005 * MIN, price: 150 }])
  assert.equal(find(rs.last, 'preview').editing, true)
})

test('row 38: an empty text draft commit yields no create; the controller decides from the text', () => {
  const env = makeEnv()
  const editing = run(env, armedWith(env, 'text'), [down(P(50, 100)), up(P(50, 100))]).last.state
  const r = reduce(editing, k('commit'), env)
  assert.deepEqual(types(r), ['commitEditor'])
  assert.equal(find(r, 'commitEditor').draft.points.length, 1)
  assert.equal(r.state.name, 'IDLE')
  assert.deepEqual(reduce(r.state, k('commit'), env).effects, [], 'a second commit (blur after Enter) is a no-op')
})

test('row 18t: with textEditor:false a text is created with its default and the host edits it', () => {
  const env = makeEnv({ textEditor: false })
  const rs = run(env, armedWith(env, 'text'), [down(P(50, 100)), up(P(50, 100))])
  const c = find(rs.last, 'create')
  assert.equal(c.edit, true)
  assert.equal(rs.last.state.name, 'IDLE')
})

// ------------------------------------------------------------------ touch creation

test('row 15t: a finger press while armed places nothing until a slop move or the up', () => {
  const env = makeEnv()
  const a = armedWith(env, 'trendLine')
  const d = reduce(a, down(T(50, 100)), env)
  assert.equal(d.result, true)
  assert.deepEqual(types(d), ['claim'], 'no preview, no ripple')
  assert.equal(d.state.points.length, 0)
  const small = reduce(d.state, move(T(55, 100)), env)
  assert.deepEqual(small.effects, [], 'inside the 10 px touch slop')
  const m = reduce(d.state, move(T(90, 80)), env)
  assert.equal(m.state.name, 'CREATE_DRAG')
  assert.deepEqual(find(m, 'ripple'), { type: 'ripple', u: 5, price: 150, paneId: 'price' }, 'P0 at the DOWN point, rippled')
  assert.deepEqual(m.state.points, [{ time: 1005 * MIN, price: 150 }])
})

test('row 27: a pinch that starts while armed leaves no ripple, residual or ghost', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'trendLine'), [down(T(50, 100)), { type: 'cancel' }])
  const effects = rs.flatMap((r) => r.effects)
  assert.equal(effects.filter((e) => e.type === 'ripple').length, 0)
  assert.equal(effects.filter((e) => e.type === 'preview').length, 0)
  assert.ok(effects.every((e) => e.type !== 'abortCreate' || e.ghost === false), 'no ghost')
  assert.equal(rs.last.state.name, 'ARMED')
})

test('tap-tap creation on touch: each tap places on its up, a pinch between them keeps P0', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'trendLine'), [
    down(T(50, 100)), up(T(50, 100)),
    down(T(200, 100)), { type: 'cancel' }, // the first finger of a pinch
    down(T(120, 60)), up(T(120, 60)),
  ])
  assert.equal(rs[1].state.name, 'PLACING')
  assert.ok(find(rs[1], 'ripple'), 'the first anchor ripples on the tap')
  assert.equal(rs[3].state.name, 'PLACING', 'row 24/27: the pinch reverts only its own press')
  assert.equal(rs[3].state.points.length, 1)
  assert.equal(all(rs[3], 'abortCreate').length, 0)
  assert.deepEqual(find(rs.last, 'create').points.map((p) => p.time), [1005 * MIN, 1012 * MIN])
})

test('a finger drags a channel’s width relative to its preview', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'parallelChannel'), [
    down(T(50, 100)), move(T(150, 100)), up(T(150, 100)),
    down(T(300, 300)), move(T(300, 260)), up(T(300, 260)),
  ])
  const c = find(rs.last, 'create')
  // The width point starts on P1 (150, 100) and moves by the finger's delta.
  assert.deepEqual(c.points[2], { time: 1015 * MIN, price: 170 })
})

// ------------------------------------------------------------------ creation aborts

test('row 25: Esc while placing goes back to armed, ghosts what was shown and releases', () => {
  const env = makeEnv()
  const placing = run(env, armedWith(env, 'parallelChannel'), [down(P(50, 100)), up(P(50, 100))]).last.state
  const r = reduce(placing, k('escape'), env)
  assert.equal(r.state.name, 'ARMED')
  assert.deepEqual(r.effects, [{ type: 'abortCreate', ghost: true }, { type: 'release' }])
})

test('row 26: Backspace while placing takes back the last anchor', () => {
  const env = makeEnv()
  const placing = run(env, armedWith(env, 'parallelChannel'), [down(P(50, 100)), move(P(150, 100)), up(P(150, 100))]).last.state
  assert.equal(placing.points.length, 2)
  const r = reduce(placing, k('unplace'), env)
  assert.equal(r.state.name, 'PLACING')
  assert.equal(r.state.points.length, 1)
  assert.equal(r.result, true)
  const again = reduce(r.state, k('unplace'), env)
  assert.equal(again.state.name, 'ARMED')
})

test('row 27: a cancelled mouse press while armed reverts to armed', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'trendLine'), [down(P(50, 100)), move(P(120, 60)), { type: 'cancel' }])
  assert.equal(rs.last.state.name, 'ARMED')
  assert.deepEqual(rs.last.effects, [{ type: 'abortCreate', ghost: true }])
})

test('undo while creating only cancels the creation', () => {
  const env = makeEnv()
  const rs = run(env, armedWith(env, 'trendLine'), [down(P(50, 100)), move(P(120, 60)), k('undo')])
  assert.equal(rs.last.state.name, 'ARMED')
  assert.equal(all(rs.last, 'undo').length, 0)
})

// ------------------------------------------------------------------ drags

function pressed(env, e = P(50, 50), hit = { id: 'tl', part: 'handle', index: 1, box: [0, 0, 100, 100], hx: 55, hy: 48, cursor: 'grab' }) {
  env.drawings.set('tl', TL)
  env.hits = [hit]
  env.selection = ['tl']
  return reduce(initialState(), down(e), env).state
}

test('row 28: a handle drag begins past the slop, with a grabbing cursor', () => {
  const env = makeEnv()
  const s = pressed(env)
  assert.deepEqual(reduce(s, move(P(52, 51)), env).effects, [], 'inside the slop nothing happens')
  const r = reduce(s, move(P(80, 30)), env)
  assert.equal(r.state.name, 'DRAG_HANDLE')
  const b = find(r, 'beginDrag')
  assert.equal(b.id, 'tl')
  assert.equal(b.part, 'handle')
  assert.equal(b.index, 1)
  assert.equal(b.clone, false)
  assert.equal(b.d0, TL)
  assert.deepEqual(b.down, { x: 50, y: 50 })
  assert.deepEqual(find(r, 'setCursor'), { type: 'setCursor', css: 'grabbing' })
  assert.ok(find(r, 'dragTo'))
  assert.equal(find(r, 'crosshair').tags, false)
})

test('the handle snaps at pointer + grab, so it never jumps under the finger', () => {
  const env = makeEnv()
  const s = pressed(env)
  reduce(s, move(P(80, 30)), env)
  const call = env.snapCalls[env.snapCalls.length - 1]
  assert.equal(call.p.x, 85)
  assert.equal(call.p.y, 28)
  assert.equal(call.opts.excludeId, 'tl', 'a drawing never snaps to itself')
  assert.equal(call.opts.handle, 1)
})

test('a handle drag passes its tool’s angle origin for Shift', () => {
  const env = makeEnv()
  env.anchors = { tl: [{ x: 10, y: 10, u: 1, time: 1, price: 195 }, { x: 55, y: 48, u: 5, time: 2, price: 176 }] }
  const s = pressed(env)
  const r = reduce(s, move(P(80, 30, { shiftKey: true })), env)
  const call = env.snapCalls[env.snapCalls.length - 1]
  assert.equal(call.opts.origin.price, 195, 'handle 1 angles from anchor 0')
  assert.equal(find(r, 'dragTo').s.kind, 'angle')
})

test('touch: the first drag step is flagged for the slop catch-up glide', () => {
  const env = makeEnv()
  const s = pressed(env, T(50, 50))
  const r = reduce(s, move(T(80, 30)), env)
  assert.equal(find(r, 'dragTo').catchUp, true)
  assert.equal(find(reduce(r.state, move(T(90, 30)), env), 'dragTo').catchUp, undefined)
})

test('rows 29, 30: a body drag, and an Alt-at-press body drag clones', () => {
  const env = makeEnv()
  const body = { id: 'tl', part: 'body', box: [0, 0, 100, 100] }
  const r = reduce(pressed(env, P(50, 50), body), move(P(80, 30)), env)
  assert.equal(r.state.name, 'DRAG_BODY')
  assert.equal(find(r, 'beginDrag').clone, false)
  assert.equal(find(r, 'dragTo').s.kind, 'free', 'a body drag carries the raw pointer')
  const c = reduce(pressed(env, P(50, 50, { altKey: true }), body), move(P(80, 30)), env)
  assert.equal(find(c, 'beginDrag').clone, true)
  assert.equal(find(c, 'setCursor').css, 'copy')
  const late = reduce(pressed(env, P(50, 50), body), move(P(80, 30, { altKey: true })), env)
  assert.equal(find(late, 'beginDrag').clone, false, 'Alt pressed after the press does not clone')
})

test('a touch move handle drags the body', () => {
  const env = makeEnv()
  const r = reduce(pressed(env, T(50, 50), { id: 'tl', part: 'move', box: [0, 0, 100, 100] }), move(T(90, 30)), env)
  assert.equal(r.state.name, 'DRAG_BODY')
})

test('row 31: a press released inside the slop is just a select', () => {
  const env = makeEnv()
  const r = reduce(pressed(env), up(P(51, 50)), env)
  assert.equal(r.state.name, 'IDLE')
  assert.deepEqual(r.effects, [])
})

test('row 31a: a finger tap on an already-selected text re-opens its editor', () => {
  const env = makeEnv({ drawings: { txt: TXT } })
  env.hits = [{ id: 'txt', box: [0, 0, 100, 100] }]
  env.selection = ['txt']
  const rs = run(env, initialState(), [down(T(50, 50)), up(T(52, 51))])
  assert.equal(rs.last.state.name, 'EDITING')
  assert.deepEqual(rs.last.effects, [{ type: 'openEditor', id: 'txt' }])
  env.selection = []
  const first = run(env, initialState(), [down(T(50, 50)), up(T(50, 50))])
  assert.equal(first[0].result, false, 'an unselected text is not claimed by a finger')
})

test('row 32: each drag step passes the previous snap state for hysteresis', () => {
  const env = makeEnv()
  const rs = run(env, pressed(env), [move(P(80, 30)), move(P(90, 30))])
  const prev = rs[0].state.prevSnap
  assert.ok(prev)
  assert.equal(env.snapCalls[env.snapCalls.length - 1].opts.prev, prev)
  assert.equal(find(rs[1], 'dragTo').prev, prev, 'the controller sees the change of snap kind')
})

test('row 33: the up ends the drag, drops the cursor override and hands back the crosshair', () => {
  const env = makeEnv()
  const rs = run(env, pressed(env), [move(P(80, 30)), up(P(80, 30))])
  assert.deepEqual(types(rs.last), ['endDrag', 'setCursor', 'crosshairRaw'])
  assert.equal(rs.last.state.name, 'IDLE')
  const moved = run(env, pressed(env), [move(P(80, 30)), up(P(82, 30))])
  assert.deepEqual(types(moved.last), ['dragTo', 'endDrag', 'setCursor', 'crosshairRaw'], 'an up a pixel on ends where the pointer did')
  const t = run(env, pressed(env, T(50, 50)), [move(T(80, 30)), up(T(80, 30))])
  assert.equal(all(t.last, 'crosshairRaw').length, 0, 'on touch the core dismisses the crosshair')
})

test('row 34: Esc mid-drag reverts, releases, drops the cursor and hands back the crosshair', () => {
  const env = makeEnv()
  const rs = run(env, pressed(env), [move(P(80, 30)), k('escape')])
  assert.deepEqual(rs.last.effects, [
    { type: 'revert' }, { type: 'release' }, { type: 'setCursor', css: null }, { type: 'crosshairRaw', x: 80, y: 30 },
  ])
  assert.equal(rs.last.state.name, 'IDLE')
  assert.equal(rs.last.result, true)
})

test('row 34: undo during a drag only cancels it', () => {
  const env = makeEnv()
  const rs = run(env, pressed(env), [move(P(80, 30)), k('undo')])
  assert.equal(all(rs.last, 'undo').length, 0, 'history is not popped under a held handle')
  assert.ok(find(rs.last, 'revert'))
  assert.ok(find(rs.last, 'release'))
  assert.equal(rs.last.state.name, 'IDLE')
})

test('row 34: a platform cancel reverts the drag', () => {
  const env = makeEnv()
  const rs = run(env, pressed(env), [move(P(80, 30)), { type: 'cancel' }])
  assert.ok(find(rs.last, 'revert'))
  assert.equal(rs.last.state.name, 'IDLE')
})

test('rederive during PRESSED does not start a drag', () => {
  const env = makeEnv()
  const r = reduce(pressed(env), { type: 'rederive' }, env)
  assert.equal(r.state.name, 'PRESSED')
  assert.deepEqual(r.effects, [])
})

test('rederive during a drag re-snaps from the stored pointer', () => {
  const env = makeEnv()
  const s = run(env, pressed(env), [move(P(80, 30))]).last.state
  const r = reduce(s, { type: 'rederive' }, env)
  assert.equal(find(r, 'dragTo').x, 80)
  assert.equal(r.result, false)
})

// ------------------------------------------------------------------ rederive

test('row 40: rederive while armed re-snaps the reticle from the stored pointer', () => {
  const env = makeEnv()
  const s = reduce(armedWith(env, 'trendLine'), hover(P(53, 100, { shiftKey: false })), env).state
  const r = reduce(s, { type: 'rederive' }, env)
  const pv = find(r, 'preview')
  assert.ok(pv, 'a fresh reticle')
  assert.equal(pv.s.u, 5)
  assert.ok(find(r, 'crosshair').s)
})

test('row 40: rederive while placing re-snaps the following point', () => {
  const env = makeEnv()
  const s = run(env, armedWith(env, 'trendLine'), [down(P(50, 100)), up(P(50, 100)), hover(P(120, 60))]).last.state
  const r = reduce(s, { type: 'rederive' }, env)
  assert.equal(find(r, 'preview').points.length, 2)
})

test('a modifier key re-derives but is never consumed', () => {
  const env = makeEnv()
  const s = reduce(armedWith(env, 'trendLine'), hover(P(53, 100)), env).state
  const r = reduce(s, k('modifier'), env)
  assert.equal(r.result, false)
  assert.ok(find(r, 'preview'))
})

// ------------------------------------------------------------------ external / abort

test('row 41: an external edit aborts every gesture state, reverting and releasing', () => {
  const env = makeEnv()
  const drag = run(env, pressed(env), [move(P(80, 30))]).last.state
  const r1 = reduce(drag, { type: 'external', id: 'tl' }, env)
  assert.deepEqual(types(r1).slice(0, 2), ['revert', 'release'])
  assert.equal(r1.state.name, 'IDLE')

  const press = pressed(env)
  const r2 = reduce(press, { type: 'external', id: null }, env)
  assert.deepEqual(types(r2), ['release'])

  for (const events of [[down(P(50, 100))], [down(P(50, 100)), move(P(120, 60))], [down(P(50, 100)), up(P(50, 100))]]) {
    const s = run(env, armedWith(env, 'parallelChannel'), events).last.state
    const r = reduce(s, { type: 'external', id: null }, env)
    assert.deepEqual(types(r), ['abortCreate', 'release'], s.name)
    assert.equal(r.state.name, 'ARMED')
  }
  assert.deepEqual(reduce(drag, { type: 'external', id: 'someone-else' }, env).effects, [], 'an edit of another drawing leaves the drag alone')
})

test('an abort during pointerDown leaves no owner', () => {
  // The controller runs the down's effects; a host 'select' listener removes
  // the drawing and the controller dispatches `external` before returning.
  const env = makeEnv()
  env.drawings.set('tl', TL)
  env.hits = [{ id: 'tl', box: [0, 0, 100, 100] }]
  const d = reduce(initialState(), down(P(50, 50)), env)
  assert.equal(d.result && ownsPress(d.state), true)
  const x = reduce(d.state, { type: 'external', id: 'tl' }, env)
  assert.equal(d.result && ownsPress(x.state), false, 'pointerDown returns false')
})

test('a hit whose drawing has vanished is not claimed', () => {
  const env = makeEnv()
  env.hits = [{ id: 'ghost', box: [0, 0, 100, 100] }]
  assert.equal(reduce(initialState(), down(P(50, 50)), env).result, false)
})

// ------------------------------------------------------------------ quick measure

test('row 6: Shift+press on empty plot starts an ephemeral quick measure', () => {
  const env = makeEnv()
  const r = reduce(initialState(), down(P(50, 100, { shiftKey: true })), env)
  assert.equal(r.result, true)
  assert.equal(r.state.name, 'QM_DRAG')
  const pv = find(r, 'preview')
  assert.equal(pv.ephemeral, true)
  assert.equal(pv.toolType, 'measure')
  assert.equal(reduce(initialState(), down(T(50, 100, { shiftKey: true })), env).result, false, 'mouse and pen only')
  assert.equal(reduce(initialState(), down(P(50, 100, { shiftKey: true })), makeEnv({ quickMeasure: false })).result, false)
})

test('rows 35, 36: the measure follows the drag and stays shown; it never enters the document', () => {
  const env = makeEnv()
  const rs = run(env, initialState(), [down(P(50, 100, { shiftKey: true })), move(P(150, 60, { shiftKey: true })), up(P(150, 60))])
  const pv = find(rs[1], 'preview')
  assert.equal(pv.ephemeral, true)
  assert.deepEqual(pv.points.map((p) => p.time), [1005 * MIN, 1015 * MIN])
  assert.equal(env.snapCalls[env.snapCalls.length - 1].opts.allowAngle, false, 'Shift started it; it does not constrain it')
  assert.equal(rs.last.state.name, 'QM_SHOWN')
  assert.ok(find(rs.last, 'crosshairRaw'))
  const effects = rs.flatMap((r) => r.effects)
  assert.equal(effects.filter((e) => e.type === 'create' || (e.type === 'preview' && !e.ephemeral)).length, 0)
})

test('row 37: a shown measure survives the pointer leaving; a pan dismisses it', () => {
  const env = makeEnv()
  const shown = run(env, initialState(), [down(P(50, 100, { shiftKey: true })), move(P(150, 60)), up(P(150, 60))]).last.state
  const left = reduce(shown, hover(null, 'leave'), env)
  assert.equal(left.state.name, 'QM_SHOWN')
  assert.deepEqual(left.effects, [])
  const panned = reduce(shown, hover(null, 'pan'), env)
  assert.equal(panned.state.name, 'IDLE')
  assert.deepEqual(panned.effects, [{ type: 'dismissMeasure' }])
})

test('row 37: the next press dismisses a shown measure and carries on unclaimed', () => {
  const env = makeEnv()
  const shown = run(env, initialState(), [down(P(50, 100, { shiftKey: true })), move(P(150, 60)), up(P(150, 60))]).last.state
  const r = reduce(shown, down(P(300, 300)), env)
  assert.equal(r.result, false)
  assert.deepEqual(r.effects, [{ type: 'dismissMeasure' }])
  assert.equal(r.state.name, 'IDLE')
  assert.equal(reduce(shown, k('escape'), env).state.name, 'IDLE', 'Esc dismisses it too')
})

test('Shift+click-click measures: the far end follows the mouse until the second click', () => {
  const env = makeEnv()
  const rs = run(env, initialState(), [
    down(P(50, 100, { shiftKey: true })), up(P(50, 100)), hover(P(120, 80)), down(P(150, 60)), up(P(150, 60)), hover(P(300, 300)),
  ])
  assert.equal(rs[1].state.name, 'QM_SHOWN')
  assert.deepEqual(find(rs[2], 'preview').points.map((p) => p.time), [1005 * MIN, 1012 * MIN])
  assert.equal(rs[3].result, true, 'the second click is claimed')
  assert.deepEqual(find(rs[4], 'crosshairRaw'), { type: 'crosshairRaw', x: 150, y: 60 })
  assert.equal(rs.last.state.measure.p1.u, 15, 'fixed after the second click')
  assert.equal(all(rs.last, 'preview').length, 0)
})

// ------------------------------------------------------------------ editing

function editing(env) {
  env.drawings.set('txt', TXT)
  env.hits = [{ id: 'txt', box: [0, 0, 100, 100] }]
  return reduce(initialState(), { type: 'dblclick', e: P(50, 50) }, env).state
}

test('row 38a: a press while editing commits first, then is handled as from IDLE', () => {
  const env = makeEnv({ drawings: { tl: TL } })
  const s = editing(env)
  env.hits = [{ id: 'tl', box: [200, 200, 300, 300] }]
  const r = reduce(s, down(P(250, 250)), env)
  assert.deepEqual(types(r), ['commitEditor', 'claim', 'select'])
  assert.equal(r.state.name, 'PRESSED')
  assert.equal(r.result, true)
})

test('row 39: Esc in the editor cancels it and refocuses the chart', () => {
  const env = makeEnv()
  const r = reduce(editing(env), k('escape'), env)
  assert.deepEqual(types(r), ['cancelEditor', 'focus'])
  assert.equal(r.state.name, 'IDLE')
})

test('Enter on a selected text opens its editor; on anything else it is not ours', () => {
  const env = makeEnv({ drawings: { txt: TXT, tl: TL } })
  env.selection = ['txt']
  const r = reduce(initialState(), k('edit'), env)
  assert.equal(r.state.name, 'EDITING')
  assert.deepEqual(r.effects, [{ type: 'openEditor', id: 'txt' }])
  env.selection = ['tl']
  assert.equal(reduce(initialState(), k('edit'), env).result, false)
})

// ------------------------------------------------------------------ keys

test('Esc peels one layer at a time: drag, creation, editor, measure, selection, tool', () => {
  const env = makeEnv()
  env.selection = ['tl']
  const armed = armedWith(env, 'trendLine')
  const r1 = reduce(armed, k('escape'), env)
  assert.deepEqual(r1.effects, [{ type: 'select', ids: [] }], 'armed with a selection: deselect first')
  env.selection = []
  assert.equal(reduce(r1.state, k('escape'), env).state.name, 'IDLE', 'then disarm')
  assert.equal(reduce(initialState(), k('escape'), env).result, false, 'nothing left: not consumed')
})

test('Delete removes the selection; a locked drawing shakes instead', () => {
  const env = makeEnv({ drawings: { tl: TL, lk: LOCKED } })
  env.selection = ['tl']
  assert.deepEqual(reduce(initialState(), k('delete'), env).effects, [{ type: 'remove', ids: ['tl'] }])
  env.selection = ['lk']
  const r = reduce(initialState(), k('delete'), env)
  assert.deepEqual(r.effects, [{ type: 'shake', id: 'lk' }])
  assert.equal(r.result, true, 'consumed, so the core does nothing either')
  env.selection = []
  assert.equal(reduce(initialState(), k('delete'), env).result, false)
})

test('nudge moves the selection; locked shakes; zero bars falls through', () => {
  const env = makeEnv({ drawings: { tl: TL, lk: LOCKED } })
  env.selection = ['tl']
  assert.deepEqual(reduce(initialState(), k('nudge', { du: -10, dv: 0 }), env).effects, [{ type: 'nudge', du: -10, dv: 0 }])
  env.selection = ['lk']
  assert.deepEqual(reduce(initialState(), k('nudge', { du: 1, dv: 0 }), env).effects, [{ type: 'shake', id: 'lk' }])
  env.selection = ['tl']
  env.hasBars = false
  assert.equal(reduce(initialState(), k('nudge', { du: 1, dv: 0 }), env).result, false)
  assert.equal(reduce(initialState(), k('duplicate'), env).result, false)
})

test('duplicate, undo and redo when idle', () => {
  const env = makeEnv({ drawings: { lk: LOCKED } })
  env.selection = ['lk']
  assert.deepEqual(reduce(initialState(), k('duplicate'), env).effects, [{ type: 'duplicate', ids: ['lk'] }], 'a locked drawing can be duplicated')
  assert.deepEqual(reduce(initialState(), k('undo'), env).effects, [{ type: 'undo' }])
  assert.deepEqual(reduce(initialState(), k('redo'), env).effects, [{ type: 'redo' }])
  assert.equal(reduce(initialState(), k('undo'), makeEnv({ readOnly: true })).result, false)
})

test('keyIntent names keys by situation', () => {
  const s = { hasSelection: true, gesture: false, placing: false, editing: false }
  const key = (k2, o = {}) => ({ key: k2, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, code: '', ...o })
  assert.equal(keyIntent(key('Escape'), s), 'escape')
  assert.equal(keyIntent(key('Delete'), s), 'delete')
  assert.equal(keyIntent(key('Backspace'), s), 'delete')
  assert.equal(keyIntent(key('Backspace'), { ...s, placing: true }), 'unplace')
  assert.equal(keyIntent(key('z', { ctrlKey: true }), s), 'undo')
  assert.equal(keyIntent(key('z', { metaKey: true }), s), 'undo')
  assert.equal(keyIntent(key('Z', { metaKey: true, shiftKey: true }), s), 'redo')
  assert.equal(keyIntent(key('y', { ctrlKey: true }), s), 'redo')
  assert.equal(keyIntent(key('я', { ctrlKey: true, code: 'KeyZ' }), s), 'undo', 'a Cyrillic layout')
  assert.equal(keyIntent(key('d', { ctrlKey: true }), s), 'duplicate')
  assert.equal(keyIntent(key('Enter'), s), 'edit')
  assert.equal(keyIntent(key('Shift'), s), 'modifier')
  assert.equal(keyIntent(key('ArrowLeft'), s), 'nudge')
  assert.equal(keyIntent(key('ArrowLeft'), { ...s, hasSelection: false }), null, 'no selection: the core pans')
  assert.equal(keyIntent(key('ArrowLeft', { ctrlKey: true }), s), null)
  assert.equal(keyIntent(key('Delete'), { ...s, gesture: true }), null)
  assert.equal(keyIntent(key('z', { ctrlKey: true }), { ...s, gesture: true }), 'undo', 'the machine turns it into a cancel')
  assert.equal(keyIntent(key('Escape'), { ...s, editing: true }), null, 'the editor owns every key')
  assert.equal(keyIntent(key('Enter', { isComposing: true }), s), null)
  assert.equal(keyIntent(key('constructor'), s), null)
})

test('keyEvent carries the nudge step: 1 bar or 1 px, ×10 with Shift', () => {
  const s = { hasSelection: true, gesture: false, placing: false, editing: false }
  assert.deepEqual(keyEvent({ key: 'ArrowRight', shiftKey: false }, s), { type: 'key', intent: 'nudge', du: 1, dv: 0 })
  assert.deepEqual(keyEvent({ key: 'ArrowLeft', shiftKey: true }, s), { type: 'key', intent: 'nudge', du: -10, dv: 0 })
  assert.deepEqual(keyEvent({ key: 'ArrowUp', shiftKey: false }, s), { type: 'key', intent: 'nudge', du: 0, dv: 1 })
  assert.deepEqual(keyEvent({ key: 'ArrowDown', shiftKey: true }, s), { type: 'key', intent: 'nudge', du: 0, dv: -10 })
  assert.deepEqual(keyEvent({ key: 'Escape' }, s), { type: 'key', intent: 'escape' })
  assert.equal(keyEvent({ key: 'q' }, s), null)
})

// ------------------------------------------------------------------ properties

test('the reducer is deterministic and never mutates its input state', () => {
  const script = [
    { type: 'setTool', tool: spec('parallelChannel') },
    hover(P(40, 100)), down(P(50, 100)), move(P(150, 100)), up(P(150, 100)), hover(P(120, 40)), { type: 'rederive' },
    down(P(120, 40)), up(P(120, 40)),
  ]
  const once = () => {
    const env = makeEnv()
    let s = Object.freeze(initialState())
    const log = []
    for (const ev of script) {
      const r = reduce(s, ev, env)
      log.push(r)
      s = Object.freeze(r.state)
    }
    return log
  }
  assert.deepEqual(once(), once())
})

test('an unknown event, or an event a state does not handle, is a no-op', () => {
  const env = makeEnv()
  const s = initialState()
  assert.deepEqual(reduce(s, { type: 'teleport' }, env), { state: s, effects: [], result: false })
  assert.deepEqual(reduce(s, up(P(1, 1)), env).effects, [])
  assert.deepEqual(reduce(s, move(P(1, 1)), env).effects, [])
  assert.deepEqual(reduce(s, { type: 'cancel' }, env).effects, [])
})
