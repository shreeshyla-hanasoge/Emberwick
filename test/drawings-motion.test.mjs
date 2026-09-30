/**
 * Drawing motion: residuals in data space, pixel-based settling, and modes.
 *
 * The rules under test are the two that make motion feel liquid without
 * costing anything: a glide stays glued to its bar under a zoom (it lives in
 * bars and fwd-price, not pixels), and the loop goes idle as soon as what is
 * left of a motion is invisible — never 1e-9 later, and never at all under
 * motion:'none'.
 *
 * Pure: a real TimeScale and PriceScale stand in for the chart, and the
 * view object is the fake host the controller would pass.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TimeScale, PriceScale, Smoothed } from '../src/chart/index.js'
import {
  Motion, Eased, Residual, MOTION, easeOutBack, easeInCubic, stagger,
} from '../src/drawings/render/motion.js'
import { projectSlots } from '../src/drawings/render/scene.js'

/** A one-pane view: 500 bars at 9 px, prices 90..110 over a 400 px pane. */
function makeView({ mode = 'linear' } = {}) {
  const ts = new TimeScale()
  ts.resize(832)
  ts.setBarCount(500)
  ts.jumpToRealtime()
  const ps = new PriceScale({ mode })
  ps.layout(0, 400)
  ps.beginFit()
  ps.consider(90, 110)
  ps.endFit()
  const pane = { id: 'price', rect: { x: 0, y: 0, w: 832, h: 400 }, ps, visible: [] }
  const host = { ts, bars: [{}], source: [{}], panes: [pane], paneById: (id) => (id === pane.id ? pane : null) }
  return { host, pane, ts, ps }
}

/** Tick until idle; returns the number of frames that asked for another. */
function run(m, view, dt = 16, max = 600) {
  let n = 0
  while (n < max && m.tick(dt, view)) n++
  return n
}

const look = (m, id) => m.look(id, {})

// ------------------------------------------------------------- Eased --

test('an Eased hover settles on its absolute epsilon within 25 frames, not after a second', () => {
  const e = new Eased(0, MOTION.hover.tau, MOTION.eps)
  e.set(1)
  let n = 0
  while (n < 200 && e.tick(16)) n++
  assert.ok(n <= 25, `settled after ${n} frames`)
  assert.equal(e.value, 1)

  // The contrast that motivates the class: Smoothed's relative epsilon keeps
  // ticking an invisible tail for more than twice as long.
  const s = new Smoothed(0, MOTION.hover.tau)
  s.set(1)
  let m = 0
  while (m < 200 && s.tick(16)) m++
  assert.ok(m > 45, `Smoothed took ${m} frames`)
})

test('a NaN-seeded Eased reads as settled and stops ticking at once', () => {
  assert.equal(new Eased(NaN, 60, MOTION.eps).settled, true)
  const e = new Eased(0, 60, MOTION.eps)
  e.value = NaN
  assert.equal(e.settled, true)
  let n = 0
  while (n < 10 && e.tick(16)) n++
  // One frame at most: the snap to the target may itself count as a
  // visible change, but NaN must never keep a loop spinning.
  assert.ok(n <= 1, `ticked ${n} frames`)
  assert.equal(e.value, 0)

  const bad = new Eased(0, 60, NaN)
  bad.set(1)
  assert.equal(bad.settled, true, 'a NaN epsilon also reads settled')
})

// --------------------------------------------------------- residuals --

test('a glide with a non-finite delta seeds nothing', () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  m.glide('a', 0, NaN, 1, 'nudge', 'price')
  m.glide('a', 1, 2, Infinity, 'nudge', 'price')
  m.glide('a', 2, -Infinity, 0, 'snapGlide', 'price')
  assert.equal(m.residual('a', 0), null)
  assert.equal(m.residual('a', 1), null)
  assert.equal(m.residual('a', 2), null)
  assert.equal(m.active, false)
  assert.equal(m.tick(16, view), false)
})

test('a morph from a NaN index (zero bars, unresolvable time) seeds no residual', () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  m.morph('a', Float64Array.of(NaN, 100, 10, 101), Float64Array.of(5, 100, 12, NaN), 'price')
  assert.equal(m.residual('a', 0), null)
  assert.equal(m.residual('a', 1), null)
})

