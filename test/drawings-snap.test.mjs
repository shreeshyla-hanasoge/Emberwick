/**
 * The snap pipeline (§5.5): where a pointer lands, in data terms.
 *
 * Pure: a hand-built linear TimeScale / PriceScale stand-in, so every
 * expected pixel below can be worked out on paper. One bar per 10 px
 * (x = 5 + 10·u), and 2 px per price unit (y = (200 − price)·2).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { snapPoint, resolveMagnet, collectSnapTargets } from '../src/drawings/interaction/snap.js'
import { tolerance } from '../src/drawings/interaction/tolerance.js'
import { pointIndex } from '../src/drawings/model/time.js'

const T0 = 1_700_000_000_000
const MIN = 60_000

/** Every bar: open 100, high 110, low 90, close 104 → y 200, 180, 220, 192. */
function makeBars(n) {
  return Array.from({ length: n }, (_, i) => ({ time: T0 + i * MIN, open: 100, high: 110, low: 90, close: 104, volume: 10 }))
}

const ts = { x: (u) => 5 + u * 10, index: (x) => (x - 5) / 10 }
const makePs = () => ({ primed: true, mode: 'linear', y: (p) => (200 - p) * 2, price: (y) => 200 - y / 2 })

function world({ n = 50, revealed = n, magnet = 'weak', hostMagnet = false, targets = [], priceLines = [] } = {}) {
  const source = makeBars(n)
  const pane = { id: 'price', rect: { x: 0, y: 0, w: 600, h: 400 }, ps: makePs(), visible: [] }
  const host = { ts, bars: source.slice(0, revealed), source, panes: [pane], magnet: hostMagnet, priceLines, timeframeMs: MIN }
  const ctx = { tf: MIN, indexOf: (pt) => pointIndex(source, pt, MIN) }
  return { pane, host, env: { host, ctx, targets, magnet } }
}

const at = (pane, x, y, o = {}) => ({
  x, y, pane, pointerType: 'mouse', shift: false, alt: false, invert: false, prev: null, allowAngle: false, fit: null, ...o,
})

const X = (u) => ts.x(u)
const Y = (p) => (200 - p) * 2

// ------------------------------------------------------------------ slot and magnet

test('the bar slot is the crosshair rounding of the pointer x', () => {
  const { pane, env } = world({ magnet: 'off' })
  for (const u of [7.4, 7.5, 7.6, 0.2, 48.9]) {
    const s = snapPoint(at(pane, X(u), 150), env)
    assert.equal(s.kind, 'slot')
    assert.equal(s.u, Math.round(ts.index(X(u))), `u ${u}`)
    assert.equal(s.x, X(s.u))
  }
  const s = snapPoint(at(pane, X(7.4), 150), env)
  assert.deepEqual(s.point, { time: T0 + 7 * MIN, price: 125 })
})

test('the weak magnet engages within 22 px on a mouse and 28 px on a finger', () => {
  const { pane, env } = world()
  // The high is at y 180.
  assert.equal(snapPoint(at(pane, X(5), 180 - 21), env).tag, 'H')
  assert.equal(snapPoint(at(pane, X(5), 180 - 23), env).kind, 'slot')
  const touch = { pointerType: 'touch' }
  assert.equal(snapPoint(at(pane, X(5), 180 - 27, touch), env).tag, 'H')
  assert.equal(snapPoint(at(pane, X(5), 180 - 29, touch), env).kind, 'slot')
  const s = snapPoint(at(pane, X(5), 175), env)
  assert.equal(s.kind, 'ohlc')
  assert.equal(s.point.price, 110, 'the stored price is the bar high itself')
  assert.equal(s.y, 180)
})

test('the mouse magnet radius equals the core crosshair literal', () => {
  const src = readFileSync(new URL('../src/chart/render/crosshair.js', import.meta.url), 'utf8')
  const m = /bestD < (\d+)/.exec(src)
  assert.ok(m, 'crosshair.js still has its magnet literal')
  assert.equal(tolerance('mouse').magnet, Number(m[1]))
})

test('the strong magnet always takes the nearest OHLC value', () => {
  const { pane, env } = world({ magnet: 'strong' })
  const s = snapPoint(at(pane, X(5), 20), env)
  assert.equal(s.tag, 'H')
  assert.equal(s.point.price, 110)
})

