/**
 * Mutants for the visible-range profile, modes 'visible' and 'both'
 * (test/profiles-visible.test.mjs). Aggregated by test/mutants.js; `file` is
 * repo-relative.
 */
const VP = 'src/profiles/VolumeProfile.js'

export const MUTANTS = [
  // ------------------------------------------------------------- the sum --
  {
    name: 'The visible profile sums sessions that are off screen',
    file: VP,
    find: '    return s.on && s.end < this._cut && s.u1 >= this._from && s.u0 <= this._to',
    replace: '    return s.on && s.end < this._cut',
  },
  {
    name: 'The visible profile drops a session that starts before the left edge',
    file: VP,
    find: '    return s.on && s.end < this._cut && s.u1 >= this._from && s.u0 <= this._to',
    replace: '    return s.on && s.end < this._cut && s.u0 >= this._from && s.u0 <= this._to',
  },
  {
    name: 'The visible profile sums a session still in the future under replay',
    file: VP,
    find: '    return s.on && s.end < this._cut && s.u1 >= this._from && s.u0 <= this._to',
    replace: '    return s.on && s.u1 >= this._from && s.u0 <= this._to',
  },
  {
    name: 'The visible profile is re-summed on every frame',
    file: VP,
    find: '    if (a === g.a && b === g.b && count === g.count && g.rev === this._rev) return g\n',
    replace: '',
  },
  {
    name: 'The visible profile is not re-summed when the data changes',
    file: VP,
    find: '    if (a === g.a && b === g.b && count === g.count && g.rev === this._rev) return g',
    replace: '    if (a === g.a && b === g.b && count === g.count) return g',
  },
  {
    name: 'The visible profile is not re-summed when the sessions on screen change',
    file: VP,
    find: '    if (a === g.a && b === g.b && count === g.count && g.rev === this._rev) return g',
    replace: '    if (g.rev === this._rev) return g',
  },
  {
    name: 'Sessions are summed without being aligned on their lo',
    file: VP,
    find: '      const off = Math.round((s.lo - lo) / step)',
    replace: '      const off = 0',
  },
  {
    name: 'A lo a hair under its grid line lands one bin low',
    file: VP,
    find: '      const off = Math.round((s.lo - lo) / step)',
    replace: '      const off = Math.floor((s.lo - lo) / step)',
  },
  {
    name: 'A smaller sum keeps stale bins from a larger one',
    file: VP,
    find: '    else g.bins.fill(0, 0, n)\n',
    replace: '',
  },
  {
    name: 'Sessions a million steps apart are summed into one enormous array',
    file: VP,
    find: '    if (!(n > 0 && n <= MAX_AGG_BINS)) return g',
    replace: '    if (!(n > 0)) return g',
  },
  {
    name: 'The visible profile has no total, so every share is zero',
    file: VP,
    find: '      g.total += s.total\n',
    replace: '',
  },
  // ------------------------------------------------------------- drawing --
  {
    name: 'The visible profile is drawn in session mode',
    file: VP,
    find: "    const g = o.mode !== 'session' ? this._aggregate() : null",
    replace: '    const g = this._aggregate()',
  },
  {
    name: 'side is ignored: the visible profile is always on the right',
    file: VP,
    find: "    const gx = o.side === 'left' ? r.x : right\n    const gdir = o.side === 'left' ? 1 : -1",
    replace: '    const gx = right\n    const gdir = -1',
  },
  {
    name: 'The visible profile on the right grows out of the pane instead of into it',
    file: VP,
    find: "    const gdir = o.side === 'left' ? 1 : -1",
    replace: '    const gdir = 1',
  },
  {
    name: 'The visible profile is as wide as a session, not a share of the pane',
    file: VP,
    find: '      drawBins(ctx, ps, g, d.step, gx, gdir, o.width * r.w, top, bottom, colors, o.valueArea, st)',
    replace: '      drawBins(ctx, ps, g, d.step, gx, gdir, o.width * 100, top, bottom, colors, o.valueArea, st)',
  },
  {
    name: 'The visible profile ignores valueArea:false',
    file: VP,
    find: '      if (o.valueArea) {\n        const yh = Math.round(ps.y(g.vah)) + 0.5',
    replace: '      if (true) {\n        const yh = Math.round(ps.y(g.vah)) + 0.5',
  },
  {
    name: 'The visible profile ignores poc:false',
    file: VP,
    find: '      if (o.poc) {\n        const y = Math.round(ps.y(g.poc))',
    replace: '      if (true) {\n        const y = Math.round(ps.y(g.poc))',
  },
  {
    name: 'The visible profile leaves the dash on',
    file: VP,
    find: '        ctx.lineTo(right, yl)\n        ctx.stroke()\n        ctx.setLineDash(DASH.solid)\n',
    replace: '        ctx.lineTo(right, yl)\n        ctx.stroke()\n',
  },
  {
    name: 'The visible profile is tagged with tags off',
    file: VP,
    find: '    if (o.tags && g && g.max > 0) this._tags(ctx, host, pane, g, colors)',
    replace: '    if (g && g.max > 0) this._tags(ctx, host, pane, g, colors)',
  },
  {
    name: 'The hovered aggregate bin is highlighted as if it were a session bin',
    file: VP,
    find: '      if (s === g) drawBin(ctx, ps, g, d.step, this._hovI, gx, gdir, o.width * r.w, colors.hover)\n      else if (s.vis)',
    replace: '      if (s.vis)',
  },
  // --------------------------------------------------------------- hover --
  {
    name: 'A point anywhere on an aggregate bin\'s row hits it, however short its bar',
    file: VP,
    find: "        if (o.side === 'left' ? x <= r.x + len : x >= r.x + r.w - len) {",
    replace: '        if (true) {',
  },
  {
    name: 'The aggregate is hit-tested on the right whatever side it is drawn on',
    file: VP,
    find: "        if (o.side === 'left' ? x <= r.x + len : x >= r.x + r.w - len) {",
    replace: '        if (x >= r.x + r.w - len) {',
  },
  {
    name: 'An aggregate bin with no volume is reported as hovered',
    file: VP,
    find: '      if (i >= 0 && g.bins[i] > 0) {',
    replace: '      if (i >= 0) {',
  },
  {
    name: 'In visible mode a session bin is reported where the aggregate is not',
    file: VP,
    find: "      if (o.mode === 'visible') return\n",
    replace: '',
  },
  {
    name: 'In both mode a session bin wins over the aggregate drawn on top of it',
    file: VP,
    find: "    if (o.mode !== 'session') {\n      const g = this._aggregate()\n      const i = g.max > 0",
    replace: "    if (o.mode === 'visible') {\n      const g = this._aggregate()\n      const i = g.max > 0",
  },
]
