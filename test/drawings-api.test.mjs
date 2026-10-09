/**
 * The drawings controller's public API (§7): events and their order, loads
 * and history, programmer-error throws, carried rows, the lifecycle, and the
 * entry's own exports. Driven through a real Chart and the real seam.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, frame, settle } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const D = await import('../src/drawings/index.js')
const { enableDrawings, createDrawings, normalizeDrawings, trendLine, horizontalLine, rectangle } = D

const T0 = 1_700_000_000_000
const MIN = 60_000
const bars = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7)
  return { time: T0 + i * MIN, open: c, high: c + 1, low: c - 1, close: c + 0.2, volume: 5 }
})
const seq = () => { let n = 0; return () => 'd' + ++n }
const OPTS = { magnet: 'off', platform: 'other', prefersReducedMotion: () => false, motion: 'none' }

function setup(extra = {}, n = 300) {
  const chart = createChart(makeContainer())
  if (n) chart.setData(bars(n))
  settle(chart); frame(chart)
  const dc = enableDrawings(chart, { idFactory: seq(), ...OPTS, ...extra })
  frame(chart)
  return { chart, dc }
}

const t = (i) => T0 + i * MIN
const tl = (i0, p0, i1, p1, extra = {}) => ({ type: 'trendLine', points: [{ time: t(i0), price: p0 }, { time: t(i1), price: p1 }], ...extra })

/** Every event in arrival order, with state events' subscribe-time delivery dropped. */
function record(dc, names = ['change', 'history', 'select', 'tool']) {
  const log = []
  for (const n of names) dc.subscribe(n, (p) => log.push([n, p]))
  log.length = 0
  return log
}

/** Silence console[level] for the duration of fn; returns what it would have printed. */
function quiet(level, fn) {
  const orig = console[level]
  const calls = []
  console[level] = (...a) => calls.push(a)
  try { fn() } finally { console[level] = orig }
  return calls
}

// ------------------------------------------------------------------ events

test('one API edit fires change, then history, then select — with the stored form in the payload', () => {
  const { dc } = setup()
  const log = record(dc)
  const id = dc.add(tl(240, 100, 260, 102, { meta: { note: 'x' } }), { select: true })
  assert.deepEqual(log.map(([n]) => n), ['change', 'history', 'select'])
  const change = log[0][1]
  assert.equal(change.source, 'api')
  assert.equal(change.reason, 'create')
  assert.equal(change.created.length, 1)
  assert.deepEqual(change.created[0], dc.get(id))
  assert.equal(change.created[0].meta.note, 'x')
  assert.deepEqual(change.updated, [])
  assert.deepEqual(change.removed, [])
  assert.deepEqual(log[1][1], { canUndo: true, canRedo: false, undoSize: 1, redoSize: 0 })
  assert.deepEqual(log[2][1].ids, [id])
  assert.equal(log[2][1].drawings[0].id, id)
})

test('state events deliver on subscribe and are deduped per listener', () => {
  const { dc } = setup()
  const id = dc.add(tl(240, 100, 260, 102))
  const a = []
  dc.subscribe('select', (p) => a.push(p.ids))
  assert.deepEqual(a, [[]], 'the current selection, at once')
  dc.select(id)
  dc.select(id)
  dc.select([id])
  assert.deepEqual(a, [[], [id]])
  const b = []
  dc.subscribe('select', (p) => b.push(p.ids))
  assert.deepEqual(b, [[id]], 'a late subscriber is told the current state')
  const tools = []
  dc.subscribe('tool', (p) => tools.push(p))
  dc.setTool('ray', { focus: false })
  dc.setTool('ray', { focus: false })
  assert.deepEqual(tools, [{ tool: null, sticky: false }, { tool: 'ray', sticky: false }])
  const hist = []
  dc.subscribe('history', (p) => hist.push(p.undoSize))
  assert.deepEqual(hist, [1])
})

