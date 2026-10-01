/**
 * The core plugin seam, and the frame fixes it depends on.
 *
 * Everything here drives the real handlers (chart._onDown & co.) and real
 * frames through dom-stub, and asserts on what reached each canvas — the
 * recording context has no state stack, so isolation is proven by op order.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps, withFixedClock } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart, Smoothed } = await import('../src/chart/index.js')
const { Layers } = await import('../src/chart/core/Layers.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
/**
 * Identity without printing: a failing assert.equal inspects both sides, and
 * inspecting a Chart (or the recording context, a Proxy that answers every
 * property with a recorder) runs away instead of failing.
 */
const same = (a, b, msg) => assert.ok(a === b, msg)

// ------------------------------------------------------------ settle frame

/** x of every vertical stroke (a wick: moveTo(x, a) then lineTo(x, b)) in `ops`. */
const wickXs = (ops) => {
  const xs = []
  for (let i = 0; i + 1 < ops.length; i++) {
    const a = ops[i]
    const b = ops[i + 1]
    if (a.op === 'moveTo' && b.op === 'lineTo' && a.args[0] === b.args[0] && a.args[1] !== b.args[1]) xs.push(a.args[0])
  }
  return xs
}

/** candles.js' own wick formula, from the scale as it is NOW. */
const wickX = (chart, i) => Math.round(chart.ts.x(i)) + (chart.ts.barWidth() % 2 ? 0.5 : 0)

/**
 * Run frames the way the Loop would with nothing else invalidating — an empty
 * dirty set — until the chart stops asking for more. Returns the main-layer
 * ops of the last frame that painted main.
 */
const runOut = (chart) => {
  let lastMain = null
  for (let i = 0; i < 600; i++) {
    clearOps(chart)
    const more = frame(chart, 16, [])
    if (chart.layers.canvas.main.ops.length) lastMain = chart.layers.canvas.main.ops.slice()
    if (!more) return lastMain
  }
  throw new Error('never settled')
}

test('a settling ease redraws the candles at the value it snapped to', () => {
  // Smoothed's epsilon is relative, and _right is an absolute bar index: on a
  // 29,000-bar backtest it snaps the last 0.03 bars, about 4px at this zoom.
  // If that snap is not a redrawn frame, the candles stay 4px off from
  // everything later painted through the scale.
  const n = 29_000
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, n, MIN, 100))
  settle(chart)
  chart.setVisibleRange({ from: n - 6, to: n - 1 })   // ~138px per bar
  frame(chart)
  chart.ts._right.set(n - 3)                          // an eased move of two bars

  const lastMain = runOut(chart)
  assert.equal(chart.ts._right.value, chart.ts._right.target, 'the ease has settled')
  const xs = wickXs(lastMain)
  for (const i of [n - 7, n - 5, n - 3]) {
    assert.ok(xs.includes(wickX(chart, i)),
      `bar ${i}: candles drawn at ${xs.join(', ')}, the scale now puts it at ${wickX(chart, i)}`)
  }
})

test('Smoothed reports its settle snap as motion exactly once', () => {
  const s = new Smoothed(0, 65)
  s.set(1000)
  let frames = 0
  while (s.tick(16)) frames++
  assert.equal(s.value, 1000)
  assert.equal(s.tick(16), false, 'once snapped, it is still')
  assert.ok(frames > 1)

  const still = new Smoothed(5, 65)
  assert.equal(still.tick(16), false, 'a value already at its target reports nothing')
})

test('a NaN target still settles, in one reported frame', () => {
  // Smoothed's own epsilon never calls NaN settled; a subclass with an
  // absolute one (the drawings' Eased) does, and must then go quiet.
  class Absolute extends Smoothed {
    get settled() { return !(Math.abs(this.target - this.value) > 1e-3) }
  }
  const s = new Absolute(0, 60)
  s.set(NaN)
  assert.equal(s.tick(16), true, 'the snap to NaN is a change')
  assert.equal(s.tick(16), false, 'and then it is settled: NaN is NaN')
})

// ----------------------------------------------------------------- options

test('setAnimate records the choice in options.animate', () => {
  const chart = createChart(makeContainer())
  assert.equal(chart.options.animate, true)
  chart.setAnimate(false)
  assert.equal(chart.options.animate, false, 'readable by anything that animates, not only LiveCandle')
  assert.equal(chart.live.enabled, false)
  chart.setAnimate(true)
  assert.equal(chart.options.animate, true)
})

// ------------------------------------------------------------------ layers

const zOrder = (layers) => layers.names.map((n) => [n, layers.canvas[n].style.zIndex])

test('Layers.add stacks a canvas below the one named, sized at once, and renumbers', () => {
  const names = ['base', 'main', 'overlay']
  const layers = new Layers(makeContainer(), names)
  const ctx = layers.add('plugins', 'overlay')
  assert.deepEqual(names, ['base', 'main', 'overlay'], "the caller's array is never mutated")
  assert.deepEqual(zOrder(layers), [['base', '1'], ['main', '2'], ['plugins', '3'], ['overlay', '4']])
  assert.equal(layers.canvas.plugins.width, 900, 'sized immediately, not 0x0 until a resize')
  assert.equal(layers.canvas.plugins.height, 500)
  same(ctx, layers.ctx.plugins, 'returns the new context')
  same(layers.add('plugins', 'overlay'), ctx, 'idempotent')
  assert.equal(layers.names.length, 4)
})

test('a late layer is sized at the device pixel ratio', () => {
  const was = globalThis.window.devicePixelRatio
  globalThis.window.devicePixelRatio = 2
  try {
    const layers = new Layers(makeContainer(), ['base', 'main', 'overlay'])
    layers.add('plugins', 'overlay')
    assert.equal(layers.canvas.plugins.width, 1800)
    const t = layers.canvas.plugins.ops.filter((o) => o.op === 'setTransform')
    assert.deepEqual(t[t.length - 1].args, [2, 0, 0, 2, 0, 0], 'and pre-scaled like the others')
  } finally {
    globalThis.window.devicePixelRatio = was
  }
})

test('Layers.add with no such neighbour puts the canvas on top', () => {
  const layers = new Layers(makeContainer(), ['base', 'main'])
  layers.add('top')
  assert.deepEqual(zOrder(layers), [['base', '1'], ['main', '2'], ['top', '3']])
})

test('Layers.remove drops the canvas and renumbers the rest', () => {
  const container = makeContainer()
  const layers = new Layers(container, ['base', 'main', 'overlay'])
  layers.add('plugins', 'overlay')
  const c = layers.canvas.plugins
  let removed = false
  c.remove = () => { removed = true }
  layers.remove('plugins')
  assert.ok(removed, 'the element left the DOM')
  assert.equal(layers.canvas.plugins, undefined)
  assert.equal(layers.ctx.plugins, undefined)
  assert.deepEqual(zOrder(layers), [['base', '1'], ['main', '2'], ['overlay', '3']])
  layers.remove('plugins')                             // a no-op, not a throw
  assert.equal(layers.names.length, 3)
})