test("'inherit' follows the chart's magnet option, and the platform modifier inverts it", () => {
  assert.equal(snapPoint(at(world({ magnet: 'inherit', hostMagnet: true }).pane, X(5), 175), world({ magnet: 'inherit', hostMagnet: true }).env).kind, 'ohlc')
  const off = world({ magnet: 'inherit', hostMagnet: false })
  assert.equal(snapPoint(at(off.pane, X(5), 175), off.env).kind, 'slot')
  assert.equal(snapPoint(at(off.pane, X(5), 175, { invert: true }), off.env).kind, 'ohlc', 'off inverted is weak')
  const weak = world({ magnet: 'weak' })
  assert.equal(snapPoint(at(weak.pane, X(5), 175, { invert: true }), weak.env).kind, 'slot', 'weak inverted is off')
  assert.equal(resolveMagnet('strong', false, true), 'off')
  assert.equal(resolveMagnet('inherit', true, false), 'weak')
  assert.equal(resolveMagnet('bogus', true, false), 'off')
})

test("the tool's preferred pair wins ties and engages at the boosted radius", () => {
  const { pane, env } = world()
  // Close is 5 px away, high 7 px: plain distance picks the close…
  assert.equal(snapPoint(at(pane, X(5), 187), env).tag, 'C')
  // …a fib (high/low preferred, ×1.5) picks the high.
  assert.equal(snapPoint(at(pane, X(5), 187, { prefs: ['high', 'low'], prefBoost: 1.5 }), env).tag, 'H')
  // 30 px above the high: outside 22, inside 22 × 1.5.
  assert.equal(snapPoint(at(pane, X(5), 150), env).kind, 'slot')
  assert.equal(snapPoint(at(pane, X(5), 150, { prefs: ['high', 'low'], prefBoost: 1.5 }), env).tag, 'H')
})

test('a sub-pane magnets to the series drawn in it at that slot', () => {
  const { host, env } = world()
  const ps = { primed: true, mode: 'linear', y: (v) => 500 + (100 - v), price: (y) => 100 - (y - 500) }
  const rsi = {
    id: 'rsi', rect: { x: 0, y: 500, w: 600, h: 100 }, ps,
    visible: [{ opts: {}, drawable: [{ index: 5, value: 70 }, { index: 7, value: 30 }, { index: 9, value: NaN }] }],
  }
  host.panes.push(rsi)
  const s = snapPoint(at(rsi, X(7), ps.y(30) - 4), env)
  assert.equal(s.kind, 'series')
  assert.equal(s.point.price, 30)
  assert.equal(snapPoint(at(rsi, X(6), ps.y(30) - 4), env).kind, 'slot', 'no value at slot 6')
  assert.equal(snapPoint(at(rsi, X(9), 560), env).kind, 'slot', 'a gap is not a value')
})

test('the magnet never reads a bar the replay has not revealed', () => {
  const { pane, env } = world({ n: 50, revealed: 20 })
  assert.equal(snapPoint(at(pane, X(19), 175), env).kind, 'ohlc', 'the newest revealed bar still snaps')
  const s = snapPoint(at(pane, X(30), 175), env)
  assert.equal(s.kind, 'slot', 'bar 30 exists in the source but has not been shown')
  assert.equal(s.point.time, T0 + 30 * MIN, 'the point still resolves against the source')
})

test('a pointer past the newest bar stores a bar count, not a clock time', () => {
  const { pane, env } = world({ n: 50, magnet: 'off' })
  const s = snapPoint(at(pane, X(53), 150), env)
  assert.deepEqual(s.point, { time: T0 + 49 * MIN, price: 125, offset: 4, tf: MIN })
})

// ------------------------------------------------------------------ order

test('stages run Alt > Shift > anchor > level > magnet > slot', () => {
  const anchor = { kind: 'anchor', x: 0, y: 0, u: 5, price: 108, point: { time: T0 + 5 * MIN, price: 108 }, paneId: 'price', id: 'a', tag: null }
  const level = { kind: 'level', x: 0, y: 0, u: 0, price: 109, point: null, paneId: 'price', id: 'h', tag: null }
  const origin = { x: X(1), y: Y(107), u: 1, time: T0 + MIN, price: 107, approx: false }
  const w = world({ targets: [anchor, level] })
  const p = (o) => snapPoint(at(w.pane, X(5) + 1, Y(108) + 1, o), w.env)
  assert.equal(p({ alt: true, shift: true, allowAngle: true, origin }).kind, 'free')
  assert.equal(p({ shift: true, allowAngle: true, origin }).kind, 'angle')
  assert.equal(p({ shift: true, allowAngle: false, origin }).kind, 'anchor', 'no angle unless allowed')
  assert.equal(p({}).kind, 'anchor')
  w.env.targets = [level]
  assert.equal(p({}).kind, 'level')
  w.env.targets = []
  assert.equal(p({}).kind, 'ohlc')
  w.env.magnet = 'off'
  assert.equal(p({}).kind, 'slot')
})