test('a morph seeds one residual per anchor, old minus new, and the what-changed halo', () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  m.morph('a', Float64Array.of(10, 100, 20, 104), Float64Array.of(12, 101, 20, 104), 'price')
  assert.deepEqual(m.residual('a', 0), { ru: -2, rv: -1 })
  assert.equal(m.residual('a', 1), null, 'an anchor that did not move gets no residual')
  m.tick(16, view)
  m.tick(16, view)
  assert.ok(look(m, 'a').hover > 0, 'the pulse shows as a halo')
  assert.ok(look(m, 'a').pulse > 0)
  run(m, view)
  assert.equal(m.residual('a', 0), null)
  assert.equal(look(m, 'a').hover, 0, 'the halo is gone at rest')
})

test('a residual decays onto the data and ends once it is under 0.1 px', () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  m.glide('a', 0, 3, 0.5, 'morph', 'price')
  m.tick(16, view)
  const mid = m.residual('a', 0)
  assert.ok(mid.ru > 0 && mid.ru < 3, `ru ${mid.ru} is on its way`)
  assert.ok(mid.rv > 0 && mid.rv < 0.5)
  const n = run(m, view)
  // 3 bars at 9 px is 27 px; at tau 70 that is under 0.1 px after ~25 frames.
  // A relative epsilon toward 0 (1e-9) would take about four times as long.
  assert.ok(n > 10 && n <= 32, `settled after ${n} frames`)
  assert.equal(m.residual('a', 0), null)
  assert.equal(m.active, false)
})

test('the settle epsilon is measured in pixels at the current zoom', () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  m.glide('a', 0, 1, 0, 'cancel', 'price')
  const at9 = run(m, view)

  const zoomed = makeView()
  zoomed.ts._spacing.jump(90)
  const m2 = new Motion()
  m2.tick(16, zoomed)
  m2.glide('a', 0, 1, 0, 'cancel', 'price')
  const at90 = run(m2, zoomed)
  // One bar is ten times as many pixels at 90 px per bar, so the same
  // residual stays visible for longer — ln(10)·tau/16 ≈ 9 more frames.
  assert.ok(at90 > at9 + 5, `${at9} frames at 9 px, ${at90} at 90 px`)
})

test('glides add to a glide already in flight', () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  m.glide('a', 0, 2, 0, 'snapGlide', 'price')
  m.glide('a', 0, 3, 0, 'snapGlide', 'price')
  assert.equal(m.residual('a', 0).ru, 5)
})

test('a residual seeded in linear mode is zeroed when the pane switches to log', () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  // 150 price units, far larger than the whole visible range.
  m.glide('a', 0, 0, 150, 'morph', 'price')
  view.ps.setMode('log')
  m.tick(16, view)
  const r = m.residual('a', 0)
  assert.ok(!r || r.rv === 0, `rv is ${r && r.rv}`)

  // And the next paint puts the anchor where the price is, not at p·e^150.
  const d = { id: 'a', type: 't', points: [{ time: 0, price: 100 }], visible: true, style: {}, options: {} }
  let seen = null
  const tool = { type: 't', project(dd, a) { seen = { y: a[0].y }; return true }, draw() {} }
  const slot = { id: 'a', d, tool, pane: view.pane, u: Float64Array.of(480), geom: null, drawn: false, broken: null, inert: false }
  projectSlots([slot], () => ({ host: view.host, pane: view.pane }), m, false)
  assert.ok(Number.isFinite(seen.y), 'y is finite')
  assert.ok(Math.abs(seen.y - view.ps.y(100)) < 1, `y ${seen.y} vs ${view.ps.y(100)}`)
})

test('a residual whose pane was removed is dropped instead of ticking on', () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  m.glide('a', 0, 4, 0, 'morph', 'rsi')
  assert.equal(m.tick(16, view), false, 'no pane to project through: nothing left to show')
  assert.equal(m.residual('a', 0), null)
})

test('Residual is stamped with the pane id and the price mode it was seeded under', () => {
  const r = new Residual('a', 1, 'price', 'linear', 70)
  assert.equal(r.paneId, 'price')
  assert.equal(r.mode, 'linear')
  assert.ok(r.ru instanceof Eased && r.rv instanceof Eased)
})

// -------------------------------------------------------------- wake --

