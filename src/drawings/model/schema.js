/**
 * Drawing schema v1 — normalisation, identity and the stored form.
 *
 * Every drawing that reaches the store has come through here, and every row a
 * host saves has gone out through toJSON(). The two directions are written
 * against the same hazard: a host that saves on every change (Traed stores one
 * row per drawing) will write back whatever we hand it, so anything we fail to
 * read, drop, or quietly default is data the host loses for good.
 *
 * Hence the shape of the rules:
 *
 * - LOADS REPORT, PROGRAMMER CALLS THROW. setDrawings() is reading stored data
 *   that may be old, hand-edited or written by a newer build; one bad row must
 *   not cost the other 400, so each drawing is normalised in isolation and the
 *   outcome lands in a LoadReport. add() and update() are code the host is
 *   writing right now, so the same problems throw with the same reason text.
 * - NEWER DATA IS CARRIED, NEVER DESTROYED. An unknown type or a newer `v` is
 *   kept inert and verbatim; unknown keys inside a known drawing ride along in
 *   an `extra` bag and are re-emitted on every write.
 * - DRAWINGS ARE IMMUTABLE. Normalised drawings are deep-frozen, so an edit is
 *   a new object, identity is a change detector, and an undo entry can hold
 *   plain references.
 *
 * Pure: no DOM, no chart. A Node backend validates stored rows with this code.
 */
import { toNumber, DASH } from '../../chart/index.js'

export const SCHEMA_VERSION = 1

/** An id longer than this is a bug or an attack, not an identifier. */
const MAX_ID = 128
/** Longer than any CSS colour a person writes; bounds what a row can make us store. */
const MAX_COLOR = 64
/** Cap on carried unknown keys per drawing, measured as JSON. */
const MAX_EXTRA = 16384
const DEFAULT_MAX_DRAWINGS = 5000
/** 36^4: four base36 digits of randomness in generated ids. */
const RANDOM_SPAN = 1679616

const TOP_KEYS = new Set(['v', 'id', 'type', 'pane', 'points', 'style', 'options', 'locked', 'visible', 'z', 'meta'])
const STYLE_KEYS = new Set(['color', 'lineWidth', 'lineStyle', 'fill', 'fillOpacity', 'textColor', 'fontSize'])
const LINE_STYLES = new Set(Object.keys(DASH))
const UNPATCHABLE = ['id', 'type', 'v']

/**
 * The floor under a tool's own defaultStyle. A custom ToolDef that omits a key
 * still yields a complete style, so the renderer never reads undefined.
 */
const BASE_STYLE = {
  color: null,
  lineWidth: 1,
  lineStyle: 'solid',
  fill: null,
  fillOpacity: 0.12,
  textColor: null,
  fontSize: 12,
}

const NO_KEYS = Object.freeze({})

// ------------------------------------------------------------------ helpers

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * Reads only OWN properties. The input is a JSON clone, so an inherited value
 * can only come from a polluted Object.prototype — which must not be able to
 * inject a `points` or `style` into every drawing that omits one.
 */
const pick = (o, k) => (own(o, k) ? o[k] : undefined)

const isPlainObject = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)

/**
 * The one clone every boundary goes through. It also turns whatever the host
 * handed us — class instances, getters, Dates — into plain data, so nothing
 * downstream can be surprised by a live object. `undefined` in, `undefined`
 * out (JSON.stringify returns it for functions and undefined).
 */
function cloneJSON(v) {
  const s = JSON.stringify(v)
  return s === undefined ? undefined : JSON.parse(s)
}

/**
 * Defines an own data property. Never `o[k] = v`: for k === '__proto__' that
 * is a prototype SWAP, not a key, so a row carrying a "__proto__" key would
 * rewire the object on the way in and vanish on the way out.
 */
function defineOwn(o, k, v) {
  Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true })
}

/**
 * JSON.stringify throws a TypeError for a cycle or a BigInt; anything else it
 * throws came out of the host's own code — a getter, a toJSON, a Proxy trap.
 */
