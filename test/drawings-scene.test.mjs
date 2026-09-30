/**
 * The drawings scene: projection, culling, isolation, clipping and chrome.
 *
 * Driven with fakes: a real TimeScale and real PriceScales laid out as the
 * chart lays out its panes, a recording 2D context from dom-stub, and small
 * fake tools that mark their own draw calls with a `__body` op (the recording
 * context records any method call), so a test can tell which drawing
 * painted and in what order without depending on any real tool's ops.
 *
 * Assertions are on op sequences only: the recording context has no state
 * stack, so reading `globalAlpha` or the clip back would be meaningless.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeCanvas } from './dom-stub.mjs'
import { TimeScale, PriceScale } from '../src/chart/index.js'
import { projectSlots, paintScene } from '../src/drawings/render/scene.js'
import { Motion, MOTION } from '../src/drawings/render/motion.js'

const T0 = 1_700_000_000_000
const MIN = 60_000
const PLOT_W = 832

const THEME = {
  line: '#6ea8fe', accent: '#f5a524', handleFill: '#0b0e14', tagText: '#06080d', guide: 'rgba(255,255,255,0.32)',
  labelBg: '#2a3040', labelText: '#e6e9ef', font: '11px sans-serif', up: '#26a69a', down: '#ef5350',
}

/**
 * A chart-shaped world. One pane fills 0..474; two panes split it with a
 * gap, the lower one an RSI-like 0..100 scale.
 */
function makeWorld({ panes = 1, n = 500, gap = 20, revealed = n } = {}) {
  const ts = new TimeScale()
  ts.resize(PLOT_W)
  ts.setBarCount(revealed)
  ts.jumpToRealtime()
  const rects = panes === 1 ? [[0, 474]] : [[0, 330], [330 + gap, 474 - 330 - gap]]
  const ranges = [[90, 110], [0, 100]]
  const list = rects.map(([y, h], i) => {
    const ps = new PriceScale()
    ps.layout(y, h)
    ps.beginFit()
    ps.consider(ranges[i][0], ranges[i][1])
    ps.endFit()
    return { id: i ? 'rsi' : 'price', rect: { x: 0, y, w: PLOT_W, h }, ps, visible: [] }
  })
  const source = Array.from({ length: n }, (_, i) => ({ time: T0 + i * MIN, open: 100, high: 101, low: 99, close: 100 }))
  const errors = []
  const host = {
    ts, bars: source.slice(0, revealed), source, panes: list, width: 900, height: 500, plotBottom: 474,
    timeframeMs: MIN, paneById: (id) => list.find((p) => p.id === id) || null,
    reportError: (err, phase) => errors.push({ err, phase }),
  }
  const ctxs = new Map()
  const ctxFor = (pane) => {
    if (!ctxs.has(pane)) {
      ctxs.set(pane, {
        host, pane, theme: THEME, bars: host.bars, source, tf: MIN, pointerType: 'mouse',
        formatPrice: (p) => p.toFixed(2), formatTime: (t) => 'T' + Math.round((t - T0) / MIN),
        textWidth: (font, text) => text.length * 6, timeAt: (u) => T0 + u * MIN,
      })
    }
    return ctxs.get(pane)
  }
  const motion = new Motion()
  const view = { host }
  return { ts, host, panes: list, ctxFor, errors, motion, view, source }
}

/**
 * A fake two-anchor tool. `project` refuses when both anchors are off the
 * plot on one side (as a real tool's clipping would), unless `infinite`.
 */
