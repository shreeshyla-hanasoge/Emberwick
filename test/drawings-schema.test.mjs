/**
 * Drawing schema: what a load keeps, what it refuses, and what it hands back.
 *
 * The consumer this protects is a host that saves on every change (Traed keeps
 * one row per drawing). Whatever a load drops, and whatever toJSON() fails to
 * re-emit, that host deletes from its database on the next save. So most of
 * these tests are about NOT losing data: a newer build's drawing, a newer
 * build's extra fields, a row whose id collides with another.
 *
 * The tool registry here is a fake with the ToolDef fields the model reads,
 * so this file depends on nothing but the model.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SCHEMA_VERSION,
  normalizeEntries,
  normalizeDrawing,
  normalizeInput,
  applyPatch,
  toJSON,
  sameDrawing,
  deepFreeze,
  derivedId,
  makeIdFactory,
  makeRegistry,
  emptyReport,
} from '../src/drawings/model/schema.js'
import { mulberry32 } from '../src/chart/index.js'

// ------------------------------------------------------------------ fake tools

const STYLE = { color: null, lineWidth: 1.5, lineStyle: 'solid', fill: null, fillOpacity: 0.12, textColor: null, fontSize: 12 }
const EXTEND = new Set(['none', 'left', 'right', 'both'])
const SIDE = new Set(['long', 'short'])

const trendLine = {
  type: 'trendLine',
  anchors: 2,
  defaultStyle: STYLE,
  defaultOptions: { extend: 'none', text: '' },
  normalizeOptions: (raw) => ({
    extend: EXTEND.has(raw.extend) ? raw.extend : 'none',
    text: raw.text != null ? String(raw.text).slice(0, 1000) : '',
  }),
}

/** Position: the stop shares the target's time (and offset/tf). */
const position = {
  type: 'position',
  anchors: 3,
  defaultStyle: { ...STYLE, lineWidth: 1 },
  defaultOptions: { side: 'long', qty: null },
  normalizeOptions: (raw) => ({
    side: SIDE.has(raw.side) ? raw.side : 'long',
    qty: Number.isFinite(raw.qty) && raw.qty > 0 ? raw.qty : null,
  }),
  normalizePoints(points) {
    const t = points[1]
    const s = { time: t.time, price: points[2].price }
    if (t.offset !== undefined) s.offset = t.offset
    if (t.tf !== undefined) s.tf = t.tf
    return [points[0], points[1], s]
  },
}

const horizontalLine = {
  type: 'horizontalLine',
  anchors: 1,
  defaultStyle: { ...STYLE, lineWidth: 1 },
  defaultOptions: { levels: [0, 0.5, 1] },
  normalizeOptions: (raw) => ({ levels: Array.isArray(raw.levels) ? raw.levels.filter(Number.isFinite) : [0, 0.5, 1] }),
}

const registry = makeRegistry([trendLine, position, horizontalLine])

const T = 1_700_000_000_000
const MIN = 60_000
const line = (extra = {}) => ({ type: 'trendLine', points: [{ time: T, price: 100 }, { time: T + 5 * MIN, price: 110 }], ...extra })
const load = (input, opts) => normalizeEntries(input, registry, opts)
const out = (input, opts) => load(input, opts).entries.map(toJSON)

// ------------------------------------------------------------------ coercion

test('numeric strings are accepted for time and price, and time is rounded', () => {
  const [d] = out([{ id: 'a', type: 'trendLine', points: [{ time: String(T) + '.4', price: '100.25' }, { time: T, price: 1 }] }])
  assert.deepEqual(d.points[0], { time: T, price: 100.25 })
})

test('a null, boolean or NaN point field rejects the drawing instead of pinning it to the epoch', () => {
  for (const bad of [null, true, false, NaN, 'soon', {}, undefined]) {
    const { entries, report } = load([{ id: 'x', type: 'trendLine', points: [{ time: bad, price: 1 }, { time: T, price: 1 }] }])
    assert.equal(entries.length, 0, `time ${String(bad)} rejected`)
    assert.deepEqual(report.rejected, [{ index: 0, id: 'x', reason: 'bad point' }])
  }
  const { report } = load([line({ points: [{ time: T, price: null }, { time: T, price: 1 }] })])
  assert.equal(report.rejected[0].reason, 'bad point')
})

