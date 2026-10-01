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
 * Exit code is survivors + unanchored + invalid, so CI fails on any of them.
 */
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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

/**
 * The TAP reporter, whatever the terminal: its result blocks carry each
 * failure's error name and message in a shape stable enough to read back,
 * which the INVALID verdict below depends on.
 */
const runSuite = (cwd) => {
  // maxBuffer: spawnSync keeps 1 MB of output by default and truncates the
  // rest without a word. A mutant in a function everything goes through (the
  // one coercion, say) fails hundreds of tests at once, and their TAP blocks
  // ran to 1.8 MB once the suite passed a thousand tests: the summary line was
  // cut off, and the guard below read a perfectly good catch as "the runner
  // failed to start" and aborted the whole run.
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...testFiles], {
    cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  })
  if (r.error) {
    console.error(`\nThe test runner could not be run: ${r.error.message}`)
    process.exit(1)
  }
  // Guard against the suite failing to RUN: a crashed runner is not a catch.
  if (!/[#ℹ] tests \d+/.test(r.stdout)) {
    console.error('\nThe test runner did not report a summary — it failed to start:')
    console.error((r.stdout + r.stderr).split('\n').slice(-6).join('\n'))
    process.exit(1)
  }
  return { green: r.status === 0, out: r.stdout }
}

/**
 * The output of each FAILING top-level test: its result block, plus the
 * diagnostic lines printed since the previous result. A file that fails to
 * load reports only 'test failed' in its block; the SyntaxError that caused
 * it arrives in those `#` lines just before.
 */
const failures = (tap) => {
  const out = []
  let buf = []
  let inBlock = false
  let failing = false
  for (const line of tap.split('\n')) {
    buf.push(line)
    if (/^(ok|not ok) \d+ /.test(line)) {
      inBlock = true
      failing = line.startsWith('not ok')
    } else if (inBlock && line === '  ...') {
      if (failing) out.push(buf.join('\n'))
      buf = []
      inBlock = false
    }
  }
  return out
}

/**
 * A mutant is only caught if it broke a BEHAVIOUR. One whose replacement
 * names something out of scope, or does not parse, fails every test that
 * loads it with a ReferenceError or SyntaxError — which says nothing about
 * whether the suite defends the fix it reverts.
 */
const INVALID = /ReferenceError|SyntaxError|is not defined/
const isInvalid = (tap) => {
  const f = failures(tap)
  return f.length > 0 && f.every((block) => INVALID.test(block))
}

/** src/ and test/ only: no node_modules, so this stays fast. */
const scratchCopy = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'emberwick-mut-'))
  for (const d of ['src', 'test']) {
    await cp(resolve(root, d), join(dir, d), { recursive: true })
  }
  return dir
}

// The suite must be green before any of this means anything.
process.stdout.write('baseline ... ')
if (!runSuite(root).green) {
  console.error('FAILED\n\nThe suite is red before mutation. Fix that first.')
  process.exit(1)
}
console.log('green')

// And green in a scratch copy, unmutated. A test that reads a file the copy
// does not have (package.json, dist-lib/, a script) fails in EVERY copy, so
// without this every mutant would read as "caught" and the run would lie.
process.stdout.write('scratch baseline ... ')
{
  const dir = await scratchCopy()
  try {
    if (!runSuite(dir).green) {
      console.error('FAILED\n\nThe suite is not green in a scratch copy of src/ and test/.')
      console.error('A test is reading something outside them; tests may read only src/ and test/.')
      process.exit(1)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
console.log('green\n')

const selected = only ? MUTANTS.filter((m) => m.name.toLowerCase().includes(only.toLowerCase())) : MUTANTS
if (!selected.length) {
  console.error(`No mutant matches "${only}".`)
  process.exit(1)
}

const survivors = []
const unanchored = []
const invalid = []

for (const mutant of selected) {
  const dir = await scratchCopy()
  try {
    const target = join(dir, mutant.file)
    // A missing file is a mis-anchored mutant, not a crash of the whole run.
    const source = existsSync(target) ? await readFile(target, 'utf8') : null
    if (source === null || !source.includes(mutant.find)) {
      unanchored.push(mutant.name)
      console.log(`ANCHOR?  ${mutant.name}${source === null ? `  (no such file: ${mutant.file})` : ''}`)
      continue
    }
    // A function replacement, so `$&` or `$1` in a replacement is literal.
    await writeFile(target, source.replace(mutant.find, () => mutant.replace))

    const run = runSuite(dir)
    if (run.green) {
      survivors.push(mutant.name)
      console.log(`SURVIVED ${mutant.name}`)
    } else if (isInvalid(run.out)) {
      invalid.push(mutant.name)
      console.log(`INVALID  ${mutant.name}`)
    } else {
      console.log(`caught   ${mutant.name}`)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const caught = selected.length - survivors.length - unanchored.length - invalid.length
console.log(`\n${caught}/${selected.length} caught`)

if (unanchored.length) {
  console.error(`\n${unanchored.length} mutant(s) no longer match the source:`)
  for (const n of unanchored) console.error(`  - ${n}`)
  console.error('Re-anchor them in test/mutants.js or test/mutants/ — deleting one silently drops its coverage.')
}
if (invalid.length) {
  console.error(`\n${invalid.length} mutant(s) were caught only by a ReferenceError or SyntaxError:`)
  for (const n of invalid) console.error(`  - ${n}`)
  console.error('The replacement broke the program, not the behaviour; rewrite it so it runs.')
}
if (survivors.length) {
  console.error(`\n${survivors.length} mutant(s) SURVIVED — these fixes have no test defending them:`)
  for (const n of survivors) console.error(`  - ${n}`)
}
process.exit(survivors.length + unanchored.length + invalid.length)
