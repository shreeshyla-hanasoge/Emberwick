/**
 * The nine drawing tools, as pure ToolDefs.
 *
 * Every tool is driven the way the scene drives it: normalized options,
 * screen anchors already projected, project() into a reused geometry, then
 * draw() into a recording context, hit(), handles() and dragHandle(). The
 * context, scales and panes are small fakes (§11: pure units test against
 * fakes), so each test controls exactly the numbers it asserts on.
 *
 * Canvas output is asserted as op sequences (§9 rule 2): the recording ctx
 * has no state to read back, and tools must never read it anyway.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeCanvas } from './dom-stub.mjs'
import { defaultTheme, lightTheme, TimeScale, PriceScale } from '../src/chart/index.js'
import { drawCandles } from '../src/chart/render/candles.js'
import { drawingTheme } from '../src/drawings/render/theme.js'
import { formatSpan } from '../src/drawings/render/labels.js'
import { trendLine } from '../src/drawings/tools/trendLine.js'
import { horizontalLine } from '../src/drawings/tools/horizontalLine.js'
import { verticalLine } from '../src/drawings/tools/verticalLine.js'
import { rectangle } from '../src/drawings/tools/rectangle.js'
import { parallelChannel } from '../src/drawings/tools/parallelChannel.js'
import { fibRetracement } from '../src/drawings/tools/fibRetracement.js'
import { measure } from '../src/drawings/tools/measure.js'
import { position } from '../src/drawings/tools/position.js'
import { text } from '../src/drawings/tools/text.js'

const T0 = 1_700_000_000_000
const MIN = 60_000
const ALL = [trendLine, horizontalLine, verticalLine, rectangle, parallelChannel, fibRetracement, measure, position, text]

/* ------------------------------------------------------------- fakes -- */

/** Uniform bars, one a minute, OHLC around `price`. */
function bars(n, price = 100, f) {
  return Array.from({ length: n }, (_, i) => {
    const b = { time: T0 + i * MIN, open: price, high: price + 1, low: price - 1, close: price, volume: 10 }
    return f ? f(b, i) : b
  })
}

/** A price scale: linear or log between lo and hi over [top, top + height]. */
function fakePs({ lo = 90, hi = 110, top = 0, height = 400, mode = 'linear' } = {}) {
  const fwd = (p) => (mode === 'log' ? Math.log(Math.max(p, 1e-9)) : p)
  const inv = (v) => (mode === 'log' ? Math.exp(v) : v)
  const a = fwd(lo)
  const b = fwd(hi)
  return {
    mode, lo, hi, top, height, primed: true,
    y: (p) => top + height * (1 - (fwd(p) - a) / (b - a)),
    price: (y) => inv(a + (1 - (y - top) / height) * (b - a)),
  }
}

/** A time scale: bar u at x = width − (right − u)·spacing, as the core's. */
function fakeTs({ width = 800, right = 99, spacing = 8 } = {}) {
  return {
    width, spacing,
    x: (u) => width - (right - u) * spacing,
    index: (x) => right - (width - x) / spacing,
    barWidth: () => Math.max(1, Math.floor(spacing * 0.72)),
  }
}

/**
 * A ToolContext over uniform minute bars. `revealed` < source length models
 * a replay: `bars` is the revealed prefix, `source` everything.
 */
function makeCtx(opts = {}) {
  const source = opts.source || bars(100)
  const revealed = opts.revealed == null ? source.length : opts.revealed
  const shown = source.slice(0, revealed)
  const mode = opts.mode || 'linear'
  const ps = opts.ps || fakePs({ mode, ...(opts.psOpts || {}) })
  const ts = opts.ts || fakeTs(opts.tsOpts || {})
  const rect = opts.rect || { x: 0, y: 0, w: 800, h: 400 }
  const pane = { id: 'price', rect, ps, visible: [] }
  const panes = opts.panes || [pane]
  const host = { ts, panes, plotBottom: opts.plotBottom || 600, bars: shown, source }
  const last = source.length - 1
  const t0 = source.length ? source[0].time : 0
  return {
    host, pane, bars: shown, source, tf: MIN,
    dataRev: opts.dataRev || 1,
    theme: opts.theme || drawingTheme(defaultTheme),
    exporting: false,
    pointerType: opts.pointerType || 'mouse',
    visibleBars: opts.visibleBars || 120,
    formatPrice: (p) => (+p).toFixed(2),
    formatTime: (t) => new Date(t).toISOString().slice(11, 16),
    formatSpan,
    fwd: (p) => (mode === 'log' ? Math.log(Math.max(p, 1e-9)) : p),
    inv: (v) => (mode === 'log' ? Math.exp(v) : v),
    timeAt: (u) => (source.length && isFinite(u) ? t0 + u * MIN : null),
    indexOf: (pt) => (pt.time - t0) / MIN + (pt.offset || 0),
    pointAt: (u, price) => {
      if (!source.length || !isFinite(u)) return null
      if (u > last) return { time: source[last].time, price, offset: u - last, tf: MIN }
      if (u < 0) return { time: t0, price, offset: u, tf: MIN }
      return { time: t0 + u * MIN, price }
    },
    textWidth: (font, s) => String(s).length * 6,
  }
}

/** What the scene hands project(): screen anchors with residuals applied (none here). */
function anchorsOf(d, ctx) {
  return d.points.map((pt) => {
    const u = ctx.indexOf(pt)
    return { x: ctx.host.ts.x(u), y: ctx.pane.ps.y(pt.price), u, time: pt.time, price: pt.price, approx: !!pt.offset }
  })
}

const pt = (u, price) => ({ time: T0 + u * MIN, price })

/** A normalized, frozen drawing, as unit B would store it. */
function mk(tool, points, options, style) {
  const d = {
    v: 1, id: tool.type + ':1', type: tool.type, pane: 'price',
    points: tool.normalizePoints ? tool.normalizePoints(points) : points,
    style: { ...tool.defaultStyle, ...(style || {}) },
    options: tool.normalizeOptions(options || {}),
    locked: false, visible: true, z: 0,
  }
  return deepFreeze(d)
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const k of Object.keys(o)) deepFreeze(o[k])
  }
  return o
}

const LOOK = Object.freeze({
  hover: 0, select: 0, press: 0, pressedHandle: -1, alpha: 1, reveal: 1, age: 1e9, stats: 0,
  preview: false, exporting: false, locked: false, handleR: 4.5, shake: 0, warnPulse: 0, editing: false,
})
const look = (over) => ({ ...LOOK, ...(over || {}) })

/** Project and draw one drawing; returns { g, ops, ok }. */
function paint(tool, d, ctx, lk) {
  const g = { clip: 'pane' }
  const ok = tool.project(d, anchorsOf(d, ctx), ctx, g)
  const canvas = makeCanvas()
  const c = canvas.getContext('2d')
  if (ok) tool.draw(c, g, d, lk || look(), ctx)
  return { g, ops: canvas.ops, ok }
}

/** Every stroked straight segment, as [x0, y0, x1, y1], from an op log. */
function strokedSegments(ops) {
  const out = []
  let path = []
  let last = null
  for (const o of ops) {
    if (o.op === 'beginPath') { path = []; last = null }
    else if (o.op === 'moveTo') last = [o.args[0], o.args[1]]
    else if (o.op === 'lineTo') {
      if (last) path.push([last[0], last[1], o.args[0], o.args[1]])
      last = [o.args[0], o.args[1]]
    } else if (o.op === 'stroke') out.push(...path)
  }
  return out
}

const texts = (ops) => ops.filter((o) => o.op === 'fillText').map((o) => String(o.args[0]))
const sets = (ops, prop) => ops.filter((o) => o.op === 'set' && o.prop === prop).map((o) => o.value)
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

/* ------------------------------------------------------- every tool -- */

