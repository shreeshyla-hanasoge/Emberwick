/**
 * isLight in the core, and the scale members the typings now declare.
 *
 * isLight moved out of src/drawings so that every plugin picks colours for a
 * theme the same way. The members (TimeScale.spacing/width/timeframeMs,
 * PriceScale.mode) always existed in the JS and are what a plugin projects
 * with; this pins them to what index.d.ts says they are.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { installDom, makeContainer, makeBars, frame, settle } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const core = await import('../src/chart/index.js')
const theme = await import('../src/drawings/render/theme.js')
const { createChart, isLight, defaultTheme, lightTheme } = core

test('the core entry exports isLight, and drawings use that same function', () => {
  assert.equal(typeof isLight, 'function')
  assert.ok(theme.isLight === isLight, 'src/drawings/render/theme.js re-exports the core isLight')
})

test('isLight is relative luminance above 0.5, and unknown formats read as dark', () => {
  assert.equal(isLight('#ffffff'), true)
  assert.equal(isLight('#fff'), true)
  assert.equal(isLight('#0b0e14'), false)
  assert.equal(isLight('rgb(250, 250, 245)'), true)
  assert.equal(isLight('rgba(20,20,20,0.9)'), false)
  assert.equal(isLight('#808080'), false, 'mid grey is below 0.5 luminance')
  assert.equal(isLight('#bcbcbc'), true, 'and #bcbcbc is just above it')
  assert.equal(isLight('#fffc'), true, '#rgba')
  assert.equal(isLight('#ffffffcc'), true, '#rrggbbaa')
  assert.equal(isLight('  #FFFFFF '), true, 'trimmed and case-insensitive')
  assert.equal(isLight('white'), false, 'a named colour is unknown, and unknown reads as dark')
  assert.equal(isLight('hsl(0 0% 100%)'), false)
  assert.equal(isLight('#12'), false)
  assert.equal(isLight('#zzzzzz'), false)
  assert.equal(isLight(undefined), false)
  assert.equal(isLight(null), false)
})

test('isLight tells the two bundled themes apart', () => {
  assert.equal(isLight(defaultTheme.background), false)
  assert.equal(isLight(lightTheme.background), true)
  assert.equal(theme.drawingTheme(lightTheme).line, '#2962ff', 'the drawings still pick their light palette through it')
  assert.equal(theme.drawingTheme(defaultTheme).line, '#6ea8fe')
})

test('the scales expose the members a plugin projects with', () => {
  const chart = createChart(makeContainer(), { timeScale: { spacing: 12 } })
  chart.setData(makeBars(1_700_000_000_000, 500, 300_000, 100))
  settle(chart); frame(chart)
  assert.equal(chart.ts.spacing, 12)
  assert.equal(chart.ts.width, chart.plot.w, 'the plot width x() runs across')
  assert.equal(chart.ts.timeframeMs, 300_000, 'inferred from the data')
  assert.equal(chart.ps.mode, 'linear')
  chart.setPriceMode('log')
  assert.equal(chart.ps.mode, 'log')
  chart.ts.zoomAt(100, 2)
  settle(chart)
  assert.equal(chart.ts.spacing, 24, 'spacing is the eased value, settled')
})

test('index.d.ts declares those members, read-only', () => {
  const dts = readFileSync(new URL('../src/chart/index.d.ts', import.meta.url), 'utf8')
  const classBody = (name) => {
    const at = dts.indexOf(`export declare class ${name} {`)
    assert.ok(at >= 0, `${name} is declared`)
    return dts.slice(at, dts.indexOf('\n}\n', at))
  }
  const ts = classBody('TimeScale')
  for (const m of ['spacing', 'width', 'timeframeMs']) {
    assert.match(ts, new RegExp(`\\n  readonly ${m}: number\\n`), `TimeScale.${m}`)
  }
  assert.match(classBody('PriceScale'), /\n  readonly mode: PriceMode\n/, 'PriceScale.mode')
  assert.match(dts, /\nexport declare function isLight\(color: string\): boolean\n/)
})