function unreadable(err) {
  return err instanceof TypeError && /circular|BigInt/i.test(err.message)
    ? 'not serialisable'
    : 'threw while reading'
}

/** Marks an input item whose clone already failed, so pass 2 can report it. */
class Unreadable {
  constructor(reason) {
    this.reason = reason
  }
}

export function emptyReport() {
  return { loaded: 0, carried: [], rejected: [], renamed: [], truncated: [], orphaned: [] }
}

function reject(report, index, id, reason) {
  report.rejected.push(id == null ? { index, reason } : { index, id, reason })
  return null
}

/** One drawing can be truncated twice (points and extras); report it once. */
function markTruncated(report, id) {
  if (report.truncated[report.truncated.length - 1] !== id) report.truncated.push(id)
}

/**
 * Recursively freezes an object graph. Own property NAMES, not keys, so the
 * non-enumerable `extra` bag is frozen too. An already-frozen node is not
 * walked again: everything this module freezes is frozen whole, and it keeps
 * the walk finite on a structure that points back at itself.
 */
export function deepFreeze(o) {
  if (o === null || typeof o !== 'object' || Object.isFrozen(o)) return o
  Object.freeze(o)
  const names = Object.getOwnPropertyNames(o)
  for (let i = 0; i < names.length; i++) deepFreeze(o[names[i]])
  return o
}

// ------------------------------------------------------------------ ids

/** A string of 1–128 characters, or a finite number; anything else is no id. */
function explicitId(raw) {
  const id = pick(raw, 'id')
  if (typeof id === 'string') return id.length > 0 && id.length <= MAX_ID ? id : null
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  return null
}

function idPart(v, round) {
  const n = toNumber(v)
  if (Number.isNaN(n)) return ''
  return String(round ? Math.round(n) || 0 : n)
}

/**
 * The id of a drawing stored without one: `type:time:price` of its first
 * point. Derived from the drawing itself, never from its position in the
 * array, so loading the same rows twice — or on two devices — yields the same
 * ids, and an id a host captured stays valid. The coerced values are used, so
 * `"1700"` and `1700` derive the same id. Capped at the id length limit so the
 * id stays valid when it is written back and read again.
 */
export function derivedId(type, p0) {
  const pt = isPlainObject(p0) ? p0 : NO_KEYS
  const id = `${type}:${idPart(pick(pt, 'time'), true)}:${idPart(pick(pt, 'price'), false)}`
  return id.length > MAX_ID ? id.slice(0, MAX_ID) : id
}

/**
 * Pass 1 of the de-duplication: every explicit id is reserved by its FIRST
 * occurrence before any drawing is renamed. Without this pass a renamed
 * duplicate could take `a:1` from a later row that was literally stored as
 * `a:1`, and the host's `a:1` row would come back holding someone else's
 * drawing.
 */
function reserveExplicit(raw, index, reserved) {
  if (!isPlainObject(raw) || raw instanceof Unreadable) return
  const id = explicitId(raw)
  if (id !== null && !reserved.has(id)) reserved.set(id, index)
}

/**
 * Pass 2: claim `id` for `index`, or the first free `id:n`. A rename that
 * would push the id past the length limit trims the stem, not the suffix, so
 * the result is still a valid id on the next load.
 */
function dedupe(id, reserved, index, report) {
  if (!reserved.has(id)) {
    reserved.set(id, index)
    return id
  }
  let n = 1
  let to = ''
  do {
    const suffix = ':' + n++
    to = id.length + suffix.length > MAX_ID ? id.slice(0, MAX_ID - suffix.length) + suffix : id + suffix
  } while (reserved.has(to))
  reserved.set(to, index)
  report.renamed.push({ index, from: id, to })
  return to
}

/**
 * Ids for interactively created drawings: 'd' + base36(now) + base36(counter)
 * + four base36 random digits. The counter makes ids from one factory unique
 * even when the clock stands still or steps back; the clock and the random
 * digits keep two tabs (or two devices) from minting the same id for the same
 * host table. Both sources are injectable so tests are deterministic.
 */
