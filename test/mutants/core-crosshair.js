/** Shared crosshair regressions: pane routing and separator gaps. */
export const MUTANTS = [
  {
    name: 'The crosshair receives only the hovered pane geometry',
    file: 'src/chart/core/Chart.js',
    find: '          panePlots: this._panes.map((pane) => pane.rect),',
    replace: '',
  },
  {
    name: 'The shared time guide bridges pane separator gaps',
    file: 'src/chart/render/crosshair.js',
    find: '    ctx.lineTo(Math.round(x) + 0.5, rect.y + rect.h)',
    replace: '    ctx.lineTo(Math.round(x) + 0.5, s.plotBottom || rect.y + rect.h)',
  },
]
