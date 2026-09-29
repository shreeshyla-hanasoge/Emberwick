/**
 * The frame that wakes an idle loop.
 *
 * The loop idles at zero CPU, and `_last` stays where the last frame left it.
 * The next invalidate() — a wheel notch, a hover — used to measure dt from
 * there and clamp it to 64ms, so the first frame of every ease covered 63% of
 * a tau-65 zoom where one nominal frame covers 23%, and every hover fade
 * popped instead of easing. The first frame after idle is one nominal frame.
 *
 * These drive Loop._tick directly with chosen timestamps: requestAnimationFrame
 * never fires under the stub.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { Loop } = await import('../src/chart/core/Loop.js')

/** A loop whose frame records dt and asks for more while `busy` says so. */
const recording = () => {
  const dts = []
  const state = { busy: false }
  const loop = new Loop((_dirty, dt) => { dts.push(dt); return state.busy })
  return { loop, dts, state }
}

test('the first frame after an idle stretch is one nominal frame, not 64ms', () => {
  const { loop, dts } = recording()
  loop.start()
  const t0 = (loop._last = 1000)       // integral, so deltas compare exactly
  loop._tick(t0 + 16)                   // the start-up frame; nothing to animate: idle
  loop.invalidate('overlay')
  loop._tick(t0 + 5000)                 // five seconds later, a hover wakes it
  assert.equal(dts[1], 16.667, 'the waking frame covers one frame of any ease it starts')
})

test('continuous frames get the real delta, clamped to 64', () => {
  const { loop, dts, state } = recording()
  loop.start()
  const t0 = (loop._last = 1000)       // integral, so deltas compare exactly
  state.busy = true
  loop._tick(t0 + 16)
  loop._tick(t0 + 46)                   // a 30ms frame while animating
  loop._tick(t0 + 346)                  // a 300ms stall while animating
  assert.deepEqual(dts, [16, 30, 64])
})

test('only the waking frame is nominal; the next one measures again', () => {
  const { loop, dts, state } = recording()
  loop.start()
  const t0 = (loop._last = 1000)       // integral, so deltas compare exactly
  loop._tick(t0 + 16)                   // idle
  state.busy = true
  loop.invalidate('all')
  loop._tick(t0 + 9000)                 // wakes: nominal
  loop._tick(t0 + 9025)                 // animating: real
  assert.deepEqual(dts.slice(1), [16.667, 25])
})

test('start() forgets an idle it did not see end', () => {
  const { loop, dts } = recording()
  loop.start()
  const t0 = (loop._last = 1000)       // integral, so deltas compare exactly
  loop._tick(t0 + 16)                   // idle: the wake flag is set
  loop.stop()
  loop.start()                          // a fresh start measures from itself
  const t1 = (loop._last = 20_000)
  loop._tick(t1 + 40)
  assert.equal(dts[1], 40, 'a restart is not a wake from idle')
})