test('Alt is free: the exact fractional bar and the exact price under the pointer', () => {
  const { pane, env } = world()
  const s = snapPoint(at(pane, X(7.3), 177, { alt: true }), env)
  assert.equal(s.kind, 'free')
  assert.ok(Math.abs(s.u - 7.3) < 1e-9)
  assert.equal(s.point.price, 200 - 177 / 2)
})

test('an anchor snap copies the other point exactly, offset and tf included', () => {
  // Drawn on 5m data, half a 5m bar past the newest bar: 2.5 bars here.
  const point = Object.freeze({ time: T0 + 49 * MIN, price: 104.123456789, offset: 0.5, tf: 5 * MIN })
  const u = pointIndex(makeBars(50), point, MIN)
  const t = { kind: 'anchor', x: 0, y: 0, u, price: point.price, point, paneId: 'price', id: 'other', tag: null }
  const { pane, env } = world({ targets: [t] })
  const s = snapPoint(at(pane, X(u) + 3, Y(point.price) - 4), env)
  assert.equal(s.kind, 'anchor')
  assert.equal(s.tag, '⊕')
  assert.equal(s.targetId, 'other')
  assert.deepEqual(s.point, { time: point.time, price: point.price, offset: 0.5, tf: 5 * MIN })
  assert.notEqual(s.point, point, 'a copy, never the frozen original')
  assert.equal(s.u, u)
})

test('an anchor of the drawing being dragged, or on another pane, is not a target', () => {
  const point = { time: T0 + 5 * MIN, price: 150 }
  const mk = (id, paneId) => ({ kind: 'anchor', x: 0, y: 0, u: 5, price: 150, point, paneId, id, tag: null })
  const { pane, env } = world({ magnet: 'off', targets: [mk('self', 'price'), mk('rsi-one', 'rsi')] })
  assert.equal(snapPoint(at(pane, X(5) + 2, Y(150), { excludeId: 'self' }), env).kind, 'slot')
})

test('Shift at 0° copies the origin price bit for bit', () => {
  const price = 101.23456789012345
  const origin = { x: 0, y: 0, u: 10, time: T0 + 10 * MIN, price, approx: false }
  const { pane, env } = world({ magnet: 'off' })
  const s = snapPoint(at(pane, X(20), Y(price) - 3, { shift: true, allowAngle: true, origin }), env)
  assert.equal(s.kind, 'angle')
  assert.ok(Object.is(s.point.price, price))
  assert.equal(s.u, 20)
  assert.ok(s.guide, 'a guide ray from the origin')
})

test('Shift at 90° copies the origin u bit for bit, and the magnet still sets y', () => {
  const src = makeBars(50)
  const opoint = { time: T0 + 10 * MIN + 22_200, price: 100 }
  const ou = pointIndex(src, opoint, MIN)
  const origin = { x: 0, y: 0, u: 0 /* stale on purpose: the stored point wins */, time: opoint.time, price: 100, approx: false, point: opoint }
  const { pane, env } = world()
  const s = snapPoint(at(pane, X(ou) + 2, Y(110) - 20, { shift: true, allowAngle: true, origin }), env)
  assert.equal(s.kind, 'angle')
  assert.ok(Object.is(s.u, ou))
  assert.equal(s.point.time, opoint.time)
  assert.equal(s.point.price, 110, 'magnet on the origin bar')
})

test('Shift at 45° derives y from the bar-slot x', () => {
  const origin = { x: 0, y: 0, u: 10, time: T0 + 10 * MIN, price: 100, approx: false }
  const { pane, env } = world({ magnet: 'off' })
  const s = snapPoint(at(pane, X(18), Y(100) - 78, { shift: true, allowAngle: true, origin }), env)
  assert.equal(s.kind, 'angle')
  assert.equal(s.u, 18)
  assert.ok(Math.abs(s.y - (Y(100) - 80)) < 1e-9, 'up and to the right at exactly 45° on screen')
})

