/**
 * Package boundaries.
 *
 * "The core is unchanged when you do not use drawings" is only true while a
 * handful of source-level rules hold, and every one of them fails silently:
 * nothing crashes when src/drawings reaches into the core through a deep
 * path, Rollup just starts splitting the core into chunks/ and a core-only
 * user downloads a second file. So the rules are checked here, on the source,
 * where the failure names the file and line that broke them.
 *
 * They hold for every OPT-IN ENTRY, which is src/drawings and src/profiles:
 *
 *   1. Nothing under src/chart imports anything under an opt-in entry.
 *   2. An opt-in entry leaves its folder only through '../chart/index.js' or
 *      '../../chart/index.js', with named imports, never a namespace. That
 *      also keeps the entries apart: profiles cannot import drawings.
 *   3. Its index.js binds `version`, a value DEFINED in the core entry,
 *      which is what keeps Rollup from chunk-splitting the core.
 *   4. No module-scope window/document/navigator/matchMedia/
 *      requestAnimationFrame/HTMLElement: the entry must import under SSR.
 *   5. Nothing that needs a newer runtime than the ES2019 build target.
 *   7. Nothing that ships (the core, the adapters, the opt-in entries)
 *      imports the demo site's code under src/components or src/pages.
 *
 * Rule 6 (no new dependencies) lives in scripts/verify-package.mjs, because
 * this file may read only src/ and test/: the mutation harness copies nothing
 * else, and a test that read package.json would fail in every mutant run and
 * report every mutant "caught".
 *
 * There is no JS parser to lean on (the suite runs on a bare checkout, no
 * npm install), so this file carries a small tokenizer. It understands
 * comments, strings, template substitutions and regex literals, which is
 * what separates `window` the global from `window` the word in a comment.
 * The first tests below prove the checks bite on synthetic source, so a
 * scanner that silently passed everything could not go unnoticed while
 * src/drawings is still empty.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, relative, sep, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORE_ENTRY = 'src/chart/index.js'
const DRAWINGS_ENTRY = 'src/drawings/index.js'
const PROFILES_ENTRY = 'src/profiles/index.js'
/** Every opt-in entry: its folder, and the function a host calls first. */
const OPT_IN = [
  { dir: 'src/drawings', entry: DRAWINGS_ENTRY, creates: 'enableDrawings' },
  { dir: 'src/profiles', entry: PROFILES_ENTRY, creates: 'createVolumeProfile' },
]
/** The demo site: a real chart on a real page, and no part of the package. */
const DEMO = ['src/components', 'src/pages', 'src/App.jsx', 'src/main.jsx']
const ALLOWED_CORE_SPECIFIERS = ['../chart/index.js', '../../chart/index.js']


// ------------------------------------------------------------------ files

const toRel = (abs) => relative(ROOT, abs).split(sep).join('/')

/** Repo-relative paths of every file under `dir` whose name passes `keep`. */
function listFiles(dir, keep) {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (keep(e.name)) out.push(toRel(p))
    }
  }
  walk(abs)
  return out.sort()
}

const isJs = (n) => /\.(m?js|jsx)$/.test(n)
const isSource = (n) => /\.(m?js|jsx|ts|tsx)$/.test(n)
const readRel = (rel) => readFileSync(join(ROOT, rel), 'utf8')

// -------------------------------------------------------------- tokenizer

const PUNCT = [
  '>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=',
  '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
]
/** After these words a `/` starts a regex literal, not a division. */
const REGEX_AFTER = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await', 'export', 'default',
])
const ID_START = /[A-Za-z_$ -￿]/
const ID_REST = /[\w$ -￿]*/y
const NUMBER = /(?:0[xXbBoO][\da-fA-F_]+n?|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?n?)/y

/**
 * Split source into tokens: `id` (including `#private` names), `num`, `str`
 * (value = the raw text between the quotes), `tpl` (a template's literal
 * text), `re` (value = the flags) and `p` (punctuation). Comments vanish.
 * A template substitution is emitted as a synthetic `(` … `)` pair, so the
 * code inside it is scanned like any other expression.
 *
 * Every token records its line, its column, and whether a newline preceded
 * it; the scope pass uses a column-0 newline to find where a top-level arrow
 * function's expression body ends in semicolon-free code.
 */
