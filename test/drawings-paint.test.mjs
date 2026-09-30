/**
 * Paint helpers and the drawing theme.
 *
 * The two canvas failure modes these exist for are silent: an invalid colour
 * string is ignored (the previous drawing's colour is kept), and a dash left
 * set carries into the next stroke. Both are asserted as op sequences on the
 * recording context, which has no state to read back (§9 rule 2).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeCanvas } from './dom-stub.mjs'
import { defaultTheme, lightTheme, DASH } from '../src/chart/index.js'
import {
  setStroke, setFill, dashOf, widthOf, alphaOf, crisp, clipRectOf, roundRect, pill, measureBox, drawBox, placeNear,
  handle, moveGlyph, arrowHead, halo, lockBadge, withAlpha, fontPx, fontSized, statsAlpha, putHandle, putTag,
  withTimeOf, withPrice, linePriceAt, nearRect, shakeBody,
} from '../src/drawings/render/paint.js'
import { drawingTheme, isLight, parseColor } from '../src/drawings/render/theme.js'

const rec = () => {
  const canvas = makeCanvas()
  return { c: canvas.getContext('2d'), ops: canvas.ops }
}
const setsOf = (ops) => ops.filter((o) => o.op === 'set').map((o) => [o.prop, o.value])

test('setStroke assigns the fallback colour immediately before the style colour', () => {
  const { c, ops } = rec()
  setStroke(c, '#6ea8fe', 'bogus-colour', 2, DASH.dashed)
  const s = setsOf(ops)
  assert.deepEqual(s.slice(0, 3), [['strokeStyle', '#6ea8fe'], ['strokeStyle', 'bogus-colour'], ['lineWidth', 2]])
})

test('setStroke with no style colour still assigns the fallback', () => {
  const { c, ops } = rec()
  setStroke(c, '#6ea8fe', null, 1, null)
  assert.deepEqual(setsOf(ops)[0], ['strokeStyle', '#6ea8fe'])
  assert.equal(setsOf(ops).filter(([p]) => p === 'strokeStyle').length, 1)
})

test('setStroke always sets a dash, so a solid line never inherits the previous one', () => {
  const { c, ops } = rec()
  setStroke(c, 'a', null, 1, DASH.dashed)
  setStroke(c, 'a', null, 1, null)
  setStroke(c, 'a', null, 1, DASH.solid)
  const dashes = ops.filter((o) => o.op === 'setLineDash').map((o) => o.args[0])
  assert.deepEqual(dashes, [[6, 4], [], []])
  // Dashed lines keep butt caps; solid ones are rounded.
  assert.deepEqual(setsOf(ops).filter(([p]) => p === 'lineCap').map(([, v]) => v), ['butt', 'round', 'round'])
})

test('setFill assigns the fallback before the style colour too', () => {
  const { c, ops } = rec()
  setFill(c, '#26a69a', '#nope')
  assert.deepEqual(setsOf(ops), [['fillStyle', '#26a69a'], ['fillStyle', '#nope']])
})

test('a preview dashes a solid style and keeps a dashed or dotted one', () => {
  assert.equal(dashOf({ lineStyle: 'solid' }, { preview: true }), DASH.dashed)
  assert.equal(dashOf({ lineStyle: 'solid' }, { preview: false }), DASH.solid)
  assert.equal(dashOf({ lineStyle: 'dotted' }, { preview: true }), DASH.dotted)
  assert.equal(dashOf({ lineStyle: 'weird' }, null), DASH.solid)
})

test('width grows on hover, on the commit tween and shrinks on a ghost; alpha defaults to 1', () => {
  const d = { style: { lineWidth: 2 } }
  assert.equal(widthOf(d, null), 2)
  assert.equal(widthOf(d, { hover: 1 }), 2.75)
  assert.equal(widthOf(d, { hover: 0, widthAdd: 1 }), 3)
  assert.equal(widthOf(d, { hover: 0, widthScale: 0.5 }), 1)
  assert.equal(widthOf({ style: { lineWidth: 0 } }, {}), 1)
  assert.equal(alphaOf({}), 1)
  assert.equal(alphaOf({ alpha: NaN }), 1)
  assert.equal(alphaOf({ alpha: 0.25 }), 0.25)
  assert.equal(alphaOf({ alpha: 3 }), 1)
})

test('stats visibility follows the option, the look and exports', () => {
  assert.equal(statsAlpha('never', { select: 1 }), 0)
  assert.equal(statsAlpha('always', { alpha: 0.5 }), 0.5)
  assert.equal(statsAlpha('active', {}), 0)
  assert.equal(statsAlpha('active', { stats: 0.4 }), 0.4)
  assert.equal(statsAlpha('active', { preview: true }), 1)
  assert.equal(statsAlpha('always', { exporting: true }), 0)
})

test('crisp puts an axis-aligned line on the half pixel', () => {
  assert.equal(crisp(10.2), 10.5)
  assert.equal(crisp(10.7), 11.5)
  assert.equal(crisp(-0.2), 0.5)
})

test('an arrowhead is a closed triangle with its tip on the end point', () => {
  const { c, ops } = rec()
  const half = (28 * Math.PI) / 180
  assert.equal(arrowHead(c, 0, 0, 100, 0, 10, half), true)
  const pts = ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo').map((o) => o.args)
  assert.deepEqual(pts[0], [100, 0])
  const [x1, y1] = pts[1]
  const [x2, y2] = pts[2]
  assert.ok(Math.abs(x1 - (100 - 10 * Math.cos(half))) < 1e-9 && Math.abs(y1 - 10 * Math.sin(half)) < 1e-9)
  assert.ok(Math.abs(x2 - x1) < 1e-9 && Math.abs(y2 + y1) < 1e-9, 'symmetric about the shaft')
  assert.deepEqual(ops.slice(-2).map((o) => o.op), ['closePath', 'fill'])
  const none = rec()
  assert.equal(arrowHead(none.c, 5, 5, 5, 5, 10, half), false, 'no direction, no arrow')
  assert.equal(none.ops.length, 0)
})

test('fills and halos assign globalAlpha as absolute values', () => {
  const { c, ops } = rec()
  halo(c, (cc, g) => { cc.moveTo(g.x, 0); cc.lineTo(g.x, 10) }, '#f5a524', 7, 0.06, { x: 3 })
  assert.deepEqual(setsOf(ops)[0], ['globalAlpha', 0.06])
  assert.ok(ops.some((o) => o.op === 'moveTo' && o.args[0] === 3), 'the path function got its argument')
  const nothing = rec()
  halo(nothing.c, () => { throw new Error('not called') }, 'x', 1, 0)
  assert.equal(nothing.ops.length, 0, 'a zero-alpha halo draws nothing')
})

test('a handle fills with the accent when pressed', () => {
  const up = rec()
  handle(up.c, 10, 10, 4.5, '#000', '#f5a524', false)
  assert.ok(setsOf(up.ops).some(([p, v]) => p === 'fillStyle' && v === '#000'))
  const down = rec()
  handle(down.c, 10, 10, 6, '#000', '#f5a524', true)
  assert.ok(setsOf(down.ops).some(([p, v]) => p === 'fillStyle' && v === '#f5a524'))
  assert.ok(down.ops.some((o) => o.op === 'arc' && o.args[2] === 6))
  const g = rec()
  moveGlyph(g.c, 0, 0, 7, '#fff')
  assert.ok(g.ops.filter((o) => o.op === 'closePath').length >= 4, 'four arrowheads')
  const l = rec()
  lockBadge(l.c, 5, 5, '#888')
  assert.ok(l.ops.some((o) => o.op === 'fillRect'))
})

test('a pill and a label box are sized by the text they draw', () => {
  const { c, ops } = rec()
  const w = pill(c, 100, 50, 'abc', '#222', '#fff', '11px sans-serif', 'center')
  assert.equal(w, 10 + 16, 'measured width plus padding')
  const h = 15 + 4
  assert.deepEqual(ops.find((o) => o.op === 'fillText').args, ['abc', 100 - w / 2 + 8, Math.round(50 - h / 2) + h / 2])
  const box = measureBox(c, ['a', 'b', 'c'], 3, '11px sans-serif', {})
  assert.equal(box.h, 3 * 15 + 4)
  box.x = 0
  box.y = 0
  const r = rec()
  drawBox(r.c, box, ['one', 'two'], 2, '#222', '#fff', '11px x', 'left', '#26a69a')
  const fills = setsOf(r.ops).filter(([p]) => p === 'fillStyle').map(([, v]) => v)
  assert.deepEqual(fills, ['#222', '#26a69a', '#fff'], 'background, then a coloured first line')
})

test('a label box sits below-right of its point, flips at the pane edge and stays inside', () => {
  const rect = { x: 0, y: 0, w: 800, h: 400 }
  const b = placeNear({ w: 100, h: 30 }, 100, 100, rect, false)
  assert.deepEqual([b.x, b.y, b.side], [114, 114, 1])
  const edge = placeNear({ w: 100, h: 30 }, 750, 390, rect, false)
  assert.deepEqual([edge.x, edge.y, edge.side], [750 - 114, 390 - 44, -1])
  const touch = placeNear({ w: 100, h: 30 }, 400, 200, rect, true)
  assert.equal(touch.y, 200 - 64 - 30, 'above the finger')
  const clamped = placeNear({ w: 100, h: 30 }, 10, 10, rect, true)
  assert.ok(clamped.x >= 4 && clamped.y >= 4)
  const eased = placeNear({ w: 100, h: 30 }, 400, 200, rect, false, 0)
  assert.equal(eased.x, (400 - 114 + 414) / 2, 'halfway through an eased flip')
})

test('the clip rect is the pane, or the whole plot for span:all', () => {
  const ctx = { pane: { rect: { x: 0, y: 410, w: 800, h: 150 } }, host: { plotBottom: 560 } }
  assert.deepEqual(clipRectOf(ctx, 'pane', {}), { x: 0, y: 410, w: 800, h: 150 })
  assert.deepEqual(clipRectOf(ctx, 'plot', {}), { x: 0, y: 0, w: 800, h: 560 })
  const out = {}
  assert.equal(clipRectOf(ctx, 'pane', out), out, 'written into the caller\'s rect')
  assert.ok(nearRect({ x: 0, y: 0, w: 10, h: 10 }, 12, 5, 3))
  assert.ok(!nearRect({ x: 0, y: 0, w: 10, h: 10 }, 14, 5, 3))
})

test('a rounded rect is a closed path that clamps its radius', () => {
  const { c, ops } = rec()
  roundRect(c, 10, 10, -20, 6, 50)
  assert.equal(ops[0].op, 'beginPath')
  assert.equal(ops.at(-1).op, 'closePath')
  assert.deepEqual(ops[1].args, [-10 + 3, 10], 'normalized, radius at most half the height')
})

test('scratch writers reuse the caller\'s objects', () => {
  const out = []
  putHandle(out, 0, 1, 2, 3, 'x', 'ew-resize')
  const h = out[0]
  putHandle(out, 0, 5, 6, -1, 'xy', 'move', true)
  assert.equal(out[0], h)
  assert.deepEqual({ ...h }, { x: 5, y: 6, index: -1, axis: 'xy', cursor: 'move', move: true })
  const tags = []
  putTag(tags, 0, 'price', 10, '100.00', '#fff')
  assert.deepEqual({ ...tags[0] }, { axis: 'price', pos: 10, text: '100.00', color: '#fff' })
})

test('point mixers keep a bar-count offset with its timeframe', () => {
  const future = { time: 5, price: 1, offset: 3, tf: 60000 }
  assert.deepEqual(withTimeOf({ time: 1, price: 9, offset: 2 }, future), { time: 5, price: 9, offset: 3, tf: 60000 })
  assert.deepEqual(withTimeOf({ time: 1, price: 9, offset: 2 }, { time: 7, price: 0 }), { time: 7, price: 9 })
  assert.deepEqual(withPrice(future, 42), { time: 5, price: 42, offset: 3, tf: 60000 })
})

test('a line price is interpolated in forward space and respects its extension', () => {
  const lin = { fwd: (p) => p, inv: (v) => v }
  assert.equal(linePriceAt(100, 110, 0, 10, false, false, 5, lin), 105)
  assert.equal(linePriceAt(100, 110, 0, 10, false, false, 11, lin), null)
  assert.equal(linePriceAt(100, 110, 0, 10, false, true, 20, lin), 120)
  assert.equal(linePriceAt(100, 110, 0, 10, true, false, -10, lin), 90)
  assert.equal(linePriceAt(100, 110, 5, 5, true, true, 5, lin), null, 'a vertical line has no single price')
  const log = { fwd: Math.log, inv: Math.exp }
  assert.ok(Math.abs(linePriceAt(100, 400, 0, 10, false, false, 5, log) - 200) < 1e-9)
})

test('fonts keep their family at a new size', () => {
  assert.equal(fontPx('11px ui-sans-serif'), 11)
  assert.equal(fontPx('bold 13.5px Inter'), 13.5)
  assert.equal(fontPx('Inter'), 11)
  assert.equal(fontSized('11px ui-sans-serif, -apple-system', 16), '16px ui-sans-serif, -apple-system')
  assert.equal(fontSized('bold 11px Inter', 20), 'bold 20px Inter')
  assert.match(fontSized(undefined, 12), /^12px /)
})

test('the shake moves the whole body, and nothing at rest', () => {
  const { c, ops } = rec()
  shakeBody(c, { shake: 0 })
  shakeBody(c, { shake: NaN })
  assert.equal(ops.length, 0)
  shakeBody(c, { shake: -2.5 })
  assert.deepEqual(ops, [{ op: 'translate', args: [-2.5, 0] }])
})

test('withAlpha is for DOM chrome and leaves what it cannot parse alone', () => {
  assert.equal(withAlpha('#f5a524', 0.5), 'rgba(245,165,36,0.5)')
  assert.equal(withAlpha('#fff', 1), 'rgba(255,255,255,1)')
  assert.equal(withAlpha('rgb(1, 2, 3)', 0.2), 'rgba(1,2,3,0.2)')
  assert.equal(withAlpha('hsl(0 0% 0%)', 0.2), 'hsl(0 0% 0%)')
})

/* -------------------------------------------------------------- theme -- */

