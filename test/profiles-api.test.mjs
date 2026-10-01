/**
 * emberwick/profiles: the public API and the data contract.
 *
 * What createVolumeProfile accepts, what it refuses and with which words, and
 * what the controller's methods do to the chart. Rendering has its own files;
 * here a frame only has to run without throwing.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const core = await import('../src/chart/index.js')
const P = await import('../src/profiles/index.js')
const VA = await import('../src/profiles/valueArea.js')
const { normalizeData, normalizeSession } = await import('../src/profiles/data.js')
const { createChart } = core
const { createVolumeProfile } = P

const MIN = 60_000
const D0 = Date.UTC(2024, 0, 2, 9, 15)
const mouse = (x, y, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra })

const charted = () => {
  const chart = createChart(makeContainer())
  chart.setData(makeBars(D0, 600, MIN, 100))
  settle(chart); frame(chart)
  return chart
}

/** A session over bars [a, b] of the charted data, with the given bins. */
const session = (a, b, bins = [1, 4, 9, 5, 1], extra = {}) => ({
  start: D0 + a * MIN, end: D0 + b * MIN, lo: 98, bins, ...extra,
})
const data = (sessions, extra = {}) => ({ version: 1, step: 0.5, sessions, ...extra })

// ------------------------------------------------------------------ attaching

test('createVolumeProfile attaches under the candles and adds no other canvas', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart, { data: data([session(0, 99)]) })
  assert.deepEqual(chart.layers.names, ['base', 'pluginsBelow', 'main', 'overlay'])
  assert.equal(vp.layer, 'below')
  assert.ok(vp.chart === chart)
  assert.equal(chart._plugins.length, 1)
  assert.equal(frame(chart), false, 'a frame runs, and an idle profile keeps nothing awake')
})

test('it has no input hook that could claim a gesture, so pan, tap and double-click are the chart\'s', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart, { data: data([session(0, 599)]) })
  for (const hook of ['pointerDown', 'pointerMove', 'pointerUp', 'tap', 'doubleClick', 'contextMenu', 'keyDown']) {
    assert.equal(vp[hook], undefined, `${hook} is not implemented`)
  }
  const right = chart.ts._right.target
  chart._onDown(mouse(400, 200)); chart._onMove(mouse(300, 200)); chart._onUp(mouse(300, 200))
  assert.notEqual(chart.ts._right.target, right, 'a drag over a profile pans')
  const panned = chart.ts._right.target
  chart._onDown(mouse(400, 200)); chart._onUp(mouse(400, 200))
  chart._onDown(mouse(400, 200)); chart._onUp(mouse(400, 200))
  chart._onDbl({ clientX: 400, clientY: 200 })
  assert.notEqual(chart.ts._right.target, panned, 'and a double-click still resets the view')
})

test('it refuses what is not a chart, and a destroyed chart, leaving nothing behind', () => {
  assert.throws(() => createVolumeProfile(null), /needs an Emberwick chart/)
  assert.throws(() => createVolumeProfile({}), /needs an Emberwick chart/)
  const chart = charted()
  chart.destroy()
  assert.throws(() => createVolumeProfile(chart), /destroyed chart/)
})

test('a core without the 0.13 host is refused in words, and the plugin is taken back off', () => {
  const calls = []
  const old = {
    addPlugin(p) { calls.push('add'); p.attach({ invalidate() {} }) },   // a 0.12 host: no timeToIndex, no drawPriceTag
    removePlugin(p) { calls.push('remove'); p.detach() },
  }
  assert.throws(() => createVolumeProfile(old, {}), /older Emberwick core.*0\.13 or newer/)
  assert.deepEqual(calls, ['add', 'remove'])
})

test('bad options or data throw before anything is attached', () => {
  const chart = charted()
  assert.throws(() => createVolumeProfile(chart, { mode: 'weekly' }), /mode must be/)
  assert.throws(() => createVolumeProfile(chart, { data: data([session(5, 1)]) }), /start must be a time at or before end/)
  assert.deepEqual(chart.layers.names, ['base', 'main', 'overlay'], 'no layer')
  assert.equal(chart._plugins.length, 0, 'no plugin')
})