function fakeTool(type = 'fake', over = {}) {
  const tool = {
    type,
    projects: 0,
    project(d, a, ctx, out) {
      tool.projects++
      out.clip = d.options.clip || 'pane'
      out.infinite = !!d.options.infinite
      out.ax = a[0].x; out.ay = a[0].y
      out.bx = a[a.length - 1].x; out.by = a[a.length - 1].y
      out.look = null
      if (!out.infinite && !d.options.wide && (Math.max(out.ax, out.bx) < 0 || Math.min(out.ax, out.bx) > ctx.pane.rect.w)) return false
      return true
    },
    draw(c, g, d, look) {
      c.__body(d.id, look.preview, look.alpha)
      c.strokeStyle = THEME.line
      c.setLineDash(d.style.lineStyle === 'dashed' ? [6, 4] : [])
      c.beginPath()
      c.moveTo(g.ax, g.ay)
      c.lineTo(g.bx, g.by)
      c.stroke()
    },
    handles(g, d, out) {
      out[0] = { x: g.ax, y: g.ay, index: 0, axis: 'xy', cursor: 'grab' }
      out[1] = { x: g.bx, y: g.by, index: 1, axis: 'xy', cursor: 'grab' }
      return 2
    },
    ...over,
  }
  return tool
}

function slotOf(world, id, tool, pts, { pane = world.panes[0], options = {}, style = {}, locked = false, visible = true } = {}) {
  const d = {
    id, type: tool.type, pane: pane.id, points: pts.map((p) => ({ time: T0 + p.u * MIN, price: p.price })),
    style: { lineStyle: 'solid', ...style }, options, locked, visible, z: 0,
  }
  return { id, d, tool, pane, u: Float64Array.from(pts.map((p) => p.u)), geom: null, drawn: false, broken: null, inert: false }
}

/** One live frame: tick motion, project, paint on a fresh recording canvas. Returns its ops. */
function paint(world, slots, extra = {}) {
  const canvas = makeCanvas()
  const c = canvas.getContext('2d')
  world.motion.tick(16, world.view)
  const exporting = !!(extra.info && extra.info.exporting)
  if (!exporting) projectSlots(slots, world.ctxFor, world.motion, false)
  paintScene(c, {
    host: world.host, info: { full: true, dt: 16, exporting: false }, slots, motion: world.motion, ctxFor: world.ctxFor,
    selectedId: null, hoverId: null, editingId: null, draft: null, snap: null, guides: [], quickMeasure: null,
    touch: false, hidden: false, ...extra,
  })
  return canvas.ops
}

/** Two frames, returning the second's ops: culling uses what the first projection learned. */
const paint2 = (world, slots, extra) => { paint(world, slots, extra); return paint(world, slots, extra) }

const bodies = (ops) => ops.filter((o) => o.op === '__body').map((o) => o.args[0])
const arcs = (ops) => ops.filter((o) => o.op === 'arc')
const settle = (world) => { for (let i = 0; i < 100 && world.motion.tick(16, world.view); i++); }
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

/** The last `rect` op before index `i` (the clip that op is under). */
function clipBefore(ops, i) {
  for (let j = i; j >= 0; j--) if (ops[j].op === 'rect') return ops[j].args
  return null
}

// -------------------------------------------------------------- isolation --

test('one throwing drawing leaves the others painted and is reported once', () => {
  const w = makeWorld()
  const boom = fakeTool('boom', { draw() { throw new Error('bad geometry') } })
  const slots = [
    slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }]),
    slotOf(w, 'b', boom, [{ u: 471, price: 96 }, { u: 481, price: 104 }]),
    slotOf(w, 'c', fakeTool(), [{ u: 472, price: 97 }, { u: 482, price: 103 }]),
  ]
  let ops
  assert.doesNotThrow(() => { ops = paint(w, slots) })
  assert.deepEqual(bodies(ops), ['a', 'c'])
  assert.equal(w.errors.length, 1)
  assert.equal(w.errors[0].phase, 'draw boom')
  assert.equal(slots[1].broken, slots[1].d)

  for (let i = 0; i < 20; i++) ops = paint(w, slots)
  assert.equal(w.errors.length, 1, 'reported once per drawing, not once per frame')
  assert.deepEqual(bodies(ops), ['a', 'c'])
  assert.equal(slots[1].drawn, false, 'a broken drawing is not hittable either')

  // An edit replaces the drawing: it gets another chance (and one more report).
  slots[1].d = { ...slots[1].d }
  paint(w, slots)
  assert.equal(w.errors.length, 2)
})