function tokenize(src) {
  const toks = []
  const subs = [] // brace depth at each open `${`
  let braces = 0
  let i = 0
  let line = 1
  let lineStart = 0
  let nl = true
  const n = src.length
  const push = (t, v, at) => {
    toks.push({ t, v, i: at, line, col: at - lineStart, nl })
    nl = false
  }
  const newlinesIn = (from, to) => {
    for (let k = from; k < to; k++) {
      if (src[k] === '\n') { line++; lineStart = k + 1; nl = true }
    }
  }
  /** Scan template text from `from`; stop after the closing backtick or a `${`. */
  const template = (from) => {
    let k = from
    while (k < n) {
      const c = src[k]
      if (c === '\\') { k += 2; continue }
      if (c === '`') { push('tpl', src.slice(from, k), from); newlinesIn(from, k + 1); return k + 1 }
      if (c === '$' && src[k + 1] === '{') {
        push('tpl', src.slice(from, k), from)
        newlinesIn(from, k)
        subs.push(braces)
        push('p', '(', k)
        return k + 2
      }
      k++
    }
    newlinesIn(from, n)
    return n
  }

  if (src.startsWith('#!')) { i = src.indexOf('\n'); if (i < 0) i = n }

  while (i < n) {
    const c = src[i]
    if (c === '\n') { line++; lineStart = i + 1; nl = true; i++; continue }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ') { i++; continue }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2)
      const end = e < 0 ? n : e + 2
      newlinesIn(i, end)
      i = end
      continue
    }
    if (c === '\'' || c === '"') {
      let k = i + 1
      while (k < n && src[k] !== c && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1
      push('str', src.slice(i + 1, k), i)
      i = k + 1
      continue
    }
    if (c === '`') { i = template(i + 1); continue }
    if (c === '}' && subs.length && subs[subs.length - 1] === braces) {
      subs.pop()
      push('p', ')', i)
      i = template(i + 1)
      continue
    }
    if (c === '/') {
      const last = toks[toks.length - 1]
      const regexOk = !last ||
        (last.t === 'p' && !(last.v === ')' || last.v === ']' || last.v === '}' || last.v === '++' || last.v === '--')) ||
        (last.t === 'id' && REGEX_AFTER.has(last.v))
      if (regexOk) {
        let k = i + 1
        let inClass = false
        let ok = false
        while (k < n) {
          const d = src[k]
          if (d === '\\') { k += 2; continue }
          if (d === '\n') break
          if (d === '[') inClass = true
          else if (d === ']') inClass = false
          else if (d === '/' && !inClass) { ok = true; break }
          k++
        }
        if (ok) {
          ID_REST.lastIndex = k + 1
          const flags = ID_REST.exec(src)[0]
          push('re', flags, i)
          i = k + 1 + flags.length
          continue
        }
      }
    }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] || ''))) {
      NUMBER.lastIndex = i
      const m = NUMBER.exec(src)
      const len = m ? m[0].length : 1
      push('num', src.slice(i, i + len), i)
      i += len
      continue
    }
    if (ID_START.test(c) || (c === '#' && ID_START.test(src[i + 1] || ''))) {
      ID_REST.lastIndex = i + 1
      const len = 1 + ID_REST.exec(src)[0].length
      push('id', src.slice(i, i + len), i)
      i += len
      continue
    }
    let p = c
    for (const q of PUNCT) if (src.startsWith(q, i)) { p = q; break }
    // `a?.5:b` is a ternary, not optional chaining
    if (p === '?.' && /\d/.test(src[i + 2] || '')) p = '?'
    if (p === '{') braces++
    else if (p === '}') braces--
    push('p', p, i)
    i += p.length
  }
  return toks
}

// ------------------------------------------------------------ scope pass

/** `x (` here runs its block at once; any other `x ( … ) {` is a function. */
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with'])
const OPENERS = { '(': ')', '[': ']', '{': '}' }
const CLOSERS = new Set([')', ']', '}'])

/**
 * Mark every token `deferred` when it only runs once a function is called:
 * function and method bodies, arrow bodies (block or expression) and
 * parameter lists (default values). Everything else runs when the module is
 * evaluated. Blocks of `if`/`for`/`try`/… and object literals at the top
 * level are NOT deferred. They run at import, which is exactly what an SSR
 * build trips over.
 *
 * Conservative on purpose: class field initializers read as module scope,
 * and an IIFE's body reads as deferred. The first can only cause a false
 * alarm with an obvious fix; the second is covered by the dynamic import test.
 */
function markScopes(toks) {
  const stack = []
  let deferredDepth = 0
  const pushFrame = (f) => { stack.push(f); if (f.deferred) deferredDepth++ }
  const popFrame = () => { const f = stack.pop(); if (f && f.deferred) deferredDepth--; return f }
  const markRange = (from, to) => { for (let j = from; j <= to; j++) toks[j].deferred = true }

  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    // An arrow's expression body ends at `,` `;` a closer, or a new top-level statement.
    while (stack.length && stack[stack.length - 1].open === '=>') {
      const ends = (tk.t === 'p' && (tk.v === ',' || tk.v === ';' || CLOSERS.has(tk.v))) ||
        (tk.nl && tk.col === 0 && stack.every((f) => f.open === '=>'))
      if (!ends) break
      popFrame()
    }
    tk.deferred = deferredDepth > 0

    if (tk.t !== 'p') continue
    if (tk.v === '(' || tk.v === '[') pushFrame({ open: tk.v, deferred: false, idx: k })
    else if (tk.v === '{') {
      const prev = toks[k - 1]
      let fn = false
      if (prev && prev.t === 'p' && prev.v === '=>') fn = true
      else if (prev && prev.t === 'p' && prev.v === ')' && prev.openIdx !== undefined) {
        const before = toks[prev.openIdx - 1]
        const before2 = toks[prev.openIdx - 2]
        const control = before && before.t === 'id' &&
          (CONTROL.has(before.v) || (before.v === 'await' && before2 && before2.v === 'for'))
        if (!control) { fn = true; markRange(prev.openIdx, k - 1) }
      }
      pushFrame({ open: '{', deferred: fn, idx: k })
    } else if (CLOSERS.has(tk.v)) {
      // Pop to the matching opener; tolerate damage rather than throw.
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].open !== '=>' && OPENERS[stack[s].open] === tk.v) {
          while (stack.length > s + 1) popFrame()
          const f = popFrame()
          tk.openIdx = f.idx
          break
        }
      }
    } else if (tk.v === '=>') {
      const prev = toks[k - 1]
      if (prev && prev.t === 'p' && prev.v === ')' && prev.openIdx !== undefined) markRange(prev.openIdx, k - 1)
      else if (prev && prev.t === 'id') prev.deferred = true
      const next = toks[k + 1]
      if (!(next && next.t === 'p' && next.v === '{')) pushFrame({ open: '=>', deferred: true, idx: k })
    }
  }
  return toks
}

