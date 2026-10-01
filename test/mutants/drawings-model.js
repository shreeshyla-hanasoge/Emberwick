/**
 * Mutants for the drawings data model (unit B): time mapping, schema, history.
 *
 * Each entry reverts one decision the model makes on purpose. The `find`
 * lines are prescribed verbatim by the drawings spec (§3.3, §9.4); if one
 * reports ANCHOR NOT FOUND, re-anchor it on the moved line rather than
 * deleting it.
 */
const TIME = 'src/drawings/model/time.js'
/** timeToIndex and indexToTime moved here in 0.13; the three mutants that revert them moved with it. */
const CORE_TIME = 'src/chart/core/time.js'
const SCHEMA = 'src/drawings/model/schema.js'
const HISTORY = 'src/drawings/model/history.js'

export const MUTANTS = [
  {
    name: 'A future time clamps onto the newest bar',
    file: CORE_TIME,
    find: '  if (t >= last) return n - 1 + (t - last) / step',
    replace: '  if (t >= last) return n - 1',
  },
  {
    name: 'A past time clamps onto the oldest bar',
    file: CORE_TIME,
    find: '  if (t <= first) return (t - first) / step',
    replace: '  if (t <= first) return 0',
  },
  {
    name: 'A time between bars snaps to the nearest',
    file: CORE_TIME,
    find: '  return span > 0 ? k - 1 + (t - a) / span : k - 1',
    replace: '  return t - a < +bars[k].time - t ? k - 1 : k',
  },
  {
    name: 'A future bar count ignores its timeframe',
    file: TIME,
    find: '  const scale = pt.tf > 0 && tf > 0 ? pt.tf / tf : 1',
    replace: '  const scale = 1',
  },
  {
    name: 'A point past the newest bar is stored as clock time',
    file: TIME,
    find: '  if (u > last) return { time: +bars[last].time, price, offset: u - last, tf }',
    replace: '',
  },
  {
    name: 'A point before the oldest bar is stored as clock time',
    file: TIME,
    find: '  if (u < 0) return { time: +bars[0].time, price, offset: u, tf }',
    replace: '',
  },
  {
    name: 'An empty bar array reads bars[-1]',
    file: TIME,
    find: '  if (last < 0 || !Number.isFinite(u)) return null',
    replace: '',
  },
  {
    name: 'A null time becomes the epoch',
    file: SCHEMA,
    find: '    const time = toNumber(p.time)',
    replace: '    const time = +p.time',
  },
  {
    name: 'An unknown type is dropped, not carried',
    file: SCHEMA,
    find: '  if (!tool) return carry(raw, index, report)',
    replace: '  if (!tool) return null',
  },
  {
    name: 'A newer drawing version is loaded as if current',
    file: SCHEMA,
    find: '  if (!(v >= 1 && v <= SCHEMA_VERSION && v === Math.floor(v))) return carry(raw, index, report)',
    replace: '',
  },
  {
    name: 'Duplicate ids survive a load',
    file: SCHEMA,
    find: '    if (reserved.get(id) !== index) id = dedupe(id, reserved, index, report)',
    replace: '',
  },
  {
    name: 'A renamed duplicate steals a later explicit id',
    file: SCHEMA,
    find: '  for (let i = 0; i < raws.length; i++) reserveExplicit(raws[i], i, reserved)',
    replace: '',
  },
  {
    name: 'Unknown keys are dropped on write-back',
    file: SCHEMA,
    find: '  emitExtra(out, d.extra && d.extra.top)',
    replace: '',
  },
  {
    name: "The position stop drifts off the target's time",
    file: SCHEMA,
    find: '  if (tool.normalizePoints) points = tool.normalizePoints(points)',
    replace: '',
  },
  {
    name: 'NaN reaches the store through an API patch',
    file: SCHEMA,
    find: "  if (!finitePoint(pt)) throw new Error('bad point')",
    replace: '',
  },
  {
    name: 'Redo survives a new commit',
    file: HISTORY,
    find: '    this._redo.length = 0',
    replace: '',
  },
  {
    name: 'Undo resets drawings the entry did not touch',
    file: HISTORY,
    find: '    for (const [id, d] of entry.before) store.put(id, d)',
    replace:
      '    for (const [id, d] of entry.before) store.put(id, d)\n    for (const e of store.list) if (!entry.before.has(e.id)) store.put(e.id, null)',
  },
]