test('every tool normalizes options into a new object of known keys, falling back on bad enums', () => {
  for (const tool of ALL) {
    const raw = { junk: 1, extend: 'sideways', side: 'up', span: 'half', labels: 'maybe', align: 'justify' }
    Object.defineProperty(raw, '__proto__', { value: { polluted: true }, enumerable: true })
    const o = tool.normalizeOptions(raw)
    assert.notEqual(o, raw)
    assert.ok(!('junk' in o), `${tool.type} copied an unknown key`)
    assert.ok(!Object.prototype.hasOwnProperty.call(o, '__proto__'), `${tool.type} copied __proto__`)
    assert.equal(o.polluted, undefined)
    assert.deepEqual(Object.keys(o).sort(), Object.keys(tool.defaultOptions).sort(), tool.type)
    for (const k of Object.keys(tool.defaultOptions)) {
      if (k === 'levels') continue
      assert.deepEqual(o[k], tool.defaultOptions[k], `${tool.type}.${k} falls back to its default`)
    }
    // Non-objects read as "no options".
    for (const bad of [null, undefined, 42, 'x', []]) {
      assert.deepEqual(Object.keys(tool.normalizeOptions(bad)).sort(), Object.keys(tool.defaultOptions).sort())
    }
  }
})

test('every tool paints with absolute state only and never reads the context back', () => {
  const STATE = new Set(['globalAlpha', 'lineWidth', 'strokeStyle', 'fillStyle', 'font', 'textAlign', 'textBaseline', 'lineCap', 'lineJoin'])
  const strict = () => {
    const ops = []
    const c = new Proxy({}, {
      get(t, k) {
        if (STATE.has(k)) throw new Error(`read context state: ${String(k)}`)
        if (k === 'measureText') return (s) => ({ width: String(s).length * 6 })
        return (...args) => { ops.push({ op: k, args }) }
      },
      set(t, k, v) { ops.push({ op: 'set', prop: k, value: v }); return true },
    })
    return { c, ops }
  }
  const ctx = makeCtx()
  const cases = [
    [trendLine, [pt(40, 95), pt(80, 105)], { text: 'Breakout', endCap: 'arrow', stats: 'always' }],
    [horizontalLine, [pt(50, 100)], { text: 'R1' }],
    [verticalLine, [pt(50, 100)], { text: 'FOMC' }],
    [rectangle, [pt(40, 95), pt(80, 105)], { text: 'Zone', middleLine: true, stats: 'always' }],
    [parallelChannel, [pt(40, 95), pt(80, 100), pt(60, 104)], {}],
    [fibRetracement, [pt(40, 95), pt(80, 105)], {}],
    [measure, [pt(40, 95), pt(80, 105)], {}],
    [position, [pt(40, 100), pt(70, 104), pt(70, 98)], { qty: 10 }],
    [text, [pt(50, 100)], { text: 'Note\nline 2', background: true }],
  ]
  for (const [tool, points, options] of cases) {
    const d = mk(tool, points, options)
    const g = { clip: 'pane' }
    assert.ok(tool.project(d, anchorsOf(d, ctx), ctx, g), `${tool.type} is visible`)
    const { c, ops } = strict()
    tool.draw(c, g, d, look({ hover: 1, select: 1 }), ctx)
    assert.ok(ops.some((o) => o.op === 'stroke' || o.op === 'fill' || o.op === 'fillRect' || o.op === 'fillText'), `${tool.type} drew`)
  }
})

test('every tool assigns the theme colour immediately before an invalid style colour', () => {
  const ctx = makeCtx()
  const cases = [
    [trendLine, [pt(40, 95), pt(80, 105)], 'strokeStyle'],
    [horizontalLine, [pt(50, 100)], 'strokeStyle'],
    [verticalLine, [pt(50, 100)], 'strokeStyle'],
    [rectangle, [pt(40, 95), pt(80, 105)], 'strokeStyle'],
    [parallelChannel, [pt(40, 95), pt(80, 100), pt(60, 104)], 'strokeStyle'],
  ]
  for (const [tool, points, prop] of cases) {
    const { ops } = paint(tool, mk(tool, points, {}, { color: 'not-a-colour' }), ctx)
    const i = ops.findIndex((o) => o.op === 'set' && o.prop === prop && o.value === 'not-a-colour')
    assert.ok(i > 0, `${tool.type} assigned its style colour`)
    const prev = ops[i - 1]
    assert.equal(prev.op, 'set')
    assert.equal(prev.prop, prop)
    assert.equal(prev.value, ctx.theme.line, `${tool.type}: theme colour first, so a bad colour falls back to it`)
  }
})

test('a drawing with non-finite anchors projects nothing and draws nothing', () => {
  const ctx = makeCtx()
  for (const tool of ALL) {
    const n = tool.anchors
    const a = Array.from({ length: n }, () => ({ x: NaN, y: 10, u: 1, time: T0, price: 100, approx: false }))
    const g = { clip: 'pane' }
    const d = mk(tool, Array.from({ length: n }, (_, i) => pt(10 + i, 100)))
    assert.equal(tool.project(d, a, ctx, g), false, tool.type)
    assert.equal(tool.hit(g, 10, 10, 5), null, tool.type)
  }
})

/* ---------------------------------------------------------- trendLine -- */

test('a ray extends past P1 only, an extended line both ways, a plain line not at all', () => {
  const ctx = makeCtx()
  const pts = [pt(40, 98), pt(60, 102)]
  const a = anchorsOf(mk(trendLine, pts), ctx)
  const seg = (extend) => {
    const g = { clip: 'pane' }
    trendLine.project(mk(trendLine, pts, { extend }), a, ctx, g)
    return g.seg
  }
  const none = seg('none')
  assert.ok(near(none.ax, a[0].x) && near(none.bx, a[1].x))
  const right = seg('right')
  assert.ok(near(right.ax, a[0].x), 'a ray keeps its start')
  assert.ok(near(right.bx, 800) || near(right.by, 0), 'and runs to the pane edge past P1')
  const left = seg('left')
  assert.ok(near(left.bx, a[1].x), 'extend left keeps P1')
  assert.ok(left.ax < a[0].x)
  const both = seg('both')
  assert.ok(both.ax < a[0].x && both.bx > a[1].x)
})

test('an extended line to a far-off price hands the canvas only coordinates on the pane', () => {
  const ctx = makeCtx()
  const d = mk(trendLine, [pt(40, 100), pt(41, 1e12)], { extend: 'both', endCap: 'arrow' })
  const { ops, ok } = paint(trendLine, d, ctx)
  assert.ok(ok)
  for (const o of ops) {
    if (o.op !== 'moveTo' && o.op !== 'lineTo') continue
    assert.ok(o.args[0] >= -1 && o.args[0] <= 801 && o.args[1] >= -1 && o.args[1] <= 401, `bounded: ${o.args}`)
  }
})

test('two anchors under a pixel apart draw without extension', () => {
  const ctx = makeCtx()
  const d = mk(trendLine, [pt(50, 100), pt(50.05, 100)], { extend: 'both' })
  const g = { clip: 'pane' }
  trendLine.project(d, anchorsOf(d, ctx), ctx, g)
  assert.equal(g.infinite, false)
  assert.ok(g.seg.bx - g.seg.ax < 1)
})

test('a trend line is hit along its stroke within tolerance, not beside it', () => {
  const ctx = makeCtx()
  const d = mk(trendLine, [pt(40, 95), pt(80, 105)])
  const { g } = paint(trendLine, d, ctx)
  const mx = (g.p0.x + g.p1.x) / 2
  const my = (g.p0.y + g.p1.y) / 2
  assert.deepEqual(trendLine.hit(g, mx, my + 3, 5), { part: 'body' })
  assert.equal(trendLine.hit(g, mx, my + 20, 5), null)
  // Beyond P1 a plain segment ends; a ray does not.
  assert.equal(trendLine.hit(g, g.p1.x + 40, g.p1.y - 40 * (g.p1.y - g.p0.y) / (g.p0.x - g.p1.x), 5), null)
})

test('the arrow cap is drawn at P1 and the shaft stops at its base', () => {
  const ctx = makeCtx()
  const d = mk(trendLine, [pt(40, 100), pt(80, 100)], { endCap: 'arrow' })
  const { g, ops } = paint(trendLine, d, ctx)
  const fills = ops.findIndex((o) => o.op === 'fill')
  assert.ok(fills > 0, 'an arrowhead was filled')
  const tip = ops.slice(0, fills).reverse().find((o) => o.op === 'moveTo')
  assert.ok(near(tip.args[0], g.p1.x) && near(tip.args[1], g.p1.y), 'its tip is P1')
  const shaft = strokedSegments(ops).at(-1)
  assert.ok(shaft[2] < g.p1.x - 5, 'the shaft stops short of the tip')
})

