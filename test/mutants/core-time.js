/**
 * Mutants for the plugin host's time mapping (test/chart-time.test.mjs). The
 * arithmetic of timeToIndex itself is mutated in drawings-model.js, where its
 * line-by-line tests live. Aggregated by test/mutants.js; `file` is
 * repo-relative.
 */
const CHART = 'src/chart/core/Chart.js'

export const MUTANTS = [
  {
    name: 'host.timeToIndex resolves against the revealed prefix under replay',
    file: CHART,
    find: '      timeToIndex(time) { return timeToIndex(source(), time, chart.ts.timeframeMs) },',
    replace: '      timeToIndex(time) { return timeToIndex(chart.bars, time, chart.ts.timeframeMs) },',
  },
  {
    name: 'host.indexToTime resolves against the revealed prefix under replay',
    file: CHART,
    find: '      indexToTime(u) { return indexToTime(source(), u, chart.ts.timeframeMs) },',
    replace: '      indexToTime(u) { return indexToTime(chart.bars, u, chart.ts.timeframeMs) },',
  },
  {
    name: 'host.timeToIndex extrapolates at a minute per bar whatever the timeframe',
    file: CHART,
    find: '      timeToIndex(time) { return timeToIndex(source(), time, chart.ts.timeframeMs) },',
    replace: '      timeToIndex(time) { return timeToIndex(source(), time) },',
  },
  {
    name: 'host.indexToTime extrapolates at a minute per bar whatever the timeframe',
    file: CHART,
    find: '      indexToTime(u) { return indexToTime(source(), u, chart.ts.timeframeMs) },',
    replace: '      indexToTime(u) { return indexToTime(source(), u) },',
  },
  {
    name: 'Drawings carry their own copy of timeToIndex again',
    file: 'src/drawings/model/time.js',
    find: "import { timeToIndex, indexToTime } from '../../chart/index.js'\n\nexport { timeToIndex, indexToTime }",
    replace: "import { timeToIndex as t2i, indexToTime as i2t } from '../../chart/index.js'\n\nexport const timeToIndex = (b, t, tf) => t2i(b, t, tf)\nexport const indexToTime = (b, u, tf) => i2t(b, u, tf)",
  },
]