test('offset and tf are kept independently, and dropped when zero or unreadable', () => {
  const [d] = out([
    {
      type: 'trendLine',
      points: [
        { time: T, price: 1, offset: -3, tf: 'abc' },
        { time: T, price: 2, offset: 0, tf: 300000 },
      ],
    },
  ])
  assert.deepEqual(d.points, [{ time: T, price: 1, offset: -3 }, { time: T, price: 2, tf: 300000 }])
})

test('the point count is enforced: too few rejects, extra points are truncated and reported', () => {
  const few = load([{ id: 'f', type: 'trendLine', points: [{ time: T, price: 1 }] }])
  assert.equal(few.report.rejected[0].reason, 'too few points')
  const many = load([{ id: 'm', type: 'trendLine', points: [1, 2, 3].map((i) => ({ time: T + i, price: i })) }])
  assert.equal(many.entries[0].points.length, 2)
  assert.deepEqual(many.report.truncated, ['m'])
  assert.equal(load([{ id: 'n', type: 'trendLine', points: 'none' }]).report.rejected[0].reason, 'bad point')
})

test('style is clamped to what the renderer can draw, and bad values fall back to the tool default', () => {
  const [d] = out([
    line({
      style: {
        color: 'x'.repeat(65),
        lineWidth: 99,
        lineStyle: 'wavy',
        fill: '#abc',
        fillOpacity: -1,
        textColor: null,
        fontSize: '2',
      },
    }),
  ])
  assert.deepEqual(d.style, { color: null, lineWidth: 8, lineStyle: 'solid', fill: '#abc', fillOpacity: 0, textColor: null, fontSize: 9 })
  const [e] = out([line({ style: { lineWidth: 0.1, lineStyle: 'dotted', fontSize: 40, color: '#fff' } })])
  assert.equal(e.style.lineWidth, 0.5)
  assert.equal(e.style.lineStyle, 'dotted')
  assert.equal(e.style.fontSize, 32)
  assert.equal(e.style.color, '#fff')
})

test('pane defaults to price, locked is only true for true, visible only false for false', () => {
  const [d] = out([line({ id: 'a', locked: 'yes', visible: 0 })])
  assert.equal(d.pane, 'price')
  assert.equal(d.locked, false)
  assert.equal(d.visible, true)
  const [e] = out([line({ id: 'b', pane: 'rsi', locked: true, visible: false })])
  assert.deepEqual([e.pane, e.locked, e.visible], ['rsi', true, false])
})

test('meta is a clone: mutating the input afterwards changes nothing stored', () => {
  const meta = { tradeId: 7, tags: ['a'] }
  const { entries } = load([line({ id: 'a', meta })])
  meta.tags.push('b')
  assert.deepEqual(toJSON(entries[0]).meta, { tradeId: 7, tags: ['a'] })
  const again = toJSON(entries[0])
  again.meta.tags.push('c')
  assert.deepEqual(toJSON(entries[0]).meta.tags, ['a'], 'the output is a clone too')
})

test('the stored form has a fixed key order', () => {
  const [d] = out([line({ id: 'a', meta: 1 })])
  assert.deepEqual(Object.keys(d), ['v', 'id', 'type', 'pane', 'points', 'style', 'options', 'locked', 'visible', 'z', 'meta'])
  assert.deepEqual(Object.keys(d.style), ['color', 'lineWidth', 'lineStyle', 'fill', 'fillOpacity', 'textColor', 'fontSize'])
  assert.equal(d.v, SCHEMA_VERSION)
})

// ------------------------------------------------------------------ ids

test('a missing id is derived from type and first point, identically on every load', () => {
  const a = out([line()])[0].id
  const b = out([line()])[0].id
  assert.equal(a, `trendLine:${T}:100`)
  assert.equal(a, b)
  assert.equal(derivedId('trendLine', { time: String(T), price: '100' }), a, 'coerced values')
})

test('two-pass de-dup: a renamed duplicate never takes an id a later row was stored under', () => {
  const { entries, report } = load([line({ id: 'a' }), line({ id: 'a' }), line({ id: 'a:1' })])
  assert.deepEqual(
    entries.map((e) => e.id),
    ['a', 'a:2', 'a:1'],
  )
  assert.deepEqual(report.renamed, [{ index: 1, from: 'a', to: 'a:2' }])
})

