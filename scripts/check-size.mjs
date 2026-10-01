#!/usr/bin/env node
/**
 * Bundle-size budget. Fails the build if the core grows past the limit —
 * "small enough to drop into any app" is a feature, and features need tests.
 *
 *   npm run size
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * path -> max gzipped KB.
 *
 * Budgets sit a little above what ships, so they fail on a real regression
 * rather than never. The core's used to be 90 / 60 KB against about 32 / 18
 * actual: a budget that cannot fail measures nothing.
 *
 * The drawings budgets were provisional (24 and 14 KB, an estimate made before
 * the code existed). The PR that first built them ratcheted each to
 * ceil(1.2 × measured). Measured 70.7 KB for the ESM (unminified, comments
 * included) gives 85, and 52.3 KB for the minified UMD gives 63.
 *
 * The core ESM moved from 36 to 37: the plugin seam measured +4.2 KB over
 * 0.11.0 against the +2.6 KB the spec allowed, because the ESM is unminified
 * and keeps the house-style "why" comments the seam's gesture handling needs.
 * The minified core UMD, where comments cost nothing, stays inside its 21 KB.
 *
 * 0.13 moved both core budgets up by one, to 38 and 22: the four plugin
 * additions (the `below` layer, timeToIndex/indexToTime, host.drawPriceTag
 * and isLight) measured 37.3 KB and 21.2 KB. What bounds them is not these
 * ceilings but MAX_CORE_GROWTH below.
 */
const BUDGETS = [
  ['dist-lib/umd/emberwick.umd.js', 22],
  ['dist-lib/index.js', 38], // unminified ESM; consumers minify
  ['dist-lib/umd/emberwick-drawings.umd.js', 63],
  ['dist-lib/drawings.js', 85], // unminified ESM
]

/**
 * Gzipped bytes of the previous release's core. The printed delta is what
 * "the core costs N KB more than it used to" means in the CHANGELOG, so it is
 * measured here, the same way every time, rather than worked out by hand.
 * (0.11.0, before the plugin seam: 32578 and 18130.)
 */
const BASELINE = { label: '0.12.0', 'dist-lib/index.js': 36877, 'dist-lib/umd/emberwick.umd.js': 20816 }

/**
 * How far the core may grow past BASELINE, in gzipped bytes: +1.5 KB, the
 * allowance 0.13 gave the four additions that volume profiles needed from
 * it. A hard failure rather than a note, because "a chart that does not use
 * profiles pays almost nothing for them" is only true while this holds, and
 * a KB-rounded budget would let half of it slip by unseen.
 */
const MAX_CORE_GROWTH = 1536

let failed = false

for (const [rel, maxKb] of BUDGETS) {
  const file = resolve(root, rel)
  if (!existsSync(file)) {
    // Never skip: a missing file here is how a build that dropped dist-lib/umd
    // still reported success while the manifest advertised a CDN entry.
    console.log(`FAIL ${rel}: missing — expected a built file`)
    failed = true
    continue
  }
  const raw = await readFile(file)
  const bytes = gzipSync(raw).length
  const kb = bytes / 1024
  const base = BASELINE[rel]
  const grew = base === undefined ? 0 : bytes - base
  const ok = kb <= maxKb && grew <= MAX_CORE_GROWTH
  if (!ok) failed = true
  const delta = base === undefined ? '' : `, ${fmtDelta(grew)} vs ${BASELINE.label}`
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${rel}: ${kb.toFixed(1)} KB gzipped (budget ${maxKb} KB${delta})`
  )
  if (grew > MAX_CORE_GROWTH) {
    console.log(`     the core may grow by at most ${fmtDelta(MAX_CORE_GROWTH)} over ${BASELINE.label}`)
  }
}

if (failed) {
  console.error('\nBundle size budget exceeded.')
  process.exit(1)
}

/** Signed, two decimals: the seam's budget is stated to a tenth of a KB. */
function fmtDelta(bytes) {
  return `${bytes < 0 ? '−' : '+'}${(Math.abs(bytes) / 1024).toFixed(2)} KB (${bytes < 0 ? '−' : '+'}${Math.abs(bytes)} B)`
}
