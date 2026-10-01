/**
 * Time <-> fractional bar index in the core, and on the plugin host.
 *
 * The arithmetic itself is covered line by line in drawings-time.test.mjs,
 * which predates the move and still imports it through src/drawings. What is
 * asserted here is the move: the core exports the pair, drawings re-export
 * the SAME functions, and a plugin's host resolves against the whole replay
 * dataset at the chart's timeframe.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, makeBars, frame, settle } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const core = await import('../src/chart/index.js')
const drawings = await import('../src/drawings/index.js')
const model = await import('../src/drawings/model/time.js')
const { createChart, timeToIndex, indexToTime } = core

const MIN = 60_000
const DAY = 24 * 60 * MIN
const D0 = Date.UTC(2024, 0, 2, 9, 15)
/** Two 375-minute sessions with a night between them: the gap every exchange has. */
const sessions = () => makeBars(D0, 375, MIN, 100).concat(makeBars(D0 + DAY, 375, MIN, 100))
const same = (a, b, msg) => assert.ok(a === b, msg)

const hosted = (bars) => {
  const chart = createChart(makeContainer())
  chart.setData(bars)
  settle(chart); frame(chart)
  let host = null
  chart.addPlugin({ attach(h) { host = h } })
  return { chart, host }
}

test('the core entry exports timeToIndex and indexToTime, and drawings re-export the same functions', () => {
  assert.equal(typeof timeToIndex, 'function')
  assert.equal(typeof indexToTime, 'function')
  same(drawings.timeToIndex, timeToIndex, 'emberwick/drawings exports the core timeToIndex')
  same(drawings.indexToTime, indexToTime, 'emberwick/drawings exports the core indexToTime')
  same(model.timeToIndex, timeToIndex, 'and so does the drawings model, which its tests import')
  same(model.indexToTime, indexToTime, 'one implementation, not two that can drift')
})

test('the pure pair: exact on a bar, linear across a gap, extrapolated outside, never clamped', () => {
  const bars = sessions()
  assert.equal(timeToIndex(bars, bars[400].time, MIN), 400)
  const close = bars[374].time
  const open = bars[375].time
  assert.equal(timeToIndex(bars, (close + open) / 2, MIN), 374.5, 'half way through the night is half way between the bars')
  assert.equal(timeToIndex(bars, bars[749].time + 3 * MIN, MIN), 752, 'past the newest bar: one timeframe per bar')
  assert.equal(timeToIndex(bars, bars[0].time - 2 * MIN, MIN), -2)
  assert.equal(indexToTime(bars, 374.5, MIN), (close + open) / 2)
  assert.equal(indexToTime(bars, 752, MIN), bars[749].time + 3 * MIN)
  assert.ok(Number.isNaN(timeToIndex([], D0, MIN)))
  assert.equal(indexToTime([], 0, MIN), null)
})

test('host.timeToIndex and host.indexToTime resolve at the chart timeframe, over a gap', () => {
  const bars = sessions()
  const { chart, host } = hosted(bars)
  assert.equal(chart.ts.timeframeMs, MIN)
  assert.equal(host.timeToIndex(bars[10].time), 10)
  const mid = (bars[374].time + bars[375].time) / 2
  assert.equal(host.timeToIndex(mid), 374.5)
  assert.equal(host.indexToTime(374.5), mid)
  assert.equal(host.timeToIndex(bars[749].time + 5 * MIN), 754, 'the host supplies timeframeMs')
  assert.equal(host.indexToTime(754), bars[749].time + 5 * MIN)
  assert.equal(host.ts.x(host.timeToIndex(bars[700].time)), chart.ts.x(700), 'which is where that bar is drawn')

  // Detached from the host object, as a plugin that destructures would call them.
  const { timeToIndex: t2i, indexToTime: i2t } = host
  assert.equal(t2i(bars[10].time), 10)
  assert.equal(i2t(10), bars[10].time)
})

test('outside the data the host steps at the chart\'s own timeframe, not a minute', () => {
  const FIVE = 5 * MIN
  const bars = makeBars(D0, 100, FIVE, 100)
  const { chart, host } = hosted(bars)
  assert.equal(chart.ts.timeframeMs, FIVE)
  assert.equal(host.timeToIndex(bars[99].time + 2 * FIVE), 101, 'ten minutes past the newest 5-minute bar is two bars')
  assert.equal(host.timeToIndex(bars[0].time - 3 * FIVE), -3)
  assert.equal(host.indexToTime(101), bars[99].time + 2 * FIVE)
  assert.equal(host.indexToTime(-3), bars[0].time - 3 * FIVE)
})

test('with no bars the host answers NaN and null rather than throwing', () => {
  const { host } = hosted([])
  assert.ok(Number.isNaN(host.timeToIndex(D0)))
  assert.equal(host.indexToTime(3), null)
})

test('under replay the host resolves against the whole dataset, not the revealed prefix', () => {
  const bars = sessions()
  const { chart, host } = hosted(bars)
  chart.startReplay({ from: 100 })
  frame(chart)
  assert.equal(host.bars.length, 101, 'only the prefix is revealed')
  assert.equal(host.source.length, 750)
  // Bar 500 is tomorrow: past the cursor AND past the night. Extrapolating
  // off the revealed prefix at one bar per minute would put it at 1565.
  assert.equal(host.timeToIndex(bars[500].time), 500)
  assert.equal(timeToIndex(host.bars, bars[500].time, MIN), 1565, 'which is what the prefix alone would say')
  assert.equal(host.indexToTime(500), bars[500].time)
  chart.replay.seek(600)
  frame(chart)
  assert.equal(host.timeToIndex(bars[500].time), 500, 'and seeking never moves it')
  chart.stopReplay()
  frame(chart)
  assert.equal(host.timeToIndex(bars[500].time), 500)
})

test('a history prepend shifts what the host answers, with no call from the plugin', () => {
  const bars = sessions()
  const { chart, host } = hosted(bars.slice(375))
  const t = bars[400].time
  assert.equal(host.timeToIndex(t), 25)
  chart.bars = bars.slice(0, 375).concat(chart.bars)   // what _maybeLoadHistory does
  assert.equal(host.timeToIndex(t), 400, 'every read is live')
})
