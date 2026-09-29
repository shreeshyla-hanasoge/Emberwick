/**
 * Mutants for the core plugin seam (unit A) and the two-finger pan that
 * shipped ahead of it (A0). Aggregated by test/mutants.js; `file` is
 * repo-relative.
 */
export const MUTANTS = [
  // ---------------------------------------------------------------- A0 ----
  {
    name: 'Two fingers zoom but no longer pan',
    file: 'src/chart/core/Chart.js',
    find: '          this.ts.panBy(mid - pinchMid)\n',
    replace: '',
  },
  {
    name: 'A third finger freezes the pinch',
    file: 'src/chart/core/Chart.js',
    find: '      if (pointers.size >= 2) {\n        // The first two',
    replace: '      if (pointers.size === 2) {\n        // The first two',
  },
  {
    name: 'A third finger starts its own gesture',
    file: 'src/chart/core/Chart.js',
    find: '      if (pointers.size > 2) return\n',
    replace: '',
  },
  {
    name: 'A finger left by a pinch drags a crosshair',
    file: 'src/chart/core/Chart.js',
    find: "          touchMode = 'pan'\n          moved = true",
    replace: '          moved = true',
  },
  {
    name: 'A pinch zoom eases, so the next move drops its right edge and the pinch slides off the fingers',
    file: 'src/chart/core/Chart.js',
    find: '          this.ts._spacing.jump(this.ts._spacing.target)\n          this.ts._right.jump(this.ts._right.target)\n',
    replace: '',
  },

  // ------------------------------------------------------------ Loop wake --
  {
    name: 'The first frame after idle takes 63% of an ease',
    file: 'src/chart/core/Loop.js',
    find: '    const dt = this._woke ? 16.667 : Math.min(Math.max(now - this._last, 1), 64)',
    replace: '    const dt = Math.min(Math.max(now - this._last, 1), 64)',
  },
  {
    name: 'A restarted loop treats its first frame as a wake from idle',
    file: 'src/chart/core/Loop.js',
    find: '    this._last = performance.now()\n    this._woke = false\n',
    replace: '    this._last = performance.now()\n',
  },
  // --------------------------------------------------------- settle frame --
  {
    name: 'The settle frame is not redrawn, so drawings drift from their candles',
    file: 'src/chart/motion/Tween.js',
    find: '      return moved',
    replace: '      return false',
  },
  {
    name: 'A NaN target never stops reporting motion',
    file: 'src/chart/motion/Tween.js',
    find: '      const moved = !Object.is(this.value, this.target)',
    replace: '      const moved = this.value !== this.target',
  },
  // ----------------------------------------------------------- setAnimate --
  {
    name: 'setAnimate(false) never reaches plugins',
    file: 'src/chart/core/Chart.js',
    find: '    this.options.animate = !!on',
    replace: '',
  },
  // --------------------------------------------------------------- Layers --
  {
    name: 'A late layer stays 0x0',
    file: 'src/chart/core/Layers.js',
    find: '    this._size(name)\n    return this.ctx[name]',
    replace: '    return this.ctx[name]',
  },
  {
    name: 'The plugins layer stacks above the crosshair',
    file: 'src/chart/core/Layers.js',
    find: '    this._create(name, i < 0 ? this.names.length : i)',
    replace: '    this._create(name, this.names.length)',
  },
  {
    name: 'Removing a layer leaves a gap in the stacking order',
    file: 'src/chart/core/Layers.js',
    find: "    this.names.splice(this.names.indexOf(name), 1)\n    this.names.forEach((n, i) => { this.canvas[n].style.zIndex = String(i + 1) })",
    replace: '    this.names.splice(this.names.indexOf(name), 1)',
  },
  {
    name: 'An export pass lands on top of the crosshair instead of between the layers',
    file: 'src/chart/core/Layers.js',
    find: '      if (between) between(c, n)',
    replace: '    }\n    for (const n of names) {\n      if (between) between(c, n)',
  },
]