export function makeIdFactory(rand, now) {
  const random = typeof rand === 'function' ? rand : Math.random
  const clock = typeof now === 'function' ? now : Date.now
  let counter = 0
  return function nextId() {
    const t = Math.floor(clock())
    const x = random()
    const r = x >= 0 && x < 1 ? Math.floor(x * RANDOM_SPAN) : 0
    const stamp = Number.isFinite(t) && t >= 0 ? t.toString(36) : '0'
    return 'd' + stamp + (counter++).toString(36) + ('000' + r.toString(36)).slice(-4)
  }
}

// ------------------------------------------------------------------ points

/**
 * A point is finite in every field it has. Used by the programmer paths,
 * which refuse what a load would quietly repair: a NaN offset is dropped on
 * load, but from add()/update() it is a bug the caller needs to see.
 */
function finitePoint(pt) {
  if (!isPlainObject(pt)) return false
  if (!Number.isFinite(toNumber(pt.time)) || !Number.isFinite(toNumber(pt.price))) return false
  if (pt.offset !== undefined && !Number.isFinite(toNumber(pt.offset))) return false
  return pt.tf === undefined || Number.isFinite(toNumber(pt.tf))
}

/**
 * The inputs are JSON clones, where NaN and Infinity have already become
 * null — so this sees a caller's NaN as a null field and refuses it, and NaN
 * can never reach the store (nor serialise as null for the next load to reject).
 */
function assertPoint(pt) {
  if (!finitePoint(pt)) throw new Error('bad point')
}

/**
 * The first `count` points, coerced. null when any of them is unusable.
 *
 * toNumber, never unary plus: +null is 0, and a point with a null time would
 * otherwise be pinned to 1 January 1970 — drawn fifty years off-screen and
 * saved back that way. Numeric strings are accepted, as they are for bars.
 * `offset` and `tf` are optional and independent: an offset that is zero or
 * unreadable is simply absent, and so is a tf that is not a positive number
 * (an offset without tf is read in the current timeframe).
 */
function readPoints(list, count) {
  const out = []
  for (let i = 0; i < count; i++) {
    const p = list[i]
    if (!isPlainObject(p)) return null
    const time = toNumber(p.time)
    const price = toNumber(p.price)
    if (Number.isNaN(time) || Number.isNaN(price)) return null
    // `|| 0` so Math.round(-0.4) stores 0, not -0: the two differ under
    // Object.is, and a round trip through JSON would change the drawing.
    const pt = { time: Math.round(time) || 0, price }
    const offset = toNumber(p.offset)
    if (offset !== 0 && Number.isFinite(offset)) pt.offset = offset
    const tf = toNumber(p.tf)
    if (tf > 0) pt.tf = tf
    out.push(pt)
  }
  return out
}

/**
 * Cross-point invariants belong to the tool (position: the stop shares the
 * target's time). They run after per-point coercion on EVERY path that makes
 * points — load, add and every patch — so no path can store a drawing the
 * tool would not accept. The tool's output is coerced again, so a buggy
 * normalizePoints still cannot store NaN or the wrong count.
 */
function finishPoints(tool, points) {
  if (tool.normalizePoints) points = tool.normalizePoints(points)
  const out = Array.isArray(points) && points.length === tool.anchors ? readPoints(points, tool.anchors) : null
  if (!out) throw new Error('bad point')
  return out
}

function copyPoint(p) {
  const out = { time: p.time, price: p.price }
  if (p.offset !== undefined) out.offset = p.offset
  if (p.tf !== undefined) out.tf = p.tf
  return out
}

// ------------------------------------------------------------------ style and options

function colorOr(v, fallback) {
  if (v === null) return null
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_COLOR ? v : fallback
}

function clampOr(v, lo, hi, fallback) {
  const n = toNumber(v)
  if (Number.isNaN(n)) return fallback
  return n < lo ? lo : n > hi ? hi : n
}