// ------------------------------------------------------------------ hysteresis

test('a snap engages at its radius and, given prev, holds to 1.5× it', () => {
  const point = { time: T0 + 5 * MIN, price: 150 }
  const t = { kind: 'anchor', x: 0, y: 0, u: 5, price: 150, point, paneId: 'price', id: 'o', tag: null }
  const { pane, env } = world({ magnet: 'off', targets: [t] })
  const engaged = snapPoint(at(pane, X(5), Y(150) - 7), env)
  assert.equal(engaged.kind, 'anchor', 'engages within 8 px')
  assert.equal(snapPoint(at(pane, X(5), Y(150) - 10), env).kind, 'slot', 'no engagement at 10 px from cold')
  assert.equal(snapPoint(at(pane, X(5), Y(150) - 10, { prev: engaged.state }), env).kind, 'anchor', 'held at 10 px')
  assert.equal(snapPoint(at(pane, X(5), Y(150) - 13, { prev: engaged.state }), env).kind, 'slot', 'released past 12 px')
})

test('the magnet holds past its radius only while it held last time', () => {
  const { pane, env } = world()
  const engaged = snapPoint(at(pane, X(5), 180 - 20), env)
  assert.equal(engaged.kind, 'ohlc')
  assert.equal(snapPoint(at(pane, X(5), 180 - 30), env).kind, 'slot')
  assert.equal(snapPoint(at(pane, X(5), 180 - 30, { prev: engaged.state }), env).kind, 'ohlc')
})

// ------------------------------------------------------------------ rails

test('price lines are level rails, on the price pane only', () => {
  const { pane, host, env } = world({ magnet: 'off', priceLines: [{ id: 'sl', price: '150.25' }] })
  const s = snapPoint(at(pane, X(3), Y(150.25) + 4), env)
  assert.equal(s.kind, 'level')
  assert.equal(s.point.price, 150.25)
  assert.equal(s.targetId, 'priceLine:sl')
  const sub = { id: 'rsi', rect: { x: 0, y: 0, w: 600, h: 400 }, ps: makePs(), visible: [] }
  host.panes.push(sub)
  assert.equal(snapPoint(at(sub, X(3), Y(150.25) + 4), env).kind, 'slot')
})

test('level targets snap y exactly and leave x on the slot', () => {
  const level = { kind: 'level', x: 0, y: 0, u: 0, price: 161.8, point: null, paneId: 'price', id: 'fib', tag: '0.618' }
  const { pane, env } = world({ magnet: 'off', targets: [level] })
  const s = snapPoint(at(pane, X(12.2), Y(161.8) - 5), env)
  assert.equal(s.kind, 'level')
  assert.equal(s.point.price, 161.8)
  assert.equal(s.u, 12)
  assert.equal(s.tag, '0.618')
})

test("the channel's auto-fit candidate is offered as kind 'fit'", () => {
  const { pane, env } = world({ magnet: 'off' })
  const fit = { kind: 'fit', x: 0, y: 0, u: 3, price: 130, point: null, paneId: 'price', id: 'fit', tag: null }
  const s = snapPoint(at(pane, X(8), Y(130) + 3, { fit }), env)
  assert.equal(s.kind, 'fit')
  assert.equal(s.point.price, 130)
})

test('another anchor at nearly the same height lends its exact price and a guide', () => {
  const point = { time: T0 + 2 * MIN, price: 123.456 }
  const t = { kind: 'anchor', x: 0, y: 0, u: 2, price: 123.456, point, paneId: 'price', id: 'o', tag: null }
  const { pane, env } = world({ magnet: 'off', targets: [t] })
  const s = snapPoint(at(pane, X(30), Y(123.456) + 3), env)
  assert.equal(s.kind, 'align')
  assert.equal(s.point.price, 123.456)
  assert.equal(s.u, 30)
  assert.deepEqual(s.guide, { x0: X(2), y0: Y(123.456), x1: X(30), y1: Y(123.456) })
  assert.equal(snapPoint(at(pane, X(30), Y(123.456) + 5), env).kind, 'slot', 'beyond 4 px')
})

// ------------------------------------------------------------------ edges

