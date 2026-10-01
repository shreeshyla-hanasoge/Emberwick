/**
 * The `below` plugin layer: a plugin that paints UNDER the candles.
 *
 * Same harness as chart-plugins.test.mjs: real handlers, real frames through
 * dom-stub, and assertions on what reached each canvas. The first half is
 * about what must NOT change: a chart with no below plugin has the stack, the
 * z-indexes and the operations it had before this layer existed.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps, withFixedClock } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
/** Identity without printing: inspecting a Chart or the recording context runs away. */
const same = (a, b, msg) => assert.ok(a === b, msg)

const mouse = (x, y, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra })
const touch = (x, y, id = 1, extra = {}) => ({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y, ...extra })

const charted = (options) => {
  const chart = createChart(makeContainer(), options)
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  settle(chart); frame(chart)
  return chart
}

const zOrder = (chart) => chart.layers.names.map((n) => [n, chart.layers.canvas[n].style.zIndex])

/** A plugin that logs every hook as [name, arg, arg] and answers from `answers`. */
const recorder = (answers = {}, layer) => {
  const log = []
  const plugin = { log, host: null }
  if (layer) plugin.layer = layer
  plugin.attach = (h) => { plugin.host = h; log.push(['attach']) }
  for (const k of ['detach', 'hover', 'pointerDown', 'pointerMove', 'pointerUp', 'pointerCancel', 'tap', 'doubleClick', 'contextMenu', 'keyDown']) {
    plugin[k] = (a, b) => {
      log.push([k, a, b])
      const r = answers[k]
      return typeof r === 'function' ? r(a, b) : r
    }
  }
  plugin.calls = (k) => log.filter((c) => c[0] === k)
  return plugin
}

/** A real marker on bar `k`, drawn once so the hit map exists; returns its hit circle. */
const withMarker = (chart, k) => {
  chart.setMarkers([{ time: chart.bars[k].time, shape: 'circle', id: 'm1' }])
  frame(chart)
  const h = chart._markerHits.find((m) => m.marker.id === 'm1')
  assert.ok(h, 'the marker was laid out')
  return h
}

// ------------------------------------------------- nothing changes without one

test('a chart with no below plugin has the stack and z-indexes it always had', () => {
  const chart = charted()
  assert.deepEqual(zOrder(chart), [['base', '1'], ['main', '2'], ['overlay', '3']])
  chart.addPlugin({})                                  // layer omitted: above, as before
  assert.deepEqual(zOrder(chart), [['base', '1'], ['main', '2'], ['plugins', '3'], ['overlay', '4']])
  chart.addPlugin({ layer: 'above' })
  chart.addPlugin({ layer: 'sideways' })               // anything but 'below' is above
  assert.deepEqual(chart.layers.names, ['base', 'main', 'plugins', 'overlay'])
  assert.equal(chart.layers.canvas.pluginsBelow, undefined, 'no canvas is created for a layer nobody asked for')
})

test('attaching and detaching a below plugin paints exactly what a plain chart paints', () => {
  // A fixed clock: the drag is thrown, and inertia is distance over clock time.
  const run = (withPlugin) => withFixedClock(() => {
    const chart = charted()
    if (withPlugin) { const p = { layer: 'below', draw() {} }; chart.addPlugin(p); frame(chart); chart.removePlugin(p) }
    clearOps(chart)
    chart._onMove(mouse(400, 200))
    frame(chart)
    chart._onDown(mouse(400, 200)); chart._onMove(mouse(350, 220)); chart._onUp(mouse(350, 220))
    frame(chart)
    const out = { z: zOrder(chart) }
    for (const n of ['base', 'main', 'overlay']) out[n] = JSON.stringify(chart.layers.canvas[n].ops)
    return out
  })
  assert.deepEqual(run(true), run(false))
})