test('the trend line text is drawn along the line and hit as a label', () => {
  const ctx = makeCtx()
  const d = mk(trendLine, [pt(40, 100), pt(80, 100)], { text: 'Breakout' })
  const { g, ops } = paint(trendLine, d, ctx)
  assert.deepEqual(texts(ops), ['Breakout'])
  assert.ok(ops.some((o) => o.op === 'rotate'))
  const mx = (g.p0.x + g.p1.x) / 2
  assert.deepEqual(trendLine.hit(g, mx, g.p0.y - 10, 5), { part: 'label' })
})

test('trend line stats read the change, the bar count and the clock span', () => {
  const ctx = makeCtx()
  const d = mk(trendLine, [pt(40, 100), pt(78, 101.52)])
  const lines = trendLine.stats(d, anchorsOf(d, ctx), ctx)
  assert.deepEqual(lines, ['+1.52 (+1.52%)', '38 bars · 38m'])
  const never = mk(trendLine, [pt(40, 100), pt(78, 101.52)], { stats: 'never' })
  assert.deepEqual(trendLine.stats(never, anchorsOf(never, ctx), ctx), [])
})

test('a span involving a point stored as a bar count reads approximate', () => {
  const ctx = makeCtx()
  const d = mk(trendLine, [pt(90, 100), { time: T0 + 99 * MIN, price: 99, offset: 11, tf: MIN }])
  const [, span] = trendLine.stats(d, anchorsOf(d, ctx), ctx)
  assert.equal(span, '20 bars · ≈20m')
})

test('stats show while selected, always with "always", and never in an export', () => {
  const ctx = makeCtx()
  const statsDrawn = (options, lk) => texts(paint(trendLine, mk(trendLine, [pt(40, 100), pt(60, 102)], options), ctx, look(lk)).ops).length
  assert.equal(statsDrawn({}, {}), 0, 'active: hidden at rest')
  assert.equal(statsDrawn({}, { select: 1 }), 2, 'active: shown when selected')
  assert.equal(statsDrawn({}, { stats: 1 }), 2, 'active: shown while motion says so')
  assert.equal(statsDrawn({ stats: 'always' }, {}), 2)
  assert.equal(statsDrawn({ stats: 'never' }, { select: 1 }), 0)
  assert.equal(statsDrawn({ stats: 'always' }, { exporting: true }), 0)
})

test('a trend line offers two handles, plus a move handle on touch', () => {
  const ctx = makeCtx()
  const { g } = paint(trendLine, mk(trendLine, [pt(40, 95), pt(80, 105)]), ctx)
  const out = []
  assert.equal(trendLine.handles(g, null, out, false), 2)
  assert.deepEqual(out.map((h) => [h.index, h.axis]), [[0, 'xy'], [1, 'xy']])
  const again = out[0]
  assert.equal(trendLine.handles(g, null, out, true), 3)
  assert.equal(out[0], again, 'the scratch objects are reused, not reallocated')
  assert.equal(out[2].move, true)
  assert.ok(near(out[2].x, (g.p0.x + g.p1.x) / 2))
})

test('dragging a trend line handle moves only that point', () => {
  const d = mk(trendLine, [pt(40, 95), pt(80, 105)])
  const s = { point: pt(50, 99), u: 50, x: 0, y: 0 }
  const moved = trendLine.dragHandle(d, 1, s)
  assert.equal(moved[0], d.points[0])
  assert.equal(moved[1], s.point)
  assert.equal(trendLine.angleOrigin(d, 1), 0)
  assert.equal(trendLine.angleOrigin(d, 0), 1)
})

test('a trend line price at a time is extension-aware and straight in log space', () => {
  const lin = makeCtx()
  const d = mk(trendLine, [pt(10, 100), pt(20, 110)])
  assert.equal(trendLine.priceAt(d, 15, lin), 105)
  assert.equal(trendLine.priceAt(d, 25, lin), null)
  const ray = mk(trendLine, [pt(10, 100), pt(20, 110)], { extend: 'right' })
  assert.equal(trendLine.priceAt(ray, 30, lin), 120)
  assert.equal(trendLine.priceAt(ray, 5, lin), null)
  const log = makeCtx({ mode: 'log' })
  const g = mk(trendLine, [pt(10, 100), pt(20, 400)])
  assert.ok(near(trendLine.priceAt(g, 15, log), 200, 1e-9), 'midpoint of a straight log line is the geometric mean')
})

test('a trend line bleeds by its stats pill so it is not culled mid-pan', () => {
  const ctx = makeCtx()
  const { g } = paint(trendLine, mk(trendLine, [pt(40, 95), pt(80, 105)], { stats: 'always' }), ctx)
  assert.ok(trendLine.bleed(null, g, ctx) > 40)
  const { g: g2 } = paint(trendLine, mk(trendLine, [pt(40, 95), pt(80, 105)]), ctx)
  assert.equal(trendLine.bleed(null, g2, ctx), 12)
})

/* ------------------------------------------------------ horizontalLine -- */

test('a horizontal line spans the plot; a horizontal ray starts at its anchor', () => {
  const ctx = makeCtx()
  const line = paint(horizontalLine, mk(horizontalLine, [pt(50, 100)]), ctx)
  const ray = paint(horizontalLine, mk(horizontalLine, [pt(50, 100)], { extend: 'right' }), ctx)
  const [l] = strokedSegments(line.ops)
  const [r] = strokedSegments(ray.ops)
  const y = Math.round(ctx.pane.ps.y(100)) + 0.5
  assert.deepEqual(l, [0, y, 800, y])
  assert.deepEqual(r, [ctx.host.ts.x(50), y, 800, y])
})

test('a horizontal line is dragged by its axis tag in the price axis', () => {
  const ctx = makeCtx()
  const { g } = paint(horizontalLine, mk(horizontalLine, [pt(50, 100)]), ctx)
  assert.deepEqual(horizontalLine.hit(g, 820, g.y + 6, 5), { part: 'tag' })
  assert.equal(horizontalLine.hit(g, 820, g.y + 30, 5), null)
  assert.deepEqual(horizontalLine.hit(g, 300, g.y - 3, 5), { part: 'body' })
  const off = paint(horizontalLine, mk(horizontalLine, [pt(50, 100)], { axisLabel: false }), ctx)
  assert.equal(horizontalLine.hit(off.g, 820, off.g.y, 5), null, 'no tag, nothing to grab in the axis')
})

test('a horizontal line tags its price in its own colour, and not when scrolled off its pane', () => {
  const ctx = makeCtx()
  const d = mk(horizontalLine, [pt(50, 101.5)], {}, { color: '#ff00aa' })
  const { g } = paint(horizontalLine, d, ctx)
  const out = []
  assert.equal(horizontalLine.axisTags(g, d, ctx, out), 1)
  assert.deepEqual({ ...out[0] }, { axis: 'price', pos: g.y, text: '101.50', color: '#ff00aa' })
  const plain = mk(horizontalLine, [pt(50, 101.5)])
  horizontalLine.axisTags(g, plain, ctx, out)
  assert.equal(out[0].color, ctx.theme.line)
  const gone = paint(horizontalLine, mk(horizontalLine, [pt(50, 150)]), ctx)
  assert.equal(gone.ok, false)
  assert.equal(horizontalLine.axisTags(gone.g, d, ctx, out), 0)
})

test('a horizontal line handle moves its price only; a ray handle moves both', () => {
  const ctx = makeCtx()
  const d = mk(horizontalLine, [pt(50, 100)])
  const { g } = paint(horizontalLine, d, ctx)
  const out = []
  horizontalLine.handles(g, d, out, false)
  assert.equal(out[0].axis, 'y')
  const s = { point: pt(70, 103), u: 70 }
  assert.deepEqual(horizontalLine.dragHandle(d, 0, s), [{ time: d.points[0].time, price: 103 }])
  const ray = mk(horizontalLine, [pt(50, 100)], { extend: 'right' })
  const r = paint(horizontalLine, ray, ctx)
  horizontalLine.handles(r.g, ray, out, false)
  assert.equal(out[0].axis, 'xy')
  assert.deepEqual(horizontalLine.dragHandle(ray, 0, s), [s.point])
})

test('a horizontal line is a snap rail at its price', () => {
  const ctx = makeCtx()
  const d = mk(horizontalLine, [pt(50, 102)])
  const { g } = paint(horizontalLine, d, ctx)
  const out = []
  assert.equal(horizontalLine.snapTargets(d, g, ctx, out), 1)
  assert.equal(out[0].kind, 'level')
  assert.equal(out[0].price, 102)
  assert.equal(horizontalLine.priceAt(d, 3, ctx), 102)
  assert.equal(horizontalLine.priceAt(mk(horizontalLine, [pt(50, 102)], { extend: 'right' }), 3, ctx), null)
})

