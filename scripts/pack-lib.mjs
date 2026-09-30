#!/usr/bin/env node
/**
 * Assembles dist-lib/ into a directory that can be published as-is:
 *
 *   npm run build:lib && npm run build:umd && npm run pack:lib
 *   npm publish ./dist-lib
 *
 * The leading ./ matters: `npm publish dist-lib` makes npm treat the argument
 * as a registry package spec ("dist-lib@*") and fail with E404. A path has to
 * look like a path.
 *
 * Publishing from dist-lib (rather than the repo root) keeps the app's
 * private package.json out of the published artifact and means the package
 * has no build config, no playground and no src/ inside it.
 */
import { copyFile, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, 'dist-lib')

if (!existsSync(out)) {
  console.error('dist-lib/ not found — run `npm run build:lib` first.')
  process.exit(1)
}

// 1. manifest
const manifest = JSON.parse(await readFile(resolve(root, 'package.lib.json'), 'utf8'))
await writeFile(resolve(out, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')

// 2. docs + licence
for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
  if (existsSync(resolve(root, f))) {
    await copyFile(resolve(root, f), resolve(out, f))
  }
}

// 3. type declarations, flattened to sit beside their entry points
const types = [
  ['src/chart/index.d.ts', 'index.d.ts'],
  ['src/adapters/react/index.d.ts', 'react.d.ts'],
  ['src/adapters/webcomponent/index.d.ts', 'webcomponent.d.ts'],
  ['src/drawings/index.d.ts', 'drawings.d.ts'],
]
for (const [from, to] of types) {
  const src = resolve(root, from)
  if (!existsSync(src)) continue
  let text = await readFile(src, 'utf8')
  // The flattened layout puts everything at the package root. Adapters sit two
  // levels below src/, drawings one; both point at the core entry. The leading
  // quote in each pattern is what keeps the one-level rewrite from matching
  // inside '../../chart/index.js'.
  text = text
    .replace(/from '\.\.\/\.\.\/chart\/index\.js'/g, "from './index.js'")
    .replace(/from "\.\.\/\.\.\/chart\/index\.js"/g, 'from "./index.js"')
    .replace(/from '\.\.\/chart\/index\.js'/g, "from './index.js'")
    .replace(/from "\.\.\/chart\/index\.js"/g, 'from "./index.js"')
    // Inline type references (`import('../chart/index.js').Chart`) are the
    // other way a hand-written .d.ts reaches the core; left as they are, they
    // point outside the published package and every such type becomes `any`.
    .replace(/import\((['"])(?:\.\.\/){1,2}chart\/index\.js\1\)/g, 'import($1./index.js$1)')
  const dest = resolve(out, to)
  await mkdir(dirname(dest), { recursive: true })
  await writeFile(dest, text)
}

console.log('packed dist-lib/ — publish with: npm publish ./dist-lib')