test('null, missing and empty data draw nothing and are not errors', () => {
  const chart = charted()
  for (const d of [undefined, null, data([]), { version: 1, step: 1 }]) {
    const vp = createVolumeProfile(chart, { data: d })
    assert.equal(vp._data.sessions.length, 0)
    frame(chart)
    vp.destroy()
  }
  const vp = createVolumeProfile(chart)
  vp.setData(data([session(0, 9)]))
  assert.equal(vp._data.sessions.length, 1)
  vp.setData(null)
  assert.equal(vp._data.sessions.length, 0)
  frame(chart)
})

// ------------------------------------------------------------------ contract

test('contract validation: a bad step, bad bins, start after end and a lo that is no price', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart)
  for (const step of [0, -0.5, NaN, Infinity, undefined, null, 'wide']) {
    assert.throws(() => vp.setData({ version: 1, step, sessions: [] }), /data\.step must be a positive number/, `step ${String(step)}`)
  }
  for (const bins of [undefined, null, 5, 'abc', { 0: 1, length: 1 }]) {
    assert.throws(() => vp.setData(data([{ ...session(0, 9), bins }])), /sessions\[0\]: bins must be an array of volumes/, `bins ${String(bins)}`)
  }
  assert.throws(() => vp.setData(data([session(0, 9), session(9, 3)])), /sessions\[1\]: start must be a time at or before end/)
  assert.throws(() => vp.setData(data([session(0, 9, [1], { start: NaN })])), /start must be a time/)
  assert.throws(() => vp.setData(data([session(0, 9, [1], { end: null })])), /start must be a time/)
  assert.throws(() => vp.setData(data([session(0, 9, [1], { lo: undefined })])), /lo must be a price/)
  assert.throws(() => vp.setData(data([null])), /sessions\[0\] must be an object/)
  assert.throws(() => vp.setData('profile'), /data must be a ProfileData object or null/)
  for (const fn of [() => vp.setData(data([session(0, 9, 'x')]))]) {
    assert.throws(fn, (e) => e instanceof Error && e.message.startsWith('emberwick/profiles: '), 'every message names the entry')
  }
})

test('a start equal to its end is a one-bar session, not an error', () => {
  const s = normalizeSession(session(7, 7), 0.5)
  assert.equal(s.start, s.end)
})

test('numeric strings are coerced the way every Emberwick input is', () => {
  const d = normalizeData({ version: 1, step: '0.5', sessions: [{ start: String(D0), end: String(D0 + MIN), lo: '98', bins: ['1', '2'] }] })
  assert.equal(d.step, 0.5)
  assert.deepEqual([d.sessions[0].start, d.sessions[0].end, d.sessions[0].lo], [D0, D0 + MIN, 98])
  assert.deepEqual([...d.sessions[0].bins], [1, 2])
})

test('a throwing setData or upsertSession leaves the previous data in place', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart, { data: data([session(0, 9)]) })
  const before = vp._data
  assert.throws(() => vp.setData(data([session(0, 9), session(20, 10)])))
  assert.ok(vp._data === before)
  assert.throws(() => vp.upsertSession(session(20, 10)))
  assert.equal(vp._data.sessions.length, 1)
})

test('a contract version this build cannot read draws nothing and warns once', () => {
  const orig = console.warn
  const warned = []
  console.warn = (...a) => warned.push(a[0])
  try {
    assert.equal(normalizeData({ version: 2, step: 1, sessions: [session(0, 9)] }).sessions.length, 0)
    assert.equal(normalizeData({ version: 3, step: -1, sessions: 7 }).sessions.length, 0, 'not even validated: its shape is unknown')
  } finally {
    console.warn = orig
  }
  assert.equal(warned.length, 1)
  assert.match(warned[0], /data version 2 is not the version this build reads \(1\)/)
  assert.equal(normalizeData({ step: 1, sessions: [session(0, 9)] }).sessions.length, 1, 'an absent version is read as 1')
})