test('a new horizontal line grows outward from where it was placed', () => {
  const ctx = makeCtx()
  const d = mk(horizontalLine, [pt(50, 100)])
  const half = paint(horizontalLine, d, ctx, look({ reveal: 0.5 }))
  const [s] = strokedSegments(half.ops)
  const ax = ctx.host.ts.x(50)
  assert.ok(near(s[0], ax / 2) && near(s[2], ax + (800 - ax) / 2))
})

/* -------------------------------------------------------- verticalLine -- */

test('a full-height vertical line runs below its own pane; a pane-only one does not', () => {
  const price = { id: 'price', rect: { x: 0, y: 0, w: 800, h: 400 }, ps: fakePs(), visible: [] }
  const rsi = { id: 'rsi', rect: { x: 0, y: 410, w: 800, h: 150 }, ps: fakePs({ top: 410, height: 150 }), visible: [] }
  const ctx = makeCtx({ panes: [price, rsi], rect: price.rect, ps: price.ps, plotBottom: 560 })
  ctx.pane = price
  const all = paint(verticalLine, mk(verticalLine, [pt(50, 100)]), ctx)
  assert.equal(all.g.clip, 'plot')
  const [a] = strokedSegments(all.ops)
  assert.equal(Math.max(a[1], a[3]), 560, 'reaches the bottom of the lowest pane')
  const pane = paint(verticalLine, mk(verticalLine, [pt(50, 100)], { span: 'pane' }), ctx)
  assert.equal(pane.g.clip, 'pane')
  const [p] = strokedSegments(pane.ops)
  assert.equal(Math.max(p[1], p[3]), 400)
  // Hittable in the sub-pane only when it spans it.
  assert.deepEqual(verticalLine.hit(all.g, a[0], 480, 5), { part: 'body' })
  assert.equal(verticalLine.hit(pane.g, p[0], 480, 5), null)
})

test('a vertical line sits exactly on its bar\'s wick at even and odd bar widths', () => {
  for (const spacing of [7, 9, 10, 11, 14]) {
    const ts = new TimeScale({ spacing })
    ts.resize(800)
    ts.setBarCount(100)
    ts.jumpToRealtime()
    const ps = new PriceScale()
    ps.layout(0, 400)
    const data = bars(100)
    ps.fit(data, 0, 99)
    const canvas = makeCanvas()
    drawCandles(canvas.getContext('2d'), {
      theme: defaultTheme, ts, ps, plot: { x: 0, y: 0, w: 800, h: 400 }, bars: data, width: 900, height: 450, live: null, volumeRatio: 0,
    })
    // The wick of bar 90: its moveTo follows the wick's strokeStyle assignment.
    const wicks = canvas.ops.filter((o) => o.op === 'moveTo').map((o) => o.args[0])
    const bw = ts.barWidth()
    const ctx = makeCtx({ ts, ps, source: data })
    const { g } = paint(verticalLine, mk(verticalLine, [pt(90, 100)]), ctx)
    const wick = Math.round(ts.x(90)) + (bw % 2 ? 0.5 : 0)
    assert.ok(wicks.includes(wick), 'the candle renderer drew that wick')
    assert.equal(g.x, wick, `bar width ${bw}`)
  }
})

test('a vertical line between bars is half-pixel aligned; its tag reads the time, approximate past the data', () => {
  const ctx = makeCtx()
  const between = paint(verticalLine, mk(verticalLine, [{ time: T0 + 50.5 * MIN, price: 100 }]), ctx)
  assert.equal(between.g.x, Math.round(ctx.host.ts.x(50.5)) + 0.5)
  const d = mk(verticalLine, [{ time: T0 + 99 * MIN, price: 100, offset: 3, tf: MIN }])
  const { g } = paint(verticalLine, d, makeCtx({ tsOpts: { right: 110 } }))
  const out = []
  assert.equal(verticalLine.axisTags(g, d, ctx, out), 1)
  assert.equal(out[0].axis, 'time')
  assert.equal(out[0].text, '≈' + ctx.formatTime(T0 + 102 * MIN))
})

test('a vertical line handle moves its time and keeps its price', () => {
  const ctx = makeCtx()
  const d = mk(verticalLine, [pt(50, 100)])
  const { g } = paint(verticalLine, d, ctx)
  const out = []
  assert.equal(verticalLine.handles(g, d, out, false), 1)
  assert.equal(out[0].axis, 'x')
  assert.equal(out[0].cursor, 'ew-resize')
  const moved = verticalLine.dragHandle(d, 0, { point: { time: T0 + 99 * MIN, price: 107, offset: 2, tf: MIN } })
  assert.deepEqual(moved, [{ time: T0 + 99 * MIN, price: 100, offset: 2, tf: MIN }])
})

/* ----------------------------------------------------------- rectangle -- */

test('dragging a rectangle corner past its opposite flips the box without reordering points', () => {
  const d = mk(rectangle, [pt(40, 95), pt(80, 105)])
  const s = { point: pt(90, 110) }
  const flipped = rectangle.dragHandle(d, 0, s)
  assert.equal(flipped[0], s.point, 'P0 is still P0, now right of P1')
  assert.equal(flipped[1], d.points[1])
  const ctx = makeCtx()
  const { g } = paint(rectangle, mk(rectangle, flipped), ctx)
  assert.ok(g.l < g.r && g.t < g.b, 'the geometry is a proper box either way')
})

test('rectangle edge handles move one coordinate of one corner', () => {
  const d = mk(rectangle, [pt(40, 95), pt(80, 105)])
  const q = pt(60, 101)
  assert.deepEqual(rectangle.dragHandle(d, 4, { point: q }), [{ time: q.time, price: 95 }, d.points[1]])
  assert.deepEqual(rectangle.dragHandle(d, 5, { point: q }), [d.points[0], { time: q.time, price: 105 }])
  assert.deepEqual(rectangle.dragHandle(d, 6, { point: q }), [{ time: d.points[0].time, price: 101 }, d.points[1]])
  assert.deepEqual(rectangle.dragHandle(d, 7, { point: q }), [d.points[0], { time: d.points[1].time, price: 101 }])
  assert.deepEqual(rectangle.dragHandle(d, 2, { point: q }), [{ time: q.time, price: 95 }, { time: d.points[1].time, price: 101 }])
})

