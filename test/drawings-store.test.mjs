/**
 * The drawing document: per-id changes over immutable drawings.
 *
 * What the controller relies on: an old `list` is a snapshot that never
 * changes under it (batch rollback, undo), a change is described per id in the
 * shape the `change` event carries, and a patch merges the way update()
 * documents — without dropping anything a newer build stored.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DrawingStore, diff } from '../src/drawings/model/store.js'
import { normalizeEntries, normalizeInput, applyPatch, toJSON, sameDrawing, makeRegistry } from '../src/drawings/model/schema.js'

const STYLE = { color: null, lineWidth: 1.5, lineStyle: 'solid', fill: null, fillOpacity: 0.12, textColor: null, fontSize: 12 }
const trendLine = {
  type: 'trendLine',
  anchors: 2,
  defaultStyle: STYLE,
  normalizeOptions: (raw) => ({ extend: ['none', 'right'].includes(raw.extend) ? raw.extend : 'none', text: raw.text != null ? String(raw.text) : '' }),
}
const fib = {
  type: 'fibRetracement',
  anchors: 2,
  defaultStyle: STYLE,
  normalizeOptions: (raw) => ({
    levels: Array.isArray(raw.levels) ? raw.levels.filter((l) => Number.isFinite(l && l.value)) : [{ value: 0 }, { value: 0.5 }, { value: 1 }],
    reverse: raw.reverse === true,
  }),
}
const registry = makeRegistry([trendLine, fib])

const T = 1_700_000_000_000
const make = (id, z, extra = {}) =>
  normalizeInput({ type: 'trendLine', points: [{ time: T, price: 1 }, { time: T + 60000, price: 2 }], z, ...extra }, registry, id, z)

const ids = (store) => store.list.map((e) => e.id)

// ------------------------------------------------------------------ store

test('put inserts in z order, replaces in place, and removes with null', () => {
  const s = new DrawingStore()
  s.put('b', make('b', 2))
  s.put('a', make('a', 1))
  s.put('c', make('c', 3))
  assert.deepEqual(ids(s), ['a', 'b', 'c'])
  s.put('b', applyPatch(s.get('b'), { style: { color: '#f00' } }, registry))
  assert.deepEqual(ids(s), ['a', 'b', 'c'])
  assert.equal(s.get('b').style.color, '#f00')
  s.put('a', null)
  assert.deepEqual(ids(s), ['b', 'c'])
  assert.equal(s.get('a'), null)
  assert.equal(s.has('a'), false)
  s.put('missing', null) // removing an absent id is a no-op
  assert.deepEqual(ids(s), ['b', 'c'])
})

test('a new z moves the drawing; an unchanged z keeps its slot among equal-z neighbours', () => {
  const s = new DrawingStore()
  s.replaceAll([make('a', 1), make('b', 1), make('c', 1)])
  s.put('a', applyPatch(s.get('a'), { text: 'x' }, registry))
  assert.deepEqual(ids(s), ['a', 'b', 'c'], 'same z keeps its slot')
  s.put('a', applyPatch(s.get('a'), { z: s.maxZ() + 1 }, registry))
  assert.deepEqual(ids(s), ['b', 'c', 'a'], 'bring to front')
  s.put('c', applyPatch(s.get('c'), { z: s.minZ() - 1 }, registry))
  assert.deepEqual(ids(s), ['c', 'b', 'a'], 'send to back')
  s.put('d', make('d', 1))
  assert.deepEqual(ids(s), ['c', 'b', 'd', 'a'], 'a newcomer goes after its equal-z neighbours')
})

test('every change makes a new frozen list; an old snapshot never changes', () => {
  const s = new DrawingStore()
  s.put('a', make('a', 1))
  const snap = s.list
  const a0 = s.get('a')
  s.put('b', make('b', 2))
  s.put('a', applyPatch(a0, { points: [{ time: T, price: 5 }, { time: T, price: 6 }] }, registry))
  assert.deepEqual(snap.map((e) => e.id), ['a'])
  assert.equal(snap[0], a0)
  assert.equal(a0.points[0].price, 1, 'the drawing itself is untouched')
  assert.notEqual(s.list, snap)
  assert.ok(Object.isFrozen(s.list))
  assert.throws(() => s.list.push(make('x', 0)), TypeError)
})

test('replaceAll restores a snapshot exactly, and refuses duplicate ids', () => {
  const s = new DrawingStore()
  s.replaceAll([make('b', 2), make('a', 1)])
  const snap = s.list
  s.put('c', make('c', 3))
  s.put('a', null)
  s.replaceAll(snap)
  assert.deepEqual(ids(s), ['a', 'b'])
  assert.equal(s.get('a'), snap[0])
  assert.equal(s.has('c'), false)
  assert.throws(() => s.replaceAll([make('a', 1), make('a', 2)]), /duplicate id "a"/)
  assert.deepEqual(ids(s), ['a', 'b'], 'nothing changed on the throw')
})

test('inert entries live in the store and count for has()', () => {
  const { entries } = normalizeEntries([{ id: 'x', type: 'brush', points: [] }, { id: 'a', type: 'trendLine', points: [{ time: T, price: 1 }, { time: T, price: 2 }] }], registry)
  const s = new DrawingStore()
  s.replaceAll(entries)
  assert.equal(s.has('x'), true)
  assert.equal(s.get('x').inert, true)
  assert.equal(s.size, 2)
})

test('put refuses a drawing filed under another id', () => {
  const s = new DrawingStore()
  assert.throws(() => s.put('a', make('b', 1)), /given drawing "b"/)
})

test('maxZ and minZ are 0 on an empty document', () => {
  const s = new DrawingStore()
  assert.equal(s.maxZ(), 0)
  assert.equal(s.minZ(), 0)
  s.replaceAll([make('a', -4), make('b', 9)])
  assert.equal(s.maxZ(), 9)
  assert.equal(s.minZ(), -4)
})

// ------------------------------------------------------------------ diff

test('an operation diffed per id yields created, updated and removed', () => {
  const s = new DrawingStore()
  s.replaceAll([make('a', 1), make('b', 2)])
  const touched = ['a', 'b', 'c']
  const before = new Map(touched.map((id) => [id, s.get(id)]))
  const a1 = applyPatch(s.get('a'), { style: { lineWidth: 3 } }, registry)
  s.put('a', a1)
  s.put('b', null)
  s.put('c', make('c', 3))
  const after = new Map(touched.map((id) => [id, s.get(id)]))
  const change = diff(before, after)
  assert.deepEqual(change.created.map((d) => d.id), ['c'])
  assert.deepEqual(change.removed.map((d) => d.id), ['b'])
  assert.equal(change.updated.length, 1)
  assert.equal(change.updated[0].before, before.get('a'))
  assert.equal(change.updated[0].after, a1)
})

test('diff ignores ids whose two sides are deep-equal, and never reports inert entries', () => {
  const a = make('a', 1)
  const same = applyPatch(a, {}, registry)
  assert.notEqual(same, a)
  const { entries } = normalizeEntries([{ id: 'x', type: 'brush', points: [] }], registry)
  const change = diff(new Map([['a', a], ['x', null]]), new Map([['a', same], ['x', entries[0]]]))
  assert.deepEqual(change, { created: [], updated: [], removed: [] })
})

test('diff treats an id missing from one map as absent', () => {
  const a = make('a', 1)
  assert.deepEqual(diff(new Map(), new Map([['a', a]])).created, [a])
  assert.deepEqual(diff(new Map([['a', a]]), new Map()).removed, [a])
})

// ------------------------------------------------------------------ sameDrawing

test('sameDrawing sees a change to a carried key, and ignores identity', () => {
  const [a] = normalizeEntries([{ id: 'a', type: 'trendLine', points: [{ time: T, price: 1 }, { time: T, price: 2 }], style: { glow: 1 } }], registry).entries
  const b = applyPatch(a, { style: { glow: 1 } }, registry)
  const c = applyPatch(a, { style: { glow: 2 } }, registry)
  assert.ok(sameDrawing(a, b))
  assert.ok(!sameDrawing(a, c))
})

// ------------------------------------------------------------------ applyPatch merge rules

const loadFib = () =>
  normalizeEntries(
    [
      {
        id: 'f',
        type: 'fibRetracement',
        points: [{ time: T, price: 100 }, { time: T + 60000, price: 200 }],
        style: { color: '#123', lineWidth: 2, halo: true },
        options: { levels: [{ value: 0 }, { value: 1 }], reverse: true, labelsV2: 'x' },
        meta: { a: 1 },
        pane: 'price',
        alerts: [1],
      },
    ],
    registry,
  ).entries[0]

test('points are replaced whole', () => {
  const d = loadFib()
  const e = applyPatch(d, { points: [{ time: T + 5, price: 1 }, { time: T + 6, price: 2, offset: 3, tf: 60000 }] }, registry)
  assert.deepEqual(toJSON(e).points, [{ time: T + 5, price: 1 }, { time: T + 6, price: 2, offset: 3, tf: 60000 }])
})

test('style merges per key, keeping the keys the patch does not mention', () => {
  const e = toJSON(applyPatch(loadFib(), { style: { lineWidth: 4, color: null } }, registry))
  assert.equal(e.style.lineWidth, 4)
  assert.equal(e.style.color, null, 'null means follow the theme')
  assert.equal(e.style.halo, true, 'carried style key kept')
})

test('options merge per key; a levels array is replaced wholesale', () => {
  const e = toJSON(applyPatch(loadFib(), { options: { levels: [{ value: 0.618 }] } }, registry))
  assert.deepEqual(e.options.levels, [{ value: 0.618 }])
  assert.equal(e.options.reverse, true, 'untouched option kept')
  assert.equal(e.options.labelsV2, 'x', 'carried option kept')
})

test('pane, locked, visible and meta are replaced; unknown patch keys are carried', () => {
  const e = toJSON(applyPatch(loadFib(), { pane: 'rsi', locked: true, visible: false, meta: { b: 2 }, note: 'n' }, registry))
  assert.deepEqual([e.pane, e.locked, e.visible], ['rsi', true, false])
  assert.deepEqual(e.meta, { b: 2 })
  assert.equal(e.note, 'n')
  assert.deepEqual(e.alerts, [1], 'carried top-level key kept')
})

test('a patch never mutates the drawing it was given, and the result is frozen', () => {
  const d = loadFib()
  const before = JSON.stringify(toJSON(d))
  const e = applyPatch(d, { style: { lineWidth: 5 }, options: { reverse: false } }, registry)
  assert.equal(JSON.stringify(toJSON(d)), before)
  assert.ok(Object.isFrozen(e))
  assert.equal(e.id, d.id)
  assert.equal(e.z, d.z)
})

test('an empty patch normalises to a deep-equal drawing (the controller treats it as a no-op)', () => {
  const d = loadFib()
  assert.ok(sameDrawing(d, applyPatch(d, {}, registry)))
  assert.ok(sameDrawing(d, applyPatch(d, { style: { lineWidth: 2 } }, registry)))
})

test('an inert entry cannot be patched', () => {
  const { entries } = normalizeEntries([{ id: 'x', type: 'brush', points: [] }], registry)
  assert.throws(() => applyPatch(entries[0], {}, registry), /carried/)
})