test('composite() flattens every layer in stack order, as it always did', () => {
  const layers = new Layers(makeContainer(), ['base', 'main', 'overlay'])
  layers.add('plugins', 'overlay')
  const out = layers.composite()
  const drawn = out.ops.filter((o) => o.op === 'drawImage').map((o) => layers.names.find((n) => layers.canvas[n] === o.args[0]))
  assert.deepEqual(drawn, ['base', 'main', 'plugins', 'overlay'])
  assert.equal(out.width, 900)
})

test('composite(names, between) paints a pass into the stack after the layer named', () => {
  const layers = new Layers(makeContainer(), ['base', 'main', 'plugins', 'overlay'])
  const seen = []
  const out = layers.composite(['base', 'main', 'overlay', 'gone'], (c, name) => {
    seen.push(name)
    if (name === 'main') c.fillRect(1, 2, 3, 4)
  })
  assert.deepEqual(seen, ['base', 'main', 'overlay', 'gone'], 'a missing layer is skipped, not thrown on')
  const ops = out.ops.filter((o) => o.op === 'drawImage' || o.op === 'fillRect')
    .map((o) => (o.op === 'fillRect' ? 'pass' : layers.names.find((n) => layers.canvas[n] === o.args[0])))
  assert.deepEqual(ops, ['base', 'main', 'pass', 'overlay'], 'the live plugins canvas is left out')
})

// ================================================================== the seam

const mouse = (x, y, extra = {}) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, ...extra })
const touch = (x, y, id = 1, extra = {}) => ({ pointerId: id, pointerType: 'touch', button: 0, clientX: x, clientY: y, ...extra })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const charted = (options) => {
  const chart = createChart(makeContainer(), options)
  chart.setData(makeBars(T0, 2000, MIN, 24000))
  settle(chart); frame(chart)
  return chart
}

/**
 * A plugin that logs every hook as [name, arg] and answers from `answers`
 * (a value, or a function of the argument).
 */