test('light and dark backgrounds are told apart by relative luminance', () => {
  assert.equal(isLight('#ffffff'), true)
  assert.equal(isLight('#fff'), true)
  assert.equal(isLight('#0b0e14'), false)
  assert.equal(isLight('rgb(250, 250, 245)'), true)
  assert.equal(isLight('rgba(20,20,20,0.9)'), false)
  assert.equal(isLight('#808080'), false, 'mid grey is below 0.5 luminance')
  assert.equal(isLight('#fffc'), true, '#rgba')
  assert.equal(isLight('#ffffffcc'), true, '#rrggbbaa')
  assert.equal(isLight('white'), false, 'unknown reads as dark')
  assert.equal(isLight(undefined), false)
  assert.equal(parseColor('#12'), null)
  assert.equal(parseColor('#zzzzzz'), null)
})

test('the drawing theme follows the chart theme and picks line and accent per background', () => {
  const dark = drawingTheme(defaultTheme)
  assert.equal(dark.line, '#6ea8fe')
  assert.equal(dark.accent, '#f5a524')
  assert.equal(dark.halo, dark.accent)
  assert.equal(dark.handleFill, defaultTheme.background)
  assert.equal(dark.labelBg, defaultTheme.labelBg)
  assert.equal(dark.up, defaultTheme.up)
  assert.equal(dark.textColor, defaultTheme.textStrong)
  assert.equal(dark.fib.length, 10)
  const light = drawingTheme(lightTheme)
  assert.equal(light.line, '#2962ff')
  assert.equal(light.accent, '#d97706')
  assert.equal(light.tagText, lightTheme.tagText)
})