/** Known style keys only, each clamped to what the renderer can draw. */
function readStyle(src, base) {
  const lineStyle = pick(src, 'lineStyle')
  return {
    color: colorOr(pick(src, 'color'), base.color),
    lineWidth: clampOr(pick(src, 'lineWidth'), 0.5, 8, base.lineWidth),
    lineStyle: typeof lineStyle === 'string' && LINE_STYLES.has(lineStyle) ? lineStyle : base.lineStyle,
    fill: colorOr(pick(src, 'fill'), base.fill),
    fillOpacity: clampOr(pick(src, 'fillOpacity'), 0, 1, base.fillOpacity),
    textColor: colorOr(pick(src, 'textColor'), base.textColor),
    fontSize: clampOr(pick(src, 'fontSize'), 9, 32, base.fontSize),
  }
}

/** A tool's defaultStyle, sanitised the same way a stored style is. */
function styleDefaults(tool) {
  const s = tool.defaultStyle
  return readStyle(isPlainObject(s) ? s : NO_KEYS, BASE_STYLE)
}

/**
 * The tool builds a NEW object from its known keys, so `__proto__`,
 * `constructor` and friends can never reach `options`. The result is cloned so
 * that freezing the drawing can never freeze a default array the tool shares
 * between drawings (fib `levels`). A tool without normalizeOptions keeps its
 * defaults, overridden by stored values of the same type.
 */
function readOptions(tool, src) {
  let out
  if (typeof tool.normalizeOptions === 'function') {
    out = tool.normalizeOptions(src)
  } else {
    const defaults = isPlainObject(tool.defaultOptions) ? tool.defaultOptions : NO_KEYS
    out = {}
    for (const k of Object.keys(defaults)) {
      const v = pick(src, k)
      defineOwn(out, k, v !== undefined && typeof v === typeof defaults[k] ? v : defaults[k])
    }
  }
  out = cloneJSON(out)
  if (!isPlainObject(out)) throw new Error('bad options')
  return out
}

// ------------------------------------------------------------------ carried keys

/** The own keys of `src` that `known` does not list, or null when there are none. */
function bagOf(src, known) {
  let bag = null
  const keys = Object.keys(src)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (known.has(k)) continue
    if (!bag) bag = {}
    defineOwn(bag, k, src[k])
  }
  return bag
}

/** Re-emits carried keys after the known ones, cloned so the caller may mutate them. */
function emitExtra(out, bag) {
  if (!bag) return
  const keys = Object.keys(bag)
  for (let i = 0; i < keys.length; i++) defineOwn(out, keys[i], cloneJSON(bag[keys[i]]))
}

// ------------------------------------------------------------------ normalisation

/**
 * An unknown type or a newer `v`: kept verbatim, never drawn, hit or edited,
 * and written back exactly as it came — apart from `id` and `z`, which are
 * filled in (or replaced by a de-duplicated id) so every row a host gets back
 * is addressable and orderable, and a second load reproduces the first.
 */
function carry(raw, index, report) {
  const z = toNumber(pick(raw, 'z'))
  if (Number.isNaN(z)) raw.z = index
  report.carried.push(raw.id)
  return deepFreeze({ inert: true, id: raw.id, z: Number.isNaN(z) ? index : z, raw })
}

/**
 * Normalise one stored drawing. Returns the frozen drawing, an inert wrapper,
 * or null after recording the rejection in `ctx.report`.
 *
 * `ctx.reserved` maps id -> the index that owns it (normalizeEntries fills it
 * with pass 1); `ctx.forcedId` skips de-duplication for the programmer paths,
 * which pick their own id; `ctx.strict` makes over-long carried keys throw
 * instead of being dropped.
 */