test('sessions are kept ascending by start, and the later of two with one start wins', () => {
  const a = session(200, 299, [1, 2, 3])
  const b = session(0, 99, [4, 5, 6])
  const b2 = session(0, 99, [7, 8, 9])
  const d = normalizeData(data([a, b, b2]))
  assert.deepEqual(d.sessions.map((s) => s.start), [b.start, a.start])
  assert.ok(d.sessions[0].raw === b2, 'the host\'s own object is kept, and it is the later one')
  assert.equal(d.source, '')
  assert.equal(normalizeData(data([], { source: 'near-month futures' })).source, 'near-month futures')
})

test('bins are copied and cleaned: what is not a positive finite volume is zero', () => {
  const bins = [3, -1, NaN, 'x', null, Infinity, '4', 2]
  const raw = session(0, 9, bins)
  const s = normalizeSession(raw, 0.5)
  assert.deepEqual([...s.bins], [3, 0, 0, 0, 0, 0, 4, 2])
  assert.equal(s.total, 9)
  assert.equal(s.max, 4)
  assert.equal(s.n, 8)
  bins[0] = 1000                                       // the host keeps writing to its array
  assert.equal(s.bins[0], 3, 'and the session does not see it until it is upserted')
  assert.deepEqual([...normalizeSession(session(0, 9, new Float32Array([1, 2])), 0.5).bins], [1, 2], 'a typed array is an array of volumes')
})

test('a missing poc, value area and total are computed once, from the bins', () => {
  const bins = [2, 5, 8, 12, 20, 15, 9, 6, 3, 1]
  const s = normalizeSession({ start: D0, end: D0 + MIN, lo: 100, bins }, 1)
  const va = VA.computeValueArea(bins, 100, 1)
  assert.deepEqual([s.poc, s.vah, s.val], [va.poc, va.vah, va.val])
  assert.deepEqual([s.poc, s.vah, s.val], [104.5, 107, 102])
  assert.deepEqual([s.pocBin, s.vaFrom, s.vaTo], [4, 2, 6])
  assert.equal(s.total, 81)
  assert.equal(s.developing, false)
})

test('what the host sends is kept: its poc, its value area, its total, its developing flag', () => {
  const bins = [2, 5, 8, 12, 20, 15, 9, 6, 3, 1]
  const s = normalizeSession({ start: D0, end: D0 + MIN, lo: 100, bins, poc: 105.25, vah: 109, val: 104, total: 500, developing: true }, 1)
  assert.deepEqual([s.poc, s.vah, s.val, s.total, s.developing], [105.25, 109, 104, 500, true])
  assert.equal(s.pocBin, 5, 'the bin its POC falls in')
  assert.deepEqual([s.vaFrom, s.vaTo], [4, 8], 'val is a low edge and vah a high edge: bins 4..8')
  assert.notDeepEqual([s.vah, s.val], [108, 103], 'not the area Emberwick would have computed around that POC')
  // A POC sent as the exact low edge of a bin belongs to that bin, not the one below.
  assert.equal(normalizeSession({ start: D0, end: D0, lo: 0, bins: new Array(20).fill(1), poc: 0.7 }, 0.1).pocBin, 7)
})

test('half a value area is no value area: with only vah or only val, both are computed', () => {
  const bins = [2, 5, 8, 12, 20, 15, 9, 6, 3, 1]
  for (const half of [{ vah: 109 }, { val: 101 }, { vah: 101, val: 109 }]) {
    const s = normalizeSession({ start: D0, end: D0, lo: 100, bins, ...half }, 1)
    assert.deepEqual([s.vah, s.val], [107, 102], JSON.stringify(half))
  }
})

test('a value area computed around a POC the host named contains that POC', () => {
  const bins = [2, 5, 8, 12, 20, 15, 9, 6, 3, 1]
  const s = normalizeSession({ start: D0, end: D0, lo: 100, bins, poc: 101.5 }, 1)
  assert.equal(s.pocBin, 1)
  assert.ok(s.val <= 101.5 && s.vah >= 101.5, `value area ${s.val}..${s.vah}`)
})

