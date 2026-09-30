/**
 * Undo/redo over per-id diffs.
 *
 * The property that matters most is the one a whole-document snapshot gets
 * wrong: undoing MY drag must not revert what the host did meanwhile to
 * OTHER drawings with { history: false } — an alert line the backend moved,
 * a drawing another tab synced in.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { History } from '../src/drawings/model/history.js'
import { DrawingStore } from '../src/drawings/model/store.js'
import { normalizeInput, applyPatch, makeRegistry } from '../src/drawings/model/schema.js'

const STYLE = { color: null, lineWidth: 1, lineStyle: 'solid', fill: null, fillOpacity: 0.12, textColor: null, fontSize: 12 }
const registry = makeRegistry([{ type: 'horizontalLine', anchors: 1, defaultStyle: STYLE, normalizeOptions: () => ({}) }])
const T = 1_700_000_000_000

const hline = (id, price, z = 0) => normalizeInput({ type: 'horizontalLine', points: [{ time: T, price }] }, registry, id, z)
const priceOf = (store, id) => store.get(id).points[0].price

/**
 * What the controller does for one committed operation: snapshot the touched
 * ids, apply, snapshot again, record.
 */
function commit(store, history, ops, extra = {}) {
  const ids = Object.keys(ops)
  const before = new Map(ids.map((id) => [id, store.get(id)]))
  for (const id of ids) store.put(id, ops[id])
  const after = new Map(ids.map((id) => [id, store.get(id)]))
  history.push({ before, after, selBefore: [], selAfter: [], reason: 'move', ...extra })
}
const move = (store, id, price) => applyPatch(store.get(id), { points: [{ time: T, price }] }, registry)

function setup() {
  const store = new DrawingStore()
  store.replaceAll([hline('a', 10, 1), hline('b', 20, 2), hline('c', 30, 3)])
  return { store, history: new History(100) }
}

test('undo and redo restore the exact drawing objects, in their z slot', () => {
  const { store, history } = setup()
  const a0 = store.get('a')
  commit(store, history, { a: move(store, 'a', 11) })
  const a1 = store.get('a')
  commit(store, history, { b: null }, { reason: 'remove' })
  const b0 = history._undo[1].before.get('b')

  assert.ok(history.undo(store))
  assert.equal(store.get('b'), b0, 'the very same frozen object is back')
  assert.deepEqual(store.list.map((e) => e.id), ['a', 'b', 'c'], 're-inserted at its z')
  assert.ok(history.undo(store))
  assert.equal(store.get('a'), a0)
  assert.equal(history.undo(store), null, 'nothing left')

  assert.ok(history.redo(store))
  assert.equal(store.get('a'), a1)
  assert.ok(history.redo(store))
  assert.equal(store.has('b'), false)
  assert.equal(history.redo(store), null)
})

test('undo leaves a history:false edit to another drawing alone', () => {
  const { store, history } = setup()
  commit(store, history, { a: move(store, 'a', 11) })
  // The host moves c without recording it.
  store.put('c', move(store, 'c', 99))
  history.undo(store)
  assert.equal(priceOf(store, 'a'), 10, 'my drag is undone')
  assert.equal(priceOf(store, 'c'), 99, "the host's edit is not")
  assert.equal(store.list.length, 3)
})

test('a new commit truncates the redo stack', () => {
  const { store, history } = setup()
  commit(store, history, { a: move(store, 'a', 11) })
  commit(store, history, { a: move(store, 'a', 12) })
  history.undo(store)
  assert.equal(history.canRedo, true)
  commit(store, history, { b: move(store, 'b', 21) })
  assert.equal(history.canRedo, false)
  assert.equal(history.redo(store), null)
  assert.equal(priceOf(store, 'a'), 11)
})

test('the oldest entry is dropped beyond the limit', () => {
  const store = new DrawingStore()
  store.replaceAll([hline('a', 0)])
  const history = new History(3)
  for (let p = 1; p <= 5; p++) {
    commit(store, history, { a: move(store, 'a', p) })
    history.breakCoalescing()
  }
  assert.equal(history.undoSize, 3)
  while (history.undo(store));
  assert.equal(priceOf(store, 'a'), 2, 'undo stops at the oldest kept entry')
  assert.equal(history.redoSize, 3)
})