test('a throwing listener is logged and isolated: the edit and the other listeners still happen', () => {
  const { dc } = setup()
  const seen = []
  dc.subscribe('change', () => { throw new Error('host bug') })
  dc.subscribe('change', (p) => seen.push(p.reason))
  let id
  const errs = quiet('error', () => { id = dc.add(tl(240, 100, 260, 102)) })
  assert.ok(dc.get(id))
  assert.deepEqual(seen, ['create'])
  assert.equal(errs.length, 1)
  assert.match(String(errs[0][0]), /'drawings:change' listener threw/)
})

test('subscribe refuses an unknown event', () => {
  const { dc } = setup()
  assert.throws(() => dc.subscribe('nope', () => {}), /unknown event "nope"/)
})

// ------------------------------------------------------------------ loads

test('setDrawings is a load: no change, history cleared, selection cleared, report returned and kept', () => {
  const { dc } = setup()
  const id = dc.add(tl(240, 100, 260, 102), { select: true })
  const log = record(dc)
  const report = dc.setDrawings([
    tl(200, 99, 210, 98, { id: 'a' }),
    { type: 'brush', id: 'future', points: [] },
    { type: 'trendLine', points: [{ time: null, price: 1 }] },
  ])
  assert.equal(report.loaded, 1)
  assert.deepEqual(report.carried, ['future'])
  assert.equal(report.rejected.length, 1)
  assert.equal(dc.lastLoadReport, report)
  assert.equal(dc.get(id), null)
  assert.equal(dc.canUndo, false)
  assert.deepEqual(dc.selection, [])
  assert.deepEqual(log.map(([n]) => n), ['history', 'select'], 'state events only — never a change')
  assert.throws(() => dc.setDrawings('{not json'), SyntaxError)
  assert.equal(dc.getDrawings().length, 2, 'a failed parse applies nothing')
})

test('the initial `drawings` option loads, keeps its report and warns once about rejects', () => {
  const chart = createChart(makeContainer())
  chart.setData(bars(100))
  let dc
  const warns = quiet('warn', () => {
    dc = enableDrawings(chart, { idFactory: seq(), drawings: [tl(10, 1, 20, 2, { id: 'x' }), { nope: 1 }] })
  })
  assert.equal(dc.lastLoadReport.loaded, 1)
  assert.equal(dc.lastLoadReport.rejected.length, 1)
  assert.equal(warns.length, 1)
  assert.equal(dc.canUndo, false)
  assert.deepEqual(dc.getDrawings().map((d) => d.id), ['x'])
})

test('getDrawings returns unfrozen clones in z order, carried rows verbatim', () => {
  const { dc } = setup()
  dc.setDrawings([tl(200, 99, 210, 98, { id: 'b', z: 5 }), { type: 'future', id: 'f', z: 3, x: [1] }, tl(220, 99, 230, 98, { id: 'a', z: 1 })])
  const out = dc.getDrawings()
  assert.deepEqual(out.map((d) => d.id), ['a', 'f', 'b'])
  assert.deepEqual(out[1], { type: 'future', id: 'f', z: 3, x: [1] })
  assert.equal(Object.isFrozen(out[0]), false)
  out[0].points[0].price = 12345
  assert.notEqual(dc.get('a').points[0].price, 12345, 'a caller mutating the result never reaches the store')
  assert.deepEqual(dc.get('f'), { type: 'future', id: 'f', z: 3, x: [1] }, 'get() of a carried id is its raw row')
})

// ------------------------------------------------------------------ edits

test('an update that normalizes to the same drawing is a no-op: false, no history, no events', () => {
  const { dc } = setup()
  const id = dc.add(tl(240, 100, 260, 102))
  const log = record(dc)
  assert.equal(dc.update(id, { style: { lineWidth: 1.5 } }), false)
  assert.equal(dc.update(id, { points: [{ time: t(240), price: '100' }, { time: t(260), price: 102 }] }), false)
  assert.deepEqual(log, [])
  assert.equal(dc.canUndo, true)
  dc.undo()
  assert.equal(dc.canUndo, false, 'only the add was recorded')
})

