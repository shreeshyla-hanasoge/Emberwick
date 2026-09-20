/**
 * Mutation manifest.
 *
 * Each entry reverts one shipped fix. `npm run mutate` applies them one at a
 * time to a scratch copy of the tree and runs the suite against each: a mutant
 * that SURVIVES is a fix with no test defending it.
 *
 * This exists because 0.5.0 shipped three silent regressions with 27 green
 * tests — 21 of 47 mutants survived that suite. Green is not evidence on its
 * own; this is what turns it into a measurement.
 *
 * `find` must match the current source exactly. When a mutant reports
 * ANCHOR NOT FOUND the code moved underneath it — re-anchor it rather than
 * deleting it, or you quietly lose the coverage it was measuring.
 */
export const MUTANTS = [
  {
    name: 'PriceScale rejects numeric-string OHLC',
    file: 'src/chart/core/PriceScale.js',
    // Re-anchored in 0.6.2: the coercion moved into formatters.toNumber, so
    // this now mutates the delegation rather than the old inline check. Same
    // defect — the scale refuses strings and the chart renders blank.
    find: '    const n = toNumber(v)',
    replace: "    const n = typeof v === 'number' ? v : NaN",
  },
  {
    name: 'Prices stop rejecting null (null numifies to 0)',
    file: 'src/chart/core/formatters.js',
    find: "  if (t !== 'string') return NaN",
    replace: "  if (t !== 'string') return +v",
  },
  {
    name: 'PriceScale ignores marginBottom',
    file: 'src/chart/core/PriceScale.js',
    find: '    let padBottom = span * this.marginBottom',
    replace: '    let padBottom = span * this.marginTop',
  },
  {
    name: 'Loop.start() no longer clears the error budget',
    file: 'src/chart/core/Loop.js',
    find: '    this._frameErrors = 0\n    this._last = performance.now()',
    replace: '    this._last = performance.now()',
  },
  {
    name: 'Loop stops reporting that it gave up',
    file: 'src/chart/core/Loop.js',
    find: '        if (this.onGiveUp) this.onGiveUp(e)',
    replace: '        if (false) this.onGiveUp(e)',
  },
  {
    name: 'Loop discards the dirty set on a throwing frame',
    file: 'src/chart/core/Loop.js',
    find: '      for (const l of dirty) this._dirty.add(l)',
    replace: '      if (false) for (const l of dirty) this._dirty.add(l)',
  },
  {
    name: 'State-event listeners run unguarded inside the frame',
    file: 'src/chart/core/Chart.js',
    find: '      try {\n        fn(payload)\n      } catch (e) {\n        console.error(`[Emberwick] \'${event}\' listener threw`, e)\n      }',
    replace: '      fn(payload)',
  },
  {
    name: 'State-event dedupe key is shared across listeners again',
    file: 'src/chart/core/Chart.js',
    find: '      if (keys.get(fn) === key) continue',
    replace: '      if (this.__sharedKey === key) continue; this.__sharedKey = key',
  },
  {
    name: '_swapBars ignores the timeframe it is handed',
    file: 'src/chart/core/Chart.js',
    find: '    if (isFinite(timeframeMs) && timeframeMs > 0) {\n      this.ts.timeframeMs = timeframeMs',
    replace: '    if (false) {\n      this.ts.timeframeMs = timeframeMs',
  },
  {
    name: 'inferTimeframe always takes the median',
    file: 'src/chart/core/Chart.js',
    find: '  return gaps.length < TF_MIN_MEDIAN ? gaps[0] : gaps[gaps.length >> 1]',
    replace: '  return gaps[gaps.length >> 1]',
  },
  {
    name: 'inferTimeframe reads only the first pair',
    file: 'src/chart/core/Chart.js',
    find: '  const start = Math.max(1, Math.floor(n / 2) - Math.floor(TF_SAMPLES / 2))',
    replace: '  const start = 1',
  },
  {
    name: 'History paging ignores bar-array ownership',
    file: 'src/chart/core/Chart.js',
    find: '      if (gen !== this._feedGen || barGen !== this._barGen || this._destroyed) return\n      if (this._replay || !this.bars.length) return',
    replace: '      if (gen !== this._feedGen || this._destroyed) return\n      if (!this.bars.length) return',
  },
  {
    name: 'History paging ignores feed generation',
    file: 'src/chart/core/Chart.js',
    find: '      if (gen !== this._feedGen || barGen !== this._barGen || this._destroyed) return',
    replace: '      if (false) return',
  },
  {
    name: 'setFeed keeps the previous symbol on screen',
    file: 'src/chart/core/Chart.js',
    find: '    if (this.bars.length) this.setData([])',
    replace: '    if (false) this.setData([])',
  },
  {
    name: 'setFeed has no generation guard after its await',
    file: 'src/chart/core/Chart.js',
    find: '    if (gen !== this._feedGen || this._destroyed) return\n    this.setData(bars)',
    replace: '    this.setData(bars)',
  },
  {
    name: 'detachFeed keeps the exhausted latch',
    file: 'src/chart/core/Chart.js',
    find: '    this._exhausted = false // the next feed gets a clean slate',
    replace: '',
  },
  {
    name: 'A single history error disables paging permanently',
    file: 'src/chart/core/Chart.js',
    find: '      if (++this._historyErrors >= MAX_HISTORY_ERRORS) this._exhausted = true',
    replace: '      this._exhausted = true',
  },
  {
    name: 'History prepend shifts the right edge twice',
    file: 'src/chart/core/Chart.js',
    find: '      this.ts._right.jump(this.ts._right.value + added.length)',
    replace:
      '      this.ts._right.jump(this.ts._right.value + added.length)\n' +
      '      this.ts._right.set(this.ts._right.target + added.length)',
  },
  {
    name: 'append() overwrites the newest bar with an older one',
    file: 'src/chart/core/Chart.js',
    find: '    if (n && bar.time < this.bars[n - 1].time) return',
    replace: '',
  },
  {
    name: 'setData no longer invalidates the marker cache',
    file: 'src/chart/core/Chart.js',
    find: "    this._resolveKey = '' // new bars, so every marker index must re-resolve",
    replace: '',
  },
  {
    name: 'setMarkers keeps a stale hover id',
    file: 'src/chart/core/Chart.js',
    // Anchored on the comment: a bare `_hoverMarkerId = null` also appears in
    // the constructor, and replace() takes the FIRST match — which mutated
    // the wrong site and reported a false survivor.
    find: "    // a hover on something no marker owns.\n    this._hoverMarkerId = null",
    replace: '    // a hover on something no marker owns.',
  },
  {
    name: 'Marker ids go back to a monotonic counter',
    file: 'src/chart/overlays/annotations.js',
    find: '  const base = `mk${marker.time}:${marker.shape}`\n  const n = seen.get(base) || 0\n  seen.set(base, n + 1)\n  return n ? `${base}:${n}` : base',
    replace: '  seen.__n = (seen.__n || 0) + 1\n  return `mk${seen.__n}`',
  },
  {
    name: 'Out-of-range markers clamp to an end bar again',
    file: 'src/chart/overlays/annotations.js',
    find: '    markers[i].index = !n || t < first || t > last ? -1 : nearestIndex(bars, t)',
    replace: '    markers[i].index = nearestIndex(bars, t)',
  },
  {
    name: 'Replay.seek accepts NaN',
    file: 'src/chart/replay/Replay.js',
    find: '    if (!Number.isFinite(n)) return this',
    replace: '',
  },
  {
    name: 'A detached Replay controller can still swap bars',
    file: 'src/chart/replay/Replay.js',
    find: '    if (this._detached) return\n    const chart = this.chart',
    replace: '    const chart = this.chart',
  },
  {
    name: 'Replay markerFilter falls back to the prefix timeframe',
    file: 'src/chart/replay/Replay.js',
    find: '      const cut = t + (this.timeframeMs || this.chart.ts.timeframeMs || 0) / 2',
    replace: '      const cut = t + (this.chart.ts.timeframeMs || 0) / 2',
  },
  {
    name: 'priceTicks loses its non-finite guard',
    file: 'src/chart/core/formatters.js',
    find: '  if (!isFinite(lo) || !isFinite(hi) || hi < lo) return { ticks: [], step }',
    replace: '  if (hi < lo) return { ticks: [], step }',
  },
  {
    name: 'The web component extends HTMLElement unconditionally',
    file: 'src/adapters/webcomponent/EmberwickChartElement.js',
    find: "const ElementBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {}",
    replace: 'const ElementBase = HTMLElement',
  },
  {
    name: 'Zoom lock applies to every following chart again',
    file: 'src/chart/core/TimeScale.js',
    find: '    const anchorX = this.follow && this.live ? this.width : x',
    replace: '    const anchorX = this.follow ? this.width : x',
  },
  {
    name: 'A live feed no longer sets the zoom lock',
    file: 'src/chart/core/Chart.js',
    find: '    this.ts.live = true // new candles are coming: hold the right edge on zoom',
    replace: '',
  },
  {
    name: 'detachFeed leaves the chart marked live',
    file: 'src/chart/core/Chart.js',
    find: '    this.ts.live = false\n    if (this._unsub) this._unsub()',
    replace: '    if (this._unsub) this._unsub()',
  },
  {
    name: 'Candle bodies ignore upFill/downFill',
    file: 'src/chart/render/candles.js',
    find: '    const color = up ? theme.upFill || theme.up : theme.downFill || theme.down',
    replace: '    const color = up ? theme.up : theme.down',
  },
  {
    name: 'Candle bodies lose the up/down fallback',
    file: 'src/chart/render/candles.js',
    find: '    const color = up ? theme.upFill || theme.up : theme.downFill || theme.down',
    replace: '    const color = up ? theme.upFill : theme.downFill',
  },
  {
    name: 'The devicePixelRatio watcher is never installed',
    file: 'src/chart/core/Layers.js',
    find: '    this._watchDpr()',
    replace: '',
  },
  {
    name: 'The dpr watcher does not re-arm after firing',
    file: 'src/chart/core/Layers.js',
    find: '      this._onDpr = () => {\n        this.measure()\n        arm()\n      }',
    replace: '      this._onDpr = () => {\n        this.measure()\n      }',
  },
  {
    name: 'destroy leaves the dpr watcher attached',
    file: 'src/chart/core/Layers.js',
    find: '    this._unwatchDpr()\n    this._ro.disconnect()',
    replace: '    this._ro.disconnect()',
  },
  {
    name: 'Framework data is applied on identity again',
    file: 'src/adapters/react/dataPlan.js',
    find: '  if (!prev) return { action: \'replace\', next }',
    replace: '  return { action: \'replace\', next }',
  },
  {
    name: 'Appended bars re-anchor instead of appending',
    file: 'src/adapters/react/dataPlan.js',
    find: '  return extends_ ? { action: \'append\', from: prev.len, next } : { action: \'replace\', next }',
    replace: '  return { action: \'replace\', next }',
  },
  {
    name: 'toNumber rejects numeric strings again',
    file: 'src/chart/core/formatters.js',
    find: "  const n = v.trim() === '' ? NaN : +v",
    replace: '  const n = NaN',
  },
  {
    name: 'toNumber accepts anything numish',
    file: 'src/chart/core/formatters.js',
    find: "  const t = typeof v\n  if (t === 'number') return isFinite(v) ? v : NaN\n  if (t !== 'string') return NaN",
    replace: '  const t = typeof v\n  if (false) return NaN\n  if (false) return NaN',
  },
  {
    name: 'The last-price tag uses the raw close again',
    file: 'src/chart/render/candles.js',
    find: '      const label = lastClose.toFixed(decimalsFor(step))',
    replace: '      const label = lastBar.close.toFixed(decimalsFor(step))',
  },
  {
    name: 'The last-price direction compares raw values',
    file: 'src/chart/render/candles.js',
    find: '      const up = Number.isNaN(open) ? true : lastClose >= open',
    replace: '      const up = lastBar.close >= lastBar.open',
  },
  {
    name: 'The price-line axis label uses the raw price again',
    file: 'src/chart/render/annotations.js',
    find: '      const label = price.toFixed(dec)',
    replace: '      const label = L.price.toFixed(dec)',
  },
  {
    name: 'The price axis is drawn before the scale is primed',
    file: 'src/chart/render/grid.js',
    find: '  if (ps.primed) {',
    replace: '  if (true) {',
  },
  {
    name: 'lineVisible: false is ignored',
    file: 'src/chart/render/annotations.js',
    find: '    if (L.lineVisible !== false) {',
    replace: '    if (true) {',
  },
  {
    name: 'The Chart no longer opts out of Vue reactivity',
    file: 'src/chart/core/Chart.js',
    find: '    this.__v_skip = true',
    replace: '',
  },
  {
    name: 'Series gaps are coerced to zero instead of breaking the line',
    file: 'src/chart/overlays/series.js',
    find: '    out.push({ time, value: toNumber(p.value), index: -1 })',
    replace: '    out.push({ time, value: toNumber(p.value) || 0, index: -1 })',
  },
  {
    name: 'A null point time becomes a point at the epoch',
    file: 'src/chart/overlays/series.js',
    find: '    const time = toNumber(p.time)\n    if (Number.isNaN(time)) continue',
    replace: '    const time = +p.time\n    if (!isFinite(time)) continue',
  },
  {
    name: 'A null marker time becomes a marker at the epoch',
    file: 'src/chart/overlays/annotations.js',
    find: '  const time = toNumber(raw.time)\n  if (Number.isNaN(time)) return null',
    replace: '  const time = +raw.time\n  if (!isFinite(time)) return null',
  },
  {
    name: 'The pen is not lifted at a series gap',
    file: 'src/chart/render/series.js',
    find: '      if (Number.isNaN(p.value)) {\n        penDown = false\n        continue\n      }',
    replace: '      if (Number.isNaN(p.value)) {\n        continue\n      }',
  },
  {
    name: 'Series are drawn unclipped, over the axes',
    file: 'src/chart/render/series.js',
    find: '  ctx.rect(0, plot.y, plot.w, plot.h)\n  ctx.clip()',
    replace: '',
  },
  {
    name: 'Series points outside the loaded range clamp to an end bar',
    file: 'src/chart/overlays/series.js',
    find: "    p.index = !n || p.time < first || p.time > last ? -1 : nearestIndex(bars, p.time)",
    replace: '    p.index = nearestIndex(bars, p.time)',
  },
  {
    name: 'Series values no longer influence autoscale',
    file: 'src/chart/core/Chart.js',
    find: '        if (isFinite(ext.min)) this.ps.consider(ext.min, ext.max)',
    replace: '',
  },
  {
    name: 'Hidden series still influence autoscale',
    file: 'src/chart/core/Chart.js',
    find: '      if (entry.opts.visible) visibleSeries.push(entry)',
    replace: '      visibleSeries.push(entry)',
  },
  {
    name: 'Series indices are never re-resolved',
    file: 'src/chart/core/Chart.js',
    find: '      if (key !== entry.resolveKey) {',
    replace: '      if (entry.resolveKey === undefined) {',
  },
  {
    name: 'Series data changes do not invalidate resolution',
    file: 'src/chart/core/Chart.js',
    find: "    entry.resolveKey = '' // force re-resolution on the next frame",
    replace: '',
  },
  {
    name: 'stepped is ignored',
    file: 'src/chart/render/series.js',
    find: '      } else if (opts.stepped) {',
    replace: '      } else if (false) {',
  },
  {
    name: 'seriesExtent ignores the visible window',
    file: 'src/chart/overlays/series.js',
    find: '    if (p.index > to) break',
    replace: '',
  },
]
