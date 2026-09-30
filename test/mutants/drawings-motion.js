/**
 * Mutants for unit E: drawing motion and the scene painter (spec §9.4).
 *
 * Each `find` is a verbatim line of the source and matches it exactly once.
 * The tests that catch them are test/drawings-motion.test.mjs and
 * test/drawings-scene.test.mjs.
 */
export const MUTANTS = [
  {
    name: "Residuals settle on Smoothed's relative epsilon",
    file: 'src/drawings/render/motion.js',
    find: '  get settled() { return !(Math.abs(this.target - this.value) > this.eps) }',
    replace: '',
  },
  {
    name: 'A NaN residual spins the loop forever',
    file: 'src/drawings/render/motion.js',
    find: '  get settled() { return !(Math.abs(this.target - this.value) > this.eps) }',
    replace: '  get settled() { return Math.abs(this.target - this.value) <= this.eps }',
  },
  {
    name: 'A non-finite jump seeds a residual',
    file: 'src/drawings/render/motion.js',
    find: '    if (!Number.isFinite(du) || !Number.isFinite(dv)) return',
    replace: '',
  },
  {
    name: 'A log switch mid-glide flings the drawing off-screen',
    file: 'src/drawings/render/motion.js',
    find: '      if (r.mode !== pane.ps.mode) r.rv.jump(0)',
    replace: '',
  },
  {
    name: 'Motion started from an input hook waits for an unrelated frame',
    file: 'src/drawings/render/motion.js',
    find: '    if (!this._active.size && this.onWake) this.onWake()',
    replace: '',
  },
  {
    name: 'Residuals decay in screen space',
    file: 'src/drawings/render/scene.js',
    find: '      a.x = ctx.host.ts.x(slot.u[k] + ru)',
    replace: '      a.x = ctx.host.ts.x(slot.u[k]) + ru',
  },
  {
    name: 'Wide drawings pop out of existence mid-pan (bleed ignored)',
    file: 'src/drawings/render/scene.js',
    find: '    if (x1 + bleed < 0 || x0 - bleed > plotW) { slot.drawn = false; continue }',
    replace: '    if (x1 < 0 || x0 > plotW) { slot.drawn = false; continue }',
  },
  {
    name: 'Drawings in the whitespace right of the newest bar are culled',
    file: 'src/drawings/render/scene.js',
    find: '    const x1 = ts.x(hiU + ruMax)',
    replace: '    const x1 = ts.x(Math.min(hiU + ruMax, ts.visibleRange().to))',
  },
  {
    name: 'One broken drawing blanks every drawing',
    file: 'src/drawings/render/scene.js',
    find: "    } catch (err) { slot.broken = slot.d; reportOnce(ctx.host, slot, err, 'draw') } finally { c.restore() }",
    replace: '    } finally { c.restore() }',
  },
  {
    name: "An axis tag prints in the neighbouring pane's gutter",
    file: 'src/drawings/render/scene.js',
    find: '      if (t.pos < pane.rect.y || t.pos > pane.rect.y + pane.rect.h) continue',
    replace: '',
  },
  {
    name: "motion:'none' still ticks",
    file: 'src/drawings/render/motion.js',
    find: "    if (this.mode === 'none') return this.finishAll()",
    replace: '',
  },
  {
    name: 'Ghosts are never dropped',
    file: 'src/drawings/render/motion.js',
    find: '      if (g.tween.done) this.ghosts.delete(g)',
    replace: '',
  },
  // Found by the F2 fuzz (test/drawings-anchors.test.mjs, "far-off anchors").
  {
    name: 'The price band hands the canvas a rectangle as tall as the price is far',
    file: 'src/drawings/render/scene.js',
    find: '      if (y0 < pane.rect.y) y0 = pane.rect.y\n      if (y1 > pane.rect.y + pane.rect.h) y1 = pane.rect.y + pane.rect.h\n',
    replace: '',
  },
  {
    name: 'The time band hands the canvas a rectangle as wide as the anchor is far',
    file: 'src/drawings/render/scene.js',
    find: '      if (x0 < 0) x0 = 0\n      if (x1 > plotW) x1 = plotW\n',
    replace: '',
  },
  {
    name: 'An alignment guide runs to an anchor millions of pixels away',
    file: 'src/drawings/render/scene.js',
    find: '  c.moveTo(clamp(g.x0, -2, plotW + 2), clamp(g.y0, -2, bottom + 2))\n  c.lineTo(clamp(g.x1, -2, plotW + 2), clamp(g.y1, -2, bottom + 2))',
    replace: '  c.moveTo(g.x0, g.y0)\n  c.lineTo(g.x1, g.y1)',
  },
]