const recorder = (answers = {}) => {
  const log = []
  const plugin = { log, host: null }
  const hooks = ['detach', 'afterFrame', 'hover', 'pointerDown', 'pointerMove', 'pointerUp',
    'pointerCancel', 'tap', 'doubleClick', 'contextMenu', 'keyDown']
  plugin.attach = (h) => { plugin.host = h; log.push(['attach']) }
  for (const k of hooks) {
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

const cursorWrites = (chart) => {
  const writes = []
  const style = chart.container.style
  chart.container.style = new Proxy(style, {
    set(t, k, v) { if (k === 'cursor') writes.push(v); t[k] = v; return true },
  })
  return writes
}

// ------------------------------------------------------------ layer and identity

test('a chart with no plugin has exactly the three canvases it always had', () => {
  const chart = charted()
  assert.deepEqual(chart.layers.names, ['base', 'main', 'overlay'])
})

test('the plugins layer is created on first attach, below the crosshair, and dropped with the last', () => {
  const chart = charted()
  const a = {}
  const b = {}
  chart.addPlugin(a).addPlugin(b)
  assert.deepEqual(chart.layers.names, ['base', 'main', 'plugins', 'overlay'])
  assert.equal(chart.layers.canvas.plugins.width, 900, 'sized at once')
  assert.equal(chart.layers.canvas.overlay.style.zIndex, '4')
  chart.removePlugin(a)
  assert.deepEqual(chart.layers.names, ['base', 'main', 'plugins', 'overlay'], 'kept while one remains')
  chart.removePlugin(b)
  assert.deepEqual(chart.layers.names, ['base', 'main', 'overlay'])
  assert.equal(chart.layers.canvas.overlay.style.zIndex, '3', 're-stacked')
})

test('attaching and detaching a no-op plugin paints exactly what a plain chart paints', () => {
  // The drag below is thrown: its inertia is distance over CLOCK time, so the
  // two runs are only comparable under the same clock.
  const run = (withPlugin) => withFixedClock(() => {
    const chart = charted()
    if (withPlugin) { const p = {}; chart.addPlugin(p); chart.removePlugin(p) }
    clearOps(chart)
    chart._onMove(mouse(400, 200))
    frame(chart)
    chart._onDown(mouse(400, 200)); chart._onMove(mouse(350, 220)); chart._onUp(mouse(350, 220))
    frame(chart)
    const out = {}
    for (const n of ['base', 'main', 'overlay']) out[n] = JSON.stringify(chart.layers.canvas[n].ops)
    return out
  })
  assert.deepEqual(run(true), run(false))
})

test('addPlugin is idempotent per object and refuses a non-object or a destroyed chart', () => {
  const chart = charted()
  const p = recorder()
  chart.addPlugin(p).addPlugin(p)
  assert.equal(chart._plugins.length, 1)
  assert.equal(p.calls('attach').length, 1)
  assert.throws(() => chart.addPlugin(null), /needs a plugin object/)
  assert.throws(() => chart.addPlugin('x'), /needs a plugin object/)
  chart.destroy()
  assert.throws(() => chart.addPlugin({}), /destroyed chart/)
})

// ----------------------------------------------------------------- frame

test('draw runs on plugins-dirty and full frames, and not on overlay-only frames', () => {
  const chart = charted()
  const seen = []
  chart.addPlugin({ draw: (ctx, info) => seen.push(info.full) })
  seen.length = 0
  frame(chart, 16, ['plugins'])
  frame(chart, 16, ['all'])
  frame(chart, 16, ['overlay'])
  assert.deepEqual(seen, [false, true])
})

test('the plugins layer is cleared before each paint, and draws get a DPR-scaled layer', () => {
  const chart = charted()
  chart.addPlugin({ draw: (ctx) => ctx.fillRect(1, 1, 1, 1) })
  const ops = chart.layers.canvas.plugins.ops
  ops.length = 0
  frame(chart, 16, ['plugins'])
  assert.deepEqual(ops.map((o) => o.op), ['clearRect', 'save', 'fillRect', 'restore'])
  assert.deepEqual(ops[0].args, [0, 0, 900, 500])
})

test('tick -> true keeps the loop awake without repainting a single candle', () => {
  const chart = charted()
  let n = 0
  chart.addPlugin({ tick: () => ++n < 5, draw() {} })
  frame(chart)
  clearOps(chart)
  assert.equal(frame(chart, 16, []), true, 'a plugin still busy keeps the loop running')
  assert.equal(chart.layers.canvas.main.ops.length, 0, 'main recorded no ops during a hover fade')
  assert.equal(chart.layers.canvas.base.ops.length, 0)
  assert.ok(chart.layers.canvas.plugins.ops.length > 0, 'while the plugin itself repainted')
  while (frame(chart, 16, [])) { /* runs out */ }
  assert.equal(frame(chart, 16, []), false, 'and idles once it is done')
})

test('tick sees info.full: true when the view moved or all was invalidated', () => {
  const chart = charted()
  const seen = []
  chart.addPlugin({ tick: (dt, info) => { seen.push([dt, info.full, info.exporting]) } })
  seen.length = 0
  frame(chart, 16, ['plugins'])
  frame(chart, 20, ['all'])
  assert.deepEqual(seen, [[16, false, false], [20, true, false]])
})

test('plugins project through the same scale values the candles are drawn with', () => {
  const chart = charted()
  const k = 1990
  let drawnAt = null
  chart.addPlugin({
    draw: (ctx) => {
      drawnAt = Math.round(chart.ts.x(k)) + (chart.ts.barWidth() % 2 ? 0.5 : 0)
      ctx.moveTo(drawnAt, 0)
    },
  })
  chart.ts.zoomAt(400, 1.6)                           // an eased zoom
  for (let i = 0; i < 4; i++) {
    clearOps(chart)
    assert.equal(frame(chart, 16, []), true, 'still easing')
    assert.ok(wickXs(chart.layers.canvas.main.ops).includes(drawnAt),
      `frame ${i}: the plugin drew bar ${k} at ${drawnAt}, where the candle is`)
  }
})

test('a plugins-only frame after an ease settles projects where the candles were drawn', () => {
  const n = 29_000
  const chart = createChart(makeContainer())
  chart.setData(makeBars(T0, n, MIN, 100))
  settle(chart)
  chart.setVisibleRange({ from: n - 6, to: n - 1 })
  frame(chart)
  const k = n - 5
  let x = null
  chart.addPlugin({ draw: () => { x = Math.round(chart.ts.x(k)) + (chart.ts.barWidth() % 2 ? 0.5 : 0) } })
  chart.ts._right.set(n - 3)
  const lastMain = runOut(chart)
  frame(chart, 16, ['plugins'])                       // a hover fade, say
  assert.ok(wickXs(lastMain).includes(x), `the anchor at ${x} sits on its wick (${wickXs(lastMain).join(', ')})`)
})

test('a throwing draw or tick never stops the candles; the plugin is removed after ten', () => {
  for (const hook of ['draw', 'tick']) {
    const chart = charted()
    const errs = []
    chart.subscribe('error', (e) => errs.push(e.message))
    chart.addPlugin({ [hook]() { throw new Error('boom') } })
    for (let i = 0; i < 9; i++) {
      clearOps(chart)
      frame(chart)
      assert.ok(chart.layers.canvas.main.ops.length > 0, `${hook}: frame ${i} still drew the candles`)
    }
    assert.equal(chart._plugins.length, 1, `${hook}: nine failing frames are tolerated`)
    frame(chart)
    assert.equal(chart._plugins.length, 0, `${hook}: the tenth removes it`)
    assert.equal(errs.filter((m) => m === 'boom').length, 10)
    assert.equal(errs.filter((m) => /removed after 10/.test(m)).length, 1)
    assert.deepEqual(chart.layers.names, ['base', 'main', 'overlay'])
  }
})

test('frames that paint nothing do not reset the count of a plugin whose draw always throws', () => {
  const chart = charted()
  chart.subscribe('error', () => {})
  chart.addPlugin({ draw() { throw new Error('boom') } })
  for (let i = 0; i < 10; i++) {
    frame(chart, 16, ['plugins'])
    frame(chart, 16, ['overlay'])                      // a crosshair move: no paint
  }
  assert.equal(chart._plugins.length, 0)
})

test("each plugin's draw is bracketed by save and restore", () => {
  const chart = charted()
  chart.addPlugin({ draw: (c) => c.fillRect(1, 0, 0, 0) })
  chart.addPlugin({ draw: (c) => c.fillRect(2, 0, 0, 0) })
  const ops = chart.layers.canvas.plugins.ops
  ops.length = 0
  frame(chart, 16, ['plugins'])
  assert.deepEqual(ops.map((o) => (o.op === 'fillRect' ? o.args[0] : o.op)),
    ['clearRect', 'save', 1, 'restore', 'save', 2, 'restore'])
})

test('afterFrame runs after the frame has emitted its state events', () => {
  const chart = charted()
  const order = []
  chart.subscribe('visibleRange', () => order.push('visibleRange'))
  chart.addPlugin({ afterFrame: () => order.push('afterFrame') })
  order.length = 0
  chart.ts.panBy(-300)
  frame(chart)
  assert.deepEqual(order, ['visibleRange', 'afterFrame'])
})

// ----------------------------------------------------------------- input

test('a claimed press suppresses the pan; its moves and up go to the owner only', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true })
  chart.addPlugin(p)
  const right = chart.ts._right.target
  chart._onDown(mouse(400, 200)); chart._onMove(mouse(300, 260)); chart._onUp(mouse(300, 260))
  assert.deepEqual(p.log.filter((c) => /^pointer/.test(c[0])).map((c) => c[0]), ['pointerDown', 'pointerMove', 'pointerUp'])
  assert.equal(p.calls('pointerDown')[0][1].region, 'plot')
  assert.equal(p.calls('pointerMove')[0][1].x, 300)
  assert.equal(chart.ts._right.target, right, 'not one pixel of pan')
  chart._onMove(mouse(200, 260))
  assert.equal(chart.ts._right.target, right, 'and a later hover does not pan either')
  assert.equal(p.calls('pointerMove').length, 1, 'nor is it routed to the old owner')
})

test('during an owned gesture only the owner pointer is routed, and the raw crosshair stays put', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true, pointerMove: (e) => p.host.setCrosshair({ x: 123, y: 45 }) })
  chart.addPlugin(p)
  chart._onDown(touch(400, 200, 7))
  chart._onMove(mouse(380, 210, { pointerId: 1 }))    // some other pointer
  chart._onMove(touch(350, 220, 7))
  chart._onMove(touch(340, 230, 7))
  assert.deepEqual(p.calls('pointerMove').map((c) => c[1].x), [350, 340])
  assert.deepEqual(chart.cursor, { x: 123, y: 45 }, 'the crosshair is where the plugin put it')
})