test('each drawing is bracketed by save/clip/restore, and a solid line after a dashed one resets its dash', () => {
  const w = makeWorld()
  const slots = [
    slotOf(w, 'dashed', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }], { style: { lineStyle: 'dashed' } }),
    slotOf(w, 'solid', fakeTool(), [{ u: 471, price: 96 }, { u: 481, price: 104 }]),
  ]
  const ops = paint(w, slots)
  for (const id of ['dashed', 'solid']) {
    const i = ops.findIndex((o) => o.op === '__body' && o.args[0] === id)
    const seq = ops.slice(i - 4, i).map((o) => o.op)
    assert.deepEqual(seq, ['save', 'beginPath', 'rect', 'clip'], `${id} is clipped inside its own save`)
    const after = ops.slice(i).findIndex((o) => o.op === 'restore')
    const body = ops.slice(i, i + after)
    assert.ok(!body.some((o) => o.op === 'save'), `${id} is closed before the next drawing opens`)
  }
  const solidAt = ops.findIndex((o) => o.op === '__body' && o.args[0] === 'solid')
  const dash = ops.slice(solidAt).find((o) => o.op === 'setLineDash')
  assert.deepEqual(dash.args[0], [])
})

test('a tool whose project throws is marked broken and skipped until its drawing changes', () => {
  const w = makeWorld()
  const bad = fakeTool('badProject', { project() { throw new Error('nope') } })
  const slots = [slotOf(w, 'x', bad, [{ u: 470, price: 95 }, { u: 480, price: 100 }])]
  paint(w, slots)
  paint(w, slots)
  assert.equal(slots[0].drawn, false)
  assert.equal(w.errors.length, 1)
  assert.equal(w.errors[0].phase, 'project badProject')
})

// ---------------------------------------------------------------- clips --

test("a drawing is clipped to its pane, or to the whole plot for clip:'plot'", () => {
  const w = makeWorld({ panes: 2 })
  const rsi = w.panes[1]
  const slots = [
    slotOf(w, 'inRsi', fakeTool(), [{ u: 470, price: 30 }, { u: 480, price: 70 }], { pane: rsi }),
    slotOf(w, 'full', fakeTool(), [{ u: 475, price: 100 }, { u: 475, price: 100 }], { options: { clip: 'plot' } }),
  ]
  const ops = paint(w, slots)
  const at = (id) => ops.findIndex((o) => o.op === '__body' && o.args[0] === id)
  assert.deepEqual(clipBefore(ops, at('inRsi')), [0, rsi.rect.y, PLOT_W, rsi.rect.h])
  assert.deepEqual(clipBefore(ops, at('full')), [0, 0, PLOT_W, 474])
})

// ------------------------------------------------------------- handles --

test('handles are drawn only for the selected drawing', () => {
  const w = makeWorld()
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  const b = slotOf(w, 'b', fakeTool(), [{ u: 460, price: 92 }, { u: 490, price: 108 }])
  w.motion.select(['b'])
  settle(w)
  const ops = paint(w, [a, b], { selectedId: 'b' })
  const hs = arcs(ops)
  assert.equal(hs.length, 2)
  const xs = hs.map((o) => o.args[0]).sort((p, q) => p - q)
  assert.ok(near(xs[0], w.ts.x(460)) && near(xs[1], w.ts.x(490)))
  assert.ok(hs.every((o) => near(o.args[2], MOTION.handleSize.mouse)), 'at the mouse radius')

  const none = paint(w, [a, b])
  assert.equal(arcs(none).length, 0, 'no selection, no handles')
})