test('derived ids that collide are renamed and reported', () => {
  const { entries, report } = load([line(), line()])
  assert.deepEqual(
    entries.map((e) => e.id),
    [`trendLine:${T}:100`, `trendLine:${T}:100:1`],
  )
  assert.equal(report.renamed.length, 1)
})

test('numeric ids become strings; unusable ids are replaced and reported', () => {
  const { entries, report } = load([line({ id: 42 }), line({ id: '' }), line({ id: 'x'.repeat(129) })])
  assert.equal(entries[0].id, '42')
  assert.equal(entries[1].id, `trendLine:${T}:100`)
  assert.deepEqual(report.renamed[0], { index: 1, from: null, to: `trendLine:${T}:100` })
  assert.ok(entries[2].id.length <= 128)
})

test('a rejected row gives its id back, so a later duplicate keeps the plain id', () => {
  const { entries, report } = load([{ id: 'a', type: 'trendLine', points: [] }, line({ id: 'a' })])
  assert.deepEqual(entries.map((e) => e.id), ['a'])
  assert.deepEqual(report.renamed, [])
})

test('renaming a maximum-length id keeps it within the length limit', () => {
  const long = 'q'.repeat(128)
  const { entries } = load([line({ id: long }), line({ id: long })])
  assert.equal(entries[1].id.length, 128)
  assert.ok(entries[1].id.endsWith(':1'))
  assert.deepEqual(out(entries.map(toJSON)).map((d) => d.id), entries.map((e) => e.id), 'stable on reload')
})

test('generated ids are unique per factory even on a frozen clock, and deterministic when injected', () => {
  const make = makeIdFactory(() => 0.5, () => 1_700_000_000_000)
  const a = make()
  const b = make()
  assert.notEqual(a, b)
  assert.match(a, /^d[0-9a-z]+$/)
  const again = makeIdFactory(() => 0.5, () => 1_700_000_000_000)
  assert.equal(again(), a)
  const hostile = makeIdFactory(() => NaN, () => NaN)
  assert.match(hostile(), /^d[0-9a-z]+$/)
})

// ------------------------------------------------------------------ carried data (D12)

test('an unknown type and a newer version are carried inert and re-emitted verbatim in their z-slot', () => {
  const future = { v: 2, id: 'f', type: 'trendLine', points: 'new-format', z: 1.5, shiny: { a: 1 } }
  const alien = { id: 'u', type: 'pitchfork', points: [{ time: T, price: 1 }], z: 0.5, x: [1, 2] }
  const { entries, report } = load([line({ id: 'a', z: 1 }), future, alien, line({ id: 'b', z: 2 })])
  assert.deepEqual(entries.map((e) => e.id), ['u', 'a', 'f', 'b'])
  assert.deepEqual(report.carried, ['f', 'u'])
  assert.equal(report.loaded, 2)
  const json = entries.map(toJSON)
  assert.deepEqual(json[0], alien)
  assert.deepEqual(json[2], future)
  assert.equal(entries[2].inert, true)
  assert.ok(Object.isFrozen(entries[2].raw))
})

test('an inert row without an id or z is given them, so every row a host gets back is addressable', () => {
  const { entries } = load([{ type: 'brush', points: [{ time: T, price: 3 }] }])
  const [raw] = entries.map(toJSON)
  assert.equal(raw.id, `brush:${T}:3`)
  assert.equal(raw.z, 0)
})

test('versions that are not a known integer are carried, and an absent v reads as 1', () => {
  for (const v of [2, 1.5, '1', null, 0, true]) {
    const { entries } = load([line({ id: 'a', v })])
    assert.equal(entries[0].inert, true, `v ${JSON.stringify(v)} carried`)
  }
  assert.equal(load([line({ id: 'a' })]).entries[0].inert, undefined)
  assert.equal(load([line({ id: 'a', v: 1 })]).entries[0].v, 1)
})

test('a missing type is rejected, not carried', () => {
  for (const type of [undefined, null, '']) {
    const { report } = load([{ id: 'a', type, points: [] }])
    assert.equal(report.rejected[0].reason, 'no type')
  }
})