test('a claim stops inertia, the hold timer and the sticky crosshair', async () => {
  const chart = charted({ touchCrosshairDelay: 0 })
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  assert.ok(chart.cursor, 'a tap left a sticky crosshair')
  // a flick, then grab the chart mid-coast
  chart._onDown(mouse(400, 200))
  chart._onMove(mouse(380, 200)); chart._onMove(mouse(340, 200)); chart._onUp(mouse(340, 200))
  assert.ok(chart.inertia.active, 'coasting')
  chart.addPlugin(recorder({ pointerDown: true }))
  chart._onDown(touch(400, 200, 3))
  assert.equal(chart.inertia.active, false, 'the claim stopped the coast')
  assert.equal(chart.cursor, null, 'a touch claim dismissed the sticky crosshair')
  await sleep(10)
  assert.equal(chart.cursor, null, 'and no hold timer fired')
  const right = chart.ts._right.target
  chart._onMove(touch(300, 200, 3))
  assert.equal(chart.ts._right.target, right)
})

test('a second finger cancels the owner and pinches', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true })
  chart.addPlugin(p)
  chart._onDown(touch(300, 200, 1))
  chart._onDown(touch(500, 200, 2))
  assert.equal(p.calls('pointerCancel').length, 1)
  same(chart._owner, null, 'no plugin owns a gesture')
  assert.equal(p.calls('pointerDown').length, 1, 'the second finger is never offered')
  const s = chart.ts._spacing.target
  chart._onMove(touch(300, 200, 1)); chart._onMove(touch(600, 200, 2))
  assert.notEqual(chart.ts._spacing.target, s, 'and the pair zooms')
  assert.deepEqual(p.calls('pointerMove'), [])
})

test('a browser pointercancel reaches the owner and forgets the pointer', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true })
  chart.addPlugin(p)
  chart._onDown(touch(300, 200, 1))
  chart._onCancel(touch(300, 200, 1))
  assert.equal(p.calls('pointerCancel').length, 1)
  assert.equal(p.calls('pointerUp').length, 0, 'exactly one way out')
  chart._onDown(touch(500, 200, 2))
  assert.equal(p.calls('pointerDown').length, 2, 'the next single finger is a press, not a pinch')
})

test('a claimed up forgets the pointer, so the next finger is not a pinch', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true })
  chart.addPlugin(p)
  chart._onDown(touch(300, 200, 1)); chart._onUp(touch(300, 200, 1))
  chart._onDown(touch(500, 200, 2))
  assert.equal(p.calls('pointerDown').length, 2)
  assert.equal(p.calls('pointerCancel').length, 0)
})

test('a throwing input hook reads as unclaimed and is reported', () => {
  const chart = charted()
  const errs = []
  chart.subscribe('error', (e) => errs.push(e.message))
  chart.addPlugin({ pointerDown() { throw new Error('bad hook') } })
  const right = chart.ts._right.target
  chart._onDown(mouse(400, 200)); chart._onMove(mouse(300, 200)); chart._onUp(mouse(300, 200))
  assert.deepEqual(errs, ['bad hook'])
  assert.notEqual(chart.ts._right.target, right, 'the chart panned as if nothing claimed it')
})

test('a hook that detaches its own plugin never leaves an owner behind', () => {
  const chart = charted()
  const p = { pointerDown() { chart.removePlugin(p); return true }, pointerMove() { throw new Error('routed to a detached plugin') } }
  chart.addPlugin(p)
  chart._onDown(mouse(400, 200))
  same(chart._owner, null, 'no plugin owns a gesture')
  chart._onMove(mouse(300, 200)); chart._onUp(mouse(300, 200))
})

// ------------------------------------------------------------------ taps

test('an unclaimed still press is offered as a tap at the down point, on touch and mouse', () => {
  for (const ev of [touch, mouse]) {
    const chart = charted()
    const p = recorder()
    chart.addPlugin(p)
    chart._onDown(ev(400, 200)); chart._onUp(ev(402, 201))
    const taps = p.calls('tap')
    assert.equal(taps.length, 1, ev.name)
    assert.deepEqual([taps[0][1].x, taps[0][1].y, taps[0][1].region], [400, 200, 'plot'])
  }
})

test('a pointercancel is never a tap', () => {
  const cases = {
    'touch pending': (c) => { c._onDown(touch(400, 200)); c._onCancel(touch(400, 200)) },
    'touch after a slop move': (c) => { c._onDown(touch(400, 200)); c._onMove(touch(400, 215)); c._onCancel(touch(400, 200)) },
    mouse: (c) => { c._onDown(mouse(400, 200)); c._onCancel(mouse(400, 200)) },
  }
  for (const [name, run] of Object.entries(cases)) {
    const chart = charted()
    const p = recorder()
    chart.addPlugin(p)
    run(chart)
    assert.equal(p.calls('tap').length, 0, name)
  }
})

test('touchCrosshair:false with 2px of finger jitter is still a tap', () => {
  const chart = charted({ touchCrosshair: false })
  const p = recorder()
  chart.addPlugin(p)
  chart._onDown(touch(400, 200)); chart._onMove(touch(402, 201)); chart._onUp(touch(402, 201))
  assert.equal(p.calls('tap').length, 1)
})

test('a slow 80px pan at one pixel per event is not a tap', () => {
  const chart = charted()
  const p = recorder()
  chart.addPlugin(p)
  chart._onDown(mouse(400, 200))
  for (let i = 1; i <= 80; i++) chart._onMove(mouse(400 - i, 200))
  for (let i = 79; i >= 0; i--) chart._onMove(mouse(400 - i, 200))   // and back where it started
  chart._onUp(mouse(400, 200))
  assert.equal(p.calls('tap').length, 0)
})

test('a right-click is not a tap', () => {
  const chart = charted()
  const p = recorder()
  chart.addPlugin(p)
  chart._onDown(mouse(400, 200, { button: 2 })); chart._onUp(mouse(400, 200, { button: 2 }))
  assert.equal(p.calls('tap').length, 0)
})

test('a tap on the price axis is offered on touch, with region priceAxis', () => {
  const chart = charted()
  const p = recorder()
  chart.addPlugin(p)
  const x = chart.plot.w + 20
  chart._onDown(touch(x, 200)); chart._onUp(touch(x, 200))
  const taps = p.calls('tap')
  assert.equal(taps.length, 1)
  assert.equal(taps[0][1].region, 'priceAxis')
  assert.equal(taps[0][1].pane.id, 'price')
})

test('a consumed tap places no crosshair and fires no markerClick', () => {
  const chart = charted()
  const clicks = []
  chart.subscribe('markerClick', (m) => clicks.push(m))
  chart.addPlugin(recorder({ tap: true }))
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  assert.equal(chart.cursor, null, 'no touch crosshair')

  const h = withMarker(chart, 1990)
  chart._onDown(mouse(h.x, h.y)); chart._onUp(mouse(h.x, h.y)); chart._onClick(mouse(h.x, h.y))
  assert.deepEqual(clicks, [])
})