// ------------------------------------------------------------ the checks

const isMember = (tok) => tok && tok.t === 'p' && (tok.v === '.' || tok.v === '?.')
const isP = (tok, v) => tok && tok.t === 'p' && tok.v === v
const isId = (tok, v) => tok && tok.t === 'id' && (v === undefined || tok.v === v)
const where = (rel, tok) => `${rel}:${tok.line}:${tok.col + 1}`

const BROWSER_GLOBALS = new Set(['window', 'document', 'navigator', 'matchMedia', 'requestAnimationFrame', 'HTMLElement'])

/**
 * Rule 4: browser globals read while the module is being evaluated.
 *
 * `typeof window` on its own is allowed. It is the one SSR-safe way to ask
 * whether a global exists, and it is how a guard is written. `typeof
 * window.matchMedia` is not: it evaluates `window` first and throws.
 */
function moduleScopeGlobals(src, rel = '<source>') {
  const toks = markScopes(tokenize(src))
  const hits = []
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    if (tk.t !== 'id' || !BROWSER_GLOBALS.has(tk.v) || tk.deferred) continue
    const prev = toks[k - 1]
    const next = toks[k + 1]
    if (isMember(prev)) continue // someone.window
    if (isP(next, ':') && (isP(prev, '{') || isP(prev, ','))) continue // { window: … }
    if (isId(prev) && ['function', 'class', 'const', 'let', 'var', 'as'].includes(prev.v)) continue
    if (isId(prev, 'typeof') && !(isMember(next) || isP(next, '[') || isP(next, '('))) continue
    hits.push({ name: tk.v, at: where(rel, tk) })
  }
  return hits
}

/** A lookup with no prototype, so `constructor` or `toString` is never "banned". */
const table = (entries) => Object.assign(Object.create(null), entries)
const MEMBER_BANNED = table({
  at: 'Array.prototype.at is ES2022 — use a[a.length - 1]',
  replaceAll: 'String.prototype.replaceAll is ES2021 — use .replace(/…/g, …)',
  findLast: 'Array.prototype.findLast is ES2023 — loop backwards',
  findLastIndex: 'Array.prototype.findLastIndex is ES2023 — loop backwards',
  toSorted: 'Array.prototype.toSorted is ES2023 — use slice().sort()',
  toReversed: 'Array.prototype.toReversed is ES2023 — use slice().reverse()',
  toSpliced: 'Array.prototype.toSpliced is ES2023',
  randomUUID: 'crypto.randomUUID needs a secure context and Node 19 — use the idFactory',
  roundRect: 'ctx.roundRect is missing from older Safari and from dom-stub — use paint.js roundRect(ctx, …)',
})
const CALL_ONLY = new Set(['at', 'roundRect'])
const STATIC_BANNED = table({
  'Object.hasOwn': 'Object.hasOwn is ES2022 — use Object.prototype.hasOwnProperty.call',
  'Object.groupBy': 'Object.groupBy is ES2024',
  'Map.groupBy': 'Map.groupBy is ES2024',
  'Promise.any': 'Promise.any is ES2021',
  'Promise.withResolvers': 'Promise.withResolvers is ES2024',
  'Array.fromAsync': 'Array.fromAsync is ES2024',
})
const GLOBAL_BANNED = table({
  structuredClone: 'structuredClone is not in older browsers or Node 16 — clone by hand',
  Path2D: 'Path2D is absent in Node and in dom-stub — build paths on the context',
  WeakRef: 'WeakRef is ES2021',
  FinalizationRegistry: 'FinalizationRegistry is ES2021',
  AggregateError: 'AggregateError is ES2021',
})

/**
 * Rule 5: APIs the ES2019 build target cannot lower. esbuild rewrites syntax
 * (`?.`, `??`) but never adds runtime methods, so these would ship as-is and
 * throw on an older browser. Private `#fields` and top-level await are
 * rejected too: the first is banned outright, the second cannot be lowered.
 */
function forbiddenApis(src, rel = '<source>') {
  const toks = markScopes(tokenize(src))
  // `paint.roundRect(ctx, …)` through a namespace import of our own module is fine.
  const namespaces = new Set()
  for (let k = 0; k + 3 < toks.length; k++) {
    if (isId(toks[k], 'import') && isP(toks[k + 1], '*') && isId(toks[k + 2], 'as') && isId(toks[k + 3])) {
      namespaces.add(toks[k + 3].v)
    }
  }
  const hits = []
  const hit = (tk, why) => hits.push({ name: tk.v, why, at: where(rel, tk) })
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    const prev = toks[k - 1]
    const next = toks[k + 1]
    if (tk.t === 're' && /[dv]/.test(tk.v)) { hit(tk, `regex flag in /…/${tk.v} is ES2022+`); continue }
    if (tk.t !== 'id') continue
    if (tk.v[0] === '#') { hit(tk, '#private members are banned (boundary rule 5) — use a _prefixed field'); continue }
    if (isP(next, ':') && (isP(prev, '{') || isP(prev, ','))) continue // an object key
    if (isMember(prev) && MEMBER_BANNED[tk.v]) {
      if (CALL_ONLY.has(tk.v) && !isP(next, '(')) continue
      // DrawingStore.replaceAll (§11 contract B) is our own method, not
      // String.prototype.replaceAll: a call on a receiver named `store` or
      // `_store` is the document store (batch() rolls back through it).
      if (tk.v === 'replaceAll' && isId(toks[k - 2]) && /^_?store$/.test(toks[k - 2].v)) continue
      if (tk.v === 'roundRect' && isId(toks[k - 2]) && namespaces.has(toks[k - 2].v)) continue
      hit(tk, MEMBER_BANNED[tk.v])
      continue
    }
    if (isMember(prev) && isId(toks[k - 2]) && STATIC_BANNED[`${toks[k - 2].v}.${tk.v}`]) {
      hit(tk, STATIC_BANNED[`${toks[k - 2].v}.${tk.v}`])
      continue
    }
    if (GLOBAL_BANNED[tk.v]) { hit(tk, GLOBAL_BANNED[tk.v]); continue }
    if (tk.v === 'await' && !tk.deferred && !isMember(prev)) hit(tk, 'top-level await cannot be lowered to ES2019')
  }
  return hits
}