test('zero bars, an unprimed pane or a missing pane snap to nothing', () => {
  const empty = world({ n: 0 })
  assert.equal(snapPoint(at(empty.pane, 100, 100), empty.env), null)
  const w = world()
  w.pane.ps.primed = false
  assert.equal(snapPoint(at(w.pane, 100, 100), w.env), null)
  assert.equal(snapPoint(at(null, 100, 100), w.env), null)
  const ok = world()
  assert.equal(snapPoint(at(ok.pane, NaN, 100), ok.env), null)
})

test('the pointer is clamped into its pane: a drawing never changes pane', () => {
  const { pane, env } = world({ magnet: 'off' })
  const s = snapPoint(at(pane, X(4), 900), env)
  assert.equal(s.y, 400)
  assert.equal(s.point.price, 0)
  const left = snapPoint(at(pane, -300, 100), env)
  assert.equal(left.u, 0, 'x clamps to the plot')
})

test('every snap reports where the same pointer lands with no snap at all: bar slot and pointer price', () => {
  // A glide is measured between the two at ONE view; u0 / price0 are the unsnapped end.
  const { pane, env } = world({ magnet: 'strong' })
  const s = snapPoint(at(pane, X(7.4), 150), env)
  assert.equal(s.kind, 'ohlc')
  assert.equal(s.u, 7)
  assert.equal(s.u0, 7, 'the bar slot')
  assert.equal(s.price0, 125, 'the price under the pointer, not the magnet\'s')
  assert.notEqual(s.price0, s.point.price)
  const free = snapPoint(at(pane, X(7.4), 150, { alt: true }), env)
  assert.equal(free.u0, ts.index(X(7.4)), 'free (Alt) is the exact fractional bar')
  assert.equal(free.u0, free.u)
  const rail = world({ magnet: 'off', targets: [{ kind: 'level', paneId: 'price', id: 'h', price: 130, tag: null }] })
  const r = snapPoint(at(rail.pane, X(9), Y(130) + 3), rail.env)
  assert.equal(r.kind, 'level')
  assert.equal(r.point.price, 130)
  assert.equal(r.price0, 200 - (Y(130) + 3) / 2, 'the level rail pulled it off the pointer price')
})

test('the snap state carries kind, target and tag for the next frame', () => {
  const { pane, env } = world()
  const s = snapPoint(at(pane, X(5), 176), env)
  assert.deepEqual(s.state, { kind: 'ohlc', targetId: null, tag: 'H', x: s.x, y: s.y })
})

// ------------------------------------------------------------------ targets

test('collectSnapTargets uses each tool’s own targets, else its anchors', () => {
  const pane = { id: 'price', rect: { x: 0, y: 0, w: 600, h: 400 }, ps: makePs(), visible: [] }
  const other = { id: 'rsi', rect: { x: 0, y: 0, w: 600, h: 400 }, ps: makePs(), visible: [] }
  const ctxFor = () => ({ host: { ts } })
  const d = (id, extra) => ({ id, type: 't', visible: true, points: [{ time: T0, price: 150 }, { time: T0 + MIN, price: 160 }], ...extra })
  const own = { snapTargets: (dd, g, ctx, out) => { out.push({ kind: 'level', price: 1, paneId: 'price', id: dd.id }); return 1 } }
  const slots = [
    { id: 'a', d: d('a'), tool: {}, pane, u: Float64Array.from([0, 1]), drawn: true, broken: null },
    { id: 'b', d: d('b'), tool: own, pane, u: Float64Array.from([0, 1]), drawn: true, broken: null },
    { id: 'hidden', d: d('hidden', { visible: false }), tool: {}, pane, u: Float64Array.from([0, 1]), drawn: true, broken: null },
    { id: 'rsi', d: d('rsi'), tool: {}, pane: other, u: Float64Array.from([0, 1]), drawn: true, broken: null },
    { id: 'self', d: d('self'), tool: {}, pane, u: Float64Array.from([0, 1]), drawn: true, broken: null },
  ]
  const out = collectSnapTargets(slots, 'price', 'self', ctxFor, [{ stale: true }])
  assert.deepEqual(out.map((t) => `${t.id}:${t.kind}`), ['a:anchor', 'a:anchor', 'b:level'])
  assert.equal(out[1].x, X(1))
  assert.equal(out[1].y, Y(160))
  assert.equal(out[0].point, slots[0].d.points[0])
})