test('a session where nothing traded has no poc and no value area, and no crash', () => {
  for (const bins of [[], [0, 0, 0], [NaN, -1]]) {
    const s = normalizeSession(session(0, 9, bins), 0.5)
    assert.deepEqual([s.poc, s.vah, s.val, s.pocBin, s.vaFrom, s.vaTo, s.total, s.max], [null, null, null, -1, -1, -1, 0, 0])
  }
  const chart = charted()
  createVolumeProfile(chart, { data: data([session(0, 99, [0, 0]), session(100, 199, [])]) })
  frame(chart)
})

// -------------------------------------------------------------- upsertSession

test('upsertSession needs setData first, because the bin step belongs to the data', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart)
  assert.throws(() => vp.upsertSession(session(0, 9)), /upsertSession\(\) needs setData\(\) first/)
  vp.setData(data([]))
  vp.upsertSession(session(0, 9))
  assert.equal(vp._data.sessions.length, 1)
  vp.setData(null)
  assert.throws(() => vp.upsertSession(session(0, 9)), /needs setData\(\) first/)
})

test('upsertSession replaces the session with the same start and inserts any other in order', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart, { data: data([session(0, 99), session(200, 299)]) })
  const [first, last] = vp._data.sessions
  vp.upsertSession(session(100, 199, [5, 5]))
  assert.deepEqual(vp._data.sessions.map((s) => s.start), [D0, D0 + 100 * MIN, D0 + 200 * MIN])
  vp.upsertSession(session(200, 320, [9, 9, 9], { developing: true }))
  assert.equal(vp._data.sessions.length, 3, 'same start: replaced, not added')
  assert.equal(vp._data.sessions[2].end, D0 + 320 * MIN)
  assert.equal(vp._data.sessions[2].developing, true)
  assert.ok(vp._data.sessions[0] === first, 'the other sessions are the same objects: only the touched one was re-read')
  assert.ok(vp._data.sessions[2] !== last)
  vp.upsertSession(session(-50, -1, [1]))
  assert.equal(vp._data.sessions[0].start, D0 - 50 * MIN, 'an earlier session goes in front')
})

test('setData, upsertSession and setOptions repaint the profile layer and not a candle', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart, { data: data([session(0, 99)]) })
  frame(chart)
  const calls = [
    () => vp.setData(data([session(0, 199)])),
    () => vp.upsertSession(session(200, 299)),
    () => vp.setOptions({ width: 0.5 }),
  ]
  for (const call of calls) {
    chart.loop._dirty.clear()
    assert.ok(call() === vp, 'chainable')
    assert.deepEqual([...chart.loop._dirty], ['pluginsBelow'])
    clearOps(chart)
    frame(chart, 16, ['pluginsBelow'])
    assert.equal(chart.layers.canvas.main.ops.length, 0)
    assert.equal(chart.layers.canvas.base.ops.length, 0)
  }
})

// ----------------------------------------------------------------- setOptions

test('the defaults are the documented ones', () => {
  const vp = createVolumeProfile(charted())
  assert.deepEqual(vp._opts, {
    mode: 'session', width: 0.3, side: 'right', valueArea: true, poc: true, extendPoc: false,
    tags: true, label: true, hideFutureInReplay: true, colors: null,
  })
})

test('setOptions validates every value before applying any', () => {
  const vp = createVolumeProfile(charted())
  assert.throws(() => vp.setOptions({ width: 0.5, mode: 'weekly' }), /mode must be 'session', 'visible' or 'both' \(got weekly\)/)
  assert.equal(vp._opts.width, 0.3, 'the good half of a bad call is not applied')
  assert.throws(() => vp.setOptions({ side: 'top' }), /side must be 'left' or 'right'/)
  for (const width of [0, -1, NaN, Infinity, '0.5', null]) {
    assert.throws(() => vp.setOptions({ width }), /width must be a number above 0/, `width ${String(width)}`)
  }
  assert.throws(() => vp.setOptions({ colors: 'red' }), /colors must be an object or null/)
  assert.throws(() => vp.setOptions(7), /options must be an object/)
  vp.setOptions(null)
  vp.setOptions(undefined)
})

