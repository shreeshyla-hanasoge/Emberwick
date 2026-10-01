/**
 * Emberwick drawings — the public entry (`emberwick/drawings`).
 *
 *   import { createChart } from 'emberwick'
 *   import { enableDrawings } from 'emberwick/drawings'
 *   const chart = createChart(el)
 *   const drawings = enableDrawings(chart)
 *   drawings.setTool('trendLine')
 *
 * Everything here is opt-in and lives outside the core: a chart that never
 * imports this file carries no drawing code at all (D1, D3). The core is
 * reached only through its own entry (D4), and nothing below touches the DOM
 * at import time, so this module can be imported during SSR and
 * normalizeDrawings() can validate stored rows in a Node backend.
 */
// Binding `version` — a value DEFINED in the core entry, not a re-export — is what
// keeps Rollup from splitting the core into chunks/ when both entries are built
// together (verified: re-export-only imports produce chunks/annotations-*.js).
// It also drives the one-time vendoring-mismatch warning below.
import { version as coreVersion } from '../chart/index.js'
import { Drawings } from './Drawings.js'
import { SCHEMA_VERSION, normalizeEntries, toJSON, makeRegistry } from './model/schema.js'
import { timeToIndex, indexToTime } from './model/time.js'
import { trendLine } from './tools/trendLine.js'
import { horizontalLine } from './tools/horizontalLine.js'
import { verticalLine } from './tools/verticalLine.js'
import { rectangle } from './tools/rectangle.js'
import { parallelChannel } from './tools/parallelChannel.js'
import { fibRetracement } from './tools/fibRetracement.js'
import { measure } from './tools/measure.js'
import { position } from './tools/position.js'
import { text } from './tools/text.js'

export const version = '0.13.0'
const mm = (v) => String(v).split('.').slice(0, 2).join('.')
let warned = false
export function checkCore() {
  if (!warned && mm(coreVersion) !== mm(version)) {
    warned = true
    console.warn(`[Emberwick] drawings ${version} is running against core ${coreVersion}; vendor both folders from one release.`)
  }
}

export { SCHEMA_VERSION, timeToIndex, indexToTime }
export { TOOL_PRESETS } from './presets.js'
export { trendLine, horizontalLine, verticalLine, rectangle, parallelChannel, fibRetracement, measure, position, text }

/** The nine standard tools, in tool-rail order. */
export const STANDARD_TOOLS = Object.freeze([
  trendLine, horizontalLine, verticalLine, rectangle, parallelChannel, fibRetracement, measure, position, text,
])

/**
 * Drawings on `chart` with exactly the tools in `options.tools`. It takes no
 * default tool set on purpose: a default parameter of STANDARD_TOOLS here
 * would keep all nine tools alive in every bundle that imports this function,
 * and tools must tree-shake for a host that ships three of them.
 */
export function createDrawings(chart, options) {
  checkCore()
  return new Drawings(chart, options)
}

/** Drawings with the nine standard tools. */
export function enableDrawings(chart, options) {
  return createDrawings(chart, Object.assign({ tools: STANDARD_TOOLS }, options))
}

/**
 * Validate and normalise a stored document with no chart: pure, and safe on a
 * server. `drawings.length === report.loaded + report.carried.length`; rows
 * this build cannot read (an unknown type, a newer `v`) come back verbatim in
 * their z slot, so a backend that re-saves the result loses nothing.
 */
export function normalizeDrawings(input, tools = STANDARD_TOOLS) {
  const { entries, report } = normalizeEntries(input, makeRegistry(tools))
  return { drawings: entries.map(toJSON), report }
}