/** Hue in degrees (0..360) of a parsed colour. */
function hueOf(color) {
  const [r, g, b] = parseColor(color).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (!d) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const hueGap = (a, b) => {
  const d = Math.abs(hueOf(a) - hueOf(b))
  return Math.min(d, 360 - d)
}

test('the warning colour is nowhere near the accent, up or down, on either background', () => {
  // It was #f59e0b beside a #f5a524 accent: a wrong-side position read as a selected one.
  for (const chart of [defaultTheme, lightTheme]) {
    const t = drawingTheme(chart)
    assert.ok(hueGap(t.warn, t.accent) >= 90, `${chart.background}: warn ${t.warn} vs accent ${t.accent}`)
    assert.ok(hueGap(t.warn, t.up) >= 60, `${chart.background}: warn vs up`)
    assert.ok(hueGap(t.warn, t.down) >= 60, `${chart.background}: warn vs down`)
    assert.ok(hueGap(t.warn, t.line) >= 60, `${chart.background}: warn vs the default line`)
    assert.notEqual(t.warn, t.accent)
  }
  assert.notEqual(drawingTheme(defaultTheme).warn, drawingTheme(lightTheme).warn, 'a shade per background')
})

test('the warning colour carries its tag text at a readable contrast on both backgrounds', () => {
  const lum = (color) => {
    const [r, g, b] = parseColor(color).map((v) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  for (const chart of [defaultTheme, lightTheme]) {
    const t = drawingTheme(chart)
    const [hi, lo] = [lum(t.warn), lum(t.tagText)].sort((a, b) => b - a)
    assert.ok((hi + 0.05) / (lo + 0.05) >= 4.5, `${chart.background}: tag text on warn`)
  }
})

test('theme keys and overrides take precedence over the derived colours', () => {
  const t = drawingTheme({ ...defaultTheme, drawingLine: '#123456', drawingAccent: '#abcdef', drawingFib: ['#1'] }, { warn: '#ff0000' })
  assert.equal(t.line, '#123456')
  assert.equal(t.accent, '#abcdef')
  assert.deepEqual(t.fib, ['#1'])
  assert.equal(t.warn, '#ff0000')
  assert.doesNotThrow(() => drawingTheme(undefined))
})