test('update merges style and options, reports why, and refuses id/type/v and unknown panes', () => {
  const { dc } = setup()
  const id = dc.add(tl(240, 100, 260, 102))
  const log = record(dc, ['change'])
  assert.equal(dc.update(id, { style: { color: '#f00' } }), true)
  assert.equal(dc.update(id, { options: { extend: 'right' } }), true)
  assert.equal(dc.setLocked(id, true), true)
  assert.equal(dc.setVisible(id, false), true)
  assert.deepEqual(log.map(([, p]) => p.reason), ['style', 'options', 'lock', 'visibility'])
  const d = dc.get(id)
  assert.equal(d.style.color, '#f00')
  assert.equal(d.style.lineWidth, 1.5)
  assert.equal(d.options.extend, 'right')
  for (const k of ['id', 'type', 'v']) assert.throws(() => dc.update(id, { [k]: 'x' }), new RegExp(`cannot patch ${k}`))
  assert.throws(() => dc.update(id, { pane: 'rsi' }), /unknown pane "rsi"/)
  assert.throws(() => dc.add(tl(1, 1, 2, 2, { pane: 'rsi' })), /unknown pane "rsi"/)
  assert.throws(() => dc.update(id, { points: [{ time: NaN, price: 1 }, { time: 1, price: 1 }] }), /bad point/)
})

test('add refuses an id already in use — carried rows included — and leaves the other drawing intact', () => {
  const { dc } = setup()
  dc.setDrawings([{ type: 'future', id: 'f' }])
  const a = dc.add(tl(240, 100, 260, 102, { id: 'a' }))
  assert.equal(a, 'a')
  const before = dc.get('a')
  assert.throws(() => dc.add(tl(1, 5, 2, 6, { id: 'a' })), /duplicate id "a"/)
  assert.throws(() => dc.add(tl(1, 5, 2, 6, { id: 'f' })), /duplicate id "f"/)
  assert.deepEqual(dc.get('a'), before)
  assert.equal(dc.getDrawings().length, 2)
})

test('a colliding idFactory is retried, and gives up after 8 ids in use', () => {
  const ids = ['x', 'x', 'x', 'y']
  const { dc } = setup({ idFactory: () => ids.shift() || 'x' })
  assert.equal(dc.add(tl(1, 1, 2, 2)), 'x')
  assert.equal(dc.add(tl(1, 1, 2, 2)), 'y')
  assert.throws(() => dc.add(tl(1, 1, 2, 2)), /idFactory returned 8 ids in use/)
})

test('history:false edits are not recorded, and undo is per id', () => {
  const { dc } = setup()
  const a = dc.add(tl(240, 100, 260, 102))
  const b = dc.add(tl(200, 90, 210, 91), { history: false })
  assert.equal(dc.update(a, { style: { color: '#0f0' } }), true)
  assert.equal(dc.update(b, { style: { color: '#00f' } }, { history: false }), true)
  dc.undo()
  assert.equal(dc.get(a).style.color, null, 'the recorded edit is undone')
  assert.equal(dc.get(b).style.color, '#00f', 'the unrecorded edit to another drawing survives')
  dc.redo()
  assert.equal(dc.get(a).style.color, '#0f0')
})

test('remove and clear skip carried rows and do not count them; clear is one undoable entry', () => {
  const { dc } = setup()
  dc.setDrawings([tl(200, 99, 210, 98, { id: 'a' }), { type: 'future', id: 'f' }, tl(220, 99, 230, 98, { id: 'b' })])
  assert.equal(dc.remove(['f']), 0)
  assert.equal(dc.remove('a'), 1)
  const log = record(dc, ['change'])
  assert.equal(dc.clear(), 1)
  assert.deepEqual(dc.getDrawings().map((d) => d.id), ['f'], 'the newer build\'s row is kept')
  assert.equal(log[0][1].reason, 'clear')
  assert.deepEqual(log[0][1].removed.map((d) => d.id), ['b'])
  dc.undo()
  assert.deepEqual(dc.getDrawings().map((d) => d.id), ['f', 'b'])
})