/**
 * Every import and export-from in a module: `{ kind, spec, namespace,
 * isDefault, names: [{ imported, local }], tok }`. `kind` is 'static',
 * 'side-effect', 'dynamic', 'meta' (import.meta), 'reexport' or
 * 'reexport-all'. `import type` and inline `type` names (in .d.ts) are read
 * like values; only the specifier matters for them.
 */
function parseImports(src) {
  const toks = tokenize(src)
  const out = []
  const findFrom = (k) => {
    for (let j = k; j < toks.length - 1; j++) {
      if (isP(toks[j], ';') || (j > k && toks[j].nl && toks[j].col === 0 && !isP(toks[j], '}') && !isId(toks[j], 'from'))) return -1
      if (isId(toks[j], 'from') && toks[j + 1].t === 'str') return j
    }
    return -1
  }
  const readNames = (from, to) => {
    const names = []
    for (let j = from; j < to; j++) {
      if (!isP(toks[j], '{')) continue
      let cur = []
      for (j++; j < to && !isP(toks[j], '}'); j++) {
        if (isP(toks[j], ',')) { if (cur.length) names.push(cur); cur = []; continue }
        cur.push(toks[j])
      }
      if (cur.length) names.push(cur)
      break
    }
    return names.map((parts) => {
      const p = parts[0] && parts[0].v === 'type' && parts.length > 1 && parts[1].v !== 'as' ? parts.slice(1) : parts
      const imported = p[0] ? p[0].v : ''
      const asAt = p.findIndex((x) => isId(x, 'as'))
      return { imported, local: asAt >= 0 && p[asAt + 1] ? p[asAt + 1].v : imported }
    })
  }
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k]
    if (!(isId(tk, 'import') || isId(tk, 'export')) || isMember(toks[k - 1])) continue
    const next = toks[k + 1]
    if (tk.v === 'import') {
      if (isP(next, '(')) {
        const arg = toks[k + 2]
        out.push({ kind: 'dynamic', spec: arg && arg.t === 'str' && isP(toks[k + 3], ')') ? arg.v : null, tok: tk, names: [] })
        continue
      }
      if (isP(next, '.')) { out.push({ kind: 'meta', spec: null, tok: tk, names: [] }); continue }
      if (next && next.t === 'str') { out.push({ kind: 'side-effect', spec: next.v, tok: tk, names: [] }); continue }
      const f = findFrom(k + 1)
      if (f < 0) continue
      let first = k + 1
      if (isId(toks[first], 'type') && !isId(toks[first + 1], 'from')) first++
      const clause = toks.slice(first, f)
      out.push({
        kind: 'static',
        spec: toks[f + 1].v,
        namespace: clause.some((x) => isP(x, '*')),
        isDefault: clause.length > 0 && isId(clause[0]) && !isP(clause[0], '{'),
        names: readNames(first, f),
        tok: tk,
      })
      continue
    }
    // export … from
    let first = k + 1
    if (isId(toks[first], 'type') && (isP(toks[first + 1], '{') || isP(toks[first + 1], '*'))) first++
    if (isP(toks[first], '*')) {
      const f = findFrom(first)
      if (f >= 0) out.push({ kind: 'reexport-all', spec: toks[f + 1].v, namespace: true, tok: tk, names: [] })
    } else if (isP(toks[first], '{')) {
      let close = first
      while (close < toks.length && !isP(toks[close], '}')) close++
      if (isId(toks[close + 1], 'from') && toks[close + 2] && toks[close + 2].t === 'str') {
        out.push({ kind: 'reexport', spec: toks[close + 2].v, namespace: false, tok: tk, names: readNames(first, close + 1) })
      }
    }
  }
  return out
}

/**
 * What a module exports: `names` (every exported name, or null when an
 * `export *` makes the set unknowable) and `defined` (names declared by an
 * `export const/let/var/function/class` in the file itself, as opposed to
 * re-exported from elsewhere).
 */
function parseExports(src) {
  const toks = tokenize(src)
  const names = new Set()
  const defined = new Set()
  let complete = true
  for (let k = 0; k < toks.length; k++) {
    if (!isId(toks[k], 'export') || isMember(toks[k - 1])) continue
    let j = k + 1
    if (isId(toks[j], 'default')) { names.add('default'); continue }
    if (isP(toks[j], '*')) {
      if (isId(toks[j + 1], 'as') && isId(toks[j + 2])) names.add(toks[j + 2].v)
      else complete = false
      continue
    }
    if (isP(toks[j], '{')) {
      for (j++; j < toks.length && !isP(toks[j], '}'); j++) {
        if (!isId(toks[j])) continue
        if (isId(toks[j + 1], 'as')) { names.add(toks[j + 2].v); j += 2 } else names.add(toks[j].v)
      }
      continue
    }
    if (isId(toks[j], 'async')) j++
    if (isId(toks[j]) && ['const', 'let', 'var', 'function', 'class'].includes(toks[j].v)) {
      let n = toks[j + 1]
      if (isP(n, '*')) n = toks[j + 2] // function*
      if (isId(n)) { names.add(n.v); defined.add(n.v) }
    }
  }
  return { names: complete ? names : null, defined }
}