test('setOptions merges: named keys change, undefined keeps, unknown keys and data are ignored', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart, { data: data([session(0, 9)]), mode: 'both', side: 'left', colors: { poc: '#f00' } })
  assert.equal(vp._opts.mode, 'both')
  vp.setOptions({ mode: undefined, width: 0.6, valueArea: 0, extendPoc: 'yes', nonsense: 1, data: null })
  assert.deepEqual([vp._opts.mode, vp._opts.side, vp._opts.width, vp._opts.valueArea, vp._opts.extendPoc], ['both', 'left', 0.6, false, true])
  assert.equal('nonsense' in vp._opts, false)
  vp.setOptions({ poc: undefined, tags: undefined })
  assert.deepEqual([vp._opts.poc, vp._opts.tags], [true, true], 'a flag passed as undefined keeps its value')
  assert.equal(vp._data.sessions.length, 1, 'data has its own setter')
  assert.deepEqual(vp._opts.colors, { poc: '#f00' })
  vp.setOptions({ width: 7 })
  assert.equal(vp._opts.width, 1, 'a share above the whole span is the whole span')
  const mine = { fill: '#123' }
  vp.setOptions({ colors: mine })
  mine.fill = '#456'
  assert.equal(vp._opts.colors.fill, '#123', 'colours are copied, not held')
  vp.setOptions({ colors: null })
  assert.equal(vp._opts.colors, null)
})

// --------------------------------------------------------------------- events

test('on and off take the hover event and refuse any other', () => {
  const vp = createVolumeProfile(charted())
  const fn = () => {}
  assert.ok(vp.on('hover', fn) === vp)
  assert.equal(vp._listeners.hover.size, 1)
  assert.ok(vp.off('hover', fn) === vp)
  assert.equal(vp._listeners.hover.size, 0)
  assert.throws(() => vp.on('click', fn), /unknown event "click"/)
  assert.throws(() => vp.off('click', fn), /unknown event "click"/)
})

// -------------------------------------------------------------------- destroy

test('destroy removes the plugin and the below layer, and is idempotent', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart, { data: data([session(0, 99)]) })
  vp.on('hover', () => {})
  vp.destroy()
  assert.deepEqual(chart.layers.names, ['base', 'main', 'overlay'])
  assert.equal(chart._plugins.length, 0)
  assert.equal(vp._listeners.hover.size, 0)
  vp.destroy()
  vp.destroy()
  frame(chart)
})

test('the below layer stays while another profile, or any below plugin, still paints on it', () => {
  const chart = charted()
  const a = createVolumeProfile(chart)
  const b = createVolumeProfile(chart)
  a.destroy()
  assert.deepEqual(chart.layers.names, ['base', 'pluginsBelow', 'main', 'overlay'])
  b.destroy()
  assert.deepEqual(chart.layers.names, ['base', 'main', 'overlay'])
})

test('chart.destroy() detaches the profile, and destroy() afterwards is a no-op', () => {
  const chart = charted()
  const vp = createVolumeProfile(chart, { data: data([session(0, 99)]) })
  chart.destroy()
  assert.equal(vp._destroyed, true)
  vp.destroy()
  vp.setData(null)                                     // a late call from a host tearing down: not a throw
  vp.setOptions({ width: 0.4 })
})

// -------------------------------------------------------------------- exports

test('the entry exports the documented names, and one version with the core', () => {
  assert.deepEqual(Object.keys(P).sort(), ['DATA_VERSION', 'computeValueArea', 'createVolumeProfile', 'version'])
  assert.equal(P.DATA_VERSION, 1)
  assert.ok(P.computeValueArea === VA.computeValueArea)
  assert.equal(P.version, core.version, 'src/profiles/index.js and src/chart/index.js must carry the same version')
})
