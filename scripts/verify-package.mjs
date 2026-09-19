#!/usr/bin/env node
/**
 * Verify the assembled dist-lib/ before it can be published.
 *
 * The hazard this exists for: vite's `emptyOutDir` wipes dist-lib/ on every
 * lib build, and pack-lib.mjs only restores the manifest, docs and types. Run
 * `build:lib && pack:lib` while skipping `build:umd` and you get a tarball
 * that packs cleanly, passes the size check ("not built, skipped") and still
 * advertises unpkg/jsdelivr entries that 404 for every CDN user.
 *
 *   npm run verify:package
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'dist-lib')

const problems = []
const fail = (msg) => problems.push(msg)
const ok = (msg) => console.log(`ok   ${msg}`)

if (!existsSync(resolve(out, 'package.json'))) {
  console.error('FAIL dist-lib/package.json missing — run `npm run release` first.')
  process.exit(1)
}

const manifest = JSON.parse(await readFile(resolve(out, 'package.json'), 'utf8'))

/** Every path the manifest points at must be a real file in the tarball. */
const targets = new Set()
const collect = (value, where) => {
  if (typeof value === 'string') {
    if (value.startsWith('./')) targets.add([value, where])
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collect(v, `${where}.${k}`)
  }
}
for (const field of ['main', 'module', 'types', 'unpkg', 'jsdelivr', 'browser']) {
  if (manifest[field]) collect(manifest[field], field)
}
collect(manifest.exports, 'exports')

for (const [rel, where] of targets) {
  if (existsSync(resolve(out, rel))) ok(`${where} -> ${rel}`)
  else fail(`${where} points at ${rel}, which is not in the package`)
}

/** Docs and licence that pack-lib is supposed to copy in. */
for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
  if (existsSync(resolve(out, f))) ok(f)
  else fail(`${f} is missing from the package`)
}

/**
 * The version lives in two places that must agree: the manifest, and the
 * `version` export the landing page and consumers read at runtime.
 */
const built = await readFile(resolve(out, 'index.js'), 'utf8').catch(() => '')
const m = built.match(/version\s*=\s*["']([^"']+)["']/)
if (!m) fail('no version export found in dist-lib/index.js')
else if (m[1] !== manifest.version) {
  fail(`version mismatch: manifest ${manifest.version}, bundle exports ${m[1]} ` +
       '(bump src/chart/index.js and package.lib.json together)')
} else ok(`version ${manifest.version} consistent between manifest and bundle`)

/**
 * The UMD build must actually define the global it advertises.
 *
 * Read from `unpkg`, not the exports map: the ./umd subpath was deliberately
 * removed (importing a UMD file as ESM exports nothing and writes a global),
 * and keying this check on it meant the check silently stopped running.
 */
const umdRel = typeof manifest.unpkg === 'string' ? manifest.unpkg : null
if (!umdRel) fail('no unpkg entry — the CDN build is unadvertised')
else if (existsSync(resolve(out, umdRel))) {
  const umd = await readFile(resolve(out, umdRel), 'utf8')
  if (umd.includes('Emberwick')) ok('UMD bundle defines the Emberwick global')
  else fail('UMD bundle does not mention the Emberwick global')
}

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''} with dist-lib/:`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nRefusing to call this publishable.')
  process.exit(1)
}
console.log(`\ndist-lib/ looks publishable (${manifest.name}@${manifest.version}).`)