test('with no below plugin, an above plugin sees the frame and the export it always saw', () => {
  const chart = charted()
  chart.addPlugin({ draw: (c) => c.fillRect(1, 2, 3, 4) })
  const ops = chart.layers.canvas.plugins.ops
  ops.length = 0
  frame(chart, 16, ['plugins'])
  assert.deepEqual(ops.map((o) => o.op), ['clearRect', 'save', 'fillRect', 'restore'])

  const created = []
  const doc = globalThis.document
  const make = doc.createElement
  doc.createElement = (tag) => { const c = make(tag); created.push(c); return c }
  try { chart.toImage() } finally { doc.createElement = make }
  const out = created[created.length - 1]
  assert.deepEqual(out.ops.map((o) => o.op),
    ['drawImage', 'drawImage', 'save', 'setTransform', 'save', 'fillRect', 'restore', 'restore', 'drawImage'],
    'base, main, one plugin pass, overlay: nothing is painted at the below depth')
})

// ------------------------------------------------------------- the new layer

test('the first below plugin creates pluginsBelow between base and main, dropped with the last', () => {
  const chart = charted()
  const a = { layer: 'below' }
  const b = { layer: 'below' }
  chart.addPlugin(a)
  assert.deepEqual(zOrder(chart), [['base', '1'], ['pluginsBelow', '2'], ['main', '3'], ['overlay', '4']],
    'no `plugins` canvas for a chart that only draws under the candles')
  assert.equal(chart.layers.canvas.pluginsBelow.width, 900, 'sized at once')
  chart.addPlugin(b)
  const top = {}
  chart.addPlugin(top)
  assert.deepEqual(zOrder(chart),
    [['base', '1'], ['pluginsBelow', '2'], ['main', '3'], ['plugins', '4'], ['overlay', '5']])
  chart.removePlugin(a)
  assert.deepEqual(chart.layers.names, ['base', 'pluginsBelow', 'main', 'plugins', 'overlay'], 'kept while one remains')
  chart.removePlugin(b)
  assert.deepEqual(zOrder(chart), [['base', '1'], ['main', '2'], ['plugins', '3'], ['overlay', '4']])
  chart.removePlugin(top)
  assert.deepEqual(zOrder(chart), [['base', '1'], ['main', '2'], ['overlay', '3']])
})

test('an above plugin attached first leaves the below canvas under the candles', () => {
  const chart = charted()
  chart.addPlugin({})
  chart.addPlugin({ layer: 'below' })
  assert.deepEqual(chart.layers.names, ['base', 'pluginsBelow', 'main', 'plugins', 'overlay'])
})

test('layer is read once, at addPlugin', () => {
  const chart = charted()
  const seen = []
  const p = { layer: 'below', draw: (ctx) => seen.push(ctx) }
  chart.addPlugin(p)
  p.layer = 'above'
  seen.length = 0
  frame(chart)
  same(seen[0], chart.layers.ctx.pluginsBelow, 'still painting under the candles')
  chart.removePlugin(p)
  assert.deepEqual(chart.layers.names, ['base', 'main', 'overlay'], 'and its own canvas is the one dropped')
})

// ------------------------------------------------------------------ painting

test('a below draw runs on pluginsBelow-dirty and full frames, cleared and bracketed like plugins', () => {
  const chart = charted()
  const seen = []
  chart.addPlugin({ layer: 'below', draw: (ctx, info) => { seen.push(info.full); ctx.fillRect(1, 1, 1, 1) } })
  seen.length = 0
  const ops = chart.layers.canvas.pluginsBelow.ops
  ops.length = 0
  frame(chart, 16, ['pluginsBelow'])
  assert.deepEqual(ops.map((o) => o.op), ['clearRect', 'save', 'fillRect', 'restore'])
  assert.deepEqual(ops[0].args, [0, 0, 900, 500])
  frame(chart, 16, ['all'])
  frame(chart, 16, ['plugins'])                        // the other layer's business
  frame(chart, 16, ['overlay'])
  assert.deepEqual(seen, [false, true])
})