test('a limit of 0 keeps nothing; a missing limit is 100', () => {
  const { store } = setup()
  const none = new History(0)
  commit(store, none, { a: move(store, 'a', 11) })
  assert.equal(none.canUndo, false)
  assert.equal(new History().limit, 100)
  assert.equal(new History(NaN).limit, 100)
})

test('consecutive nudges coalesce into one entry that undoes to where the run began', () => {
  const { store, history } = setup()
  for (let i = 1; i <= 5; i++) {
    commit(store, history, { a: move(store, 'a', 10 + i) }, { reason: 'nudge', coalesce: 'nudge:a', selAfter: ['a'] })
  }
  assert.equal(history.undoSize, 1)
  assert.equal(priceOf(store, 'a'), 15)
  history.undo(store)
  assert.equal(priceOf(store, 'a'), 10)
  history.redo(store)
  assert.equal(priceOf(store, 'a'), 15)
})

test('coalescing is broken by any other operation, by breakCoalescing, and by undo', () => {
  const { store, history } = setup()
  const nudge = (p) => commit(store, history, { a: move(store, 'a', p) }, { reason: 'nudge', coalesce: 'nudge:a' })
  nudge(11)
  nudge(12)
  commit(store, history, { b: move(store, 'b', 21) }) // another op
  nudge(13)
  assert.equal(history.undoSize, 3)
  history.breakCoalescing() // e.g. a selection change
  nudge(14)
  assert.equal(history.undoSize, 4)
  history.undo(store)
  nudge(15)
  assert.equal(history.undoSize, 4, 'the nudge after an undo is a new entry, not merged into the one below')
  history.undo(store)
  assert.equal(priceOf(store, 'a'), 13)
})

test('a different coalesce key starts a new entry', () => {
  const { store, history } = setup()
  commit(store, history, { a: move(store, 'a', 11) }, { coalesce: 'nudge:a' })
  commit(store, history, { b: move(store, 'b', 21) }, { coalesce: 'nudge:b' })
  assert.equal(history.undoSize, 2)
})

test('coalescing is deterministic: the same pushes give the same entries, however far apart in time', async () => {
  const run = async (gap) => {
    const { store, history } = setup()
    for (let i = 1; i <= 3; i++) {
      commit(store, history, { a: move(store, 'a', 10 + i) }, { coalesce: 'nudge:a' })
      if (gap) await new Promise((r) => setTimeout(r, gap))
    }
    return history.undoSize
  }
  assert.equal(await run(0), 1)
  assert.equal(await run(30), 1)
})

test('clear() is one entry that undo reverses completely', () => {
  const { store, history } = setup()
  const snap = store.list
  commit(store, history, { a: null, b: null, c: null }, { reason: 'clear' })
  assert.equal(store.list.length, 0)
  assert.equal(history.undoSize, 1)
  history.undo(store)
  assert.deepEqual(store.list, snap)
})

test('History.clear drops both stacks', () => {
  const { store, history } = setup()
  commit(store, history, { a: move(store, 'a', 11) })
  commit(store, history, { a: move(store, 'a', 12) })
  history.undo(store)
  history.clear()
  assert.deepEqual([history.canUndo, history.canRedo, history.undoSize, history.redoSize], [false, false, 0, 0])
})

test('the entry handed to push is copied, so a later merge never mutates the caller', () => {
  const { store, history } = setup()
  const before = new Map([['a', store.get('a')]])
  const after = new Map([['a', move(store, 'a', 11)]])
  store.put('a', after.get('a'))
  history.push({ before, after, selBefore: [], selAfter: [], reason: 'nudge', coalesce: 'k' })
  commit(store, history, { a: move(store, 'a', 12) }, { coalesce: 'k' })
  assert.equal(after.get('a').points[0].price, 11)
  assert.equal(after.size, 1)
})

test('undo returns the entry, with its selection, for the controller to restore', () => {
  const { store, history } = setup()
  commit(store, history, { a: move(store, 'a', 11) }, { selBefore: [], selAfter: ['a'] })
  const e = history.undo(store)
  assert.deepEqual(e.selBefore, [])
  assert.deepEqual(e.selAfter, ['a'])
  assert.equal(e.reason, 'move')
})