test('an unconsumed tap still places the touch crosshair and a click still reaches markerClick', () => {
  const chart = charted()
  const clicks = []
  chart.subscribe('markerClick', (m) => clicks.push(m.id))
  chart.addPlugin(recorder({ tap: false }))
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  assert.ok(chart.cursor)
  const h = withMarker(chart, 1990)
  chart._onDown(mouse(h.x, h.y)); chart._onUp(mouse(h.x, h.y)); chart._onClick(mouse(h.x, h.y))
  assert.deepEqual(clicks, ['m1'])
})

// ---------------------------------------------------------- stuck owners

test('a down while a plugin still owns a gesture cancels that gesture first', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true })
  chart.addPlugin(p)
  chart._onDown(mouse(400, 200))                       // its up never comes
  chart._onDown(mouse(300, 200))
  assert.deepEqual(p.log.filter((c) => /^pointer/.test(c[0])).map((c) => c[0]),
    ['pointerDown', 'pointerCancel', 'pointerDown'])
})

test('a buttonless mouse move after a lost up ends the gesture as its pointerUp', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true })
  chart.addPlugin(p)
  chart._onDown(mouse(400, 200, { buttons: 1 }))
  chart._onMove(mouse(380, 200, { buttons: 1 }))
  chart._onMove(mouse(360, 200, { buttons: 0 }))       // the up went to a context menu
  assert.equal(p.calls('pointerUp').length, 1)
  same(chart._owner, null, 'no plugin owns a gesture')
  chart._onMove(mouse(340, 200, { buttons: 0 }))
  assert.equal(p.calls('pointerMove').length, 1, 'later moves are not routed')
  assert.ok(p.calls('hover').some((c) => c[1] && c[1].x === 340), 'they hover instead')
  assert.equal(p.calls('tap').length, 0)
})

test('a buttonless move also ends an unclaimed pan whose up was lost', () => {
  const chart = charted()
  chart.addPlugin(recorder())
  chart._onDown(mouse(400, 200, { buttons: 1 }))
  chart._onMove(mouse(380, 200, { buttons: 1 }))
  const right = chart.ts._right.target
  chart._onMove(mouse(300, 200, { buttons: 0 }))
  chart._onMove(mouse(200, 200, { buttons: 0 }))
  assert.equal(chart.ts._right.target, right, 'hovering no longer pans')
})

test('lostpointercapture cancels the owner, and is a no-op after a normal up', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true })
  chart.addPlugin(p)
  chart._onDown(mouse(400, 200))
  chart._onLostCapture(mouse(400, 200))
  assert.equal(p.calls('pointerCancel').length, 1)
  same(chart._owner, null, 'no plugin owns a gesture')
  chart._onDown(mouse(400, 200)); chart._onUp(mouse(400, 200))
  chart._onLostCapture(mouse(400, 200))
  assert.equal(p.calls('pointerCancel').length, 1, 'the capture a normal up releases is not a cancel')
  assert.equal(p.calls('pointerUp').length, 1)
})

test('a context menu mid-gesture cancels the owner and prevents the native menu', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true })
  chart.addPlugin(p)
  chart._onDown(mouse(400, 200))
  let prevented = 0
  chart._onContextMenu(mouse(400, 200, { preventDefault: () => prevented++ }))
  assert.equal(p.calls('pointerCancel').length, 1)
  assert.equal(prevented, 1)
  assert.equal(p.calls('contextMenu').length, 0, 'not offered: it ended a gesture')
})

test('a context menu is prevented only when a plugin consumes it', () => {
  let prevented = 0
  const ev = (x, y) => mouse(x, y, { preventDefault: () => prevented++ })
  const plain = charted()
  plain._onContextMenu(ev(400, 200))
  assert.equal(prevented, 0, 'a chart with no plugin never prevents the browser menu')

  const chart = charted()
  const p = recorder({ contextMenu: (e) => e.x > 450 })
  chart.addPlugin(p)
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  chart._onContextMenu({ clientX: 400, clientY: 200, preventDefault: () => prevented++ })
  assert.equal(prevented, 0, 'offered, declined, not prevented')
  assert.equal(p.calls('contextMenu')[0][1].pointerType, 'touch', 'typed by the press that opened it')
  chart._onContextMenu(ev(500, 200))
  assert.equal(prevented, 1, 'consumed, prevented')
})

// ---------------------------------------------------------------- release

test('after release() the rest of the press moves only the raw crosshair', () => {
  const chart = charted()
  const p = recorder({
    pointerDown: true,
    hover: (e) => (e ? { cursor: 'move' } : null),
    pointerMove: () => { p.host.setCursor('grabbing'); p.host.release() },
  })
  chart.addPlugin(p)
  chart._onMove(mouse(400, 200))
  assert.equal(chart.container.style.cursor, 'move')
  const right = chart.ts._right.target
  chart._onDown(mouse(400, 200))
  chart._onMove(mouse(390, 200))                       // the plugin hands the press back
  const hovers = p.calls('hover').length
  chart._onMove(mouse(300, 250))
  chart._onMove(mouse(200, 260))
  assert.deepEqual(chart.cursor, { x: 200, y: 260 }, 'the raw crosshair tracks')
  assert.equal(chart.ts._right.target, right, 'the chart does not pan')
  assert.equal(p.calls('hover').length, hovers, 'nothing is hover-tested for the rest of the press')
  assert.equal(p.calls('pointerMove').length, 1)
  assert.equal(chart.container.style.cursor, 'crosshair')
  chart._onUp(mouse(200, 260))
  assert.equal(p.calls('tap').length, 0, 'the up is not a tap')
  assert.equal(p.calls('pointerUp').length, 0, 'nor a pointerUp: the plugin let go')
  assert.equal(p.calls('pointerCancel').length, 0)
  chart._onMove(mouse(210, 260))
  assert.equal(p.calls('hover').length, hovers + 1, 'hover resumes after the up')
})

test('a released touch press draws no crosshair', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true, pointerMove: () => p.host.release() })
  chart.addPlugin(p)
  chart._onDown(touch(400, 200))
  chart._onMove(touch(390, 200))
  chart._onMove(touch(300, 200))
  assert.equal(chart.cursor, null)
  chart._onUp(touch(300, 200))
  assert.equal(chart.cursor, null)
  assert.equal(p.calls('tap').length, 0)
})

test('a released press whose up is lost stops being swallowed', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true, pointerMove: () => p.host.release() })
  chart.addPlugin(p)
  chart._onDown(mouse(400, 200, { buttons: 1 }))
  chart._onMove(mouse(390, 200, { buttons: 1 }))
  chart._onMove(mouse(380, 200, { buttons: 0 }))
  const n = p.calls('hover').length
  chart._onMove(mouse(370, 200, { buttons: 0 }))
  assert.equal(p.calls('hover').length, n + 1, 'hover works again')
})