/** Resolve a relative specifier against a repo-relative importer. */
const resolveSpec = (fromRel, spec) => posix.normalize(posix.join(posix.dirname(fromRel), spec))
const isRelative = (spec) => spec.startsWith('./') || spec.startsWith('../')
const inDir = (rel, dir) => rel === dir || rel.startsWith(dir + '/')
/** The opt-in entry folder a source file belongs to: 'src/drawings' for anything under it. */
const folderOf = (rel) => rel.split('/').slice(0, 2).join('/')

/** Every relative specifier of one file that lands in any of `dirs`. */
function reaches(src, rel, dirs) {
  return parseImports(src)
    .filter((im) => im.spec && isRelative(im.spec) && dirs.some((d) => inDir(resolveSpec(rel, im.spec), d)))
    .map((im) => `${where(rel, im.tok)} imports '${im.spec}'`)
}

/** Rule 1 on one file: every specifier that lands in an opt-in entry. */
const coreReachesDrawings = (src, rel) => reaches(src, rel, OPT_IN.map((e) => e.dir))

/**
 * Rule 2 on one file of an opt-in entry (the folder is read off `rel`).
 * `coreExports` is parseExports() of the core entry, used to catch an import
 * of a name the core does not export (Rollup only warns about that, and the
 * binding is then undefined).
 */
function drawingsBoundaryViolations(src, rel, coreExports, exists = () => true) {
  const folder = folderOf(rel)
  const inDrawings = (target) => inDir(target, folder)
  const bad = []
  const typings = /\.d\.ts$/.test(rel)
  for (const im of parseImports(src)) {
    const at = where(rel, im.tok)
    if (im.kind === 'meta') { bad.push(`${at}: import.meta has no meaning in the UMD build`); continue }
    // In a .d.ts, import('…') is a type reference, not a chunk; check its path.
    if (im.kind === 'dynamic' && !(typings && im.spec)) {
      bad.push(`${at}: import(${im.spec ? `'${im.spec}'` : '…'}) splits the build into chunks/ — import statically`)
      continue
    }
    const spec = im.spec
    if (!isRelative(spec)) { bad.push(`${at}: '${spec}' is a dependency — ${folder} has none`); continue }
    const target = resolveSpec(rel, spec)
    if (ALLOWED_CORE_SPECIFIERS.includes(spec) && target !== CORE_ENTRY) {
      const depth = rel.split('/').length - 2 // folders below src/
      bad.push(`${at}: '${spec}' resolves to ${target} from here — the core entry is '${'../'.repeat(depth)}chart/index.js'`)
      continue
    }
    if (inDrawings(target)) {
      if (!/\.js$/.test(spec)) bad.push(`${at}: '${spec}' needs its .js extension (vendored copies run as plain ESM)`)
      else if (!typings && !exists(target)) bad.push(`${at}: '${spec}' resolves to ${target}, which does not exist`)
      continue
    }
    if (!ALLOWED_CORE_SPECIFIERS.includes(spec)) {
      bad.push(`${at}: '${spec}' leaves ${folder} — only ${ALLOWED_CORE_SPECIFIERS.map((s) => `'${s}'`).join(' or ')} may`)
      continue
    }
    if (im.namespace) { bad.push(`${at}: namespace ${im.kind === 'reexport-all' ? 're-export' : 'import'} of the core — import names`); continue }
    if (im.kind === 'side-effect') { bad.push(`${at}: side-effect import of the core — import names`); continue }
    if (im.isDefault) { bad.push(`${at}: default import of the core, which has no default export`); continue }
    if (!typings && coreExports && coreExports.names) {
      for (const { imported } of im.names) {
        if (!coreExports.names.has(imported)) bad.push(`${at}: the core entry does not export '${imported}'`)
      }
    }
  }
  return bad
}

// ============================================================ the checker bites

test('the global scan ignores comments, strings, regexes and property names', () => {
  const src = [
    '// window.x = 1',
    '/* document.title */',
    "const a = 'navigator'",
    'const b = "matchMedia(x)"',
    'const r = /window|document/g',
    'const o = { window: 1, document: 2 }',
    'const p = obj.window',
    'const q = typeof HTMLElement === "function"',
  ].join('\n')
  assert.deepEqual(moduleScopeGlobals(src), [])
})

test('the global scan skips function bodies, arrow bodies and default parameters', () => {
  const src = [
    'export function f() { return window.innerWidth }',
    'const g = () => document.body',
    'const h = (m = matchMedia) => m',
    'function k(a = navigator) { return a }',
    'const o = { m() { return requestAnimationFrame }, get w() { return window } }',
    'class A { get w() { return HTMLElement } static make() { return document } }',
    'export default function () { return window }',
    'const x = 1',
  ].join('\n')
  assert.deepEqual(moduleScopeGlobals(src), [])
})