test('onWake fires once when the live set goes from empty to non-empty', () => {
  const view = makeView()
  let wakes = 0
  const m = new Motion({ onWake: () => wakes++ })
  m.hover('a')
  assert.equal(wakes, 1)
  m.select(['a'])
  m.press('a', 0)
  m.glide('a', 0, 1, 0, 'nudge', 'price')
  assert.equal(wakes, 1, 'not again while something is already live')
  run(m, view)
  assert.equal(m.active, false)
  m.hover(null)
  assert.equal(wakes, 2, 'again after the set emptied')
})

test('a change that animates nothing under its mode still gets its one repaint', () => {
  let wakes = 0
  const m = new Motion({ mode: 'reduced', onWake: () => wakes++ })
  m.glide('a', 0, 1, 0, 'nudge', 'price')
  assert.equal(wakes, 1, 'the nudged drawing is repainted where it now is')
  assert.equal(m.active, false)
})

// ------------------------------------------------------------- modes --

test("motion:'none' finishes everything on the next tick: zero keep-alive frames", () => {
  const view = makeView()
  const m = new Motion({ mode: 'full' })
  m.hover('a')
  m.select(['a'])
  m.appear('a')
  m.glide('a', 0, 5, 0, 'morph', 'price')
  m.tick(16, view)
  assert.equal(m.active, true)
  m.setMode('none')
  assert.equal(m.tick(16, view), false)
  assert.equal(m.active, false)
  const l = look(m, 'a')
  assert.equal(l.hover, 1, 'decorations jump to their targets')
  assert.equal(l.select, 1)
  assert.equal(l.alpha, 1)
  assert.equal(m.residual('a', 0), null, 'residuals are zeroed')
})

test("motion:'none' from the start: seeds jump, no ghost, no residual, no ripple", () => {
  const view = makeView()
  let wakes = 0
  const m = new Motion({ mode: 'none', onWake: () => wakes++ })
  m.hover('a')
  assert.ok(wakes >= 1, 'the hover still gets a repaint')
  assert.equal(m.tick(16, view), false)
  assert.equal(look(m, 'a').hover, 1)
  m.glide('a', 0, 5, 1, 'morph', 'price')
  m.ghost({ id: 'g', d: {}, tool: {} })
  m.ripple(10, 100, 'price')
  m.ring(10, 100, 'price', 'H')
  assert.equal(m.residual('a', 0), null)
  assert.equal(m.ghosts.size, 0)
  assert.equal(m.ripples.size, 0)
  assert.equal(m.rings.size, 0)
  assert.equal(m.tick(16, view), false)
})

test("motion:'reduced' drops residuals, ripples, shakes and stagger but keeps short fades", () => {
  const view = makeView()
  const m = new Motion({ mode: 'reduced' })
  m.tick(16, view)
  m.glide('a', 0, 5, 0, 'morph', 'price')
  m.ripple(10, 100, 'price')
  m.shake('a')
  m.warn('a')
  assert.equal(m.residual('a', 0), null)
  assert.equal(m.ripples.size, 0)
  assert.equal(look(m, 'a').shake, 0)
  assert.equal(look(m, 'a').warnPulse, 0)

  m.select(['b'])
  assert.equal(m.handlePop('b', 5), 1, 'handles appear at once: no overshoot, no stagger')

  const m2 = new Motion({ mode: 'reduced' })
  m2.appear('c')
  m2.tick(16, view)
  const a = look(m2, 'c').alpha
  assert.ok(a > 0 && a < 1, `appear still fades (alpha ${a})`)
  const n = run(m2, view)
  assert.ok((n + 2) * 16 <= MOTION.reducedMs + 16, `the fade is capped at ${MOTION.reducedMs} ms (${n + 2} frames)`)
  assert.equal(look(m2, 'c').alpha, 1)

  m.reveal('d', 'hline', 3)
  assert.equal(look(m, 'd').reveal, 1, 'no reveal growth')
})

test("switching a running chart to 'reduced' drops a glide in flight", () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  m.glide('a', 0, 5, 0, 'morph', 'price')
  m.setMode('reduced')
  assert.equal(m.residual('a', 0), null)
  assert.equal(m.tick(16, view), false)
})

// ----------------------------------------------------------- one-shots --

test('stagger spaces fib levels 22 ms apart and all ten land inside 400 ms', () => {
  assert.equal(stagger(0, 0, 22, 180), 0)
  assert.equal(stagger(90, 0, 22, 180), 0.5)
  assert.equal(stagger(22, 1, 22, 180), 0)
  assert.equal(stagger(22 + 90, 1, 22, 180), 0.5)
  assert.equal(stagger(9 * 22 + 180, 9, 22, 180), 1)
  assert.ok(9 * 22 + 180 <= MOTION.fibStagger.span)
  assert.equal(stagger(-5, 0, 22, 180), 0)
})