export function normalizeDrawing(input, index, registry, ctx) {
  const report = ctx.report
  const reserved = ctx.reserved || new Map()
  let raw
  try {
    raw = cloneJSON(input)
  } catch (err) {
    return reject(report, index, null, unreadable(err))
  }
  if (!isPlainObject(raw)) return reject(report, index, null, 'not an object')

  const v = own(raw, 'v') ? raw.v : 1
  const rawType = pick(raw, 'type')
  const type = rawType == null ? '' : typeof rawType === 'string' ? rawType : String(rawType)
  const explicit = explicitId(raw)
  const points0 = pick(raw, 'points')
  let id = ctx.forcedId || explicit || derivedId(type, Array.isArray(points0) ? points0[0] : null)
  if (!ctx.forcedId) {
    if (reserved.get(id) !== index) id = dedupe(id, reserved, index, report)
    const last = report.renamed[report.renamed.length - 1]
    // An id was supplied but is not usable (empty, over-long, an object):
    // say so, or a host looking its row up by that id finds nothing.
    if (!explicit && pick(raw, 'id') != null && !(last && last.index === index)) {
      report.renamed.push({ index, from: null, to: id })
    }
  }
  if (raw.id !== id) raw.id = id

  // A rejected drawing gives its id back, so a later duplicate of it keeps the
  // plain id instead of being renamed around a drawing that does not exist.
  const fail = (reason) => {
    if (reserved.get(id) === index) reserved.delete(id)
    return reject(report, index, explicit, reason)
  }

  if (!(v >= 1 && v <= SCHEMA_VERSION && v === Math.floor(v))) return carry(raw, index, report)
  if (!type) return fail('no type')
  const tool = registry.get(type)
  if (!tool) return carry(raw, index, report)

  const list = points0
  if (!Array.isArray(list)) return fail('bad point')
  if (list.length < tool.anchors) return fail('too few points')
  let points = readPoints(list, tool.anchors)
  if (!points) return fail('bad point')
  if (list.length > tool.anchors) markTruncated(report, id)
  try {
    points = finishPoints(tool, points)
  } catch (err) {
    return fail('bad point')
  }

  const rawStyle = pick(raw, 'style')
  const styleSrc = isPlainObject(rawStyle) ? rawStyle : NO_KEYS
  const style = readStyle(styleSrc, styleDefaults(tool))
  const rawOptions = pick(raw, 'options')
  const optionSrc = isPlainObject(rawOptions) ? rawOptions : NO_KEYS
  let options
  try {
    options = readOptions(tool, optionSrc)
  } catch (err) {
    return fail('bad options')
  }

  const top = bagOf(raw, TOP_KEYS)
  const styleBag = bagOf(styleSrc, STYLE_KEYS)
  const optionBag = bagOf(optionSrc, new Set(Object.keys(options)))
  let extra = top || styleBag || optionBag ? { top, style: styleBag, options: optionBag } : null
  if (extra && JSON.stringify(extra).length > MAX_EXTRA) {
    if (ctx.strict) throw new Error('unknown keys exceed 16 KB')
    extra = null
    markTruncated(report, id)
  }

  // String() first, then the default: a pane of [] stringifies to '', and
  // must land on 'price' now rather than on the next load.
  const pane = pick(raw, 'pane') == null ? '' : String(raw.pane)
  const z = toNumber(pick(raw, 'z'))
  const d = {
    v: SCHEMA_VERSION,
    id,
    type,
    pane: pane || 'price',
    points,
    style,
    options,
    locked: pick(raw, 'locked') === true,
    visible: pick(raw, 'visible') !== false,
    z: Number.isNaN(z) ? index : z,
  }
  // meta is the host's: cloned (by the clone above), stored, never read.
  if (own(raw, 'meta')) d.meta = raw.meta
  // Not enumerable, so a stray JSON.stringify(d) or spread never leaks the
  // bag as a key; toJSON() re-emits its contents explicitly.
  Object.defineProperty(d, 'extra', { value: extra, enumerable: false })
  report.loaded++
  return deepFreeze(d)
}