test('the pressed handle is drawn ×1.35', () => {
  const w = makeWorld()
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  w.motion.select(['a'])
  w.motion.press('a', 1)
  settle(w)
  const hs = arcs(paint(w, [a], { selectedId: 'a' }))
  const r = hs.map((o) => o.args[2]).sort((p, q) => p - q)
  assert.ok(near(r[0], MOTION.handleSize.mouse))
  assert.ok(near(r[1], MOTION.handleSize.mouse * MOTION.press.scale))
})

test('under a mouse a hovered drawing shows ghost handles at half strength', () => {
  const w = makeWorld()
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  w.motion.hover('a')
  settle(w)
  const ops = paint(w, [a], { hoverId: 'a' })
  assert.equal(arcs(ops).length, 2)
  const alphaAt = ops.slice(0, ops.indexOf(arcs(ops)[0])).filter((o) => o.op === 'set' && o.prop === 'globalAlpha').pop()
  assert.equal(alphaAt.value, 0.5)
  assert.equal(arcs(paint(w, [a], { hoverId: 'a', touch: true })).length, 0, 'not on touch')
})

test('a locked selected drawing gets hollow squares and a lock badge, not grab handles', () => {
  const w = makeWorld()
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }], { locked: true })
  w.motion.select(['a'])
  settle(w)
  const ops = paint(w, [a], { selectedId: 'a' })
  assert.equal(ops.filter((o) => o.op === 'strokeRect').length, 2)
  assert.ok(ops.some((o) => o.op === 'fillRect'), 'the badge')
  assert.ok(!arcs(ops).some((o) => o.args[3] === 0 && o.args[4] === Math.PI * 2), 'no circular grab handle')
})

test('a handle at a pane edge is drawn whole, but never into the neighbouring pane', () => {
  const w = makeWorld({ panes: 2, gap: 20 })
  const price = w.panes[0]
  const edgePrice = price.ps.price(price.rect.y + price.rect.h) // exactly on the pane's bottom edge
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 100 }, { u: 480, price: edgePrice }])
  w.motion.select(['a'])
  settle(w)
  const ops = paint(w, [a], { selectedId: 'a' })
  const edge = arcs(ops).find((o) => near(o.args[1], price.rect.y + price.rect.h, 1e-6))
  assert.ok(edge, 'the edge handle is painted')
  const [, y, , h] = clipBefore(ops, ops.indexOf(edge))
  const r = edge.args[2]
  assert.ok(y + h >= edge.args[1] + r, 'the clip reaches past the edge by the handle radius')
  assert.ok(y + h <= w.panes[1].rect.y, 'and stops before the RSI pane')

  const tight = makeWorld({ panes: 2, gap: 6 })
  const p2 = tight.panes[0]
  const b = slotOf(tight, 'b', fakeTool(), [{ u: 470, price: 100 }, { u: 480, price: p2.ps.price(p2.rect.y + p2.rect.h) }])
  tight.motion.select(['b'])
  settle(tight)
  const ops2 = paint(tight, [b], { selectedId: 'b' })
  const [, y2, , h2] = clipBefore(ops2, ops2.indexOf(arcs(ops2)[0]))
  assert.equal(y2 + h2, p2.rect.y + p2.rect.h + 3, 'a 6 px gap is split at its midpoint')
})

// ---------------------------------------------------------- axis tags --