// ------------------------------------------------------------------ hover

test('a plugin hover hit sets the cursor and occludes the marker under it', () => {
  const chart = charted()
  const hovered = []
  chart.subscribe('markerHover', (m) => hovered.push(m && m.id))
  const h = withMarker(chart, 1990)
  let hit = true
  chart.addPlugin(recorder({ hover: (e) => (e && hit ? { cursor: 'move' } : null) }))
  chart._onMove(mouse(h.x, h.y))
  assert.equal(chart.container.style.cursor, 'move')
  assert.deepEqual(hovered, [], 'the marker under the drawing is not hovered')
  hit = false
  chart._onMove(mouse(h.x + 0.5, h.y))
  assert.deepEqual(hovered, ['m1'], 'with nothing above it, it is')
  assert.equal(chart.container.style.cursor, 'pointer')
})

test('hover(null, reason): pan on an unclaimed pan press, leave on leave, occluded below a hit', () => {
  const chart = charted()
  const low = recorder({ hover: (e) => (e ? { cursor: 'low' } : null) })
  const top = recorder({ hover: (e) => (e ? { cursor: 'top' } : null) })
  chart.addPlugin(low).addPlugin(top)
  chart._onMove(mouse(400, 200))
  assert.deepEqual(low.calls('hover').map((c) => [c[1], c[2]]), [[null, 'occluded']])
  assert.equal(chart.container.style.cursor, 'top', 'the topmost plugin wins')
  chart._onDown(mouse(400, 200))
  assert.deepEqual(top.calls('hover').slice(-1).map((c) => [c[1], c[2]]), [[null, 'pan']])
  chart._onUp(mouse(400, 200))
  chart._onLeave()
  assert.deepEqual(top.calls('hover').slice(-1).map((c) => [c[1], c[2]]), [[null, 'leave']])
  assert.equal(chart.container.style.cursor, 'crosshair')
})

test('touch never hover-tests, and a hover result may place the crosshair', () => {
  const chart = charted()
  const p = recorder({ hover: (e) => (e ? { crosshair: { x: 10, y: 20 } } : null) })
  chart.addPlugin(p)
  chart._onDown(touch(400, 200)); chart._onMove(touch(400, 230)); chart._onUp(touch(400, 230))
  assert.equal(p.calls('hover').filter((c) => c[1]).length, 0)
  chart._onMove(mouse(400, 200))
  assert.deepEqual(chart.cursor, { x: 10, y: 20 })
})

// ---------------------------------------------------------------- dblclick

const panAway = (chart) => {
  chart.ts.panBy(-400)
  frame(chart)
  return chart.ts._right.target
}

test('a consumed doubleClick prevents the view reset', () => {
  const chart = charted()
  const p = recorder({ doubleClick: true })
  chart.addPlugin(p)
  const right = panAway(chart)
  chart._onDbl({ clientX: 400, clientY: 200 })
  assert.equal(chart.ts._right.target, right)
  assert.equal(p.calls('doubleClick').length, 1)
})

test('a dblclick after a claimed press does not reset the view', () => {
  const chart = charted()
  let claim = true
  chart.addPlugin(recorder({ pointerDown: () => claim }))
  const right = panAway(chart)
  chart._onDown(mouse(400, 200)); chart._onUp(mouse(400, 200))   // claimed: places a point
  claim = false
  chart._onDown(mouse(400, 200)); chart._onUp(mouse(400, 200))   // not claimed
  chart._onDbl({ clientX: 400, clientY: 200 })
  assert.equal(chart.ts._right.target, right, 'a fast click-click trendline is not a reset')
})

test('an unclaimed double-click still resets the view', () => {
  const chart = charted()
  chart.addPlugin(recorder())
  const right = panAway(chart)
  chart._onDown(mouse(400, 200)); chart._onUp(mouse(400, 200))
  chart._onDown(mouse(400, 200)); chart._onUp(mouse(400, 200))
  chart._onDbl({ clientX: 400, clientY: 200 })
  assert.notEqual(chart.ts._right.target, right)
})

test('after two touch taps the dblclick reports pointerType touch', () => {
  const chart = charted()
  const p = recorder()
  chart.addPlugin(p)
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  chart._onDown(touch(400, 200)); chart._onUp(touch(400, 200))
  chart._onDbl({ clientX: 400, clientY: 200 })
  assert.equal(p.calls('doubleClick')[0][1].pointerType, 'touch')
})

// -------------------------------------------------------------------- keys

test('a consumed keyDown prevents the arrow pan', () => {
  const chart = charted()
  const p = recorder({ keyDown: (e) => e.key === 'ArrowLeft' })
  chart.addPlugin(p)
  const right = chart.ts._right.target
  let prevented = 0
  chart._onKey({ key: 'ArrowLeft', preventDefault: () => prevented++ })
  assert.equal(chart.ts._right.target, right)
  assert.equal(prevented, 1)
  chart._onKey({ key: 'ArrowRight', preventDefault: () => prevented++ })
  assert.equal(prevented, 2, 'declined keys still work')
})

// --------------------------------------------------------------- crosshair

test('setCrosshair from tick lands in that frame and is announced after drawing', () => {
  const chart = charted()
  const heard = []
  chart.subscribe('crosshair', (p) => heard.push(chart.layers.canvas.main.ops.length))
  let place = true
  let hostRef = null
  chart.addPlugin({ tick: () => { if (place) { place = false; hostRef.setCrosshair({ x: 400, y: 200 }) } }, attach(h) { hostRef = h } })
  clearOps(chart)
  frame(chart)
  assert.equal(heard.length, 1)
  assert.ok(heard[0] > 0, 'the listener ran after the candles were drawn')
  assert.deepEqual(chart.cursor, { x: 400, y: 200 })
  assert.ok(chart.layers.canvas.overlay.ops.some((o) => o.op === 'stroke'), 'this frame drew it')
})

test('a throwing crosshair listener during re-derive frames is logged, never counted against the plugin', () => {
  const chart = charted()
  const errs = []
  chart.subscribe('error', (e) => errs.push(e))
  chart.subscribe('crosshair', () => { throw new Error('host legend bug') })
  let host = null
  chart.addPlugin({ attach(h) { host = h }, tick() { host.setCrosshair({ x: 400, y: 200 }); return true } })
  const orig = console.error
  const logged = []
  console.error = (...a) => logged.push(a)
  try {
    for (let i = 0; i < 12; i++) frame(chart)
  } finally {
    console.error = orig
  }
  assert.equal(chart._plugins.length, 1, 'the plugin is still attached')
  assert.deepEqual(errs, [])
  assert.equal(logged.length, 12)
})