test('the global scan catches module-scope reads, including inside top-level blocks', () => {
  const found = (src) => moduleScopeGlobals(src).map((h) => h.name)
  assert.deepEqual(found('const dpr = window.devicePixelRatio'), ['window'])
  assert.deepEqual(found("if (typeof window !== 'undefined') { window.x = 1 }"), ['window'])
  assert.deepEqual(found('const t = `${document.title}`'), ['document'])
  assert.deepEqual(found('const bad = typeof window.matchMedia'), ['window'])
  assert.deepEqual(found('const n = a / navigator / b'), ['navigator'], 'a division is not a regex')
  assert.deepEqual(found('const f = () => 1\nrequestAnimationFrame(f)'), ['requestAnimationFrame'])
  assert.deepEqual(found('for (const k of [1]) { matchMedia(k) }'), ['matchMedia'])
  assert.deepEqual(found('try { HTMLElement } catch (e) {}'), ['HTMLElement'])
  assert.deepEqual(found('const o = { w: window }'), ['window'])
  assert.deepEqual(moduleScopeGlobals('\n\n  x(document)', 'src/drawings/x.js')[0].at, 'src/drawings/x.js:3:5')
})

test('the API scan catches what ES2019 cannot lower, and nothing that merely looks like it', () => {
  const names = (src) => forbiddenApis(src).map((h) => h.name)
  assert.deepEqual(names('const last = a.at(-1)'), ['at'])
  assert.deepEqual(names('class A { #x = 1; m() { return this.#x } }'), ['#x', '#x'])
  assert.deepEqual(names('Object.hasOwn(o, k)'), ['hasOwn'])
  assert.deepEqual(names("s.replaceAll('a', 'b')"), ['replaceAll'])
  assert.deepEqual(names('this._store.replaceAll(snapshot); store.replaceAll([])'), [], 'DrawingStore.replaceAll is ours')
  assert.deepEqual(names("this.label.replaceAll('a', 'b')"), ['replaceAll'])
  assert.deepEqual(names('function p(ctx) { ctx.roundRect(0, 0, 1, 1, 2) }'), ['roundRect'])
  assert.deepEqual(names('const p = new Path2D()'), ['Path2D'])
  assert.deepEqual(names('const id = crypto.randomUUID()'), ['randomUUID'])
  assert.deepEqual(names('const c = structuredClone(x)'), ['structuredClone'])
  assert.deepEqual(names('const f = a.findLast((x) => x)'), ['findLast'])
  assert.deepEqual(names('const r = /a/d'), ['d'])
  assert.deepEqual(names('const k = o.constructor; o.hasOwnProperty(k); String(o.toString())'), [], 'inherited names are not banned')
  assert.deepEqual(names('const m = await load()'), ['await'])

  assert.deepEqual(names([
    "import { roundRect } from './paint.js'",
    "import * as paint from './paint.js'",
    'function p(ctx) { roundRect(ctx, 0, 0, 1, 1, 2); paint.roundRect(ctx, 0, 0, 1, 1, 2) }',
    "const color = '#fff'",
    '// a.at(0), Object.hasOwn, structuredClone',
    'const o = { at: 1, Path2D: 2 }',
    'const t = o.at',
    'async function f() { for await (const x of y) await x }',
    'const r = /[/]#x/g',
  ].join('\n')), [])
})

test('the import parser sees every way out of a module', () => {
  const ims = parseImports([
    "import { Smoothed, version as coreVersion } from '../chart/index.js'",
    "import * as core from '../chart/index.js'",
    "import Core from '../chart/index.js'",
    "import '../chart/index.js'",
    "export * from '../chart/index.js'",
    "export { DASH as dash } from '../../chart/index.js'",
    "const lazy = () => import('./textEditor.js')",
    'const u = import.meta.url',
    "import {\n  a,\n  b as c,\n} from './multi.js'",
    "const s = 'import x from \"./nope.js\"'",
  ].join('\n'))
  assert.deepEqual(ims.map((m) => [m.kind, m.spec]), [
    ['static', '../chart/index.js'],
    ['static', '../chart/index.js'],
    ['static', '../chart/index.js'],
    ['side-effect', '../chart/index.js'],
    ['reexport-all', '../chart/index.js'],
    ['reexport', '../../chart/index.js'],
    ['dynamic', './textEditor.js'],
    ['meta', null],
    ['static', './multi.js'],
  ])
  assert.deepEqual(ims[0].names, [{ imported: 'Smoothed', local: 'Smoothed' }, { imported: 'version', local: 'coreVersion' }])
  assert.equal(ims[1].namespace, true)
  assert.equal(ims[2].isDefault, true)
  assert.deepEqual(ims[8].names.map((n) => n.local), ['a', 'c'])
})