test('the selection gets accent axis bands and one tag per anchor on each axis', () => {
  const w = makeWorld()
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  w.motion.select(['a'])
  settle(w)
  const ops = paint(w, [a], { selectedId: 'a' })
  const ps = w.panes[0].ps
  const rects = ops.filter((o) => o.op === 'fillRect')
  const band = rects.find((o) => o.args[0] === PLOT_W && near(o.args[1], ps.y(105)) && near(o.args[3], ps.y(95) - ps.y(105)))
  assert.ok(band, 'a price band spans the anchors in the gutter')
  const tband = rects.find((o) => o.args[1] === 474 && near(o.args[0], w.ts.x(470)) && near(o.args[2], w.ts.x(480) - w.ts.x(470)))
  assert.ok(tband, 'a time band spans them on the time axis')
  const texts = ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])
  assert.deepEqual(texts.sort(), ['105.00', '95.00', 'T470', 'T480'])

  w.motion.select([])
  w.motion.tick(16, w.view)
  const fading = paint(w, [a]).filter((o) => o.op === 'fillText').length
  assert.equal(fading, 4, 'the bands fade out after a deselect rather than blink')
  settle(w)
  assert.equal(paint(w, [a]).filter((o) => o.op === 'fillText').length, 0, 'no selection, no chrome tags')
})

test('an offset anchor time tag is prefixed ≈ and names the time it stands for', () => {
  const w = makeWorld()
  const a = slotOf(w, 'a', fakeTool(), [{ u: 495, price: 95 }, { u: 503, price: 105 }])
  a.d.points[1] = { time: T0 + 499 * MIN, price: 105, offset: 4, tf: MIN }
  w.motion.select(['a'])
  settle(w)
  const texts = paint(w, [a], { selectedId: 'a' }).filter((o) => o.op === 'fillText').map((o) => o.args[0])
  assert.ok(texts.includes('≈T503'), texts.join(', '))
})

test('a horizontal line below the price range prints no tag in the RSI gutter', () => {
  const w = makeWorld({ panes: 2 })
  const price = w.panes[0]
  const rsi = w.panes[1]
  const hline = fakeTool('hline', {
    axisTags(g, d, ctx, out) {
      out[0] = { axis: 'price', pos: g.ay, text: d.points[0].price.toFixed(2), color: '#abcdef' }
      return 1
    },
  })
  const low = slotOf(w, 'low', hline, [{ u: 470, price: 80 }, { u: 480, price: 80 }], { options: { infinite: true } })
  assert.ok(price.ps.y(80) >= rsi.rect.y && price.ps.y(80) <= rsi.rect.y + rsi.rect.h, 'fixture: its y is inside the RSI band')
  const ops = paint(w, [low])
  const inRsi = ops.filter((o) => o.op === 'fillText' && o.args[2] >= rsi.rect.y && o.args[2] <= rsi.rect.y + rsi.rect.h)
  assert.equal(inRsi.length, 0)

  const inRange = slotOf(w, 'in', hline, [{ u: 470, price: 100 }, { u: 480, price: 100 }], { options: { infinite: true } })
  const ok = paint(w, [inRange]).filter((o) => o.op === 'fillText')
  assert.equal(ok.length, 1, 'an in-range line prints its tag')
  assert.equal(ok[0].args[1], PLOT_W + 8)
  assert.ok(near(ok[0].args[2], price.ps.y(100)))
})

// ------------------------------------------------------------- residual --

test('a residual is applied in data space: after a mid-glide zoom x is ts.x(u + ru)', () => {
  const w = makeWorld()
  w.motion.tick(16, w.view)
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  w.motion.glide('a', 1, 6, 0, 'morph', 'price')
  paint(w, [a])
  w.ts.zoomAt(400, 2.5)
  for (let i = 0; i < 4; i++) w.ts.tick(16)
  const ops = paint(w, [a])
  const r = w.motion.residual('a', 1)
  assert.ok(r && r.ru > 1, 'still mid-glide')
  const lt = ops.find((o) => o.op === 'lineTo')
  assert.ok(near(lt.args[0], w.ts.x(480 + r.ru)), `${lt.args[0]} vs ${w.ts.x(480 + r.ru)}`)
  assert.ok(near(a.anchors[1].u, 480 + r.ru))
  const mt = ops.find((o) => o.op === 'moveTo')
  assert.ok(near(mt.args[0], w.ts.x(470)), 'the other anchor is exactly on its bar')
})

