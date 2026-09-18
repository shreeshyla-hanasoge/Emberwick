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

// path -> max gzipped KB
const BUDGETS = [
  ['dist-lib/umd/emberwick.umd.js', 60],
  ['dist-lib/index.js', 90], // unminified ESM; consumers minify
]

let failed = false

for (const [rel, maxKb] of BUDGETS) {
  const file = resolve(root, rel)
  if (!existsSync(file)) {
    console.log(`- ${rel}: not built, skipped`)
    continue
  }
  const raw = await readFile(file)
  const kb = gzipSync(raw).length / 1024
  const ok = kb <= maxKb
  if (!ok) failed = true
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${rel}: ${kb.toFixed(1)} KB gzipped (budget ${maxKb} KB)`
  )
}

if (failed) {
  console.error('\nBundle size budget exceeded.')
  process.exit(1)
}