test('setCrosshair outside a frame announces at once, and null clears', () => {
  const chart = charted()
  const heard = []
  chart.subscribe('crosshair', (p) => heard.push(p && p.index))
  const p = recorder()
  chart.addPlugin(p)
  p.host.setCrosshair({ x: 400, y: 200 })
  assert.equal(heard.length, 1)
  assert.ok(Number.isInteger(heard[0]))
  p.host.setCrosshair(null)
  assert.deepEqual(heard.slice(1), [null])
  assert.equal(chart.cursor, null)
})

// ------------------------------------------------------- exact crosshair

/** The crosshair's dashed lines on the overlay: [vertical x, horizontal y]. */
const crossLines = (chart) => {
  const ops = chart.layers.canvas.overlay.ops
  const mv = ops.filter((o) => o.op === 'moveTo')
  return [mv[0].args[0], mv[1].args[1]]
}

test('an exact crosshair is drawn where the plugin put it, with no slot or magnet snap', () => {
  const chart = charted()                              // magnet on
  const p = recorder()
  chart.addPlugin(p)
  const x = chart.ts.x(1990) + 3.2                     // between slots
  const y = chart.ps.y(24000) + 6                      // 6px off a close: the magnet would take it
  p.host.setCrosshair({ x, y })
  clearOps(chart); frame(chart, 16, ['overlay'])
  const snapped = crossLines(chart)
  assert.equal(snapped[0], Math.round(chart.ts.x(1990)) + 0.5, 'a raw point snaps to its slot')
  assert.equal(snapped[1], Math.round(chart.ps.y(24000)) + 0.5, 'and to the magnet')

  p.host.setCrosshair({ x, y, exact: true, price: 24000.123 })
  clearOps(chart); frame(chart, 16, ['overlay'])
  assert.deepEqual(crossLines(chart), [Math.round(x) + 0.5, Math.round(y) + 0.5])
  const texts = chart.layers.canvas.overlay.ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])
  assert.ok(texts.includes(p.host.formatPrice(24000.123)), `the tag reads the stored price (${texts.join(', ')})`)
})

test('an exact crosshair with a null price falls back to the y it is drawn at', () => {
  const chart = charted()
  const p = recorder()
  chart.addPlugin(p)
  const heard = []
  chart.subscribe('crosshair', (c) => heard.push(c && c.price))
  const y = chart.ps.y(24000.5)
  p.host.setCrosshair({ x: 300, y, exact: true, price: null })
  clearOps(chart); frame(chart, 16, ['overlay'])     // must not throw on null.toFixed()
  assert.ok(Math.abs(heard[0] - 24000.5) < 1e-6, 'the event reports ps.price(y), not null')
})

test("the crosshair event carries an exact point's stored price, not a y round-trip", () => {
  const chart = charted()
  const p = recorder()
  chart.addPlugin(p)
  const heard = []
  chart.subscribe('crosshair', (c) => heard.push(c && c.price))
  p.host.setCrosshair({ x: 300, y: 200, exact: true, price: 24000.123 })
  assert.deepEqual(heard, [24000.123])
})

test('tags:false draws the crosshair lines and leaves the axis tags to the plugin', () => {
  const chart = charted()
  const p = recorder()
  chart.addPlugin(p)
  p.host.setCrosshair({ x: 300, y: 200, exact: true, price: 24000, tags: false })
  clearOps(chart); frame(chart, 16, ['overlay'])
  const ops = chart.layers.canvas.overlay.ops
  assert.ok(ops.some((o) => o.op === 'stroke'))
  assert.equal(ops.filter((o) => o.op === 'fillText').length, 0)
})

test('a touch gesture a plugin claimed leaves no crosshair when it ends', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true, pointerMove: (e) => p.host.setCrosshair({ x: e.x, y: e.y, exact: true, price: 24000 }) })
  chart.addPlugin(p)
  chart._onDown(touch(400, 200)); chart._onMove(touch(380, 210))
  assert.ok(chart.cursor && chart.cursor.exact, 'the plugin placed an exact crosshair during its drag')
  chart._onUp(touch(380, 210))
  same(chart.cursor, null, 'dismissed with the finger')
})

// ------------------------------------------------------------------ cursor

test('cursor precedence is override, then plugin hover, then marker, then crosshair; writes dedupe', () => {
  const chart = charted()
  const h = withMarker(chart, 1990)
  let hit = null
  const p = recorder({ hover: (e) => (e && hit ? { cursor: hit } : null) })
  chart.addPlugin(p)
  const writes = cursorWrites(chart)
  chart._onMove(mouse(h.x, h.y))
  chart._onMove(mouse(h.x, h.y + 0.5))
  assert.deepEqual(writes, ['pointer'], 'marker, written once')
  hit = 'move'
  chart._onMove(mouse(h.x, h.y))
  p.host.setCursor('grabbing')
  p.host.setCursor('grabbing')
  p.host.setCursor(null)
  hit = null
  chart._onMove(mouse(100, 100))
  assert.deepEqual(writes, ['pointer', 'move', 'grabbing', 'move', 'crosshair'])
})

test('setHover reports what a plugin has under the pointer, and clears only its own', () => {
  const chart = charted()
  const a = recorder()
  const b = recorder()
  chart.addPlugin(a).addPlugin(b)
  a.host.setHover('text')
  assert.equal(chart.container.style.cursor, 'text')
  b.host.setHover(null)
  assert.equal(chart.container.style.cursor, 'text', "b cannot clear a's hover")
  a.host.setHover(null)
  assert.equal(chart.container.style.cursor, 'crosshair')
})

// --------------------------------------------------------------- lifecycle

test('removePlugin mid-gesture cancels it before detaching', () => {
  const chart = charted()
  const p = recorder({ pointerDown: true })
  chart.addPlugin(p)
  chart._onDown(mouse(400, 200))
  p.host.setCursor('grabbing')
  chart.removePlugin(p)
  assert.deepEqual(p.log.slice(-2).map((c) => c[0]), ['pointerCancel', 'detach'])
  same(chart._owner, null, 'no plugin owns a gesture')
  assert.equal(chart.container.style.cursor, 'crosshair')
  chart.removePlugin(p)                                // a no-op
  assert.equal(p.calls('detach').length, 1)
})

