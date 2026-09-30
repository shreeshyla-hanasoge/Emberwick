/**
 * Mutants for unit D: the nine tools and the paint helpers (spec §9.4).
 *
 * Each `find` is a line the spec prescribes verbatim and must occur exactly
 * once in its file; `file` is repo-relative. The tests that catch them live
 * in test/drawings-tools.test.mjs and test/drawings-paint.test.mjs.
 */
export const MUTANTS = [
  {
    name: 'Fib 0 sits at the start of the move',
    file: 'src/drawings/tools/fibRetracement.js',
    find: 'const levelPrice = (p0, p1, L) => p1 + (p0 - p1) * L',
    replace: 'const levelPrice = (p0, p1, L) => p0 + (p1 - p0) * L',
  },
  {
    name: 'Channel offset taken in raw price (log breaks)',
    file: 'src/drawings/tools/parallelChannel.js',
    find: '  const off = a2.y - baseY(a0, a1, a2.x)',
    replace: '  const off = ctx.pane.ps.y(a2.price - (a0.price + (a1.price - a0.price) * ((a2.u - a0.u) / (a1.u - a0.u || 1)))) - ctx.pane.ps.y(0)',
  },
  {
    name: 'Outcome favours the target on an ambiguous bar',
    file: 'src/drawings/tools/position.js',
    find: "    if (hitStop) return { kind: 'stop', i, sameBar: hitTarget }",
    replace: "    if (hitTarget) return { kind: 'target', i }",
  },
  {
    name: 'Outcome scans unrevealed bars',
    file: 'src/drawings/tools/position.js',
    find: '  const bars = ctx.bars',
    replace: '  const bars = ctx.source',
  },
  {
    name: 'Outcome never sees a replay step',
    file: 'src/drawings/tools/position.js',
    find: '  if (c.d === d && c.rev === ctx.dataRev) return c.outcome',
    replace: '  if (c.d === d) return c.outcome',
  },
  {
    name: 'Position defaults ignore volatility',
    file: 'src/drawings/tools/position.js',
    find: '  const risk = 1.5 * atr14(ctx.bars, entryIdx, price)',
    replace: '  const risk = price * 0.01',
  },
  {
    name: 'A vertical line sits beside its wick at even bar widths',
    file: 'src/drawings/tools/verticalLine.js',
    find: '  const x = Number.isInteger(u) ? Math.round(ctx.host.ts.x(u)) + (ctx.host.ts.barWidth() % 2 ? 0.5 : 0) : Math.round(a.x) + 0.5',
    replace: '  const x = Math.round(a.x) + 0.5',
  },
  {
    name: 'A full-height vertical line stops at its own pane',
    file: 'src/drawings/tools/verticalLine.js',
    find: "  out.clip = d.options.span === 'all' ? 'plot' : 'pane'",
    replace: "  out.clip = 'pane'",
  },
  {
    name: 'A ray extends both ways',
    file: 'src/drawings/tools/trendLine.js',
    find: "  const extStart = ext === 'left' || ext === 'both'",
    replace: "  const extStart = ext !== 'none'",
  },
  {
    name: 'Option normalizers copy raw keys',
    file: 'src/drawings/tools/trendLine.js',
    find: "  const o = { extend: pick(raw && raw.extend, EXTEND, 'none'),",
    replace: "  const o = { ...raw, extend: pick(raw && raw.extend, EXTEND, 'none'),",
  },
  {
    name: "An invalid colour inherits the previous drawing's",
    file: 'src/drawings/render/paint.js',
    find: '  c.strokeStyle = fallback',
    replace: '',
  },
  {
    name: 'A solid line inherits the previous dash',
    file: 'src/drawings/render/paint.js',
    find: '  c.setLineDash(dash || NO_DASH)',
    replace: '  if (dash) c.setLineDash(dash)',
  },
  // ---- F2: replay reads (test/drawings-replay.test.mjs).
  {
    name: 'A measure counts volume the replay has not shown',
    file: 'src/drawings/tools/measure.js',
    find: '  const bars = ctx.bars\n  const u0 = ctx.indexOf(d.points[0])\n  const u1 = ctx.indexOf(d.points[1])\n  let v = NaN',
    replace: '  const bars = ctx.source\n  const u0 = ctx.indexOf(d.points[0])\n  const u1 = ctx.indexOf(d.points[1])\n  let v = NaN',
  },
  // ---- Polish: position label layout, fib label pills, the warning colour.
  {
    name: 'The outcome pill lands on the target or stop pill',
    file: 'src/drawings/tools/position.js',
    find: '    if (settleY(ob, rect, reach, tb, sb, cb)) return true',
    replace: '    return true',
  },
  {
    name: 'The outcome pill is never tried inside the box',
    file: 'src/drawings/tools/position.js',
    find: '  return settleY(ob, rect, reach, tb, sb, cb)\n}',
    replace: '  return false\n}',
  },
  {
    name: 'A wrong-side stop pill sits on the target pill',
    file: 'src/drawings/tools/position.js',
    find: '  settleY(sb, rect, ANYWHERE, tb, null, null)',
    replace: '',
  },
  {
    name: 'The R:R pill is drawn over the edge pills of a tiny box',
    file: 'src/drawings/tools/position.js',
    find: '  if (!settleY(cb, rect, cb.h, tb, sb, null)) cb.w = 0',
    replace: '',
  },
  {
    name: 'A pill only slides below the pill in its way',
    file: 'src/drawings/tools/position.js',
    find: '      const y = j === 0 ? o.y + o.h + PILL_GAP : o.y - PILL_GAP - box.h',
    replace: '      const y = o.y + o.h + PILL_GAP',
  },
  {
    name: 'Fib labels are bare text on the candles',
    file: 'src/drawings/tools/fibRetracement.js',
    find: '    roundRect(c, Math.round(lx[k]), Math.round(yy - ph / 2), lw[k], ph, 4)',
    replace: '    c.beginPath()',
  },
  {
    name: 'The warning colour is the accent amber again',
    file: 'src/drawings/render/theme.js',
    find: "  const warn = light ? '#c026d3' : '#e879f9'",
    replace: "  const warn = '#f59e0b'",
  },
]