test('easeOutBack overshoots and lands; easeInCubic starts slow', () => {
  assert.ok(Math.abs(easeOutBack(0)) < 1e-12)
  assert.ok(Math.abs(easeOutBack(1) - 1) < 1e-12)
  assert.ok(easeOutBack(0.7) > 1, 'the pop overshoots')
  assert.equal(easeInCubic(0.5), 0.125)
})

test('a fib reveal runs its age clock for the stagger and then stops', () => {
  const view = makeView()
  const m = new Motion()
  m.reveal('f', 'fib')
  assert.equal(look(m, 'f').age, 0)
  m.tick(16, view)
  assert.equal(look(m, 'f').age, 16)
  const n = run(m, view)
  assert.ok(n * 16 <= MOTION.fibStagger.span + 16, `${n} frames`)
  assert.ok(look(m, 'f').age >= MOTION.fibStagger.span)
})

test('a ghost is dropped once its 160 ms fade ends', () => {
  const view = makeView()
  const m = new Motion()
  const slot = { id: 'g', d: { id: 'g' }, tool: { type: 't' } }
  m.ghost(slot)
  assert.equal(m.ghosts.size, 1)
  assert.equal([...m.ghosts][0].slot, slot, 'the ghost keeps the drawing and its tool')
  const n = run(m, view)
  assert.equal(n, Math.ceil(MOTION.ghost.ms / 16) - 1)
  assert.equal(m.ghosts.size, 0)
  assert.equal(m.active, false)
})

test('warnPulse is one-shot: after 300 ms nothing keeps the loop awake', () => {
  const view = makeView()
  const m = new Motion()
  m.warn('p')
  m.tick(16, view)
  assert.ok(look(m, 'p').warnPulse > 0)
  let frames = 1
  while (frames < 100 && m.tick(16, view)) frames++
  // `frames` ticks asked for another frame; the one after them (which ends
  // the pulse and paints it at rest) is the last.
  const last = (frames + 1) * 16
  assert.ok(last >= MOTION.warnPulse.ms && last < MOTION.warnPulse.ms + 16, `${frames + 1} frames`)
  assert.equal(look(m, 'p').warnPulse, 0)
  for (let i = 0; i < 30; i++) assert.equal(m.tick(16, view), false, 'never periodic')
})

test('a shake is a damped 3 px sine that ends at rest', () => {
  const view = makeView()
  const m = new Motion()
  m.shake('a')
  let peak = 0
  while (m.tick(16, view)) peak = Math.max(peak, Math.abs(look(m, 'a').shake))
  assert.ok(peak > 1 && peak <= MOTION.shake.px, `peak ${peak}`)
  assert.equal(look(m, 'a').shake, 0)
})

test('dt 0 (a synchronous export re-render) advances nothing', () => {
  const view = makeView()
  const m = new Motion()
  m.appear('a')
  m.tick(0, view)
  m.tick(0, view)
  assert.equal(look(m, 'a').alpha, 0, 'the fade has not started')
})

// --------------------------------------------------------- selection --

test('selected handles pop in 25 ms apart with an overshoot, and shrink out together', () => {
  const view = makeView()
  const m = new Motion()
  m.select(['a'])
  assert.equal(m.handlePop('a', 0), 0)
  for (let i = 0; i < 5; i++) m.tick(16, view)
  assert.ok(m.handlePop('a', 0) > m.handlePop('a', 3), 'staggered')
  let over = 0
  for (let i = 0; i < 40; i++) { m.tick(16, view); over = Math.max(over, m.handlePop('a', 0)) }
  assert.ok(over > 1, 'overshoots')
  assert.equal(m.handlePop('a', 7), 1)
  assert.equal(look(m, 'a').select, 1)
  assert.equal(look(m, 'a').stats, 1)
  assert.ok(m.bandAlpha('a') > 0.99)

  m.select([])
  assert.equal(m.deselecting('a'), true)
  m.tick(16, view)
  const p = m.handlePop('a', 0)
  assert.ok(p > 0 && p < 1)
  assert.equal(m.handlePop('a', 5), p, 'every handle leaves at once')
  run(m, view)
  assert.equal(m.handlePop('a', 0), 0)
  assert.equal(m.deselecting('a'), false)
  assert.equal(m.bandAlpha('a'), 0)
})