test('host.invalidate() repaints only the layer that plugin lives on', () => {
  const chart = charted()
  const drawn = []
  const low = { layer: 'below', attach(h) { this.host = h }, draw: () => drawn.push('low') }
  const top = { attach(h) { this.host = h }, draw: () => drawn.push('top') }
  chart.addPlugin(low).addPlugin(top)
  frame(chart)
  const run = () => {
    drawn.length = 0
    clearOps(chart)
    const dirty = [...chart.loop._dirty]
    chart.loop._dirty.clear()
    frame(chart, 16, dirty)
    return drawn.slice()
  }
  chart.loop._dirty.clear()
  low.host.invalidate()
  assert.deepEqual(run(), ['low'])
  assert.equal(chart.layers.canvas.main.ops.length, 0, 'not a candle repainted')
  assert.equal(chart.layers.canvas.plugins.ops.length, 0)
  top.host.invalidate()
  assert.deepEqual(run(), ['top'])
  assert.equal(chart.layers.canvas.pluginsBelow.ops.length, 0)
})

test('keep-alive is per layer: a busy plugin repaints its own canvas and nothing else', () => {
  for (const [busy, idle] of [['pluginsBelow', 'plugins'], ['plugins', 'pluginsBelow']]) {
    const chart = charted()
    let n = 0
    chart.addPlugin({ layer: busy === 'pluginsBelow' ? 'below' : 'above', tick: () => ++n < 5, draw() {} })
    chart.addPlugin({ layer: busy === 'pluginsBelow' ? 'above' : 'below', draw() {} })
    frame(chart)
    clearOps(chart)
    assert.equal(frame(chart, 16, []), true, `${busy}: still busy, so the loop stays awake`)
    assert.ok(chart.layers.canvas[busy].ops.length > 0, `${busy} repainted`)
    assert.equal(chart.layers.canvas[idle].ops.length, 0, `${idle} did not`)
    assert.equal(chart.layers.canvas.main.ops.length, 0, 'nor the candles')
    assert.equal(chart.layers.canvas.base.ops.length, 0)
    while (frame(chart, 16, [])) { /* runs out */ }
    assert.equal(frame(chart, 16, []), false, 'and idles once it is done')
  }
})

test('each layer paints its own plugins, in attach order', () => {
  const chart = charted()
  const mk = (id, layer) => ({ layer, draw: (c) => c.fillRect(id, 0, 0, 0) })
  chart.addPlugin(mk(1, 'below')).addPlugin(mk(2)).addPlugin(mk(3, 'below')).addPlugin(mk(4))
  clearOps(chart)
  frame(chart)
  const ids = (layer) => chart.layers.canvas[layer].ops.filter((o) => o.op === 'fillRect' && o.args[1] === 0 && o.args[2] === 0).map((o) => o.args[0])
  assert.deepEqual(ids('pluginsBelow'), [1, 3])
  assert.deepEqual(ids('plugins'), [2, 4])
})

// --------------------------------------------------------------------- input

test('input is offered to above plugins first, topmost first, then to below plugins', () => {
  const chart = charted()
  const order = []
  const mk = (name, layer) => ({ layer, pointerDown() { order.push(name) }, tap() { order.push('tap:' + name) }, keyDown() { order.push('key:' + name) } })
  chart.addPlugin(mk('a1')).addPlugin(mk('b1', 'below')).addPlugin(mk('a2')).addPlugin(mk('b2', 'below'))
  chart._onDown(mouse(400, 200)); chart._onUp(mouse(400, 200))
  chart._onKey({ key: 'x', preventDefault() {} })
  assert.deepEqual(order, ['a2', 'a1', 'b2', 'b1', 'tap:a2', 'tap:a1', 'tap:b2', 'tap:b1', 'key:a2', 'key:a1', 'key:b2', 'key:b1'])
})

