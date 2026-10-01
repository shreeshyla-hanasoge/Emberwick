/**
 * Mutants for the profiles API and data contract (test/profiles-api.test.mjs).
 * Aggregated by test/mutants.js; `file` is repo-relative.
 */
const DATA = 'src/profiles/data.js'
const OPTIONS = 'src/profiles/options.js'
const VP = 'src/profiles/VolumeProfile.js'

export const MUTANTS = [
  // ---------------------------------------------------------- validation --
  {
    name: 'A zero or negative bin step is accepted',
    file: DATA,
    find: '  if (!(s > 0 && s < Infinity)) fail(',
    replace: '  if (Number.isNaN(s)) fail(',
  },
  {
    name: 'A session that starts after it ends is accepted',
    file: DATA,
    find: '  if (!(start <= end)) fail(',
    replace: '  if (Number.isNaN(start)) fail(',
  },
  {
    name: 'A session with no end time is accepted',
    file: DATA,
    find: '  if (!(start <= end)) fail(',
    replace: '  if (start > end) fail(',
  },
  {
    name: 'A lo that is not a price is accepted and every bin edge is NaN',
    file: DATA,
    find: '  if (!Number.isFinite(lo)) fail(',
    replace: '  if (false) fail(',
  },
  {
    name: 'A contract version this build cannot read is drawn as version 1',
    file: DATA,
    find: '  if (data.version != null && data.version !== DATA_VERSION) {',
    replace: '  if (false) {',
  },
  {
    name: 'A missing contract version is refused',
    file: DATA,
    find: '  if (data.version != null && data.version !== DATA_VERSION) {',
    replace: '  if (data.version !== DATA_VERSION) {',
  },
  // -------------------------------------------------------- normalisation --
  {
    name: 'A negative bin counts as volume',
    file: DATA,
    find: '    if (v > 0 && v < Infinity) {',
    replace: '    if (v < Infinity) {',
  },
  {
    name: "The host's own total is ignored",
    file: DATA,
    find: '    total: toNumber(raw.total) > 0 ? toNumber(raw.total) : sum,',
    replace: '    total: sum,',
  },
  {
    name: "The host's POC is ignored and recomputed",
    file: DATA,
    find: '  if (Number.isFinite(poc)) {',
    replace: '  if (false) {',
  },
  {
    name: 'A POC sent as a bin edge lands in the bin below',
    file: DATA,
    find: 'Math.floor((poc - lo) / step + 1e-9)',
    replace: 'Math.floor((poc - lo) / step)',
  },
  {
    name: "The host's value area is ignored and recomputed",
    file: DATA,
    find: '  if (Number.isFinite(vah) && Number.isFinite(val) && vah >= val) {',
    replace: '  if (false) {',
  },
  {
    name: 'An inverted value area is taken as sent',
    file: DATA,
    find: '  if (Number.isFinite(vah) && Number.isFinite(val) && vah >= val) {',
    replace: '  if (Number.isFinite(vah) && Number.isFinite(val)) {',
  },
  {
    name: 'The value area tints the bin above vah',
    file: DATA,
    find: '    s.vaTo = clampInt(Math.round((vah - lo) / step) - 1, s.vaFrom, n - 1)',
    replace: '    s.vaTo = clampInt(Math.round((vah - lo) / step), s.vaFrom, n - 1)',
  },
  {
    name: 'A computed value area ignores the POC the host named',
    file: DATA,
    find: '    const va = valueAreaBins(bins, 0.7, s.pocBin)',
    replace: '    const va = valueAreaBins(bins, 0.7)',
  },
  {
    name: 'Sessions are kept in the order they were sent',
    file: DATA,
    find: '  sessions.sort((a, b) => a.start - b.start)\n',
    replace: '',
  },
  {
    name: 'Two sessions with one start are both kept',
    file: DATA,
    find: '    if (unique.length && unique[unique.length - 1].start === s.start) unique[unique.length - 1] = s\n    else unique.push(s)',
    replace: '    unique.push(s)',
  },
  {
    name: 'upsertSession adds a second session with the same start',
    file: DATA,
    find: '  if (lo < sessions.length && sessions[lo].start === s.start) sessions[lo] = s\n  else sessions.splice(lo, 0, s)',
    replace: '  sessions.splice(lo, 0, s)',
  },
  {
    name: 'upsertSession appends an earlier session at the end',
    file: DATA,
    find: '  else sessions.splice(lo, 0, s)',
    replace: '  else sessions.push(s)',
  },
  // -------------------------------------------------------------- options --
  {
    name: 'An unknown mode is accepted',
    file: OPTIONS,
    find: '    if (!MODES.includes(partial.mode)) fail(',
    replace: '    if (false) fail(',
  },
  {
    name: 'An unknown side is accepted',
    file: OPTIONS,
    find: '    if (!SIDES.includes(partial.side)) fail(',
    replace: '    if (false) fail(',
  },
  {
    name: 'A width given as a string is accepted',
    file: OPTIONS,
    find: "    if (typeof partial.width !== 'number' || !(w > 0 && w < Infinity)) fail(",
    replace: '    if (!(w > 0 && w < Infinity)) fail(',
  },
  {
    name: 'A width above 1 runs a bar out of its session',
    file: OPTIONS,
    find: '    o.width = Math.min(w, 1)',
    replace: '    o.width = w',
  },
  {
    name: "The caller's colours object is held, not copied",
    file: OPTIONS,
    find: '    o.colors = partial.colors ? { ...partial.colors } : null',
    replace: '    o.colors = partial.colors || null',
  },
  {
    name: 'An option passed as undefined blanks the current value',
    file: OPTIONS,
    find: '  for (const k of FLAGS) if (partial[k] !== undefined) o[k] = !!partial[k]',
    replace: '  for (const k of FLAGS) if (k in partial) o[k] = !!partial[k]',
  },
  // ----------------------------------------------------------- controller --
  {
    name: 'The profile paints over the candles',
    file: VP,
    find: "    this.layer = 'below'",
    replace: "    this.layer = 'above'",
  },
  {
    name: 'A core without the 0.13 host is accepted',
    file: VP,
    find: "    if (typeof host.timeToIndex !== 'function' || typeof host.drawPriceTag !== 'function') return\n",
    replace: '',
  },
  {
    name: 'upsertSession runs with no bin step',
    file: VP,
    find: "    if (!(d.step > 0)) fail('upsertSession() needs setData() first: the bin step comes from the data')\n",
    replace: '',
  },
  {
    name: 'A change to the data or the options does not repaint',
    file: VP,
    find: '    if (this._host) this._host.invalidate()\n',
    replace: '',
  },
  {
    name: 'destroy() leaves the plugin on the chart',
    file: VP,
    find: '    this.chart.removePlugin(this)\n    this._destroyed = true',
    replace: '    this._destroyed = true',
  },
  {
    name: 'A destroyed profile keeps its listeners',
    file: VP,
    find: '    for (const set of Object.values(this._listeners)) set.clear()\n',
    replace: '',
  },
]