test('the boundary check rejects every forbidden way to reach the core', () => {
  const core = parseExports("export { Smoothed } from './motion/Tween.js'\nexport const version = '1'")
  const files = new Set(['src/drawings/index.js', 'src/drawings/render/motion.js', 'src/drawings/model/time.js'])
  const check = (rel, src) => drawingsBoundaryViolations(src, rel, core, (f) => files.has(f))
  assert.deepEqual(check('src/drawings/index.js', "import { version, Smoothed } from '../chart/index.js'"), [])
  assert.deepEqual(check('src/drawings/render/motion.js', "import { Smoothed } from '../../chart/index.js'"), [])

  const one = (rel, src, pattern) => {
    const bad = check(rel, src)
    assert.equal(bad.length, 1, `${src} -> ${JSON.stringify(bad)}`)
    assert.match(bad[0], pattern)
  }
  one('src/drawings/index.js', "import { Smoothed } from '../chart/motion/Tween.js'", /leaves src\/drawings/)
  one('src/drawings/model/time.js', "import { toNumber } from '../chart/index.js'", /resolves to src\/drawings\/chart\/index\.js .* '\.\.\/\.\.\/chart\/index\.js'/)
  one('src/drawings/index.js', "import { toNumber } from '../../chart/index.js'", /resolves to chart\/index\.js .* '\.\.\/chart\/index\.js'/)
  one('src/drawings/index.js', "import { x } from './model/missing.js'", /does not exist/)
  one('src/drawings/index.js', "import * as core from '../chart/index.js'", /namespace/)
  one('src/drawings/index.js', "export * from '../chart/index.js'", /namespace/)
  one('src/drawings/index.js', "import Core from '../chart/index.js'", /default import/)
  one('src/drawings/index.js', "import '../chart/index.js'", /side-effect/)
  one('src/drawings/index.js', "import { Nope } from '../chart/index.js'", /does not export 'Nope'/)
  one('src/drawings/index.js', "import React from 'react'", /dependency/)
  one('src/drawings/index.js', "import { x } from './model/time'", /\.js extension/)
  one('src/drawings/index.js', "const m = () => import('./textEditor.js')", /chunks/)
  one('src/drawings/index.js', "import { a } from '../adapters/react/index.js'", /leaves src\/drawings/)

  assert.deepEqual(coreReachesDrawings("import { enableDrawings } from '../../drawings/index.js'", 'src/chart/core/Chart.js').length, 1)
  assert.deepEqual(coreReachesDrawings("import { Tween } from '../motion/Tween.js'", 'src/chart/core/Chart.js'), [])
})

test('the boundary check holds for every opt-in entry, and keeps the entries apart', () => {
  const core = parseExports("export { isLight } from './core/color.js'\nexport const version = '1'")
  const files = new Set(['src/profiles/index.js', 'src/profiles/valueArea.js', 'src/drawings/index.js'])
  const check = (rel, src) => drawingsBoundaryViolations(src, rel, core, (f) => files.has(f))
  assert.deepEqual(check('src/profiles/index.js', "import { version, isLight } from '../chart/index.js'"), [])
  assert.deepEqual(check('src/profiles/index.js', "import { computeValueArea } from './valueArea.js'"), [])

  const one = (rel, src, pattern) => {
    const bad = check(rel, src)
    assert.equal(bad.length, 1, `${src} -> ${JSON.stringify(bad)}`)
    assert.match(bad[0], pattern)
  }
  one('src/profiles/index.js', "import { timeToIndex } from '../chart/core/time.js'", /leaves src\/profiles/)
  one('src/profiles/index.js', "import { timeToIndex } from '../drawings/index.js'", /leaves src\/profiles/)
  one('src/drawings/index.js', "import { computeValueArea } from '../profiles/index.js'", /leaves src\/drawings/)
  one('src/profiles/index.js', "import { binSessions } from '../components/profileData.js'", /leaves src\/profiles/)
  one('src/profiles/index.js', "import { Nope } from '../chart/index.js'", /does not export 'Nope'/)
  one('src/profiles/index.js', "import React from 'react'", /src\/profiles has none/)

  assert.equal(coreReachesDrawings("import { createVolumeProfile } from '../../profiles/index.js'", 'src/chart/core/Chart.js').length, 1,
    'the core reaching into profiles is rule 1 too')
  assert.equal(reaches("import { binSessions } from '../components/profileData.js'", 'src/profiles/index.js', DEMO).length, 1)
  assert.equal(reaches("import { Demo } from '../../pages/Landing.jsx'", 'src/adapters/react/index.js', DEMO).length, 1)
  assert.deepEqual(reaches("import { BRAND_PATHS } from '../../brand.js'", 'src/chart/render/watermark.js', DEMO), [], 'brand.js ships with the core')
})

// ============================================================ the real tree

const chartFiles = listFiles('src/chart', isSource)
const adapterFiles = listFiles('src/adapters', isSource)
/** Each opt-in entry with its sources listed. */
const ENTRIES = OPT_IN.map((e) => ({
  ...e,
  js: listFiles(e.dir, isJs),
  typings: listFiles(e.dir, (n) => /\.d\.ts$/.test(n)),
}))

test('rule 1: nothing under src/chart imports anything under an opt-in entry', () => {
  assert.ok(chartFiles.length > 10, `expected the core's sources, found ${chartFiles.length}`)
  const bad = chartFiles.flatMap((rel) => coreReachesDrawings(readRel(rel), rel))
  assert.deepEqual(bad, [], 'the core must not know drawings or profiles exist')
})

test('rule 7: nothing that ships imports the demo site', () => {
  const shipped = [...chartFiles, ...adapterFiles, ...ENTRIES.flatMap((e) => [...e.js, ...e.typings])]
  assert.ok(adapterFiles.length >= 2, `expected the adapters' sources, found ${adapterFiles.length}`)
  const bad = shipped.flatMap((rel) => reaches(readRel(rel), rel, DEMO))
  assert.deepEqual(bad, [], 'a demo helper (a data generator, a binning function) must never leak into the package')
})