test('a price residual moves y through fwd space, and at rest the price is untouched', () => {
  const w = makeWorld()
  w.motion.tick(16, w.view)
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  w.motion.glide('a', 0, 0, 2, 'nudge', 'price')
  paint(w, [a])
  const rv = w.motion.residual('a', 0).rv
  assert.ok(near(a.anchors[0].price, 95 + rv))
  assert.ok(near(a.anchors[0].y, w.panes[0].ps.y(95 + rv)))
  settle(w)
  paint(w, [a])
  assert.equal(a.anchors[0].price, 95)
  assert.equal(a.anchors[0].y, w.panes[0].ps.y(95))
})

test('a snap ring seeded before a pan paints at the bar, not where the bar was', () => {
  const w = makeWorld()
  w.motion.ring(470, 101, 'price', 'H')
  w.motion.tick(16, w.view)
  w.motion.tick(16, w.view)
  w.ts.panBy(50)
  const ops = paint(w, [])
  const ring = arcs(ops)[0]
  assert.ok(ring, 'the ring is painted')
  assert.ok(near(ring.args[0], w.ts.x(470)))
  assert.ok(near(ring.args[1], w.panes[0].ps.y(101)))
  assert.ok(ops.some((o) => o.op === 'fillText' && o.args[0] === 'H'), 'with its tag')
})

// --------------------------------------------------------------- export --

