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
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { isDeepStrictEqual } from 'node:util'

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

// ---------------------------------------------------------------- drawings
//
// Checks (a)–(h) of the drawings spec. Together they are what "the core is
// unchanged when you do not use drawings" rests on, so each names the way
// that claim has actually been broken, or would be.

const read = (rel) => readFile(resolve(out, rel), 'utf8').catch(() => null)
const coreEsm = await read('index.js')
const drawingsEsm = await read('drawings.js')
const DRAWINGS_UMD = 'umd/emberwick-drawings.umd.js'

/**
 * (a) No chunks/. Rollup splits shared modules into chunks/ as soon as a
 * second entry reaches the core through anything but a value DEFINED in
 * src/chart/index.js. The core would then be two files, and a core-only
 * user would load code that only exists because drawings were built beside it.
 */
if (existsSync(resolve(out, 'chunks'))) {
  const names = await readdir(resolve(out, 'chunks')).catch(() => [])
  fail(`dist-lib/chunks/ exists (${names.join(', ') || 'empty'}) — an entry is importing the core ` +
       'through a deep path or re-exports only; see D4 in the drawings spec')
} else ok('no chunks/ — every entry is one file')

/** (b) The core is self-contained: it imports nothing, not even a chunk. */
if (coreEsm === null) fail('dist-lib/index.js is missing')
else if (/^\s*import[\s{*]/m.test(coreEsm)) {
  fail('dist-lib/index.js has an import statement — the core is no longer self-contained')
} else ok('index.js imports nothing')

/**
 * (c) The drawings entry reaches the core only as './index.js', so a
 * bundler resolves it to the SAME module instance the app's chart came from.
 * Anything else (a chunk, a bare 'emberwick', a second path) risks two cores.
 */
if (drawingsEsm === null) fail('dist-lib/drawings.js is missing')
else {
  const specs = [
    ...[...drawingsEsm.matchAll(/^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...drawingsEsm.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)].map((m) => m[1]),
    ...[...drawingsEsm.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
  ]
  const stray = specs.filter((sp) => sp !== './index.js')
  if (stray.length) fail(`drawings.js imports ${stray.map((x) => `'${x}'`).join(', ')} — only './index.js' is allowed`)
  else if (!specs.length) fail("drawings.js does not import './index.js' — it must be carrying its own core")
  else ok("drawings.js imports only './index.js'")
}

/**
 * (d) No drawing code leaked into the core. Comments are stripped first, so a
 * seam comment that names a drawings function cannot trip it; the sentinels
 * are error strings and identifiers that exist only in src/drawings/.
 *
 * Each sentinel must also be FOUND in drawings.js. Otherwise a renamed error
 * message would quietly turn this check into one that can never fail.
 */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')
const SENTINELS = [
  'enableDrawings: needs an Emberwick',
  'drawings are already enabled on this chart',
  'createDrawings',
  'fibRetracement',
]
const coreUmd = await read('umd/emberwick.umd.js')
for (const [rel, text] of [['index.js', coreEsm], ['umd/emberwick.umd.js', coreUmd]]) {
  if (text === null) { fail(`dist-lib/${rel} is missing`); continue }
  const code = stripComments(text)
  const leaked = SENTINELS.filter((x) => code.includes(x))
  if (leaked.length) fail(`drawing code leaked into the core: ${rel} contains ${leaked.map((x) => `"${x}"`).join(', ')}`)
  else ok(`${rel} contains no drawing code`)
}
if (drawingsEsm !== null) {
  const code = stripComments(drawingsEsm)
  const lost = SENTINELS.filter((x) => !code.includes(x))
  if (lost.length) {
    fail(`sentinel${lost.length > 1 ? 's' : ''} ${lost.map((x) => `"${x}"`).join(', ')} no longer appear in drawings.js, ` +
         'so check (d) cannot see a leak — update SENTINELS in scripts/verify-package.mjs')
  }
}

/**
 * (e) The drawings entry carries no second copy of the core. The string is
 * the Chart constructor's first guard; the positive control on index.js keeps
 * a reworded message from making this vacuous.
 */
const CORE_STRING = 'Chart: container element is required'
if (coreEsm !== null && !coreEsm.includes(CORE_STRING)) {
  fail(`index.js no longer contains "${CORE_STRING}" — update CORE_STRING in scripts/verify-package.mjs`)
}
if (drawingsEsm !== null) {
  if (drawingsEsm.includes(CORE_STRING)) fail('drawings.js bundles a second copy of the core')
  else ok('drawings.js does not bundle the core')
}

/**
 * (f) The drawings UMD exists, reads the core from window.Emberwick instead of
 * bundling it, and actually runs: core then drawings defines the global;
 * drawings alone fails with the load-order message from the banner guard, not
 * with "Class extends value undefined". Executed, not grepped, because a
 * banner the minifier dropped or placed inside the wrapper greps fine.
 */
const drawingsUmd = await read(DRAWINGS_UMD)
if (drawingsUmd === null) fail(`${DRAWINGS_UMD} is missing — the CDN drawings build was not run (npm run build:umd)`)
else {
  if (drawingsUmd.includes('EmberwickDrawings')) ok('drawings UMD defines the EmberwickDrawings global')
  else fail('drawings UMD does not mention the EmberwickDrawings global')
  if (drawingsUmd.includes(CORE_STRING)) fail('drawings UMD bundles a second copy of the core')

  const run = (ctx, text, filename) => vm.runInContext(text, ctx, { filename })
  if (coreUmd !== null) {
    try {
      const ctx = vm.createContext({ console })
      run(ctx, coreUmd, 'emberwick.umd.js')
      run(ctx, drawingsUmd, 'emberwick-drawings.umd.js')
      const g = vm.runInContext('this', ctx)
      if (g.EmberwickDrawings && typeof g.EmberwickDrawings.enableDrawings === 'function') {
        ok('core UMD then drawings UMD defines EmberwickDrawings.enableDrawings')
      } else fail('core UMD then drawings UMD ran, but EmberwickDrawings.enableDrawings is not a function')
    } catch (e) {
      fail(`core UMD then drawings UMD threw: ${e && e.message}`)
    }

    // CommonJS: the guard stands aside and the wrapper require()s the core by
    // package name — which is what `output.paths` is for.
    try {
      const coreModule = { exports: {} }
      run(vm.createContext({ console, module: coreModule, exports: coreModule.exports }), coreUmd, 'emberwick.umd.js')
      const requested = []
      const mod = { exports: {} }
      const require = (id) => { requested.push(id); if (id === 'emberwick') return coreModule.exports; throw new Error(`Cannot find module '${id}'`) }
      run(vm.createContext({ console, module: mod, exports: mod.exports, require }), drawingsUmd, 'emberwick-drawings.umd.js')
      if (typeof mod.exports.enableDrawings === 'function' && requested.join() === 'emberwick') {
        ok("drawings UMD under CommonJS require()s 'emberwick'")
      } else fail(`drawings UMD under CommonJS required [${requested.join(', ')}] and exported no enableDrawings`)
    } catch (e) {
      fail(`drawings UMD under CommonJS threw: ${e && e.message}`)
    }
  }

  const GUARD_MESSAGE = 'load emberwick.umd.js before emberwick-drawings.umd.js'
  let thrown = null
  try {
    run(vm.createContext({ console }), drawingsUmd, 'emberwick-drawings.umd.js')
  } catch (e) {
    thrown = e
  }
  // Errors from another realm fail `instanceof Error`; compare by name.
  if (!thrown) fail('drawings UMD loaded without the core and did not throw — the load-order guard is missing')
  else if (thrown.name !== 'Error' || !String(thrown.message).includes(GUARD_MESSAGE)) {
    fail(`drawings UMD without the core threw ${thrown.name}: ${thrown.message} — expected the banner guard's "${GUARD_MESSAGE}"`)
  } else ok('drawings UMD without the core throws the load-order message')
}

/**
 * (g) drawings.js exports the manifest's version. Imported rather than
 * grepped: the entry also imports the core's `version`, and Rollup is free to
 * rename either binding.
 */
if (drawingsEsm !== null) {
  try {
    const dr = await import(pathToFileURL(resolve(out, 'drawings.js')).href)
    if (dr.version === manifest.version) ok(`drawings.js exports version ${dr.version}`)
    else {
      fail(`version mismatch: manifest ${manifest.version}, drawings.js exports ${dr.version} ` +
           '(bump src/drawings/index.js with src/chart/index.js and package.lib.json)')
    }
  } catch (e) {
    fail(`drawings.js does not import in Node: ${e && e.message}`)
  }
}

/**
 * (h) No new dependencies (boundary rule 6). Checked here, not in a test,
 * because the mutation harness copies only src/ and test/; a test reading a
 * manifest would fail in every mutant run and read every mutant as caught.
 * Both manifests are checked: the source of truth and what ships.
 */
const libManifest = JSON.parse(await readFile(resolve(root, 'package.lib.json'), 'utf8'))
for (const [label, m] of [['package.lib.json', libManifest], ['dist-lib/package.json', manifest]]) {
  const deps = m.dependencies
  if (deps && Object.keys(deps).length) fail(`${label} has dependencies (${Object.keys(deps).join(', ')}) — Emberwick ships with none`)
  for (const k of ['optionalDependencies', 'bundleDependencies', 'bundledDependencies']) {
    if (m[k] && (Array.isArray(m[k]) ? m[k].length : Object.keys(m[k]).length)) fail(`${label} has ${k}`)
  }
  if (!isDeepStrictEqual(m.peerDependencies, { react: '>=17' })) {
    fail(`${label} peerDependencies are ${JSON.stringify(m.peerDependencies)}, expected exactly {"react":">=17"}`)
  }
}
const site = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const siteDeps = Object.keys(site.dependencies || {}).sort()
if (siteDeps.join() !== 'react,react-dom') {
  fail(`the demo site's package.json dependencies are [${siteDeps.join(', ')}], expected exactly [react, react-dom]`)
}
if (!problems.some((p) => /dependenc/.test(p))) ok('no dependencies beyond the react peer')

/**
 * Typings are flattened to the package root by pack-lib. A path still
 * pointing up into the source tree resolves to nothing once published, and
 * TypeScript turns every type behind it into `any` without a word.
 */
for (const f of (await readdir(out)).filter((n) => n.endsWith('.d.ts')).sort()) {
  const text = await readFile(resolve(out, f), 'utf8')
  const up = text.match(/(?:\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.\/[^'"]*)\1/)
  if (up) fail(`${f} references '${up[2]}', which is outside the published package`)
}

if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''} with dist-lib/:`)
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\nRefusing to call this publishable.')
  process.exit(1)
}
console.log(`\ndist-lib/ looks publishable (${manifest.name}@${manifest.version}).`)
