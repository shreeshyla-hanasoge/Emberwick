/**
 * Mutants for the core's isLight (test/chart-islight.test.mjs). Aggregated by
 * test/mutants.js; `file` is repo-relative.
 */
const COLOR = 'src/chart/core/color.js'

export const MUTANTS = [
  {
    name: 'A mid grey background reads as light',
    file: COLOR,
    find: '0.0722 * lin(rgb[2]) > 0.5',
    replace: '0.0722 * lin(rgb[2]) > 0.2',
  },
  {
    name: 'An unknown colour format reads as light',
    file: COLOR,
    find: '  if (!rgb) return false\n  return 0.2126',
    replace: '  if (!rgb) return true\n  return 0.2126',
  },
  {
    name: 'Luminance is taken from the sRGB bytes without linearising them',
    file: COLOR,
    find: '  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)',
    replace: '  return v',
  },
  {
    name: 'A short #rgb colour is not parsed',
    file: COLOR,
    find: '    if (h.length === 3 || h.length === 4) {',
    replace: '    if (h.length === 4) {',
  },
]