test('unknown keys at top level, in style and in options survive load -> drag commit -> toJSON', () => {
  const row = JSON.parse(
    `{"id":"a","type":"trendLine","points":[{"time":${T},"price":1},{"time":${T},"price":2}],` +
      `"style":{"color":"#f00","glow":3},"options":{"extend":"right","magnetism":"x"},` +
      `"alerts":[{"above":5}],"__proto__":{"polluted":true}}`,
  )
  const { entries } = load([row])
  const dragged = applyPatch(entries[0], { points: [{ time: T + MIN, price: 5 }, { time: T + 2 * MIN, price: 6 }] }, registry)
  const saved = toJSON(dragged)
  assert.equal(saved.style.glow, 3)
  assert.equal(saved.options.magnetism, 'x')
  assert.deepEqual(saved.alerts, [{ above: 5 }])
  assert.deepEqual(Object.getOwnPropertyDescriptor(saved, '__proto__').value, { polluted: true })
  assert.equal(Object.getPrototypeOf(saved), Object.prototype, 'no prototype swap')
  assert.equal({}.polluted, undefined, 'Object.prototype untouched')
  assert.equal(saved.points[0].price, 5)
  // Carried keys come after the known keys of the same object.
  assert.deepEqual(Object.keys(saved).slice(-2), ['alerts', '__proto__'])
  assert.deepEqual(Object.keys(saved.options), ['extend', 'text', 'magnetism'])
})

test('carried keys over 16 KB are dropped and the drawing is reported truncated', () => {
  const { entries, report } = load([line({ id: 'big', blob: 'x'.repeat(17000) })])
  assert.equal(toJSON(entries[0]).blob, undefined)
  assert.deepEqual(report.truncated, ['big'])
})

test('options are rebuilt from known keys only', () => {
  const [d] = out([line({ options: { extend: 'sideways', constructor: 1, prototype: 2 } })])
  assert.equal(d.options.extend, 'none')
  assert.equal(Object.getOwnPropertyDescriptor(d.options, 'constructor').value, 1, 'carried, as an inert own key')
  const e = load([line({ options: { extend: 'sideways' } })]).entries[0]
  assert.deepEqual(e.options, { extend: 'none', text: '' })
})

// ------------------------------------------------------------------ position invariant

const pos = (p2) => ({
  id: 'p',
  type: 'position',
  points: [
    { time: T, price: 100 },
    { time: T + 30 * MIN, price: 110, offset: 4, tf: MIN },
    { time: T + 9 * MIN, price: 95, ...p2 },
  ],
})

test("position: the stop's time, offset and tf are forced to the target's on load", () => {
  const [d] = out([pos({ offset: 7 })])
  assert.deepEqual(d.points[2], { time: T + 30 * MIN, price: 95, offset: 4, tf: MIN })
})

test("position: the stop's time is forced to the target's on add", () => {
  const d = normalizeInput(pos({}), registry, 'p', 3)
  assert.deepEqual(d.points[2], { time: T + 30 * MIN, price: 95, offset: 4, tf: MIN })
})

test("position: the stop's time is forced to the target's on every patch", () => {
  const d = normalizeInput(pos({}), registry, 'p', 3)
  const moved = applyPatch(
    d,
    { points: [{ time: T, price: 100 }, { time: T + 40 * MIN, price: 111 }, { time: T, price: 90 }] },
    registry,
  )
  assert.deepEqual(toJSON(moved).points[2], { time: T + 40 * MIN, price: 90 })
})

// ------------------------------------------------------------------ document shape

test('entries are stable-sorted by z; a missing z is the input index', () => {
  const { entries } = load([line({ id: 'a', z: 5 }), line({ id: 'b' }), line({ id: 'c', z: 1 }), line({ id: 'd', z: 5 })])
  // b has no z, so it sits at its index (1) and ties with c: document order wins.
  assert.deepEqual(entries.map((e) => e.id), ['b', 'c', 'a', 'd'])
  assert.equal(entries[0].z, 1)
})