test('batch is one history entry and one change; a throwing batch changes and emits nothing and rethrows', () => {
  const { dc } = setup()
  const a = dc.add(tl(240, 100, 260, 102))
  dc.select(a)
  const log = record(dc)
  dc.batch(() => {
    dc.update(a, { style: { color: '#f00' } })
    dc.add(tl(200, 90, 210, 91))
    dc.batch(() => dc.add(tl(180, 90, 190, 91)))
  })
  assert.deepEqual(log.map(([n]) => n), ['change', 'history'])
  assert.equal(log[0][1].reason, 'batch')
  assert.equal(log[0][1].created.length, 2)
  assert.equal(log[0][1].updated.length, 1)
  assert.equal(dc.getDrawings().length, 3)
  dc.undo()
  assert.equal(dc.getDrawings().length, 1, 'one undo reverts the whole batch')
  assert.equal(dc.get(a).style.color, null)

  const docBefore = dc.getDrawings()
  const hist = { u: dc.canUndo, r: dc.canRedo }
  log.length = 0
  const boom = new Error('boom')
  assert.throws(() => dc.batch(() => {
    dc.remove(a)
    dc.add(tl(100, 90, 110, 91))
    dc.select(null)
    throw boom
  }), (e) => e === boom)
  assert.deepEqual(dc.getDrawings(), docBefore)
  assert.deepEqual({ u: dc.canUndo, r: dc.canRedo }, hist)
  assert.deepEqual(dc.selection, [a])
  assert.deepEqual(log, [])
})

test('duplicate offsets by 5 bars by default; bringToFront and sendToBack reorder with sparse z', () => {
  const { dc } = setup()
  const a = dc.add(tl(240, 100, 260, 102))
  const b = dc.add(tl(200, 90, 210, 91))
  const c = dc.duplicate(a)
  assert.equal(dc.get(c).points[0].time, t(245))
  assert.equal(dc.get(c).points[1].time, t(265))
  assert.equal(dc.duplicate(a, { offsetBars: -2 }) != null, true)
  assert.equal(dc.bringToFront(a), true)
  const ids = dc.getDrawings().map((d) => d.id)
  assert.equal(ids[ids.length - 1], a)
  assert.equal(dc.bringToFront(a), false, 'already in front')
  assert.equal(dc.sendToBack(a), true)
  assert.equal(dc.getDrawings()[0].id, a)
  assert.equal(dc.get(b).z, 2, 'nobody else was rewritten')
})

test('with zero bars: nudge, duplicate and priceAt are no-ops, and nothing stores NaN', () => {
  const { chart, dc } = setup({}, 0)
  const id = dc.add(tl(1, 100, 2, 101))
  dc.select(id)
  assert.deepEqual(dc.selection, [id])
  assert.equal(dc.keyDown({ key: 'ArrowRight' }), false, 'not consumed: the key falls through to the core')
  assert.equal(dc.keyDown({ key: 'd', ctrlKey: true }), false)
  chart._onKey({ key: 'ArrowRight', preventDefault() {} })
  assert.equal(dc.duplicate(id), null)
  assert.equal(dc.priceAt(id, t(1)), null)
  assert.deepEqual(dc.get(id).points, [{ time: t(1), price: 100 }, { time: t(2), price: 101 }])
  for (const d of dc.getDrawings()) for (const p of d.points) assert.ok(Number.isFinite(p.time) && Number.isFinite(p.price))
})

test('priceAt reads a line (extension-aware), a horizontal line and a channel baseline', () => {
  const { dc } = setup()
  const a = dc.add(tl(240, 100, 260, 102))
  assert.ok(Math.abs(dc.priceAt(a, t(250)) - 101) < 1e-9)
  assert.equal(dc.priceAt(a, t(270)), null, 'past the drawn segment')
  dc.update(a, { options: { extend: 'right' } })
  assert.ok(Math.abs(dc.priceAt(a, t(270)) - 103) < 1e-9)
  const h = dc.add({ type: 'horizontalLine', points: [{ time: t(10), price: 97 }] })
  assert.equal(dc.priceAt(h, t(250)), 97)
  const ch = dc.add({ type: 'parallelChannel', points: [{ time: t(240), price: 100 }, { time: t(260), price: 104 }, { time: t(250), price: 99 }] })
  assert.ok(Math.abs(dc.priceAt(ch, t(250)) - 102) < 1e-9)
  assert.equal(dc.priceAt('missing', t(250)), null)
})

