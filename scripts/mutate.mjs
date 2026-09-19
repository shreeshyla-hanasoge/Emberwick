#!/usr/bin/env node
/**
 * Mutation testing.
 *
 * A passing suite proves the code works on the cases someone thought to write.
 * It does not prove the suite would NOTICE the code breaking — 0.5.0 shipped
 * three silent regressions with every test green. This reverts each shipped
 * fix in turn, in a scratch copy, and reports any the suite fails to catch.
 *
 *   npm run mutate
 *
 * Exit code is the number of surviving mutants, so CI fails on any survivor.
 */
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MUTANTS } from '../test/mutants.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const only = process.argv[2]  // optional substring filter

/**
 * Enumerate the test files explicitly. `node --test test/` resolves the bare
 * directory as a MODULE on some versions and fails before running anything —
 * which a naive runner reads as "the mutant was caught", turning every result
 * into a false pass.
 */
const testFiles = (await readdir(resolve(root, 'test')))
  .filter((f) => f.endsWith('.test.mjs'))
  .map((f) => `test/${f}`)
  .sort()

if (!testFiles.length) {
  console.error('No test files found.')
  process.exit(1)
}

const runSuite = (cwd) => {
  const r = spawnSync(process.execPath, ['--test', ...testFiles], { cwd, encoding: 'utf8' })
  // Guard against the suite failing to RUN: a crashed runner is not a catch.
  if (!/[#\u2139] tests \d+/.test(r.stdout)) {
    console.error('\nThe test runner did not report a summary — it failed to start:')
    console.error((r.stdout + r.stderr).split('\n').slice(-6).join('\n'))
    process.exit(1)
  }
  return r.status === 0
}

// The suite must be green before any of this means anything.
process.stdout.write('baseline ... ')
if (!runSuite(root)) {
  console.error('FAILED\n\nThe suite is red before mutation. Fix that first.')
  process.exit(1)
}
console.log('green\n')

const selected = only ? MUTANTS.filter((m) => m.name.toLowerCase().includes(only.toLowerCase())) : MUTANTS
if (!selected.length) {
  console.error(`No mutant matches "${only}".`)
  process.exit(1)
}

const survivors = []
const unanchored = []

for (const mutant of selected) {
  const dir = await mkdtemp(join(tmpdir(), 'emberwick-mut-'))
  try {
    // Only what the suite reads: no node_modules, so this stays fast.
    for (const d of ['src', 'test']) {
      await cp(resolve(root, d), join(dir, d), { recursive: true })
    }
    const target = join(dir, mutant.file)
    const source = await readFile(target, 'utf8')
    if (!source.includes(mutant.find)) {
      unanchored.push(mutant.name)
      console.log(`ANCHOR?  ${mutant.name}`)
      continue
    }
    await writeFile(target, source.replace(mutant.find, mutant.replace))

    if (runSuite(dir)) {
      survivors.push(mutant.name)
      console.log(`SURVIVED ${mutant.name}`)
    } else {
      console.log(`caught   ${mutant.name}`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const caught = selected.length - survivors.length - unanchored.length
console.log(`\n${caught}/${selected.length} caught`)

if (unanchored.length) {
  console.error(`\n${unanchored.length} mutant(s) no longer match the source:`)
  for (const n of unanchored) console.error(`  - ${n}`)
  console.error('Re-anchor them in test/mutants.js — deleting one silently drops its coverage.')
}
if (survivors.length) {
  console.error(`\n${survivors.length} mutant(s) SURVIVED — these fixes have no test defending them:`)
  for (const n of survivors) console.error(`  - ${n}`)
}
process.exit(survivors.length + unanchored.length)
