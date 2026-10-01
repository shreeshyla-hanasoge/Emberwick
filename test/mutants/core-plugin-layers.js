/**
 * Mutants for the `below` plugin layer (test/chart-plugin-layers.test.mjs).
 * Aggregated by test/mutants.js; `file` is repo-relative.
 */
const CHART = 'src/chart/core/Chart.js'

export const MUTANTS = [
  {
    name: 'A below plugin paints over the candles',
    file: CHART,
    find: "    this.layers.add(rec.layer, below ? 'main' : 'overlay')",
    replace: "    this.layers.add(rec.layer, 'overlay')",
  },
  {
    name: 'A below plugin attached last is offered input before the plugins above it',
    file: CHART,
    find: '    if (below) for (at = 0; at < this._plugins.length && this._plugins[at].below;) at++\n',
    replace: '',
  },
  {
    name: 'A second below plugin is stacked under the first',
    file: CHART,
    find: '    if (below) for (at = 0; at < this._plugins.length && this._plugins[at].below;) at++\n',
    replace: '    if (below) at = 0\n',
  },
  {
    name: "A below plugin's invalidate() repaints the layer above the candles",
    file: CHART,
    find: '      invalidate() { chart.loop.invalidate(rec.layer) },',
    replace: "      invalidate() { chart.loop.invalidate('plugins') },",
  },
  {
    name: 'One busy plugin repaints both plugin layers',
    file: CHART,
    find: 'busy = paint[rec.layer] = true }',
    replace: 'busy = paint.plugins = paint.pluginsBelow = true }',
  },
  {
    name: 'A plugins-dirty frame repaints the layer under the candles',
    file: CHART,
    find: "pluginsBelow: full || dirty.has('pluginsBelow') }",
    replace: "pluginsBelow: full || dirty.has('pluginsBelow') || dirty.has('plugins') }",
  },
  {
    name: "A plugin layer paints the other layer's plugins too",
    file: CHART,
    find: '      if (rec.layer !== layer || !rec.plugin.draw) continue',
    replace: '      if (!rec.plugin.draw) continue',
  },
  {
    name: 'A plugin canvas outlives the last plugin on it while the other layer is in use',
    file: CHART,
    find: '    if (this._plugins.some((r) => r.below === rec.below)) this.loop.invalidate(rec.layer)',
    replace: '    if (this._plugins.length) this.loop.invalidate(rec.layer)',
  },
  {
    name: "A frame that paints only the other layer resets a failing draw's count",
    file: CHART,
    find: '      else if (paint[rec.layer] || !rec.plugin.draw) rec.errors = 0',
    replace: '      else if (paint.plugins || paint.pluginsBelow || !rec.plugin.draw) rec.errors = 0',
  },
  {
    name: 'toImage paints the below pass over the crosshair',
    file: CHART,
    find: "      const layer = name === 'main' ? 'plugins' : name === 'base' ? 'pluginsBelow' : ''",
    replace: "      const layer = name === 'main' ? 'plugins' : name === 'overlay' ? 'pluginsBelow' : ''",
  },
  {
    name: 'toImage flattens the live below canvas, chrome and all, into the export',
    file: CHART,
    find: '    const out = this.layers.composite(this.layers.names.filter((n) => !/^plugins/.test(n)), (c, name) => {',
    replace: "    const out = this.layers.composite(this.layers.names.filter((n) => n !== 'plugins'), (c, name) => {",
  },
  {
    name: 'An export with no below plugin still paints a pass under the candles',
    file: CHART,
    find: '      if (!this.layers.ctx[layer]) return\n',
    replace: '      if (!layer) return\n',
  },
  {
    name: 'host.volumeRatio answers the default whatever the chart was given',
    file: CHART,
    find: '      get volumeRatio() { return chart.options.volumeRatio },',
    replace: '      get volumeRatio() { return 0.18 },',
  },
  {
    name: "A below plugin's hit hides the marker painted above it",
    file: CHART,
    find: '    const over = this._pluginHit && !this._pluginHit.rec.below',
    replace: '    const over = this._pluginHit',
  },
  {
    name: "A below plugin's cursor beats the marker hovered over it",
    file: CHART,
    find: '      (hit && !(hit.rec.below && this._hoverMarkerId != null) && hit.cursor) ||',
    replace: '      (hit && hit.cursor) ||',
  },
]