test('rectangle handles: corners then edges, with resize cursors by screen orientation', () => {
  const ctx = makeCtx()
  const d = mk(rectangle, [pt(40, 105), pt(80, 95)]) // P0 top-left, P1 bottom-right
  const { g } = paint(rectangle, d, ctx)
  const out = []
  assert.equal(rectangle.handles(g, d, out, false), 8)
  assert.deepEqual(out.map((h) => h.index), [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(out.map((h) => h.cursor), ['nwse-resize', 'nwse-resize', 'nesw-resize', 'nesw-resize', 'ew-resize', 'ew-resize', 'ns-resize', 'ns-resize'])
  assert.equal(rectangle.handles(g, d, out, true), 9)
  assert.equal(out[8].move, true)
})

test('a rectangle is hit on its stroke, and inside only while it has a fill', () => {
  const ctx = makeCtx()
  const { g } = paint(rectangle, mk(rectangle, [pt(40, 95), pt(80, 105)]), ctx)
  assert.deepEqual(rectangle.hit(g, g.l + 2, (g.t + g.b) / 2, 5), { part: 'body' })
  assert.deepEqual(rectangle.hit(g, (g.l + g.r) / 2, (g.t + g.b) / 2, 5), { part: 'fill' })
  assert.equal(rectangle.hit(g, g.r + 40, g.t, 5), null)
  const hollow = paint(rectangle, mk(rectangle, [pt(40, 95), pt(80, 105)], {}, { fillOpacity: 0 }), ctx)
  assert.equal(rectangle.hit(hollow.g, (g.l + g.r) / 2, (g.t + g.b) / 2, 5), null)
})

test('a rectangle fills with an absolute alpha and extends right to the plot edge', () => {
  const ctx = makeCtx()
  const { ops } = paint(rectangle, mk(rectangle, [pt(40, 95), pt(80, 105)], { extend: 'right' }), ctx, look({ alpha: 0.5 }))
  assert.equal(sets(ops, 'globalAlpha')[0], 0.5 * 0.12)
  const fill = ops.find((o) => o.op === 'fillRect')
  assert.ok(fill.args[0] + fill.args[2] >= 800)
  // An extended box has no right side: three strokes from the right edge round.
  assert.equal(strokedSegments(ops).length, 3)
})

/* ----------------------------------------------------- parallelChannel -- */

test('a channel stays parallel on screen in log mode, its second line through P2', () => {
  const ctx = makeCtx({ mode: 'log', psOpts: { lo: 50, hi: 400 } })
  const d = mk(parallelChannel, [pt(20, 100), pt(80, 300), pt(50, 120)])
  const a = anchorsOf(d, ctx)
  const { g } = paint(parallelChannel, d, ctx)
  assert.equal(g.full, true)
  const baseSlope = (g.base.by - g.base.ay) / (g.base.bx - g.base.ax)
  const parSlope = (g.par.by - g.par.ay) / (g.par.bx - g.par.ax)
  assert.ok(near(baseSlope, parSlope, 1e-9), 'parallel on screen')
  const yAtP2 = g.par.ay + parSlope * (a[2].x - g.par.ax)
  assert.ok(near(yAtP2, a[2].y, 1e-6), 'the parallel line passes through P2')
})

test('a channel with its first two anchors under a pixel apart draws its baseline only', () => {
  const ctx = makeCtx()
  const d = mk(parallelChannel, [pt(50, 95), pt(50.05, 105), pt(60, 110)])
  const { g, ops } = paint(parallelChannel, d, ctx)
  assert.equal(g.full, false)
  assert.equal(strokedSegments(ops).length, 1)
  // While P1 is still being dragged there is no P2: baseline only too.
  const two = mk(trendLine, [pt(40, 95), pt(80, 105)])
  const g2 = { clip: 'pane' }
  assert.ok(parallelChannel.project(mk(parallelChannel, [pt(40, 95), pt(80, 105), pt(60, 100)]), anchorsOf(two, ctx), ctx, g2))
  assert.equal(g2.full, false)
})

test('a channel fills only its visible area and is hit inside it as a fill', () => {
  const ctx = makeCtx()
  const d = mk(parallelChannel, [pt(20, 95), pt(80, 101), pt(50, 104)], { extend: 'both' })
  const { g, ops } = paint(parallelChannel, d, ctx)
  assert.ok(g.polyN >= 4)
  const pathOps = ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo')
  for (const o of pathOps) assert.ok(o.args[0] >= 0 && o.args[0] <= 800 && o.args[1] >= 0 && o.args[1] <= 400)
  const x = ctx.host.ts.x(50)
  const yBase = ctx.pane.ps.y(98)
  const yPar = ctx.pane.ps.y(104)
  // Between the base and the middle line: inside, on no stroke.
  assert.deepEqual(parallelChannel.hit(g, x, ctx.pane.ps.y(99.5), 5), { part: 'fill' })
  assert.deepEqual(parallelChannel.hit(g, x, (yBase + yPar) / 2, 5), { part: 'body' }, 'the dashed middle line')
  assert.deepEqual(parallelChannel.hit(g, x, yPar, 5), { part: 'body' })
  assert.equal(parallelChannel.hit(g, x, yPar - 40, 5), null)
})

test('the channel handle for P2 sits on the parallel line\'s midpoint and re-places P2', () => {
  const ctx = makeCtx()
  const d = mk(parallelChannel, [pt(20, 95), pt(80, 101), pt(30, 104)])
  const { g } = paint(parallelChannel, d, ctx)
  const out = []
  parallelChannel.handles(g, d, out, false)
  const h = out.find((x) => x.index === 2)
  assert.ok(near(h.x, (g.p0.x + g.p1.x) / 2))
  assert.ok(near(h.y, (g.p0.y + g.p1.y) / 2 + g.off))
  assert.equal(h.cursor, 'ns-resize')
  const s = { point: pt(50, 106) }
  assert.equal(parallelChannel.dragHandle(d, 2, s)[2], s.point)
})

test('the channel auto-fit offers the farthest revealed high above the base, or low below it', () => {
  const data = bars(100, 100, (b, i) => (i === 45 ? { ...b, high: 108 } : i === 70 ? { ...b, high: 112, low: 90 } : b))
  const ctx = makeCtx({ source: data })
  const d = mk(parallelChannel, [pt(20, 100), pt(60, 100)])
  const above = parallelChannel.fitTarget(d, 2, ctx.pane.ps.y(106), ctx)
  assert.equal(above.kind, 'fit')
  assert.equal(above.u, 45, 'bar 70 is outside P0..P1')
  assert.equal(above.price, 108)
  assert.deepEqual(above.point, pt(45, 108))
  const below = parallelChannel.fitTarget(d, 2, ctx.pane.ps.y(95), ctx)
  assert.equal(below.price, 99)
  // Revealed bars only: with the replay cursor before bar 45 its high is unknown.
  const replay = makeCtx({ source: data, revealed: 40 })
  assert.equal(parallelChannel.fitTarget(d, 2, replay.pane.ps.y(106), replay).price, 101)
  assert.equal(parallelChannel.fitTarget(d, 1, 0, ctx), null, 'only while placing P2')
})

/* ------------------------------------------------------ fibRetracement -- */

test('fib level 0 sits at P1 and level 1 at P0; reverse flips them', () => {
  const ctx = makeCtx()
  const d = mk(fibRetracement, [pt(40, 90), pt(80, 110)])
  const { g } = paint(fibRetracement, d, ctx)
  const priceOf = (value) => g.lp[[...g.order.slice(0, g.n)].findIndex((i) => d.options.levels[i].value === value)]
  assert.equal(priceOf(0), 110)
  assert.equal(priceOf(1), 90)
  assert.ok(near(priceOf(0.618), 110 - 20 * 0.618, 1e-9))
  const r = mk(fibRetracement, [pt(40, 90), pt(80, 110)], { reverse: true })
  const rg = paint(fibRetracement, r, ctx).g
  assert.equal(rg.lp[0], 90, 'reversed: 0 at P0')
})

test('log fib levels interpolate geometrically', () => {
  const ctx = makeCtx({ mode: 'log', psOpts: { lo: 50, hi: 500 } })
  const d = mk(fibRetracement, [pt(40, 100), pt(80, 400)], { logLevels: true })
  const { g } = paint(fibRetracement, d, ctx)
  const k = [...g.order.slice(0, g.n)].findIndex((i) => d.options.levels[i].value === 0.5)
  assert.ok(near(g.lp[k], 200, 1e-9))
})

test('fib draws its visible levels with labels, bands and a dashed trend line', () => {
  const ctx = makeCtx()
  const d = mk(fibRetracement, [pt(40, 90), pt(80, 110)])
  const { ops } = paint(fibRetracement, d, ctx)
  assert.deepEqual(texts(ops), ['0 (110.00)', '0.236 (105.28)', '0.382 (102.36)', '0.5 (100.00)', '0.618 (97.64)', '0.786 (94.28)', '1 (90.00)'])
  assert.equal(ops.filter((o) => o.op === 'fillRect').length, 6, 'a band between each pair of neighbours')
  assert.equal(strokedSegments(ops).length, 8, 'seven levels and the trend line')
  assert.equal(sets(ops, 'strokeStyle')[0], ctx.theme.line, 'the trend line follows the line colour')
  assert.equal(sets(ops, 'strokeStyle')[1], ctx.theme.fib[0], 'level 0 its fib colour')
  const hidden = mk(fibRetracement, [pt(40, 90), pt(80, 110)], { labels: 'none', trend: false, fill: false })
  const h = paint(fibRetracement, hidden, ctx)
  assert.equal(texts(h.ops).length, 0)
  assert.equal(h.ops.filter((o) => o.op === 'fillRect').length, 0)
  assert.equal(strokedSegments(h.ops).length, 7)
})

/**
 * The pill under op `i` (a fillText): the bounding box of the path last
 * filled before it, and the fillStyle that fill used.
 */
function pillUnder(ops, i) {
  let f = i - 1
  while (f >= 0 && ops[f].op !== 'fill') f--
  if (f < 0) return null
  let b = f
  while (b >= 0 && ops[b].op !== 'beginPath') b--
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }
  for (let k = b + 1; k < f; k++) {
    const a = ops[k].args
    if (!a || !['moveTo', 'lineTo', 'quadraticCurveTo'].includes(ops[k].op)) continue
    for (let m = 0; m + 1 < a.length; m += 2) {
      box.x0 = Math.min(box.x0, a[m]); box.x1 = Math.max(box.x1, a[m])
      box.y0 = Math.min(box.y0, a[m + 1]); box.y1 = Math.max(box.y1, a[m + 1])
    }
  }
  let color = null
  for (let k = f - 1; k >= 0; k--) if (ops[k].op === 'set' && ops[k].prop === 'fillStyle') { color = ops[k].value; break }
  return { ...box, color }
}

test('every fib label sits on a pill of the chart background, so candles never run through the text', () => {
  const ctx = makeCtx()
  const d = mk(fibRetracement, [pt(40, 90), pt(80, 110)])
  const { ops, g } = paint(fibRetracement, d, ctx)
  const at = ops.map((o, i) => (o.op === 'fillText' ? i : -1)).filter((i) => i >= 0)
  assert.equal(at.length, 7)
  for (const i of at) {
    const [text, x, y] = ops[i].args
    const pill = pillUnder(ops, i)
    assert.ok(pill, `${text} has a pill`)
    assert.equal(pill.color, ctx.theme.handleFill, `${text}: the pill is the chart's background`)
    const w = String(text).length * 6
    assert.ok(pill.x0 <= x - 3 && pill.x1 >= x + w + 3, `${text}: the pill pads the text on both sides`)
    assert.ok(pill.y0 <= y - 6 && pill.y1 >= y + 6, `${text}: the pill covers the text's height`)
    assert.ok(pill.x1 <= g.lx, `${text}: the pill stays left of the level line it labels`)
  }
  // The pill is a hit area too: a press on the padding grabs the drawing by its label.
  const k = 3
  const yLevel = g.ly[k]
  assert.deepEqual(fibRetracement.hit(g, g.lxLab[k] + 2, yLevel, 5), { part: 'label' })
})

test('fib labels tucked inside a level line keep clear of it, on their pill', () => {
  const ctx = makeCtx()
  // Drawn from the left edge: nowhere outside to put them.
  const d = mk(fibRetracement, [pt(0, 90), pt(0, 110)])
  const p = mk(fibRetracement, [{ time: T0 + 84 * MIN, price: 90 }, { time: T0 + 92 * MIN, price: 110 }])
  for (const dd of [d, p]) {
    const { ops, g } = paint(fibRetracement, dd, ctx)
    const at = ops.map((o, i) => (o.op === 'fillText' ? i : -1)).filter((i) => i >= 0)
    assert.ok(at.length > 0)
    for (const i of at) {
      const pill = pillUnder(ops, i)
      assert.ok(pill && pill.color === ctx.theme.handleFill)
      assert.ok(pill.x0 >= g.rect.x, 'inside the pane')
    }
  }
})

test('fib levels are hit within their x extent, the area between them as a fill', () => {
  const ctx = makeCtx()
  const d = mk(fibRetracement, [pt(40, 90), pt(80, 110)])
  const { g } = paint(fibRetracement, d, ctx)
  const y = ctx.pane.ps.y(100)
  const x = ctx.host.ts.x(60)
  assert.deepEqual(fibRetracement.hit(g, x, Math.round(y) + 0.5 + 2, 5), { part: 'body' })
  assert.deepEqual(fibRetracement.hit(g, x, ctx.pane.ps.y(101.2), 5), { part: 'fill' })
  assert.equal(fibRetracement.hit(g, ctx.host.ts.x(90), y, 5), null)
})

test('fib levels normalize: bare numbers accepted, bad entries skipped, at most 24 in [-10, 10]', () => {
  const o = fibRetracement.normalizeOptions({ levels: [0.5, '0.618', { value: 2, color: '#f00', visible: false }, { value: 11 }, null, { value: 'x' }, { value: -0.272, junk: 1 }] })
  assert.deepEqual(o.levels, [
    { value: 0.5, color: null, visible: true },
    { value: 0.618, color: null, visible: true },
    { value: 2, color: '#f00', visible: false },
    { value: -0.272, color: null, visible: true },
  ])
  assert.equal(fibRetracement.normalizeOptions({ levels: Array(40).fill(0.5) }).levels.length, 24)
  assert.equal(fibRetracement.normalizeOptions({}).levels.length, 10)
})

test('fib levels are snap rails tagged with their ratio', () => {
  const ctx = makeCtx()
  const d = mk(fibRetracement, [pt(40, 90), pt(80, 110)])
  const { g } = paint(fibRetracement, d, ctx)
  const out = []
  assert.equal(fibRetracement.snapTargets(d, g, ctx, out), 7)
  assert.deepEqual(out.map((t) => t.tag), ['0', '0.236', '0.382', '0.5', '0.618', '0.786', '1'])
  assert.equal(fibRetracement.prefBoost, 1.5)
})

test('fib levels stagger in on reveal and are all there at rest', () => {
  const ctx = makeCtx()
  const d = mk(fibRetracement, [pt(40, 90), pt(80, 110)], { fill: false, trend: false, labels: 'none' })
  const early = paint(fibRetracement, d, ctx, look({ reveal: 0.1, age: 30 }))
  const alphas = sets(early.ops, 'globalAlpha')
  assert.ok(alphas[0] > 0 && alphas[6] === 0, 'the first level is on its way, the last not started')
  const rest = paint(fibRetracement, d, ctx, look({ reveal: 1, age: 0 }))
  assert.ok(sets(rest.ops, 'globalAlpha').every((a) => a === 1))
})

/* ------------------------------------------------------------- measure -- */

test('measure reads the change, the span and the volume of the revealed bars inside it', () => {
  const data = bars(100, 100, (b, i) => ({ ...b, volume: 1000 * (i + 1) }))
  const ctx = makeCtx({ source: data })
  const d = mk(measure, [pt(10, 100), pt(48, 101.52)])
  const { ops, g } = paint(measure, d, ctx)
  // bars 10..48 inclusive: 1000 * (11 + … + 49)
  assert.deepEqual(texts(ops), ['+1.52 (+1.52%)', '38 bars · 38m', 'Vol 1.17M'])
  assert.equal(g.up, true)
  // Replay: only bars 10..29 are revealed.
  const replay = makeCtx({ source: data, revealed: 30 })
  assert.equal(texts(paint(measure, d, replay).ops)[2], 'Vol 410.0K')
})

test('measure volume is recounted when the data revision changes', () => {
  const data = bars(100)
  const ctx = makeCtx({ source: data })
  const d = mk(measure, [pt(10, 100), pt(19, 101)])
  const g = { clip: 'pane' }
  const a = anchorsOf(d, ctx)
  measure.project(d, a, ctx, g)
  measure.draw(makeCanvas().getContext('2d'), g, d, look(), ctx)
  data[15].volume = 1e6
  const again = makeCanvas()
  measure.draw(again.getContext('2d'), g, d, look(), ctx)
  assert.equal(texts(again.ops)[2], 'Vol 100', 'same revision: cached')
  ctx.dataRev = 2
  const fresh = makeCanvas()
  measure.draw(fresh.getContext('2d'), g, d, look(), ctx)
  assert.equal(texts(fresh.ops)[2], 'Vol 1.00M')
})

test('a downward measure fills with the down colour and is hit inside as a fill', () => {
  const ctx = makeCtx()
  const d = mk(measure, [pt(10, 104), pt(40, 96)])
  const { g, ops } = paint(measure, d, ctx)
  assert.equal(g.up, false)
  assert.equal(sets(ops, 'fillStyle')[0], ctx.theme.down)
  assert.deepEqual(measure.hit(g, g.l + 3, g.t + 3, 5), { part: 'fill' })
  assert.deepEqual(measure.hit(g, g.cx, g.t + 20, 5), { part: 'body' })
})

/* ------------------------------------------------------------ position -- */

/** Bars whose true range is exactly `tr` (high - low), closes flat. */
const rangeBars = (n, tr, price = 100) => bars(n, price, (b) => ({ ...b, high: price + tr / 2, low: price - tr / 2 }))

test('a clicked long position brackets 1.5 ATR of stop and a 2R target', () => {
  const ctx = makeCtx({ source: rangeBars(100, 0.4), visibleBars: 120 })
  const [e, t, s] = position.complete([pt(50, 100)], ctx, null, { side: 'long' })
  assert.deepEqual(e, pt(50, 100))
  assert.ok(near(s.price, 100 - 0.6, 1e-9), 'stop 1.5 × ATR(0.4) below')
  assert.ok(near(t.price, 100 + 1.2, 1e-9), 'target 2R above')
  assert.equal(t.time, T0 + 70 * MIN, 'end = entry + visibleBars / 6 bars')
  assert.equal(s.time, t.time)
})

test('a clicked short mirrors its brackets, and the box width is clamped to 8..60 bars', () => {
  const ctx = makeCtx({ source: rangeBars(100, 0.4), visibleBars: 12 })
  const [, t, s] = position.complete([pt(50, 100)], ctx, null, { side: 'short' })
  assert.ok(t.price < 100 && s.price > 100)
  assert.equal(t.time, T0 + 58 * MIN, 'at least 8 bars')
  const wide = makeCtx({ source: rangeBars(200, 0.4), visibleBars: 1000 })
  assert.equal(position.complete([pt(50, 100)], wide, null, { side: 'long' })[1].time, T0 + 110 * MIN, 'at most 60')
})

test('with fewer than two bars the brackets fall back to 1% of the price', () => {
  const ctx = makeCtx({ source: rangeBars(1, 5) })
  const [, t, s] = position.complete([pt(0, 200)], ctx, null, { side: 'long' })
  assert.ok(near(s.price, 200 - 1.5 * 2, 1e-9))
  assert.ok(near(t.price, 200 + 6, 1e-9))
})

test('a press-drag position takes its target and end from the drag and mirrors the stop at half the reward', () => {
  const ctx = makeCtx({ source: rangeBars(100, 0.4) })
  const drag = { point: pt(70, 104), u: 70, x: 0, y: 0, kind: 'slot' }
  const [, t, s] = position.complete([pt(50, 100)], ctx, drag, { side: 'long' })
  assert.equal(t.price, 104)
  assert.equal(s.price, 98)
  assert.equal(t.time, T0 + 70 * MIN)
  assert.equal(s.time, t.time)
})

test('position normalizePoints forces the stop onto the target\'s time, offset and timeframe', () => {
  const p = position.normalizePoints([pt(10, 100), { time: T0 + 99 * MIN, price: 105, offset: 4, tf: MIN }, { time: T0, price: 97, offset: 2 }])
  assert.deepEqual(p[2], { time: T0 + 99 * MIN, price: 97, offset: 4, tf: MIN })
  const q = position.normalizePoints([pt(10, 100), pt(30, 105), { time: T0, price: 97, offset: 2, tf: 5 * MIN }])
  assert.deepEqual(q[2], { time: T0 + 30 * MIN, price: 97 }, 'an offset the target lacks is dropped')
})

const trade = (source, over = {}) => {
  const ctx = makeCtx({ source, ...over })
  const d = mk(position, [pt(20, 100), pt(40, 104), pt(40, 98)], over.options || {})
  const { g, ops } = paint(position, d, ctx)
  return { g, ops, d, ctx }
}
const withBar = (i, f) => bars(100, 100, (b, j) => (j === i ? f({ ...b }) : b))

test('the outcome is the first bar to reach the target or the stop', () => {
  const hit = trade(withBar(30, (b) => ({ ...b, high: 104.5 })))
  assert.equal(hit.g.outcome.kind, 'target')
  assert.equal(hit.g.outcome.i, 30)
  assert.ok(texts(hit.ops).includes('Target hit · +4.00% · 10 bars'))
  const stop = trade(withBar(25, (b) => ({ ...b, low: 97.5 })))
  assert.equal(stop.g.outcome.kind, 'stop')
  assert.ok(texts(stop.ops).includes(`Stopped · −2.00% · 5 bars`))
  const open = trade(bars(100))
  assert.equal(open.g.outcome.kind, 'open')
  assert.ok(texts(open.ops).includes('Open · 0.00%'))
})

test('a bar that reaches both the target and the stop counts as the stop', () => {
  const both = trade(withBar(30, (b) => ({ ...b, high: 105, low: 97 })))
  assert.deepEqual({ ...both.g.outcome }, { kind: 'stop', i: 30, sameBar: true })
  assert.ok(texts(both.ops).includes('Stopped · −2.00% · 10 bars (same bar)'))
})

test('the outcome sees only revealed bars under replay', () => {
  const src = withBar(30, (b) => ({ ...b, high: 104.5 }))
  assert.equal(trade(src, { revealed: 29 }).g.outcome.kind, 'open')
  assert.equal(trade(src, { revealed: 31 }).g.outcome.kind, 'target')
  assert.equal(trade(src, { revealed: 15 }).g.outcome, null, 'entry not revealed yet')
})

test('a replay step that reveals the target flips the cached outcome on the next revision', () => {
  const src = withBar(30, (b) => ({ ...b, high: 104.5 }))
  const ctx = makeCtx({ source: src, revealed: 29 })
  const d = mk(position, [pt(20, 100), pt(40, 104), pt(40, 98)])
  const g = { clip: 'pane' }
  position.project(d, anchorsOf(d, ctx), ctx, g)
  assert.equal(g.outcomeKind, 'open')
  // The same drawing, one step later: the controller hands over a new
  // revealed prefix and bumps dataRev.
  ctx.bars = src.slice(0, 31)
  ctx.dataRev = 2
  position.project(d, anchorsOf(d, ctx), ctx, g)
  assert.equal(g.outcomeKind, 'target')
})

test('a stop on the wrong side paints both zones in the warning colour and reads R:R —', () => {
  const ctx = makeCtx()
  const d = mk(position, [pt(20, 100), pt(40, 104), pt(40, 101)])
  const { g, ops } = paint(position, d, ctx)
  assert.equal(g.wrong, true)
  assert.deepEqual(sets(ops, 'fillStyle').slice(0, 2), [ctx.theme.warn, ctx.theme.warn])
  assert.ok(texts(ops).includes('R:R —'))
  assert.equal(g.outcome, null)
  const ok = paint(position, mk(position, [pt(20, 100), pt(40, 104), pt(40, 98)]), ctx)
  assert.deepEqual(sets(ok.ops, 'fillStyle').slice(0, 2), [ctx.theme.up, ctx.theme.down])
  assert.ok(texts(ok.ops).includes('R:R 2.00'))
})

test('position labels read the target, the stop, the R multiple and the quantity money', () => {
  const ctx = makeCtx()
  const d = mk(position, [pt(20, 148), pt(40, 152.2), pt(40, 145.9)], { qty: 40, outcome: false })
  const t = texts(paint(position, d, makeCtx({ psOpts: { lo: 140, hi: 160 }, source: bars(100, 148) })).ops)
  assert.ok(t.includes('Target 152.20 · +4.20 (+2.84%) · 2.00R'), t.join(' | '))
  assert.ok(t.includes('Stop 145.90 · −2.10 (−1.42%)'))
  assert.ok(t.includes('R:R 2.00'))
  assert.ok(t.includes('Qty 40 · +168.00 / −84.00'))
  assert.ok(ctx)
})

/* Label layout: the pills never sit on each other. */

const rectOf = (b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })
const crossing = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
const inside = (b, r) => b.x >= r.x && b.y >= r.y && b.x + b.w <= r.x + r.w && b.y + b.h <= r.y + r.h