test('the export pass paints committed drawings at rest and nothing else', () => {
  const w = makeWorld()
  w.motion.tick(16, w.view)
  const tool = fakeTool('t', {
    axisTags(g, d, ctx, out) { out[0] = { axis: 'price', pos: g.ay, text: 'own', color: '#abcdef' }; return 1 },
  })
  const a = slotOf(w, 'a', tool, [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  const gone = slotOf(w, 'gone', fakeTool(), [{ u: 471, price: 96 }, { u: 481, price: 104 }])
  const draftSlot = slotOf(w, 'new', fakeTool(), [{ u: 472, price: 97 }, { u: 482, price: 103 }])
  w.motion.select(['a'])
  w.motion.hover('a')
  w.motion.glide('a', 1, 5, 0, 'morph', 'price')
  w.motion.ghost(gone)
  w.motion.ring(470, 100, 'price', 'H')
  paint(w, [a])
  const ops = paint(w, [a], {
    info: { full: true, dt: 0, exporting: true }, selectedId: 'a', hoverId: 'a',
    draft: { tool: draftSlot.tool, d: draftSlot.d, slot: draftSlot }, snap: { kind: 'ohlc', x: 10, y: 10, guide: null },
  })
  assert.deepEqual(bodies(ops), ['a'], 'no ghost, no draft')
  assert.equal(arcs(ops).length, 0, 'no handles, rings or snap marker')
  const lt = ops.find((o) => o.op === 'lineTo')
  assert.ok(near(lt.args[0], w.ts.x(480)), 'residuals ignored')
  const body = ops.find((o) => o.op === '__body')
  assert.equal(body.args[2], 1, 'alpha 1')
  const texts = ops.filter((o) => o.op === 'fillText').map((o) => o.args[0])
  assert.deepEqual(texts, ['own'], "the tool's own tag, but no selection tags")
  assert.ok(!ops.some((o) => o.op === 'fillRect' && o.args[1] === 474), 'no time band')
})

// -------------------------------------------------------------- culling --

test('a drawing in the whitespace right of the newest bar is painted at the right clamp', () => {
  const w = makeWorld()
  const n = 500
  w.ts.panBy(-1e6) // as far right as _clampRight allows: the newest bar sits 12 bars LEFT of the plot
  const left = w.ts.index(0)
  assert.ok(near(left, n - 1 + w.ts.rightOffset, 1e-6), `fixture: left edge at ${left}`)
  const a = slotOf(w, 'rect', fakeTool(), [{ u: n + 15, price: 95 }, { u: n + 25, price: 105 }])
  const ops = paint2(w, [a])
  assert.deepEqual(bodies(ops), ['rect'])
  assert.ok(ops.some((o) => o.op === 'stroke'))
})

test('a drawing past the replay cursor, inside the view, is painted', () => {
  const w = makeWorld({ n: 500, revealed: 300 })
  w.ts.panBy(-50 * 9) // show the whitespace right of the revealed bars
  const a = slotOf(w, 'future', fakeTool(), [{ u: 330, price: 95 }, { u: 345, price: 105 }])
  assert.ok(w.ts.x(345) > 0 && w.ts.x(330) < PLOT_W, 'fixture: on screen')
  assert.deepEqual(bodies(paint2(w, [a])), ['future'])
})

test("a wide drawing anchored left of the view is kept by its bleed", () => {
  const w = makeWorld()
  const left = w.ts.index(0)
  const text = fakeTool('text', { bleed: () => 200 })
  const a = slotOf(w, 'note', text, [{ u: left - 3, price: 100 }, { u: left - 3, price: 100 }], { options: { wide: true } })
  assert.ok(w.ts.x(left - 3) < -20, 'fixture: its anchor is off the plot')
  assert.deepEqual(bodies(paint2(w, [a])), ['note'])

  const narrow = slotOf(w, 'narrow', fakeTool(), [{ u: left - 30, price: 100 }, { u: left - 30, price: 100 }], { options: { wide: true } })
  paint2(w, [narrow])
  assert.equal(narrow.drawn, false, 'without the bleed it is culled')
})

test('1,000 drawings genuinely off screen emit no ops and are culled before projection', () => {
  const w = makeWorld()
  const tool = fakeTool()
  const slots = []
  for (let i = 0; i < 1000; i++) slots.push(slotOf(w, 'off' + i, tool, [{ u: -3000 + i, price: 95 }, { u: -2990 + i, price: 105 }]))
  const first = paint(w, slots)
  assert.equal(bodies(first).length, 0)
  tool.projects = 0
  const ops = paint(w, slots)
  assert.equal(tool.projects, 0, 'culled on anchors alone once their geometry is known')
  assert.equal(ops.filter((o) => o.op === 'stroke').length, 0)
  assert.ok(ops.length < 5, `only frame bookkeeping (${ops.length} ops)`)
})

test('infinite geometry is never culled by x, and neither is a drawing seen for the first time', () => {
  const w = makeWorld()
  const tool = fakeTool()
  const ray = slotOf(w, 'ray', tool, [{ u: -500, price: 95 }, { u: -490, price: 105 }], { options: { infinite: true } })
  for (let i = 0; i < 3; i++) assert.deepEqual(bodies(paint(w, [ray])), ['ray'])
  // An edit gives the slot a new drawing identity: it is projected unculled
  // again before anything is assumed about its extent.
  const before = tool.projects
  ray.d = { ...ray.d, options: {} }
  paint(w, [ray])
  assert.equal(tool.projects, before + 1)
})

// ---------------------------------------------------------------- skips --

test('hidden, orphaned, inert, unprimed-pane, zero-bar and log-nonpositive drawings are not projected', () => {
  const w = makeWorld({ panes: 2 })
  const tool = fakeTool()
  const pts = [{ u: 470, price: 95 }, { u: 480, price: 105 }]
  const hidden = slotOf(w, 'h', tool, pts, { visible: false })
  const orphan = slotOf(w, 'o', tool, pts)
  orphan.pane = null
  const inert = { id: 'i', inert: true }
  const unprimed = slotOf(w, 'u', tool, pts, { pane: { ...w.panes[1], ps: new PriceScale() } })
  const nan = slotOf(w, 'n', tool, pts)
  nan.u[0] = NaN
  paint(w, [hidden, orphan, inert, unprimed, nan])
  assert.equal(tool.projects, 0)
  for (const s of [hidden, orphan, unprimed, nan]) assert.equal(s.drawn, false)

  w.panes[0].ps.setMode('log')
  const neg = slotOf(w, 'neg', tool, [{ u: 470, price: -5 }, { u: 480, price: 105 }])
  paint(w, [neg])
  assert.equal(neg.drawn, false, 'log mode cannot place a price <= 0')

  const empty = makeWorld()
  empty.host.bars = []
  const z = slotOf(empty, 'z', tool, pts)
  paint(empty, [z])
  assert.equal(z.drawn, false, 'zero bars: nothing is drawn')
})

test('hide-all hides the document but not the drawing being created', () => {
  const w = makeWorld()
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  const d = slotOf(w, 'draft', fakeTool(), [{ u: 471, price: 96 }, { u: 481, price: 104 }])
  const ops = paint(w, [a], { hidden: true, draft: { tool: d.tool, d: d.d, slot: d } })
  assert.deepEqual(bodies(ops), ['draft'])
})

// --------------------------------------------------------------- drafts --

test('a creation draft previews at 60% alpha with Look.preview; a drag draft replaces its drawing', () => {
  const w = makeWorld()
  const a = slotOf(w, 'a', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  const created = slotOf(w, 'new', fakeTool(), [{ u: 460, price: 96 }, { u: 465, price: 104 }])
  let ops = paint(w, [a], { draft: { tool: created.tool, d: created.d, slot: created } })
  const pv = ops.find((o) => o.op === '__body' && o.args[0] === 'new')
  assert.equal(pv.args[1], true)
  assert.ok(near(pv.args[2], MOTION.commit.from))

  w.motion.select(['a'])
  settle(w)
  const moved = slotOf(w, 'a', fakeTool(), [{ u: 472, price: 95 }, { u: 482, price: 105 }])
  ops = paint(w, [a], { selectedId: 'a', draft: { tool: moved.tool, d: moved.d, slot: moved } })
  assert.deepEqual(bodies(ops), ['a'], 'painted once, not twice')
  const lt = ops.find((o) => o.op === 'lineTo')
  assert.ok(near(lt.args[0], w.ts.x(482)), 'at the dragged position')
  const hx = arcs(ops).map((o) => o.args[0]).sort((p, q) => p - q)
  assert.ok(near(hx[0], w.ts.x(472)) && near(hx[1], w.ts.x(482)), 'handles follow the draft')
})

test('ghosts fade out where their data is, and are never painted after they end', () => {
  const w = makeWorld()
  const gone = slotOf(w, 'gone', fakeTool(), [{ u: 470, price: 95 }, { u: 480, price: 105 }])
  w.motion.ghost(gone)
  const ops = paint(w, [])
  const g = ops.find((o) => o.op === '__body')
  assert.equal(g.args[0], 'gone')
  assert.ok(g.args[2] < 1 && g.args[2] > 0, `alpha ${g.args[2]}`)
  settle(w)
  assert.deepEqual(bodies(paint(w, [])), [])
})

test('guides are dashed and a held snap gets a steady marker', () => {
  const w = makeWorld()
  const ops = paint(w, [], {
    guides: [{ x0: 10, y0: 20, x1: 300, y1: 20 }],
    snap: { kind: 'ohlc', x: 100, y: 50, tag: 'H', guide: null },
  })
  const dash = ops.find((o) => o.op === 'setLineDash' && o.args[0].length === 2)
  assert.ok(dash, 'dashed guide')
  assert.ok(ops.some((o) => o.op === 'lineTo' && o.args[0] === 300 && o.args[1] === 20))
  assert.ok(arcs(ops).some((o) => o.args[0] === 100 && o.args[1] === 50))
  assert.equal(arcs(paint(w, [], { snap: { kind: 'slot', x: 100, y: 50 } })).length, 0, 'a bare slot is not marked')
})