test('a JSON string, { drawings: [...] }, null and undefined are all documents', () => {
  const json = JSON.stringify([line({ id: 'a' })])
  assert.equal(load(json).entries[0].id, 'a')
  assert.equal(load({ drawings: [line({ id: 'b' })] }).entries[0].id, 'b')
  assert.equal(load(JSON.stringify({ drawings: [line({ id: 'c' })] })).entries[0].id, 'c')
  assert.deepEqual(load(null).entries, [])
  assert.deepEqual(load(undefined).entries, [])
  assert.deepEqual(load('null').entries, [])
})

test('a JSON parse failure throws rather than loading an empty document', () => {
  assert.throws(() => load('[{"id":'), SyntaxError)
  assert.throws(() => load(42), TypeError)
  assert.throws(() => load({ drawings: 'nope' }), TypeError)
})

test('beyond maxDrawings the rest are rejected with reason limit', () => {
  const rows = Array.from({ length: 5 }, (_, i) => line({ id: 'r' + i }))
  const { entries, report } = load(rows, { maxDrawings: 3 })
  assert.equal(entries.length, 3)
  assert.deepEqual(report.rejected, [{ index: 3, reason: 'limit' }, { index: 4, reason: 'limit' }])
  assert.equal(load(Array.from({ length: 5001 }, (_, i) => line({ id: 'r' + i }))).report.rejected.length, 1, 'default 5000')
})

test('a cyclic item, a BigInt and a throwing getter each reject only themselves', () => {
  const cyclic = line({ id: 'c' })
  cyclic.self = cyclic
  const hostile = line({ id: 'h' })
  Object.defineProperty(hostile, 'style', { enumerable: true, get() { throw new Error('boom') } })
  const big = line({ id: 'b', n: 10n })
  const { entries, report } = load([cyclic, line({ id: 'ok' }), hostile, big])
  assert.deepEqual(entries.map((e) => e.id), ['ok'])
  assert.deepEqual(report.rejected, [
    { index: 0, reason: 'not serialisable' },
    { index: 2, reason: 'threw while reading' },
    { index: 3, reason: 'not serialisable' },
  ])
})

test('a throwing array element getter rejects that element only', () => {
  const list = [line({ id: 'a' }), null]
  Object.defineProperty(list, 1, { get() { throw new Error('boom') } })
  const { entries, report } = load(list)
  assert.equal(entries.length, 1)
  assert.deepEqual(report.rejected, [{ index: 1, reason: 'threw while reading' }])
})

test('non-objects are rejected as not an object', () => {
  const { report } = load([1, 'x', null, [], () => 1])
  assert.equal(report.rejected.length, 5)
  assert.ok(report.rejected.every((r) => r.reason === 'not an object'))
})

test('a custom tool whose normalizeOptions throws costs that drawing, not the document', () => {
  const broken = { type: 'broken', anchors: 1, defaultStyle: STYLE, normalizeOptions() { throw new Error('bug') } }
  const reg = makeRegistry([trendLine, broken])
  const { entries, report } = normalizeEntries([{ id: 'x', type: 'broken', points: [{ time: T, price: 1 }] }, line({ id: 'a' })], reg)
  assert.deepEqual(entries.map((e) => e.id), ['a'])
  assert.equal(report.rejected[0].reason, 'bad options')
})

test('output is deep-frozen, including points, style, options and the carried-keys bag', () => {
  const [d] = load([line({ id: 'a', style: { glow: { a: 1 } }, meta: { k: [1] } })]).entries
  assert.ok(Object.isFrozen(d))
  assert.ok(Object.isFrozen(d.points[0]))
  assert.ok(Object.isFrozen(d.style))
  assert.ok(Object.isFrozen(d.options))
  assert.ok(Object.isFrozen(d.meta.k))
  assert.ok(Object.isFrozen(d.extra.style.glow))
  assert.throws(() => { d.points[0].price = 1 }, TypeError)
  assert.equal(Object.keys(d).includes('extra'), false, 'extra is not an enumerable key')
  assert.equal(JSON.stringify(d).includes('glow'), false)
})

test('deepFreeze survives a cycle', () => {
  const a = { b: {} }
  a.b.a = a
  assert.equal(deepFreeze(a), a)
  assert.ok(Object.isFrozen(a.b))
})