/** The placed pills of a painted position: name -> box, for those that were drawn. */
function pillsOf(g) {
  const out = {}
  for (const k of ['tb', 'sb', 'cb', 'ob']) if (g[k] && g[k].w > 0) out[k] = rectOf(g[k])
  return out
}

/**
 * paint(), on a canvas that measures text at 6 px a character, like the real
 * 11-12px face does. The default stub reports every string as 10 px wide, so
 * a "Target 104.00 · +4.00 (+4.00%) · 2.00R" pill would be narrower than the
 * box it labels and no layout problem could ever show.
 */
function paintWide(tool, d, ctx, lk) {
  const g = { clip: 'pane' }
  const ok = tool.project(d, anchorsOf(d, ctx), ctx, g)
  const canvas = makeCanvas()
  const c = canvas.getContext('2d')
  Object.defineProperty(c, 'measureText', { value: (s) => ({ width: String(s).length * 6 }) })
  if (ok) tool.draw(c, g, d, lk || look(), ctx)
  return { g, ops: canvas.ops, ok }
}

function assertClear(g, rect, what) {
  const p = pillsOf(g)
  const names = Object.keys(p)
  for (const n of names) assert.ok(inside(p[n], rect), `${what}: ${n} ${JSON.stringify(p[n])} leaves the pane`)
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      assert.ok(!crossing(p[names[i]], p[names[j]]), `${what}: ${names[i]} ${JSON.stringify(p[names[i]])} overlaps ${names[j]} ${JSON.stringify(p[names[j]])}`)
    }
  }
  assert.ok(p.tb && p.sb, `${what}: the target and stop pills are always drawn`)
}