test('press scales the pressed handle and releases it', () => {
  const view = makeView()
  const m = new Motion()
  m.press('a', 1)
  run(m, view)
  assert.equal(look(m, 'a').press, 1)
  assert.equal(look(m, 'a').pressedHandle, 1)
  m.press(null)
  run(m, view)
  assert.equal(look(m, 'a').press, 0)
  assert.equal(look(m, 'a').pressedHandle, -1)
})

test('the handle radius eases between mouse and touch sizes', () => {
  const view = makeView()
  const m = new Motion()
  assert.equal(look(m, 'x').handleR, MOTION.handleSize.mouse)
  m.handleSize(true)
  m.tick(16, view)
  const r = look(m, 'x').handleR
  assert.ok(r > MOTION.handleSize.mouse && r < MOTION.handleSize.touch)
  run(m, view)
  assert.equal(look(m, 'x').handleR, MOTION.handleSize.touch)
})

test('a label side change eases across; the first report jumps', () => {
  const view = makeView()
  const m = new Motion()
  m.labelSide('a', 1)
  assert.equal(look(m, 'a').flip, 1)
  assert.equal(m.active, false)
  m.labelSide('a', -1)
  m.tick(16, view)
  const f = look(m, 'a').flip
  assert.ok(f < 1 && f > -1, `flip ${f}`)
  run(m, view)
  assert.equal(look(m, 'a').flip, -1)
})

// ------------------------------------------------------ decorations --

test('rings and ripples are stored in data space, one ring at a time', () => {
  const view = makeView()
  const m = new Motion()
  m.ring(480, 101, 'price', 'H')
  m.ring(481, 102, 'price', 'L')
  assert.equal(m.rings.size, 1)
  const ring = [...m.rings][0]
  assert.equal(ring.u, 481)
  assert.equal(ring.price, 102)
  assert.equal(ring.tag, 'L')
  m.ripple(480, 101, 'price')
  assert.equal(m.ripples.size, 1)
  m.ring(NaN, 100, 'price', null)
  assert.equal(m.rings.size, 1, 'a NaN point places no ring')
  run(m, view)
  assert.equal(m.rings.size, 0)
  assert.equal(m.ripples.size, 0)
})

test('look() at rest is the neutral look', () => {
  const m = new Motion()
  const l = look(m, 'nobody')
  assert.equal(l.hover, 0)
  assert.equal(l.select, 0)
  assert.equal(l.alpha, 1)
  assert.equal(l.reveal, 1)
  assert.equal(l.pressedHandle, -1)
  assert.equal(l.warnPulse, 0)
  assert.equal(l.outcome, 1)
  assert.ok(stagger(l.age, 9, 22, 180) === 1, 'a resting fib shows every level')
})

test('commit fades the 60% preview into the solid drawing', () => {
  const view = makeView()
  const m = new Motion()
  m.commit('a')
  assert.ok(Math.abs(look(m, 'a').alpha - MOTION.commit.from) < 1e-9)
  assert.equal(look(m, 'a').widthAdd, 1)
  run(m, view)
  assert.equal(look(m, 'a').alpha, 1)
  assert.equal(look(m, 'a').widthAdd, 0)
})

test('forget drops a drawing\'s state; finishAll empties everything', () => {
  const view = makeView()
  const m = new Motion()
  m.tick(16, view)
  m.hover('a')
  m.glide('a', 0, 3, 0, 'morph', 'price')
  m.forget('a')
  assert.equal(m.residual('a', 0), null)
  assert.equal(m.active, false)

  m.appear('b')
  m.ghost({ d: {}, tool: {} })
  assert.equal(m.finishAll(), false)
  assert.equal(m.active, false)
  assert.equal(m.ghosts.size, 0)
  assert.equal(look(m, 'b').alpha, 1)
})

test('MOTION is the spec table, and frozen', () => {
  assert.equal(MOTION.snapGlide.tau, 28)
  assert.equal(MOTION.morph.tau, 70)
  assert.equal(MOTION.ghost.ms, 160)
  assert.equal(MOTION.warnPulse.ms, 300)
  assert.equal(MOTION.ripple.r, 14)
  assert.ok(Object.isFrozen(MOTION) && Object.isFrozen(MOTION.hover))
})
