/**
 * The in-place text editor (§5.8).
 *
 * The stub can only prove what a browser would need, not what it does: the
 * one property that matters on an iPhone — focus() called synchronously inside
 * the activating handler — is checked as `el.focused === true` the moment
 * openTextEditor returns. The element and container are minimal inline fakes
 * that record listeners, focus and removal.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'

function makeElement(tag) {
  const listeners = new Map()
  return {
    tagName: tag,
    style: {},
    value: '',
    attrs: {},
    focused: false,
    removed: false,
    selected: false,
    addEventListener(t, fn) {
      if (!listeners.has(t)) listeners.set(t, new Set())
      listeners.get(t).add(fn)
    },
    removeEventListener(t, fn) { if (listeners.has(t)) listeners.get(t).delete(fn) },
    dispatch(t, ev) { for (const fn of [...(listeners.get(t) || [])]) fn(ev) },
    listening(t) { return listeners.has(t) ? listeners.get(t).size : 0 },
    focus() { this.focused = true },
    blur() { this.focused = false; this.dispatch('blur', {}) },
    remove() { this.removed = true },
    setAttribute(k, v) { this.attrs[k] = v },
    select() { this.selected = true },
  }
}

function makeContainer() {
  return {
    children: [],
    focused: false,
    focusOpts: undefined,
    appendChild(c) { this.children.push(c) },
    focus(o) { this.focused = true; this.focusOpts = o },
  }
}

const key = (k, o = {}) => ({
  key: k, shiftKey: false, isComposing: false, keyCode: 0,
  stopped: false, prevented: false,
  stopPropagation() { this.stopped = true },
  preventDefault() { this.prevented = true },
  ...o,
})

let saved
let created
before(() => {
  saved = globalThis.document
  created = []
  globalThis.document = { createElement: (tag) => { const el = makeElement(tag); created.push(el); return el } }
})
after(() => { globalThis.document = saved })

const { openTextEditor } = await import('../src/drawings/interaction/textEditor.js')

test('importing the editor touches no DOM', async () => {
  const doc = globalThis.document
  delete globalThis.document
  try {
    // A query string makes a fresh module instance, evaluated with no document.
    const m = await import('../src/drawings/interaction/textEditor.js?ssr')
    assert.equal(typeof m.openTextEditor, 'function')
  } finally {
    globalThis.document = doc
  }
})

const BOX = { x: 120, y: 80, w: 64, h: 20 }
const INIT = { text: 'Breakout', font: '12px Inter', color: '#fff', bg: '#123' }

function open(on = {}) {
  const log = []
  const container = makeContainer()
  const ed = openTextEditor(container, BOX, INIT, {
    commit: (t) => log.push(['commit', t]),
    cancel: () => log.push(['cancel']),
    ...on,
  })
  return { ed, el: ed.el, container, log }
}

test('the textarea is created lazily, inside the container', () => {
  const before = created.length
  const { el, container } = open()
  assert.equal(created.length, before + 1, 'exactly one element per open')
  assert.equal(el.tagName, 'textarea')
  assert.deepEqual(container.children, [el])
  assert.equal(el.value, 'Breakout')
})

test('it is focused synchronously, before openTextEditor returns', () => {
  const { el } = open()
  assert.equal(el.focused, true)
  assert.equal(el.selected, true, 'the placeholder is selected so typing replaces it')
})

test('it sits above the chart at the text’s box and is selectable', () => {
  const { el } = open()
  assert.equal(el.style.position, 'absolute')
  assert.equal(el.style.zIndex, '10')
  assert.equal(el.style.left, '120px')
  assert.equal(el.style.top, '80px')
  assert.equal(el.style.width, '64px')
  assert.equal(el.style.userSelect, 'text')
  assert.equal(el.style.webkitUserSelect, 'text')
  assert.equal(el.style.font, '12px Inter')
  assert.equal(el.style.color, '#fff')
  assert.equal(el.style.background, '#123')
})

test('pointer, click, wheel and context-menu events never reach the chart', () => {
  const { el } = open()
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel', 'keydown']) {
    const ev = key('x')
    el.dispatch(t, ev)
    assert.equal(ev.stopped, true, t)
  }
})

test('Enter commits the text', () => {
  const { el, log } = open()
  el.value = 'Double top'
  const ev = key('Enter')
  el.dispatch('keydown', ev)
  assert.deepEqual(log, [['commit', 'Double top']])
  assert.equal(ev.prevented, true, 'no newline is inserted')
  assert.equal(el.removed, true)
})

test('Enter does not commit while an IME is composing', () => {
  const { el, log } = open()
  el.dispatch('keydown', key('Enter', { isComposing: true }))
  el.dispatch('keydown', key('Enter', { keyCode: 229 }))
  assert.deepEqual(log, [])
  assert.equal(el.removed, false)
})

test('Shift+Enter is a newline, not a commit', () => {
  const { el, log } = open()
  const ev = key('Enter', { shiftKey: true })
  el.dispatch('keydown', ev)
  assert.deepEqual(log, [])
  assert.equal(ev.prevented, false)
})

test('Escape cancels', () => {
  const { el, log } = open()
  el.value = 'changed'
  el.dispatch('keydown', key('Escape'))
  assert.deepEqual(log, [['cancel']])
  assert.equal(el.removed, true)
})

test('blur commits', () => {
  const { el, log } = open()
  el.value = 'typed then clicked away'
  el.blur()
  assert.deepEqual(log, [['commit', 'typed then clicked away']])
})

test('a commit happens once: Enter then blur is one commit', () => {
  const { el, log } = open()
  el.dispatch('keydown', key('Enter'))
  el.blur()
  el.dispatch('keydown', key('Enter'))
  assert.deepEqual(log, [['commit', 'Breakout']])
})

test('Escape is not turned into a commit by the blur that follows it', () => {
  const log = []
  const container = makeContainer()
  // A container whose focus() blurs the textarea, as a browser's would.
  let el = null
  container.focus = function (o) { this.focused = true; this.focusOpts = o; if (el) el.blur() }
  const ed = openTextEditor(container, BOX, INIT, { commit: (t) => log.push(['commit', t]), cancel: () => log.push(['cancel']) })
  el = ed.el
  el.dispatch('keydown', key('Escape'))
  assert.deepEqual(log, [['cancel']])
})

test('commit and cancel hand focus back to the container', () => {
  const a = open()
  a.el.dispatch('keydown', key('Enter'))
  assert.equal(a.container.focused, true)
  assert.deepEqual(a.container.focusOpts, { preventScroll: true })
  const b = open()
  b.el.dispatch('keydown', key('Escape'))
  assert.equal(b.container.focused, true)
})

test('close removes the editor without calling back, and only once', () => {
  const { ed, el, log } = open()
  ed.close()
  ed.close()
  el.blur()
  assert.equal(el.removed, true)
  assert.deepEqual(log, [])
  assert.equal(el.listening('keydown'), 0, 'its listeners are gone')
})

test('reposition moves it to the new box', () => {
  const { ed, el } = open()
  ed.reposition({ x: 300.4, y: 41.6, w: 90, h: 22 })
  assert.equal(el.style.left, '300px')
  assert.equal(el.style.top, '42px')
  assert.equal(el.style.width, '90px')
  ed.reposition({ x: NaN, y: 10, w: 1, h: 1 })
  assert.equal(el.style.left, '300px', 'a NaN box keeps the last position')
})

test('a missing text opens an empty editor', () => {
  const container = makeContainer()
  const ed = openTextEditor(container, BOX, { font: '12px Inter' }, { commit() {}, cancel() {} })
  assert.equal(ed.el.value, '')
})