/**
 * A position with the outcome `kind` reached on the bar three past the
 * entry. Flat bars, so nothing else touches the target or the stop.
 */
function layoutCase(side, [rew, risk], endU, kind, entry = 100) {
  const dir = side === 'long' ? 1 : -1
  const pT = entry + dir * rew
  const pS = entry - dir * risk
  const src = bars(100, entry, (b, i) => {
    const flat = { ...b, high: entry, low: entry, open: entry, close: entry }
    if (i !== 23) return flat
    if (kind === 'target') return { ...flat, high: Math.max(entry, pT), low: Math.min(entry, pT) }
    if (kind === 'stop') return { ...flat, high: Math.max(entry, pS), low: Math.min(entry, pS) }
    return flat
  })
  const ctx = makeCtx({ source: src })
  const d = mk(position, [pt(20, entry), pt(endU, pT), pt(endU, pS)], { side })
  return { ...paintWide(position, d, ctx), rect: ctx.pane.rect, ctx, d }
}

test('a target hit on a narrow long box keeps its outcome pill off the target pill', () => {
  // The reported case: the exit is level with the target line, and the
  // target pill (much wider than the box) is centred just above that line.
  const { g, rect } = layoutCase('long', [4, 2], 40, 'target')
  assert.equal(g.outcome.kind, 'target')
  assert.ok(g.ob.w > 0, 'the outcome is still shown')
  assert.ok(!crossing(rectOf(g.tb), rectOf(g.ob)), `target pill ${JSON.stringify(rectOf(g.tb))} vs outcome pill ${JSON.stringify(rectOf(g.ob))}`)
  assertClear(g, rect, 'long target hit')
})