test('normalize(normalize(x)) equals normalize(x)', () => {
  const input = [
    line({ id: 'a', z: 3, style: { glow: 1 }, zz: 1 }),
    line(),
    line(),
    pos({}),
    { type: 'alien', points: [] },
    { v: 9, id: 'a' },
    line({ id: 'a' }),
  ]
  const first = out(input)
  assert.deepEqual(out(first), first)
})

// ------------------------------------------------------------------ programmer paths

test('normalizeInput throws the reason a load would report', () => {
  assert.throws(() => normalizeInput(line({ points: [{ time: NaN, price: 1 }, { time: T, price: 1 }] }), registry, 'a', 0), /bad point/)
  assert.throws(() => normalizeInput(line({ points: [{ time: T, price: 1, offset: NaN }, { time: T, price: 1 }] }), registry, 'a', 0), /bad point/)
  assert.throws(() => normalizeInput(line({ points: [{ time: T, price: 1, tf: Infinity }, { time: T, price: 1 }] }), registry, 'a', 0), /bad point/)
  assert.throws(() => normalizeInput({ type: 'trendLine', points: [] }, registry, 'a', 0), /too few points/)
  assert.throws(() => normalizeInput({ points: [] }, registry, 'a', 0), /no type/)
  assert.throws(() => normalizeInput({ type: 'brush', points: [] }, registry, 'a', 0), /unknown type "brush"/)
  assert.throws(() => normalizeInput(line({ v: 2 }), registry, 'a', 0), /unsupported schema version 2/)
  assert.throws(() => normalizeInput('x', registry, 'a', 0), /not an object/)
  assert.throws(() => normalizeInput(line(), registry, '', 0), /bad id/)
})

test('normalizeInput takes the given id, and the given z unless the input has one', () => {
  const d = normalizeInput(line({ id: 'ignored' }), registry, 'mine', 7)
  assert.equal(d.id, 'mine')
  assert.equal(d.z, 7)
  assert.equal(normalizeInput(line({ z: 2 }), registry, 'mine', 7).z, 2)
  assert.ok(Object.isFrozen(d))
})

test('applyPatch throws on id, type or v in the patch', () => {
  const d = normalizeInput(line(), registry, 'a', 0)
  for (const k of ['id', 'type', 'v']) {
    assert.throws(() => applyPatch(d, { [k]: 'x' }, registry), new RegExp(`cannot patch ${k}`))
  }
})

test('applyPatch throws on any non-finite point field, so NaN never reaches the store', () => {
  const d = normalizeInput(line(), registry, 'a', 0)
  const at = (p) => ({ points: [p, { time: T, price: 1 }] })
  assert.throws(() => applyPatch(d, at({ time: T, price: NaN }), registry), /bad point/)
  assert.throws(() => applyPatch(d, at({ time: T, price: 1, offset: NaN }), registry), /bad point/)
  assert.throws(() => applyPatch(d, at({ time: T, price: 1, tf: -Infinity }), registry), /bad point/)
  assert.throws(() => applyPatch(d, { points: [{ time: T, price: 1 }] }, registry), /too few points/)
  assert.throws(() => applyPatch(d, { z: 'top' }, registry), /bad z/)
  assert.throws(() => applyPatch(d, { style: 'red' }, registry), /bad style/)
})

test('normalizeDrawing reports into the context it is given', () => {
  const report = emptyReport()
  const reserved = new Map()
  const e = normalizeDrawing(line({ id: 'a' }), 0, registry, { reserved, report })
  assert.equal(e.id, 'a')
  assert.equal(report.loaded, 1)
  assert.equal(reserved.get('a'), 0)
  assert.equal(normalizeDrawing(line({ id: 'a' }), 1, registry, { reserved, report }).id, 'a:1')
})

test('sameDrawing compares the stored form, carried keys included', () => {
  const [a] = load([line({ id: 'a', glow: 1 })]).entries
  const [b] = load([line({ id: 'a', glow: 1 })]).entries
  const [c] = load([line({ id: 'a', glow: 2 })]).entries
  assert.ok(sameDrawing(a, b))
  assert.ok(!sameDrawing(a, c))
  assert.ok(!sameDrawing(a, null))
})

// ------------------------------------------------------------------ fuzz