/** Accepts every documented document shape; anything else is a programmer error. */
function documentOf(input) {
  // A JSON parse failure throws on purpose: a truncated string is a failed
  // read, and loading "nothing" in its place would let a save-on-change host
  // overwrite the stored document with an empty one.
  const doc = typeof input === 'string' ? JSON.parse(input) : input
  if (doc == null) return []
  if (Array.isArray(doc)) return doc
  if (isPlainObject(doc) && Array.isArray(doc.drawings)) return doc.drawings
  throw new TypeError('drawings: expected an array, a JSON string, { drawings: [...] } or null')
}

const byZ = (a, b) => a.z - b.z

/**
 * Normalise a whole stored document: frozen drawings and inert wrappers,
 * stable-sorted by z, plus the LoadReport. Never throws for a bad drawing —
 * only for a document that is not a document (see documentOf).
 *
 * Invariant: loaded + carried.length + rejected.length === input items.
 */
export function normalizeEntries(input, registry, opts) {
  const list = documentOf(input)
  const cap = toNumber(opts && opts.maxDrawings)
  const max = cap >= 0 ? Math.floor(cap) : DEFAULT_MAX_DRAWINGS
  const report = emptyReport()
  const count = list.length
  const n = Math.min(count, max)

  // Clone every item up front: pass 1 must read ids, and reading them from
  // the caller's objects would run hostile getters outside the per-item try.
  const raws = []
  for (let i = 0; i < n; i++) {
    try {
      raws.push(cloneJSON(list[i]))
    } catch (err) {
      raws.push(new Unreadable(unreadable(err)))
    }
  }

  const reserved = new Map()
  for (let i = 0; i < raws.length; i++) reserveExplicit(raws[i], i, reserved)

  const ctx = { reserved, report }
  const entries = []
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i]
    if (raw instanceof Unreadable) {
      reject(report, i, null, raw.reason)
      continue
    }
    // Each drawing in its own try: a custom tool's normalizeOptions that
    // throws costs that one drawing, not the document.
    try {
      const e = normalizeDrawing(raw, i, registry, ctx)
      if (e) entries.push(e)
    } catch (err) {
      reject(report, i, isPlainObject(raw) ? explicitId(raw) : null, 'threw while reading')
    }
  }
  for (let i = n; i < count; i++) report.rejected.push({ index: i, reason: 'limit' })

  // Array#sort is stable (ES2019), so equal z keeps document order.
  entries.sort(byZ)
  return { entries, report }
}

/**
 * The same validation for add(), with the id and a fallback z chosen by the
 * caller (a z in the input wins, so a host re-creating rows keeps its order).
 * Throws the reason a load would have reported, and refuses a non-finite
 * point field that a load would have dropped.
 */
export function normalizeInput(input, registry, id, z) {
  let raw
  try {
    raw = cloneJSON(input)
  } catch (err) {
    throw new Error(unreadable(err))
  }
  if (!isPlainObject(raw)) throw new Error('not an object')
  const forcedId = explicitId({ id })
  if (forcedId === null) throw new Error('bad id')
  const list = pick(raw, 'points')
  if (Array.isArray(list)) for (let i = 0; i < list.length; i++) assertPoint(list[i])
  const report = emptyReport()
  const e = normalizeDrawing(raw, Number.isFinite(z) ? z : 0, registry, {
    reserved: new Map(),
    report,
    forcedId,
    strict: true,
  })
  if (e && !e.inert) return e
  if (e) {
    const v = own(raw, 'v') ? raw.v : 1
    throw new Error(v === SCHEMA_VERSION ? `unknown type "${e.raw.type}"` : `unsupported schema version ${JSON.stringify(v)}`)
  }
  throw new Error(report.rejected[0].reason)
}

/**
 * update()'s merge. `points` is replaced whole (count checked, normalizePoints
 * applied); `style` and `options` merge per key (so fib `levels` is replaced
 * whole); `pane`, `locked`, `visible`, `meta` and `z` are replaced; unknown
 * keys join the carried ones. Carried keys of the original survive: the
 * merge starts from toJSON(d), which re-emits them, and the result is
 * normalised again from scratch — so a patch can never produce a drawing a
 * load would not.
 */