test('the pills of a position never overlap: long and short, tall and tiny boxes, every outcome', () => {
  let n = 0
  for (const side of ['long', 'short']) {
    for (const size of [[4, 2], [0.6, 0.3], [0.08, 0.04], [9, 4.5]]) {
      for (const endU of [24, 40, 70, 99]) {
        for (const kind of ['target', 'stop', 'open']) {
          for (const entry of [100, 109.6, 90.4]) {
            const c = layoutCase(side, size, endU, kind, entry)
            assert.ok(c.ok, 'projected')
            assertClear(c.g, c.rect, `${side} ${size} end ${endU} ${kind} entry ${entry}`)
            n++
          }
        }
      }
    }
  }
  assert.equal(n, 288)
})

test('with no room outside the box the outcome pill tucks inside it, beside the exit dot and clear of the other pills', () => {
  // The box runs to the pane's right edge and starts far from the left one.
  const c = layoutCase('long', [4, 2], 99, 'target')
  assert.equal(c.g.outcome.kind, 'target')
  assert.ok(c.g.ob.w > 0, 'still shown')
  assert.ok(c.g.ob.x >= c.g.l && c.g.ob.x + c.g.ob.w <= c.g.r, 'inside the box')
  assertClear(c.g, c.rect, 'inside the box')
})

test('a wrong-side stop keeps its two edge pills apart', () => {
  for (const [entry, pT, pS] of [[100, 104, 103.5], [100, 96, 96.4], [100, 100.3, 100.2]]) {
    const ctx = makeCtx()
    const d = mk(position, [pt(20, entry), pt(40, pT), pt(40, pS)])
    const { g } = paintWide(position, d, ctx)
    assert.equal(g.wrong, true)
    assertClear(g, ctx.pane.rect, `wrong side ${pT}/${pS}`)
  }
})

test('the R:R pill drops out of a box too short to hold it, and the outcome pill finds room', () => {
  const tiny = layoutCase('long', [0.08, 0.04], 40, 'target')
  assert.equal(tiny.g.cb.w, 0, 'no room between the edge pills: the R:R pill is not drawn')
  assert.ok(!texts(tiny.ops).includes('R:R 2.00'))
  assert.ok(texts(tiny.ops).some((t) => t.startsWith('Target 100.08')), 'the target pill says the R multiple anyway')
  const tall = layoutCase('long', [4, 2], 40, 'target')
  assert.ok(tall.g.cb.w > 0)
  assert.ok(texts(tall.ops).includes('R:R 2.00'))
})

test('position handles: entry, target, stop and end, plus a move handle on touch', () => {
  const ctx = makeCtx()
  const d = mk(position, [pt(20, 100), pt(40, 104), pt(40, 98)])
  const { g } = paint(position, d, ctx)
  const out = []
  assert.equal(position.handles(g, d, out, false), 4)
  assert.deepEqual(out.map((h) => [h.index, h.axis]), [[0, 'xy'], [1, 'y'], [2, 'y'], [3, 'x']])
  assert.equal(position.handles(g, d, out, true), 5)
  const q = { point: { time: T0 + 99 * MIN, price: 103, offset: 5, tf: MIN } }
  const end = position.dragHandle(d, 3, q)
  assert.deepEqual(end[1], { time: q.point.time, price: 104, offset: 5, tf: MIN })
  assert.deepEqual(end[2], { time: q.point.time, price: 98, offset: 5, tf: MIN })
  assert.deepEqual(position.dragHandle(d, 1, q)[1], { time: d.points[1].time, price: 103 })
  const t = []
  assert.equal(position.snapTargets(d, g, ctx, t), 3)
  assert.deepEqual(t.map((x) => x.price), [100, 104, 98])
})

test('position boxes grow out of the entry line on reveal', () => {
  const ctx = makeCtx()
  const d = mk(position, [pt(20, 100), pt(40, 104), pt(40, 98)], { labels: false, outcome: false })
  const { g, ops } = paint(position, d, ctx, look({ reveal: 0.5 }))
  const [target] = ops.filter((o) => o.op === 'fillRect')
  assert.ok(near(target.args[3], Math.abs(g.yT - g.yE) / 2, 1e-9))
})

/* ---------------------------------------------------------------- text -- */

test('a text box is sized by its measured lines and hidden while being edited', () => {
  const ctx = makeCtx()
  const d = mk(text, [pt(50, 100)], { text: 'Hello\nworld!!', background: true })
  const { g, ops } = paint(text, d, ctx)
  assert.equal(g.box.w, 7 * 6 + 12)
  assert.equal(g.box.h, 2 * Math.round(12 * 1.3) + 12)
  assert.deepEqual(texts(ops), ['Hello', 'world!!'])
  assert.ok(ops.some((o) => o.op === 'set' && o.prop === 'font' && /^12px /.test(o.value)))
  const editing = paint(text, d, ctx, look({ editing: true }))
  assert.equal(texts(editing.ops).length, 0)
  assert.deepEqual(text.hit(g, g.box.x + 5, g.box.y + 5, 5), { part: 'body' })
  assert.equal(text.hit(g, g.box.x - 20, g.box.y, 5), null)
  assert.equal(text.handles(g, d, [], true), 0)
  assert.equal(text.bleed(d, g, ctx), g.box.w + 12)
})

test('a selected text shows a dashed accent frame; an export does not', () => {
  const ctx = makeCtx()
  const d = mk(text, [pt(50, 100)])
  const sel = paint(text, d, ctx, look({ select: 1 }))
  assert.ok(sets(sel.ops, 'strokeStyle').includes(ctx.theme.accent))
  const exp = paint(text, d, ctx, look({ select: 1, exporting: true }))
  assert.equal(sets(exp.ops, 'strokeStyle').length, 0)
})

test('the light theme recolours drawings that follow it', () => {
  const ctx = makeCtx({ theme: drawingTheme(lightTheme) })
  const { ops } = paint(trendLine, mk(trendLine, [pt(40, 95), pt(80, 105)]), ctx)
  assert.equal(sets(ops, 'strokeStyle')[0], '#2962ff')
})
