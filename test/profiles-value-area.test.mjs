/**
 * computeValueArea: point of control and value area of one profile.
 *
 * Pure arithmetic, so every fixture below is worked by hand in its comment.
 * Bin i covers [lo + i*step, lo + (i+1)*step).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeValueArea, valueAreaBins, pocIndex } from '../src/profiles/valueArea.js'

test('a hand-computed profile: POC, then the larger pair until 70% is inside', () => {
  // index:      0  1  2   3   4   5  6  7  8  9
  const bins = [2, 5, 8, 12, 20, 15, 9, 6, 3, 1]
  // total 81, so the area must hold 56.7.
  // POC is bin 4 (20).                       area 4..4 = 20
  // above 15+9 = 24, below 12+8 = 20: above.  area 4..6 = 44
  // above 6+3 = 9,  below 12+8 = 20: below.   area 2..6 = 64 >= 56.7, stop.
  assert.deepEqual(valueAreaBins(bins), { poc: 4, from: 2, to: 6, total: 81 })
  assert.deepEqual(computeValueArea(bins, 100, 1), { poc: 104.5, vah: 107, val: 102 })
})

test('the edges are bin edges: vah the high edge of the top bin, val the low edge of the bottom', () => {
  const bins = [2, 5, 8, 12, 20, 15, 9, 6, 3, 1]
  const va = computeValueArea(bins, 24000, 2.5)
  assert.deepEqual(va, { poc: 24000 + 4.5 * 2.5, vah: 24000 + 7 * 2.5, val: 24000 + 2 * 2.5 })
  assert.equal((va.vah - va.val) / 2.5, 5, 'five whole bins: 2, 3, 4, 5 and 6')
  assert.ok(va.val < va.poc && va.poc < va.vah)
})

test('a POC tie goes to the bin nearest the middle, then to the lower one', () => {
  assert.equal(pocIndex([3, 7, 1, 7, 2]), 1, 'bins 1 and 3 are equally near the middle (2): the lower')
  assert.equal(pocIndex([7, 1, 1, 7, 1, 1]), 3, 'bin 3 is nearer the middle (2.5) than bin 0')
  assert.equal(pocIndex([1, 1, 7, 1, 1, 7]), 2, 'and the same from the other end')
  assert.equal(pocIndex([4, 4, 4, 4, 4]), 2, 'a flat profile: the middle bin')
  assert.equal(pocIndex([4, 4, 4, 4]), 1, 'a flat profile with no middle bin: the lower of the two')
  assert.equal(pocIndex([9, 1, 1, 1, 9]), 0, 'both ends, equally far: the lower')
  assert.equal(pocIndex([1, 9, 2]), 1, 'no tie: just the max')
  assert.equal(computeValueArea([3, 7, 1, 7, 2], 10, 1).poc, 11.5, 'and the POC price is that bin\'s centre')
})

test('two equal pairs: the upper one is taken, every time', () => {
  // total 19, target 13.3. POC bin 2 (9). above 4+1 = 5, below 4+1 = 5: a tie.
  // The upper pair: area 2..4 = 14 >= 13.3.
  assert.deepEqual(valueAreaBins([1, 4, 9, 4, 1]), { poc: 2, from: 2, to: 4, total: 19 })
  assert.deepEqual(computeValueArea([1, 4, 9, 4, 1], 100, 0.5), { poc: 101.25, vah: 102.5, val: 101 })
})

test('at the top or bottom of the range the area grows the other way', () => {
  // POC is the TOP bin: total 16, target 11.2. Nothing above; below 3+2 = 5.
  // area 1..3 = 15.
  assert.deepEqual(valueAreaBins([1, 2, 3, 10]), { poc: 3, from: 1, to: 3, total: 16 })
  assert.deepEqual(computeValueArea([1, 2, 3, 10], 50, 2), { poc: 57, vah: 58, val: 52 })
  // POC is the BOTTOM bin.
  assert.deepEqual(valueAreaBins([10, 3, 2, 1]), { poc: 0, from: 0, to: 2, total: 16 })
  assert.deepEqual(computeValueArea([10, 3, 2, 1], 50, 2), { poc: 51, vah: 56, val: 50 })
})

test('near an edge a pair is whatever is left, and the area never leaves the bins', () => {
  // total 30, target 21. POC bin 1 (10). above 5+5 = 10, below 5 (one bin): above.
  // area 1..3 = 20. above 5 (one bin), below 5: a tie, upper. area 1..4 = 25.
  assert.deepEqual(valueAreaBins([5, 10, 5, 5, 5]), { poc: 1, from: 1, to: 4, total: 30 })
  // The mirror image: the single bin left is BELOW. above 5 (one bin), below
  // 5+5: below, area 1..3 = 20; above 5, below 5 (one bin): upper, area 1..4.
  assert.deepEqual(valueAreaBins([5, 5, 5, 10, 5]), { poc: 3, from: 1, to: 4, total: 30 })
  // One bin left below, and it is the larger "pair": total 27, 90% is 24.3.
  // POC bin 3 (10). above 1, below 5+5: below, area 1..3 = 20. above 1,
  // below 6 (bin 0 alone): below, area 0..3 = 26. It stops at bin 0, not -1.
  assert.deepEqual(valueAreaBins([6, 5, 5, 10, 1], 0.9), { poc: 3, from: 0, to: 3, total: 27 })
  // Volume only at the two ends: the area has to cross every empty bin to
  // reach its share, and stops at the first and last index, not beyond.
  assert.deepEqual(valueAreaBins([6, 0, 0, 0, 0, 0, 7]), { poc: 6, from: 0, to: 6, total: 13 })
})

test('a single bin is its own value area', () => {
  assert.deepEqual(valueAreaBins([42]), { poc: 0, from: 0, to: 0, total: 42 })
  assert.deepEqual(computeValueArea([42], 100, 5), { poc: 102.5, vah: 105, val: 100 })
})

test('nothing traded: no value area, and no crash', () => {
  assert.equal(computeValueArea([0, 0, 0, 0], 100, 1), null)
  assert.equal(computeValueArea([], 100, 1), null)
  assert.equal(computeValueArea(null, 100, 1), null)
  assert.equal(computeValueArea(undefined, 100, 1), null)
  assert.equal(pocIndex([0, 0]), -1)
  assert.equal(pocIndex([]), -1)
  assert.equal(pocIndex(null), -1)
  assert.equal(valueAreaBins([0, 0, 0]), null)
  assert.equal(valueAreaBins([0, 0, 0], 0.7, 1), null, 'even when the caller names a POC bin')
  assert.equal(valueAreaBins([1, 2, 3], 0.7, 7), null, 'a POC outside the bins is no POC')
})

test('a bin that is not a positive finite volume counts as zero', () => {
  const bins = [NaN, -3, 5, 'x', undefined, null, Infinity, 2]
  assert.equal(pocIndex(bins), 2)
  // total 7, target 4.9: the POC alone (5) already holds it.
  assert.deepEqual(valueAreaBins(bins), { poc: 2, from: 2, to: 2, total: 7 })
  assert.deepEqual(valueAreaBins(['5', 1, 1]), { poc: 0, from: 0, to: 0, total: 7 }, 'numeric strings are volumes')
  const va = computeValueArea(new Float64Array([1, 4, 9, 5, 1]), 100, 0.5)
  assert.deepEqual(va, { poc: 101.25, vah: 102.5, val: 101 }, 'a typed array works too')
})

test('an unusable lo or step returns null rather than NaN prices', () => {
  for (const step of [0, -1, NaN, Infinity, undefined, null]) {
    assert.equal(computeValueArea([1, 2, 3], 100, step), null, `step ${String(step)}`)
  }
  for (const lo of [NaN, Infinity, undefined, null, '100']) {
    assert.equal(computeValueArea([1, 2, 3], lo, 1), null, `lo ${String(lo)}`)
  }
  // POC bin 2 (3 of 6), nothing above it, so the pair below joins: bins 0..2.
  assert.deepEqual(computeValueArea([1, 2, 3], -2, 1), { poc: 0.5, vah: 1, val: -2 }, 'a negative lo is a price like any other')
})

test('share: the default is 70%, and other shares move the stopping point', () => {
  const bins = [2, 5, 8, 12, 20, 15, 9, 6, 3, 1]
  assert.deepEqual(valueAreaBins(bins, 0.7), valueAreaBins(bins))
  // 50% of 81 is 40.5: the first pair (4..6 = 44) is enough.
  assert.deepEqual(valueAreaBins(bins, 0.5), { poc: 4, from: 4, to: 6, total: 81 })
  // 100%: every bin that holds volume, here all of them.
  assert.deepEqual(valueAreaBins(bins, 1), { poc: 4, from: 0, to: 9, total: 81 })
  assert.deepEqual(valueAreaBins(bins, 3), { poc: 4, from: 0, to: 9, total: 81 }, 'a share above 1 is 1')
  for (const none of [0, -1, NaN]) {
    assert.deepEqual(valueAreaBins(bins, none), { poc: 4, from: 4, to: 4, total: 81 }, `share ${none}: the POC bin alone`)
  }
  assert.deepEqual(computeValueArea(bins, 100, 1, 0.5), { poc: 104.5, vah: 107, val: 104 })
})

test('an area holding exactly its share stops there, whatever floating point says', () => {
  // 0.28 * 25 is 7.000000000000001 in floating point. The POC bin holds
  // exactly 7 of 25, which IS 28%, so the area is the POC bin alone.
  assert.ok(0.28 * 25 > 7, 'the premise: the product rounds above the true share')
  assert.deepEqual(valueAreaBins([6, 7, 6, 6], 0.28), { poc: 1, from: 1, to: 1, total: 25 })
})

test('it is pure: the input is never modified', () => {
  const bins = [2, 5, 8, 12, 20, 15, 9, 6, 3, 1]
  const copy = bins.slice()
  computeValueArea(bins, 100, 1)
  assert.deepEqual(bins, copy)
})
