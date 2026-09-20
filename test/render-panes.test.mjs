/**
 * Pane-readiness of the renderers.
 *
 * Every renderer receives a `plot` rect. For a single-pane chart plot.y is 0,
 * so a renderer that treats 0 as the top and plot.h as the bottom looks
 * correct and is not. These tests render at a NON-ZERO plot.y and assert the
 * output lands inside that band — the property multi-pane depends on, pinned
 * before anything depends on it.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeCanvas, makeBars } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { drawPriceLines, drawZones } = await import('../src/chart/render/annotations.js')
const { drawCrosshair } = await import('../src/chart/render/crosshair.js')
const { PriceScale } = await import('../src/chart/core/PriceScale.js')
const { TimeScale } = await import('../src/chart/core/TimeScale.js')
const { defaultTheme } = await import('../src/chart/core/palette.js')
const { createTimeFormatter } = await import('../src/chart/core/formatters.js')

const T0 = 1_700_000_000_000
const MIN = 60_000

/** A pane band 200px tall starting 100px down — what pane 1 looks like. */
const BAND = { x: 0, y: 100, w: 800, h: 200 }

function paneState(overrides = {}) {
  const bars = makeBars(T0, 60, MIN)
  const ts = new TimeScale()
  ts.resize(BAND.w)
  ts.setBarCount(bars.length)
  for (let i = 0; i < 400; i++) ts.tick(16)

  const ps = new PriceScale()
  ps.layout(BAND.y, BAND.h)
  ps.fit(bars, 0, bars.length - 1)
  for (let i = 0; i < 400; i++) ps.tick(16)

  return {
    theme: defaultTheme,
    ts, ps,
    plot: BAND,
    bars,
    width: 900,
    height: 340,
    fmt: createTimeFormatter(null),
    priceLines: [],
    zones: [],
    cursor: null,
    magnet: false,
    ...overrides,
  }
}

/** Every y coordinate the ops touched. */
function ys(canvas) {
  const out = []
  for (const o of canvas.ops) {
    if (o.op === 'moveTo' || o.op === 'lineTo') out.push(o.args[1])
    else if (o.op === 'fillRect' || o.op === 'rect') { out.push(o.args[1], o.args[1] + o.args[3]) }
  }
  return out.filter(Number.isFinite)
}

test('the price scale maps into the pane band, not the canvas top', () => {
  const s = paneState()
  const mid = (s.ps.lo + s.ps.hi) / 2
  const y = s.ps.y(mid)
  assert.ok(y > BAND.y && y < BAND.y + BAND.h,
    `a mid price mapped to ${y}, outside the band ${BAND.y}..${BAND.y + BAND.h}`)
})

test('a price line draws inside its pane band', () => {
  const canvas = makeCanvas()
  const s = paneState()
  const price = (s.ps.lo + s.ps.hi) / 2
  s.priceLines = [{ price, title: 'level' }]

  drawPriceLines(canvas.getContext('2d'), s)
  const drawn = ys(canvas)
  assert.ok(drawn.length > 0, 'the line must actually draw')
  assert.ok(drawn.every((v) => v >= BAND.y - 12 && v <= BAND.y + BAND.h + 12),
    `price line drew outside its pane: ${JSON.stringify(drawn)}`)
})

test('a price line outside the pane band is culled, not clamped to the canvas', () => {
  const canvas = makeCanvas()
  const s = paneState()
  // Far above the band: with an origin-at-zero guard this passed the y > 0
  // test and drew across a neighbouring pane.
  s.priceLines = [{ price: s.ps.hi * 10, title: 'way up' }]
  drawPriceLines(canvas.getContext('2d'), s)
  assert.equal(canvas.ops.filter((o) => o.op === 'stroke').length, 0)
})

test('a time-band zone fills its pane band only', () => {
  const canvas = makeCanvas()
  const s = paneState()
  s.zones = [{ fromTime: T0 + 10 * MIN, toTime: T0 + 20 * MIN }]

  drawZones(canvas.getContext('2d'), s)
  const rects = canvas.ops.filter((o) => o.op === 'fillRect')
  assert.equal(rects.length, 1, 'the band must draw')
  const [, y, , h] = rects[0].args
  assert.equal(y, BAND.y, 'a time band starts at the top of ITS pane')
  assert.equal(h, BAND.h, 'and is exactly that pane tall')
})

test('the crosshair only responds inside its own pane band', () => {
  const inside = makeCanvas()
  const s = paneState({ cursor: { x: 400, y: BAND.y + 50 } })
  drawCrosshair(inside.getContext('2d'), s)
  assert.ok(inside.ops.some((o) => o.op === 'stroke'), 'a cursor in the band must draw')

  const above = makeCanvas()
  drawCrosshair(above.getContext('2d'), paneState({ cursor: { x: 400, y: BAND.y - 40 } }))
  assert.equal(above.ops.filter((o) => o.op === 'stroke').length, 0,
    'a cursor above the band belongs to another pane')

  const below = makeCanvas()
  drawCrosshair(below.getContext('2d'), paneState({ cursor: { x: 400, y: BAND.y + BAND.h + 40 } }))
  assert.equal(below.ops.filter((o) => o.op === 'stroke').length, 0,
    'and one below it does too')
})

test('the crosshair lines span the pane band, not the whole canvas', () => {
  const canvas = makeCanvas()
  drawCrosshair(canvas.getContext('2d'), paneState({ cursor: { x: 400, y: BAND.y + 50 } }))
  const verticalYs = canvas.ops
    .filter((o) => (o.op === 'moveTo' || o.op === 'lineTo'))
    .map((o) => o.args[1])
    .filter(Number.isFinite)
  assert.ok(Math.min(...verticalYs) >= BAND.y - 1,
    `crosshair reached above its pane: min y ${Math.min(...verticalYs)}`)
})
