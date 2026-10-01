/**
 * The profile data contract (version 1), validated and prepared for drawing.
 *
 * A host sends `ProfileData`: one bin `step` and a list of sessions, each a
 * column of volumes over fixed price bins. Emberwick never computes that from
 * bars; it only reads it. This module is where the reading happens: once per
 * setData / upsertSession, never per frame, so the frame only projects.
 *
 * What comes out of normalizeSession is the INTERNAL form: a private copy of
 * the bins, their sum and maximum, and the POC and value area as both prices
 * (for lines and tags) and bin indices (for tinting). The host's own object
 * is kept as `raw` and handed back in the hover payload, untouched.
 */
import { toNumber } from '../chart/index.js'
import { pocIndex, valueAreaBins } from './valueArea.js'

/** The contract version this build reads. */
export const DATA_VERSION = 1

const fail = (msg) => { throw new Error(`emberwick/profiles: ${msg}`) }

const clampInt = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/**
 * `step` of a ProfileData, or a throw. A zero, negative or non-numeric step is
 * a programmer error rather than bad market data: every bin edge is
 * `lo + i * step`, so nothing can be drawn and nothing sensible skipped.
 */
export function checkStep(step) {
  const s = toNumber(step)
  if (!(s > 0 && s < Infinity)) fail(`data.step must be a positive number (got ${String(step)})`)
  return s
}

/**
 * Validate one ProfileSession and build its internal form.
 *
 * Throws for what only a bug produces: `bins` that is not an array, a
 * `start` after its `end` (or either not a time), a `lo` that is not a price.
 * Everything else is repaired or computed: a bin that is not a positive
 * finite number counts as zero, and a missing `poc`, `vah`/`val` or `total`
 * is derived from the bins.
 *
 * @param {object} raw the host's session
 * @param {number} step bin width, already checked
 * @param {string} [where] how the session is named in an error
 */
export function normalizeSession(raw, step, where = 'session') {
  if (!raw || typeof raw !== 'object') fail(`${where} must be an object`)
  const start = toNumber(raw.start)
  const end = toNumber(raw.end)
  // One test for "after" and for NaN: both are a session with no span.
  if (!(start <= end)) fail(`${where}: start must be a time at or before end (got start ${String(raw.start)}, end ${String(raw.end)})`)
  if (!Array.isArray(raw.bins) && !ArrayBuffer.isView(raw.bins)) fail(`${where}: bins must be an array of volumes`)
  const lo = toNumber(raw.lo)
  if (!Number.isFinite(lo)) fail(`${where}: lo must be a price (got ${String(raw.lo)})`)

  // A private copy: the host is free to keep mutating its own array (a live
  // session usually is one), and the frame must never see a half-written bin.
  const n = raw.bins.length
  const bins = new Float64Array(n)
  let sum = 0
  let max = 0
  for (let i = 0; i < n; i++) {
    const v = +raw.bins[i]
    if (v > 0 && v < Infinity) {
      bins[i] = v
      sum += v
      if (v > max) max = v
    }
  }

  const s = {
    raw, start, end, lo, bins, n, max,
    // The host's own total wins: it may know of volume outside the bins it sent.
    total: toNumber(raw.total) > 0 ? toNumber(raw.total) : sum,
    poc: null, pocBin: -1, vah: null, val: null, vaFrom: -1, vaTo: -1,
    developing: !!raw.developing,
    // Resolved against the bar array by the controller (NaN: not yet).
    u0: NaN, u1: NaN,
  }
  if (!(sum > 0)) return s            // nothing traded: bars, POC and value area all absent

  const poc = toNumber(raw.poc)
  if (Number.isFinite(poc)) {
    s.poc = poc
    // The bin the host's POC falls in. The epsilon keeps a POC sent as a bin's
    // exact low edge from landing in the bin below through float division.
    s.pocBin = clampInt(Math.floor((poc - lo) / step + 1e-9), 0, n - 1)
  } else {
    s.pocBin = pocIndex(bins)
    s.poc = lo + (s.pocBin + 0.5) * step
  }

  const vah = toNumber(raw.vah)
  const val = toNumber(raw.val)
  if (Number.isFinite(vah) && Number.isFinite(val) && vah >= val) {
    s.vah = vah
    s.val = val
    // vah is a HIGH edge and val a LOW edge, so the bins between them are
    // val's bin up to the one ending at vah.
    s.vaFrom = clampInt(Math.round((val - lo) / step), 0, n - 1)
    s.vaTo = clampInt(Math.round((vah - lo) / step) - 1, s.vaFrom, n - 1)
  } else {
    // Around the POC the host named, if it named one: a value area that does
    // not contain the drawn POC line reads as a bug.
    const va = valueAreaBins(bins, 0.7, s.pocBin)
    s.vaFrom = va.from
    s.vaTo = va.to
    s.val = lo + va.from * step
    s.vah = lo + (va.to + 1) * step
  }
  return s
}

let warnedVersion = false

/** No data: nothing to draw, and no bin step for upsertSession to use yet. */
const empty = () => ({ source: '', step: 0, sessions: [] })

/**
 * Validate a ProfileData and build its internal form: `{ source, step,
 * sessions }`, sessions ascending by start and unique by start (the later of
 * two wins, as upsertSession would have it).
 *
 * null, undefined and a contract version this build cannot read all come back
 * EMPTY (step 0): a chart with no profile yet is the normal starting state,
 * not an error. Throws only through checkStep and normalizeSession.
 */
export function normalizeData(data) {
  if (data == null) return empty()
  if (typeof data !== 'object') fail('data must be a ProfileData object or null')
  if (data.version != null && data.version !== DATA_VERSION) {
    if (!warnedVersion) {
      warnedVersion = true
      console.warn(`[Emberwick] profiles: data version ${String(data.version)} is not the version this build reads (${DATA_VERSION}); nothing is drawn.`)
    }
    return empty()
  }
  const step = checkStep(data.step)
  const list = Array.isArray(data.sessions) ? data.sessions : []
  const sessions = []
  for (let i = 0; i < list.length; i++) sessions.push(normalizeSession(list[i], step, `sessions[${i}]`))
  // Stable, so of two sessions with one start the LATER in the input stays later.
  sessions.sort((a, b) => a.start - b.start)
  const unique = []
  for (const s of sessions) {
    if (unique.length && unique[unique.length - 1].start === s.start) unique[unique.length - 1] = s
    else unique.push(s)
  }
  return { source: data.source != null ? String(data.source) : '', step, sessions: unique }
}

/**
 * Insert `s` into `sessions` (ascending by start), replacing the session with
 * the same start. Returns the index it now sits at.
 */
export function upsert(sessions, s) {
  let lo = 0
  let hi = sessions.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sessions[mid].start < s.start) lo = mid + 1
    else hi = mid
  }
  if (lo < sessions.length && sessions[lo].start === s.start) sessions[lo] = s
  else sessions.splice(lo, 0, s)
  return lo
}