test('a below plugin that never claims blocks nothing: the pan, the tap and the plugin above', () => {
  const chart = charted()
  const low = recorder({}, 'below')
  const top = recorder({ pointerDown: (e) => e.x < 100 })
  chart.addPlugin(top).addPlugin(low)                  // the below plugin attached LAST
  const right = chart.ts._right.target
  chart._onDown(mouse(400, 200)); chart._onMove(mouse(300, 200)); chart._onUp(mouse(300, 200))
  assert.notEqual(chart.ts._right.target, right, 'the chart panned')
  assert.equal(low.calls('pointerMove').length, 0)

  chart._onDown(mouse(50, 200)); chart._onUp(mouse(50, 200))
  assert.equal(top.calls('pointerUp').length, 1, 'the plugin above owned its press')
  assert.equal(low.calls('pointerDown').length, 1, 'and the below plugin was never offered that one')

  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  assert.ok(chart.cursor, 'an unconsumed tap still places the touch crosshair')
})

test('a below plugin can own a gesture when nothing above claims it', () => {
  const chart = charted()
  const low = recorder({ pointerDown: true }, 'below')
  chart.addPlugin(low).addPlugin(recorder())
  const right = chart.ts._right.target
  chart._onDown(mouse(400, 200)); chart._onMove(mouse(300, 200)); chart._onUp(mouse(300, 200))
  assert.deepEqual(low.log.filter((c) => /^pointer/.test(c[0])).map((c) => c[0]), ['pointerDown', 'pointerMove', 'pointerUp'])
  assert.equal(chart.ts._right.target, right)
})

test('hover reaches a below plugin only when nothing above it reported a hit', () => {
  const chart = charted()
  let hit = true
  const low = recorder({ hover: (e) => (e ? { cursor: 'cell' } : null) }, 'below')
  const top = recorder({ hover: (e) => (e && hit ? { cursor: 'move' } : null) })
  chart.addPlugin(low).addPlugin(top)
  chart._onMove(mouse(400, 200))
  assert.deepEqual(low.calls('hover').map((c) => [c[1], c[2]]), [[null, 'occluded']])
  assert.equal(chart.container.style.cursor, 'move')
  hit = false
  chart._onMove(mouse(401, 200))
  assert.equal(low.calls('hover').slice(-1)[0][1].x, 401, 'offered the real event')
  assert.equal(chart.container.style.cursor, 'cell')
})

test('a marker is painted above a below plugin, so its hover wins over that plugin\'s hit', () => {
  const chart = charted()
  const hovered = []
  chart.subscribe('markerHover', (m) => hovered.push(m && m.id))
  const h = withMarker(chart, 1990)
  chart.addPlugin(recorder({ hover: (e) => (e ? { cursor: 'cell' } : null) }, 'below'))
  chart._onMove(mouse(h.x, h.y))
  assert.deepEqual(hovered, ['m1'], 'the marker over the below plugin is hovered')
  assert.equal(chart.container.style.cursor, 'pointer')
  chart._onMove(mouse(h.x - 200, h.y - 60))
  assert.deepEqual(hovered, ['m1', null])
  assert.equal(chart.container.style.cursor, 'cell', 'away from the marker, the plugin\'s own cursor shows')

  const clicks = []
  chart.subscribe('markerClick', (m) => clicks.push(m.id))
  chart._onDown(mouse(h.x, h.y)); chart._onUp(mouse(h.x, h.y)); chart._onClick(mouse(h.x, h.y))
  assert.deepEqual(clicks, ['m1'], 'and it is still clickable')
})

// -------------------------------------------------------------------- export

test('toImage composites base, the below pass, main, the above pass, then the crosshair', () => {
  const chart = charted()
  const draws = []
  const mk = (name, layer) => ({ layer, draw(ctx, info) { draws.push([name, info.exporting, ctx]); ctx.moveTo(name === 'low' ? 1 : 2, 0) } })
  chart.addPlugin(mk('top')).addPlugin(mk('low', 'below'))
  frame(chart)
  draws.length = 0
  const created = []
  const doc = globalThis.document
  const make = doc.createElement
  doc.createElement = (tag) => { const c = make(tag); created.push(c); return c }
  try { chart.toImage() } finally { doc.createElement = make }
  const out = created[created.length - 1]
  const drawn = out.ops.filter((o) => o.op === 'drawImage' || o.op === 'moveTo')
    .map((o) => (o.op === 'moveTo' ? (o.args[0] === 1 ? 'low pass' : 'top pass') : chart.layers.names.find((n) => chart.layers.canvas[n] === o.args[0])))
  assert.deepEqual(drawn, ['base', 'low pass', 'main', 'top pass', 'overlay'], 'neither live plugin canvas is flattened in')

  const exp = draws.filter((d) => d[1])
  assert.deepEqual(exp.map((d) => d[0]), ['low', 'top'])
  for (const d of exp) {
    assert.ok(d[2] !== chart.layers.ctx.plugins && d[2] !== chart.layers.ctx.pluginsBelow, 'the export pass never touches a live canvas')
  }
  assert.equal(chart._pluginInfo.exporting, false, 'and the flag is put back')
})