test('screenBox, drawingAt (fill, body, handle) and orphans', () => {
  const { chart, dc } = setup()
  const r = dc.add({ type: 'rectangle', points: [{ time: t(240), price: 104 }, { time: t(260), price: 96 }] })
  frame(chart)
  const box = dc.screenBox(r)
  assert.ok(Math.abs(box.x - chart.ts.x(240)) < 1)
  assert.ok(Math.abs(box.x + box.w - chart.ts.x(260)) < 1)
  const cx = chart.ts.x(250)
  assert.deepEqual(dc.drawingAt(cx, chart.ps.y(100)), { id: r, part: 'fill', handle: -1, locked: false })
  assert.equal(dc.drawingAt(cx, chart.ps.y(104)).part, 'body')
  dc.select(r, { focus: false })
  frame(chart)
  const h = dc.drawingAt(chart.ts.x(240), chart.ps.y(104))
  assert.equal(h.part, 'handle')
  assert.equal(h.handle, 0)
  assert.equal(dc.drawingAt(5, 5), null)
  assert.deepEqual(dc.orphans(), [])
})

test('editText with textEditor:false hands editing to the host through the edit event', () => {
  const { chart, dc } = setup({ textEditor: false })
  const id = dc.add({ type: 'text', points: [{ time: t(250), price: 100 }], options: { text: 'Hi' } })
  frame(chart)
  const edits = []
  dc.subscribe('edit', (p) => edits.push(p))
  assert.equal(dc.editText(id), true)
  assert.equal(edits.length, 1)
  assert.equal(edits[0].id, id)
  assert.equal(edits[0].drawing.options.text, 'Hi')
  assert.ok(edits[0].box && edits[0].box.w > 0)
})

test('editText opens the in-place editor focused, and Enter commits one text edit', () => {
  const { chart, dc } = setup()
  const id = dc.add({ type: 'text', points: [{ time: t(250), price: 100 }], options: { text: 'Hi' } })
  frame(chart)
  const log = record(dc, ['change'])
  assert.equal(dc.editText(id), true)
  const ta = chart.container.children.find((c) => c.tagName === 'TEXTAREA' && !c.removed)
  assert.ok(ta.focused)
  assert.equal(ta.value, 'Hi')
  ta.value = 'Bye'
  ta.dispatch('keydown', { key: 'Enter', stopPropagation() {}, preventDefault() {} })
  ta.blur()
  assert.equal(dc.get(id).options.text, 'Bye')
  assert.deepEqual(log.map(([, p]) => p.reason), ['text'])
})

// ------------------------------------------------------------------ lifecycle

test('destroy is idempotent, keeps getDrawings working and turns mutators into no-ops', () => {
  const { chart, dc } = setup()
  const id = dc.add(tl(240, 100, 260, 102))
  assert.equal(dc.__v_skip, true)
  dc.destroy()
  dc.destroy()
  assert.equal(dc.destroyed, true)
  assert.equal(chart._plugins.length, 0)
  assert.equal(chart.layers.names.includes('plugins'), false)
  assert.deepEqual(dc.getDrawings().map((d) => d.id), [id])
  assert.equal(dc.add(tl(1, 1, 2, 2)), null)
  assert.equal(dc.update(id, { style: { color: '#f00' } }), false)
  assert.equal(dc.remove(id), 0)
  assert.equal(dc.clear(), 0)
  assert.equal(dc.undo(), false)
  assert.ok(dc.get(id))
})

test('chart.destroy() detaches the drawings too', () => {
  const { chart, dc } = setup()
  const id = dc.add(tl(240, 100, 260, 102))
  chart.destroy()
  assert.equal(dc.destroyed, true)
  assert.deepEqual(dc.getDrawings().map((d) => d.id), [id])
})

