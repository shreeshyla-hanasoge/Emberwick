/**
 * Mutants for computeValueArea (test/profiles-value-area.test.mjs). Each one
 * reverts a decision the algorithm makes on purpose. Aggregated by
 * test/mutants.js; `file` is repo-relative.
 */
const VA = 'src/profiles/valueArea.js'

export const MUTANTS = [
  {
    name: 'A POC tie goes to the first bin, at the bottom of the range',
    file: VA,
    find: '    if (v > max || (v === max && best >= 0 && Math.abs(i - mid) < Math.abs(best - mid))) {',
    replace: '    if (v > max) {',
  },
  {
    name: 'Two tied bins equally near the middle resolve to the upper one',
    file: VA,
    find: 'Math.abs(i - mid) < Math.abs(best - mid))) {',
    replace: 'Math.abs(i - mid) <= Math.abs(best - mid))) {',
  },
  {
    name: 'A POC tie is measured from the bottom, not from the middle',
    file: VA,
    find: '  const mid = (n - 1) / 2',
    replace: '  const mid = n - 1',
  },
  {
    name: 'A bin that is not a volume poisons the total',
    file: VA,
    find: 'const vol = (v) => (v > 0 && v < Infinity ? +v : 0)',
    replace: 'const vol = (v) => +v',
  },
  {
    name: 'The value area compares one bin above with one below',
    file: VA,
    find: '    const up = vol(bins[to + 1]) + vol(bins[to + 2])\n    const down = vol(bins[from - 1]) + vol(bins[from - 2])',
    replace: '    const up = vol(bins[to + 1])\n    const down = vol(bins[from - 1])',
  },
  {
    name: 'The value area grows up by one bin while counting the pair',
    file: VA,
    find: '      to = Math.min(n - 1, to + 2)',
    replace: '      to = Math.min(n - 1, to + 1)',
  },
  {
    name: 'The value area grows down by one bin while counting the pair',
    file: VA,
    find: '      from = Math.max(0, from - 2)',
    replace: '      from = Math.max(0, from - 1)',
  },
  {
    name: 'Two equal pairs resolve to the lower one',
    file: VA,
    find: '    if (to < n - 1 && (from === 0 || up >= down)) {',
    replace: '    if (to < n - 1 && (from === 0 || up > down)) {',
  },
  {
    name: 'The smaller pair is added',
    file: VA,
    find: '    if (to < n - 1 && (from === 0 || up >= down)) {',
    replace: '    if (to < n - 1 && (from === 0 || up <= down)) {',
  },
  {
    name: 'The value area stops growing when it reaches either edge',
    file: VA,
    find: '  while (acc < target && (from > 0 || to < n - 1)) {',
    replace: '  while (acc < target && from > 0 && to < n - 1) {',
  },
  {
    name: 'The value area runs past the top of the bins',
    file: VA,
    find: '      to = Math.min(n - 1, to + 2)',
    replace: '      to = to + 2',
  },
  {
    name: 'The value area runs past the bottom of the bins',
    file: VA,
    find: '      from = Math.max(0, from - 2)',
    replace: '      from = from - 2',
  },
  {
    name: 'The default share is half the volume',
    file: VA,
    find: 'export function valueAreaBins(bins, share = 0.7, poc = pocIndex(bins)) {',
    replace: 'export function valueAreaBins(bins, share = 0.5, poc = pocIndex(bins)) {',
  },
  {
    name: 'computeValueArea ignores the share it is given',
    file: VA,
    find: '  const va = valueAreaBins(bins, share)',
    replace: '  const va = valueAreaBins(bins)',
  },
  {
    name: 'A share above 1 can never be reached, so the area takes every bin by exhaustion only',
    file: VA,
    find: '  const target = (share > 0 ? Math.min(share, 1) : 0) * total * (1 - 1e-12)',
    replace: '  const target = (share > 0 ? share : 0.7) * total * (1 - 1e-12)',
  },
  {
    name: 'An area holding exactly its share is sent round again by a float rounding error',
    file: VA,
    find: ' * total * (1 - 1e-12)',
    replace: ' * total',
  },
  {
    name: 'A profile with no volume has a value area',
    file: VA,
    find: '  if (!(total > 0)) return null\n',
    replace: '',
  },
  {
    name: 'A POC index outside the bins is accepted',
    file: VA,
    find: '  if (!(poc >= 0 && poc < n)) return null',
    replace: '  if (!(poc >= 0)) return null',
  },
  {
    name: 'The POC price is the low edge of its bin',
    file: VA,
    find: 'poc: lo + (va.poc + 0.5) * step,',
    replace: 'poc: lo + va.poc * step,',
  },
  {
    name: 'vah is the low edge of the top bin',
    file: VA,
    find: 'vah: lo + (va.to + 1) * step,',
    replace: 'vah: lo + va.to * step,',
  },
  {
    name: 'val is the high edge of the bottom bin',
    file: VA,
    find: 'val: lo + va.from * step }',
    replace: 'val: lo + (va.from + 1) * step }',
  },
  {
    name: 'A zero or negative step yields prices',
    file: VA,
    find: '  if (!Number.isFinite(lo) || !(step > 0 && step < Infinity)) return null',
    replace: '  if (!Number.isFinite(lo)) return null',
  },
  {
    name: 'A non-numeric lo yields NaN prices',
    file: VA,
    find: '  if (!Number.isFinite(lo) || !(step > 0 && step < Infinity)) return null',
    replace: '  if (!(step > 0 && step < Infinity)) return null',
  },
]