/** Hostile data, deterministic: the same seed builds the same 2,000 items. */
function hostileItems(seed, count) {
  const rnd = mulberry32(seed)
  const pickOne = (list) => list[Math.floor(rnd() * list.length)]
  const maybe = (p) => rnd() < p
  const num = () =>
    pickOne([T, T + 60000, String(T), -0.4, 0, 1e308, -1e308, NaN, Infinity, null, true, 'abc', '', {}, [], 12.5, '3.5', -7])
  const good = () => pickOne([T, T + 60000, T - 1.4, String(T), 12.5, '3.5', -7, 0])
  const point = () => {
    if (maybe(0.05)) return pickOne([null, 1, 'p', []])
    // Mostly readable, so plenty of drawings load and the round trip is
    // exercised on real output rather than on an empty document.
    const p = { time: maybe(0.9) ? good() : num(), price: maybe(0.9) ? good() : num() }
    if (maybe(0.3)) p.offset = maybe(0.7) ? pickOne([3, -2, 0.5, -0.25]) : num()
    if (maybe(0.3)) p.tf = maybe(0.7) ? pickOne([60000, 300000]) : num()
    return p
  }
  const items = []
  for (let i = 0; i < count; i++) {
    if (maybe(0.05)) {
      items.push(pickOne([null, 1, 'str', true, [], [1, 2], undefined]))
      continue
    }
    const o = {}
    if (maybe(0.9)) o.type = pickOne(['trendLine', 'trendLine', 'position', 'horizontalLine', 'alien', '', null, 5])
    if (maybe(0.3)) o.v = pickOne([1, 2, 1.5, '1', null, 0, -1])
    if (maybe(0.7)) o.id = pickOne(['a', 'b', 'a:1', 'a:2', '', 5, 'x'.repeat(130), {}, null, 'q'.repeat(128)])
    if (maybe(0.9)) o.points = maybe(0.1) ? pickOne([null, 'x', {}]) : Array.from({ length: Math.floor(rnd() * 5) }, point)
    if (maybe(0.5)) o.style = { color: pickOne(['#f00', null, 7, 'x'.repeat(70)]), lineWidth: num(), lineStyle: pickOne(['dashed', 'wavy', null]), glow: num() }
    if (maybe(0.5)) o.options = { extend: pickOne(['left', 'nope', null]), side: pickOne(['short', 'x']), qty: num(), junk: num() }
    if (maybe(0.4)) o.z = num()
    if (maybe(0.2)) o.pane = pickOne(['rsi', '', 0, [], null, {}])
    if (maybe(0.2)) o.locked = pickOne([true, 'true', 1])
    if (maybe(0.2)) o.meta = pickOne([{ a: [1] }, null, 'm'])
    if (maybe(0.1)) Object.defineProperty(o, '__proto__', { value: { polluted: i }, enumerable: true, writable: true, configurable: true })
    if (maybe(0.05)) o.self = o
    if (maybe(0.03)) Object.defineProperty(o, 'boom', { enumerable: true, get() { throw new Error('boom') } })
    if (maybe(0.02)) o.big = 1n
    if (maybe(0.02)) o.huge = 'h'.repeat(17000)
    items.push(o)
  }
  return items
}

test('fuzz: 2,000 hostile items never throw, always account for every item, and re-normalise to themselves', () => {
  for (const seed of [1, 2, 3]) {
    const items = hostileItems(seed, 2000)
    let result
    assert.doesNotThrow(() => { result = load(items) })
    const { entries, report } = result
    assert.equal(report.loaded + report.carried.length + report.rejected.length, items.length, `seed ${seed}: invariant`)
    assert.equal(entries.length, report.loaded + report.carried.length)
    assert.equal(new Set(entries.map((e) => e.id)).size, entries.length, 'ids are unique')
    for (let i = 1; i < entries.length; i++) assert.ok(entries[i - 1].z <= entries[i].z, 'z order')
    for (const e of entries) assert.ok(Object.isFrozen(e))
    const first = entries.map(toJSON)
    const second = out(first)
    assert.deepEqual(second, first, `seed ${seed}: idempotent`)
    assert.equal({}.polluted, undefined, 'Object.prototype untouched')
  }
})