export function applyPatch(d, patch, registry) {
  if (!d || d.inert) throw new Error('cannot patch a carried drawing')
  let p
  try {
    p = cloneJSON(patch)
  } catch (err) {
    throw new Error(unreadable(err))
  }
  if (!isPlainObject(p)) throw new Error('not an object')
  for (const k of UNPATCHABLE) if (own(p, k)) throw new Error(`cannot patch ${k}`)
  const tool = registry.get(d.type)
  if (!tool) throw new Error(`unknown type "${d.type}"`)

  const next = toJSON(d)
  for (const k of Object.keys(p)) {
    const v = p[k]
    if (k === 'style' || k === 'options') {
      if (!isPlainObject(v)) throw new Error(`bad ${k}`)
      for (const kk of Object.keys(v)) defineOwn(next[k], kk, v[kk])
    } else if (k === 'points') {
      if (!Array.isArray(v)) throw new Error('bad point')
      if (v.length < tool.anchors) throw new Error('too few points')
      for (let i = 0; i < v.length; i++) assertPoint(v[i])
      next.points = v
    } else if (k === 'z') {
      if (!Number.isFinite(toNumber(v))) throw new Error('bad z')
      next.z = v
    } else {
      defineOwn(next, k, v)
    }
  }
  const report = emptyReport()
  const e = normalizeDrawing(next, d.z, registry, { reserved: new Map(), report, forcedId: d.id, strict: true })
  if (!e) throw new Error(report.rejected[0].reason)
  return e
}

// ------------------------------------------------------------------ output

/**
 * The stored form: an unfrozen clone, known keys in a fixed order, then the
 * carried keys of the same object. Inert entries come back as their raw row.
 */
export function toJSON(e) {
  if (e.inert) return cloneJSON(e.raw)
  const d = e
  const out = {}
  out.v = d.v
  out.id = d.id
  out.type = d.type
  out.pane = d.pane
  out.points = d.points.map(copyPoint)
  out.style = {
    color: d.style.color,
    lineWidth: d.style.lineWidth,
    lineStyle: d.style.lineStyle,
    fill: d.style.fill,
    fillOpacity: d.style.fillOpacity,
    textColor: d.style.textColor,
    fontSize: d.style.fontSize,
  }
  emitExtra(out.style, d.extra && d.extra.style)
  out.options = cloneJSON(d.options)
  emitExtra(out.options, d.extra && d.extra.options)
  out.locked = d.locked
  out.visible = d.visible
  out.z = d.z
  if (d.meta !== undefined) out.meta = cloneJSON(d.meta)
  emitExtra(out, d.extra && d.extra.top)
  return out
}

/**
 * Deep equality of the stored form, carried keys included — so an update
 * that changes nothing a host would save is recognisably a no-op, and one
 * that changes only a carried key is not.
 */
export function sameDrawing(a, b) {
  if (a === b) return true
  if (!a || !b || !a.inert !== !b.inert) return false
  return JSON.stringify(toJSON(a)) === JSON.stringify(toJSON(b))
}

/**
 * Registry from ToolDefs: type -> the ToolDef itself (it carries anchors,
 * defaultStyle, defaultOptions, normalizeOptions and normalizePoints). A
 * duplicate or malformed def is a programmer error and throws.
 */
export function makeRegistry(tools) {
  const registry = new Map()
  const list = Array.isArray(tools) ? tools : []
  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    if (!t || typeof t.type !== 'string' || !t.type) throw new Error('drawings: a tool needs a type')
    if (!(t.anchors >= 1 && t.anchors <= 3 && t.anchors === Math.floor(t.anchors))) {
      throw new Error(`drawings: tool "${t.type}" needs 1 to 3 anchors`)
    }
    if (registry.has(t.type)) throw new Error(`drawings: tool "${t.type}" is registered twice`)
    registry.set(t.type, t)
  }
  return registry
}
