/**
 * The core plugin seam, and the frame fixes it depends on.
 *
 * Everything here drives the real handlers (chart._onDown & co.) and real
 * frames through dom-stub, and asserts on what reached each canvas — the
 * recording context has no state stack, so isolation is proven by op order.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle, clearOps } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart, Smoothed } = await import('../src/chart/index.js')
const { Layers } = await import('../src/chart/core/Layers.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

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
  assert.equal(ctx, layers.ctx.plugins)
  assert.equal(layers.add('plugins', 'overlay'), ctx, 'idempotent')
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
  const drawn = out.ops.filter((o) => o.op === 'drawImage').map((o) => o.args[0])
  assert.deepEqual(drawn, ['base', 'main', 'plugins', 'overlay'].map((n) => layers.canvas[n]))
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