test('a second enable on one chart throws; after destroy a fresh controller can be made', () => {
  const chart = createChart(makeContainer())
  const a = enableDrawings(chart, { idFactory: seq() })
  assert.throws(() => enableDrawings(chart), /drawings are already enabled on this chart — call destroy\(\) first/)
  a.destroy()
  const b = enableDrawings(chart, { idFactory: seq() })
  assert.notEqual(a, b)
  assert.equal(b.destroyed, false)
  chart.destroy()
  assert.throws(() => enableDrawings(chart), /destroyed/)
})

test('createDrawings needs a chart with the plugin seam, and a tool list', () => {
  assert.throws(() => createDrawings({}, { tools: [] }), /enableDrawings: needs an Emberwick >= 0\.12 chart \(no addPlugin\)/)
  const chart = createChart(makeContainer())
  assert.throws(() => createDrawings(chart, {}), /options\.tools/)
})

test('createDrawings with three tools carries the other types inert and refuses to add them', () => {
  const chart = createChart(makeContainer())
  chart.setData(bars(100))
  const dc = createDrawings(chart, { tools: [trendLine, horizontalLine, rectangle], idFactory: seq() })
  const r = dc.setDrawings([tl(10, 1, 20, 2, { id: 'a' }), { type: 'fibRetracement', id: 'f', points: [{ time: t(1), price: 1 }, { time: t(2), price: 2 }] }])
  assert.equal(r.loaded, 1)
  assert.deepEqual(r.carried, ['f'])
  assert.throws(() => dc.add({ type: 'measure', points: [{ time: t(1), price: 1 }, { time: t(2), price: 2 }] }), /unknown type "measure"/)
  assert.throws(() => dc.setTool('fibRetracement'), /unknown tool "fibRetracement"/)
  dc.setTool('horizontalRay', { focus: false })
  assert.equal(dc.tool, 'horizontalRay')
})

test('normalizeDrawings is the pure public wrapper: drawings.length === loaded + carried', () => {
  const r = normalizeDrawings([
    tl(10, '1', 20, 2),
    { type: 'future', id: 'f', z: 9, keep: true },
    { type: 'trendLine', points: [] },
  ])
  assert.equal(r.report.loaded, 1)
  assert.equal(r.drawings.length, r.report.loaded + r.report.carried.length)
  assert.equal(r.drawings[0].points[0].price, 1)
  assert.deepEqual(r.drawings[1], { type: 'future', id: 'f', z: 9, keep: true })
  assert.equal(normalizeDrawings([tl(1, 1, 2, 2)], [horizontalLine]).report.carried.length, 1, 'with a tool list of its own')
  assert.equal(D.SCHEMA_VERSION, 1)
  assert.equal(D.version, '0.14.0')
  assert.equal(D.STANDARD_TOOLS.length, 9)
  assert.equal(Object.keys(D.TOOL_PRESETS).length, 14)
  assert.equal(D.timeToIndex(bars(10), t(3), MIN), 3)
  assert.equal(D.indexToTime(bars(10), 4, MIN), t(4))
})

test('setAnimate(false) leaves no keep-alive frames', () => {
  const { chart, dc } = setup({ motion: 'auto' })
  const id = dc.add(tl(240, 100, 260, 102))
  dc.select(id)
  assert.equal(frame(chart), true, 'the selection animates in')
  chart.setAnimate(false)
  assert.equal(frame(chart), false)
})

test('toImage paints the committed drawings on the export pass, with no selection chrome', () => {
  const { chart, dc } = setup({ motion: 'full' })
  const id = dc.add(tl(240, 100, 260, 102))
  dc.select(id)
  frame(chart)
  const ops = []
  const orig = chart.layers.composite.bind(chart.layers)
  chart.layers.composite = (names, between) => {
    const out = orig(names, between)
    ops.push(...out.ops)
    return out
  }
  chart.toImage()
  const x0 = chart.ts.x(240)
  const moved = ops.filter((o) => (o.op === 'moveTo' || o.op === 'lineTo') && Math.abs(o.args[0] - x0) < 1e-6)
  assert.ok(moved.length > 0, 'the line is in the export')
  assert.equal(ops.filter((o) => o.op === 'arc').length, 0, 'no handles, rings or ripples')
})