test('toImage with only a below plugin paints one pass, under the candles', () => {
  const chart = charted()
  chart.addPlugin({ layer: 'below', draw: (c) => c.fillRect(1, 2, 3, 4) })
  const created = []
  const doc = globalThis.document
  const make = doc.createElement
  doc.createElement = (tag) => { const c = make(tag); created.push(c); return c }
  try { chart.toImage() } finally { doc.createElement = make }
  assert.deepEqual(created[created.length - 1].ops.map((o) => o.op),
    ['drawImage', 'save', 'setTransform', 'save', 'fillRect', 'restore', 'restore', 'drawImage', 'drawImage'])
})

// -------------------------------------------------------------------- errors

test('a throwing below plugin never stops the candles and is removed after ten, with its canvas', () => {
  for (const hook of ['draw', 'tick']) {
    const chart = charted()
    const errs = []
    chart.subscribe('error', (e) => errs.push(e.message))
    const top = { draw() {} }
    chart.addPlugin(top)
    chart.addPlugin({ layer: 'below', [hook]() { throw new Error('boom') } })
    for (let i = 0; i < 9; i++) {
      clearOps(chart)
      frame(chart)
      assert.ok(chart.layers.canvas.main.ops.length > 0, `${hook}: frame ${i} still drew the candles`)
    }
    assert.equal(chart._plugins.length, 2, `${hook}: nine failing frames are tolerated`)
    frame(chart)
    assert.deepEqual(chart._plugins.map((r) => r.plugin), [top], `${hook}: the tenth removes it, and only it`)
    assert.equal(errs.filter((m) => m === 'boom').length, 10)
    assert.deepEqual(chart.layers.names, ['base', 'main', 'plugins', 'overlay'])
  }
})

test('a frame that paints only the other layer does not reset a failing below draw', () => {
  const chart = charted()
  chart.subscribe('error', () => {})
  chart.addPlugin({ draw() {} })
  chart.addPlugin({ layer: 'below', draw() { throw new Error('boom') } })
  for (let i = 0; i < 10; i++) {
    frame(chart, 16, ['pluginsBelow'])
    frame(chart, 16, ['plugins'])                      // the layer above repaints; this plugin's draw does not run
  }
  assert.equal(chart._plugins.length, 1)
  assert.equal(chart._plugins[0].below, false)
})

// ---------------------------------------------------------------------- host

test('host.volumeRatio is the chart\'s volume strip share, so a below plugin can stay clear of the strip', () => {
  const chart = charted()
  let host = null
  chart.addPlugin({ layer: 'below', attach(h) { host = h } })
  assert.equal(host.volumeRatio, 0.18, 'the default')
  const custom = charted({ volumeRatio: 0.3 })
  custom.addPlugin({ attach(h) { host = h } })
  assert.equal(host.volumeRatio, 0.3)
})

// ----------------------------------------------------------------- lifecycle

test('destroy detaches every plugin in reverse stack order while its canvas exists', () => {
  const chart = charted()
  const order = []
  const mk = (name, layer) => ({ layer, detach() { order.push([name, !!chart.layers.ctx[layer === 'below' ? 'pluginsBelow' : 'plugins']]) } })
  chart.addPlugin(mk('top')).addPlugin(mk('low', 'below'))
  chart.destroy()
  assert.deepEqual(order, [['top', true], ['low', true]])
  assert.equal(chart._plugins.length, 0)
})