test('destroy removes plugins in reverse, while their layer exists, and both new listeners', () => {
  const chart = charted()
  const order = []
  const mk = (name) => ({ detach() { order.push([name, !!chart.layers.ctx.plugins]) } })
  chart.addPlugin(mk('a')).addPlugin(mk('b'))
  const el = chart.container
  assert.equal(el.listeners.get('contextmenu').size, 1)
  assert.equal(el.listeners.get('lostpointercapture').size, 1)
  chart.destroy()
  assert.deepEqual(order, [['b', true], ['a', true]])
  assert.equal(chart._plugins.length, 0)
  assert.equal(el.listeners.get('contextmenu').size, 0)
  assert.equal(el.listeners.get('lostpointercapture').size, 0)
})

// ------------------------------------------------------------------ export

test('toImage re-renders first, then paints the plugin pass on the composite', () => {
  const chart = charted()
  const k = 1500
  const draws = []
  chart.addPlugin({
    draw(ctx, info) {
      const x = Math.round(chart.ts.x(k)) + (chart.ts.barWidth() % 2 ? 0.5 : 0)
      draws.push({ ctx, exporting: info.exporting, x })
      ctx.moveTo(x, 0)
    },
  })
  frame(chart)
  chart.fitContent()                                   // synchronous: base/main are now stale
  clearOps(chart)
  draws.length = 0
  const created = []
  const doc = globalThis.document
  const make = doc.createElement
  doc.createElement = (tag) => { const c = make(tag); created.push(c); return c }
  let url
  try { url = chart.toImage() } finally { doc.createElement = make }
  assert.equal(url, 'data:image/png;base64,')

  const live = draws.filter((d) => !d.exporting)
  const exp = draws.filter((d) => d.exporting)
  assert.equal(live.length, 1, 'the live layer was repainted by the re-render, chrome included')
  same(live[0].ctx, chart.layers.ctx.plugins, 'the re-render painted the live layer')
  assert.equal(exp.length, 1)
  assert.ok(exp[0].ctx !== chart.layers.ctx.plugins, 'the export pass never touches the live canvas')
  assert.equal(exp[0].x, Math.round(chart.ts.x(k)) + (chart.ts.barWidth() % 2 ? 0.5 : 0))
  assert.ok(wickXs(chart.layers.canvas.main.ops).includes(exp[0].x), 'on the candles of the same re-render')

  const out = created[created.length - 1]
  const drawn = out.ops.filter((o) => o.op === 'drawImage' || o.op === 'moveTo')
    .map((o) => (o.op === 'moveTo' ? 'pass' : chart.layers.names.find((n) => chart.layers.canvas[n] === o.args[0])))
  assert.deepEqual(drawn, ['base', 'main', 'pass', 'overlay'], 'between main and the crosshair, live plugins layer left out')
  assert.equal(chart._pluginInfo.exporting, false, 'and the flag is put back')
})

test('toImage with no plugin is the plain composite', () => {
  const chart = charted()
  clearOps(chart)
  assert.equal(chart.toImage(), 'data:image/png;base64,')
  assert.equal(chart.layers.canvas.main.ops.length, 0, 'no re-render')
})

// ------------------------------------------------------------------- host

test('the host exposes the chart through getters that stay live', () => {
  const chart = charted()
  const p = recorder()
  chart.addPlugin(p)
  const h = p.host
  same(h.chart, chart, 'h.chart')
  same(h.ts, chart.ts, 'h.ts')
  same(h.bars, chart.bars, 'h.bars')
  same(h.source, chart.bars, 'h.source')
  same(h.replay, null, 'h.replay')
  same(h.panes, chart._panes, 'h.panes')
  assert.equal(h.width, 900)
  assert.equal(h.height, 500)
  assert.equal(h.pixelRatio, 1)
  assert.equal(h.plotBottom, chart.plot.y + chart.plot.h)
  assert.equal(h.magnet, true)
  assert.equal(h.animate, true)
  assert.equal(h.exporting, false)
  assert.equal(h.timeframeMs, MIN)
  chart.setAnimate(false)
  chart.setMagnet(false)
  assert.equal(h.animate, false)
  assert.equal(h.magnet, false)
  const gen = h.barGen
  const replay = chart.startReplay({ from: 500 })
  same(h.replay, replay, 'h.replay')
  assert.equal(h.source.length, 2000, 'source is the whole dataset')
  assert.ok(h.bars.length < 2000, 'bars is what is revealed')
  assert.notEqual(h.barGen, gen)
  chart.addPane('rsi', { weight: 1 })
  assert.equal(h.paneById('rsi').id, 'rsi')
  assert.equal(h.paneById('nope'), null)
  const rsi = h.paneById('rsi')
  same(h.paneAt(rsi.rect.y + 5), rsi, 'paneAt')
  assert.equal(h.plotBottom, rsi.rect.y + rsi.rect.h)
})

test('host.reportError surfaces as a chart error with the phase', () => {
  const chart = charted()
  const got = []
  chart.subscribe('error', (e) => got.push(e.message))
  const p = recorder()
  chart.addPlugin(p)
  const orig = console.error
  const logged = []
  console.error = (...a) => logged.push(a[0])
  chart._listeners.error.clear()
  try { p.host.reportError(new Error('x'), 'draw') } finally { console.error = orig }
  assert.deepEqual(logged, ['[Emberwick] plugin draw failed'])
})

test('host.formatPrice uses the decimals of the pane axis it names', () => {
  const chart = charted({ magnet: false })
  const p = recorder()
  chart.addPlugin(p)
  chart.addPane('rsi', { weight: 1 })
  chart.setSeries('r', { pane: 'rsi', data: chart.bars.map((b, i) => ({ time: b.time, value: 30 + (i % 40) + 0.123 })) })
  settle(chart)
  for (const id of ['price', 'rsi']) {
    const pane = chart._paneById.get(id)
    const y = pane.rect.y + pane.rect.h / 2
    chart._onMove(mouse(300, y))
    clearOps(chart)
    frame(chart)
    const tag = chart.layers.canvas.overlay.ops.find((o) => o.op === 'fillText' && o.args[1] === chart.plot.w + 8)
    assert.ok(tag, `${id}: a price tag was drawn`)
    assert.equal(p.host.formatPrice(pane.ps.price(y), pane), tag.args[0], `${id}: same decimals as the crosshair`)
  }
})

// ----------------------------------------------------------------- exports

test('the core entry exports the coercion and dash table plugins share with it', async () => {
  const core = await import('../src/chart/index.js')
  const { toNumber } = await import('../src/chart/core/formatters.js')
  const { DASH } = await import('../src/chart/render/style.js')
  same(core.toNumber, toNumber, 'the same toNumber the core coerces with')
  same(core.DASH, DASH, 'the same dash table price lines and series use')
  assert.equal(core.toNumber('24000.5'), 24000.5)
  assert.ok(Number.isNaN(core.toNumber(null)), 'null is not 0')
  assert.match(core.version, /^\d+\.\d+\.\d+$/)
})