for (const { dir, entry, js, typings } of ENTRIES) {
  test(`rule 2: ${dir} leaves its folder only through the core entry, by name`, () => {
    assert.ok(js.length > 0, `expected sources under ${dir}`)
    const coreExports = parseExports(readRel(CORE_ENTRY))
    assert.ok(coreExports.names && coreExports.names.has('createChart'), 'the core entry parsed')
    const exists = (rel) => existsSync(join(ROOT, rel))
    const bad = [...js, ...typings]
      .flatMap((rel) => drawingsBoundaryViolations(readRel(rel), rel, coreExports, exists))
    assert.deepEqual(bad, [])
  })

  test(`rule 3: ${entry} binds version, a value defined in the core entry`, () => {
    const src = readRel(entry)
    const fromCore = parseImports(src).filter((im) => im.spec === '../chart/index.js' && im.kind === 'static')
    const binding = fromCore.flatMap((im) => im.names).find((n) => n.imported === 'version')
    assert.ok(binding,
      `${entry} must import { version } from '../chart/index.js'. Importing only re-exports ` +
      '(Smoothed, Tween, …) makes Rollup hoist the shared core modules into chunks/.')

    // It has to be DEFINED there. If the core's version ever became a
    // re-export, the binding would stop anchoring the core to one file.
    const core = parseExports(readRel(CORE_ENTRY))
    assert.ok(core.defined.has('version'), `${CORE_ENTRY} must define \`version\` itself, not re-export it`)

    // The binding is used (the compatibility warning), so no tool drops it as dead.
    const uses = tokenize(src).filter((t) => t.t === 'id' && t.v === binding.local).length
    assert.ok(uses >= 2, `${binding.local} is imported but never used`)

    // And the reason is written down where the next person would delete it:
    // the comment block directly above the import statement.
    const statement = fromCore.find((im) => im.names.includes(binding))
    const lines = src.slice(0, src.lastIndexOf('\n', statement.tok.i) + 1).split('\n').slice(0, -1)
    const comment = []
    while (lines.length && /^\s*(\/\/|\/\*|\*)/.test(lines[lines.length - 1])) comment.unshift(lines.pop())
    const above = comment.join('\n')
    assert.match(above, /rollup/i, 'the comment above the import names Rollup')
    assert.match(above, /chunk/i, 'the comment above the import names the chunk split it prevents')
  })

  test(`rule 4: no module-scope browser globals anywhere in ${dir}`, () => {
    const bad = js.flatMap((rel) => moduleScopeGlobals(readRel(rel), rel).map((h) => `${h.at} ${h.name}`))
    assert.deepEqual(bad, [], 'browser globals may be read only inside functions (SSR imports every module)')
  })

  test(`rule 5: nothing in ${dir} needs more than the ES2019 target`, () => {
    const bad = js.flatMap((rel) => forbiddenApis(readRel(rel), rel).map((h) => `${h.at} ${h.name}: ${h.why}`))
    assert.deepEqual(bad, [])
  })
}

// ------------------------------------------------------ rule 4, dynamically

/**
 * Import with no DOM at all. installDom() is never called in this file, and
 * Node 21+ defines a global `navigator`, which SSR hosts on Node 18/20 and
 * other runtimes do not have: it is hidden for the duration.
 */
async function withoutDom(fn) {
  for (const name of BROWSER_GLOBALS) {
    if (name !== 'navigator') assert.equal(typeof globalThis[name], 'undefined', `${name} is defined before the import`)
  }
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  if (nav && nav.configurable) delete globalThis.navigator
  try {
    return await fn()
  } finally {
    if (nav && nav.configurable) Object.defineProperty(globalThis, 'navigator', nav)
  }
}

const importRel = (rel) => import(pathToFileURL(join(ROOT, rel)).href)

for (const { dir, entry, creates, js } of ENTRIES) {
  test(`rule 4: every module under ${dir} imports with no DOM and defines no browser global`, async () => {
    await withoutDom(async () => {
      for (const rel of js) {
        await assert.doesNotReject(importRel(rel), `${rel} threw while being imported without a DOM`)
      }
      for (const name of ['window', 'document', 'matchMedia', 'requestAnimationFrame', 'HTMLElement']) {
        assert.equal(typeof globalThis[name], 'undefined', `importing ${dir} defined a global ${name}`)
      }
    })
  })

  test(`rule 4: ${entry} imports under SSR and carries the core's version`, async () => {
    await withoutDom(async () => {
      const mod = await importRel(entry)
      assert.equal(typeof mod[creates], 'function')
      // One tree, one release: an entry and a core that disagree here would
      // print the vendoring-mismatch warning on every page of a fresh install.
      const core = await importRel(CORE_ENTRY)
      assert.equal(mod.version, core.version, `${entry} and src/chart/index.js must carry the same version`)
    })
  })
}

test('rule 4: normalizeDrawings is pure under SSR', async () => {
  await withoutDom(async () => {
    const dr = await importRel(DRAWINGS_ENTRY)
    assert.equal(typeof dr.createDrawings, 'function')
    // The same call the CI SSR step makes against the built package.
    const r = dr.normalizeDrawings([{ type: 'trendLine', points: [{ time: 1, price: '2' }, { time: 2, price: 3 }] }])
    assert.equal(r.drawings.length, 1)
    assert.equal(r.report.loaded, 1)
    assert.equal(r.drawings.length, r.report.loaded + r.report.carried.length)
  })
})

test('rule 4: computeValueArea is pure under SSR', async () => {
  await withoutDom(async () => {
    const pr = await importRel(PROFILES_ENTRY)
    // A host's server computes profiles; it can check them with the same function the chart draws by.
    assert.deepEqual(pr.computeValueArea([1, 4, 9, 5, 1], 100, 0.5), { poc: 101.25, vah: 102.5, val: 101 })
  })
})
