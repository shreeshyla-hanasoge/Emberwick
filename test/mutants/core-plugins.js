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
]
