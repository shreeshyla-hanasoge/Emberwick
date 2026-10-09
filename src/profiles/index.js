/**
 * Emberwick volume profiles — the public entry (`emberwick/profiles`).
 *
 *   import { createChart } from 'emberwick'
 *   import { createVolumeProfile } from 'emberwick/profiles'
 *   const chart = createChart(el)
 *   const profile = createVolumeProfile(chart, { data, mode: 'session' })
 *
 * A volume profile is a horizontal histogram of how much volume traded at
 * each price, usually one per session, with the point of control and the
 * value area marked. This entry DRAWS profiles the host supplies. It never
 * computes one from the chart's bars: those are often 5-minute bars or
 * longer and may carry no real volume, so a profile binned from them would be
 * wrong. The host computes from finer data and passes a small versioned
 * contract (ProfileData, see index.d.ts).
 *
 * Everything here is opt-in and lives outside the core: a chart that never
 * imports this file carries no profile code at all. The core is reached only
 * through its own entry, and nothing below touches the DOM at import time, so
 * this module can be imported during SSR.
 */
// Binding `version` — a value DEFINED in the core entry, not a re-export — is what
// keeps Rollup from splitting the core into chunks/ when the entries are built
// together (re-export-only imports produce chunks/). It also drives the
// one-time vendoring-mismatch warning below.
import { version as coreVersion } from '../chart/index.js'
import { VolumeProfile } from './VolumeProfile.js'
import { DATA_VERSION } from './data.js'

export const version = '0.14.0'
const mm = (v) => String(v).split('.').slice(0, 2).join('.')
let warned = false
function checkCore() {
  if (!warned && mm(coreVersion) !== mm(version)) {
    warned = true
    console.warn(`[Emberwick] profiles ${version} is running against core ${coreVersion}; vendor both folders from one release.`)
  }
}

export { DATA_VERSION }
export { computeValueArea } from './valueArea.js'

/**
 * Draw volume profiles on `chart`, under its candles.
 *
 * @param {object} chart an Emberwick Chart
 * @param {object} [options]
 * @param {object|null} [options.data] ProfileData; null or empty draws nothing
 * @param {'session'|'visible'|'both'} [options.mode] default 'session'
 * @param {number} [options.width] longest bar as a share of the session's pixel span ('visible': of the pane width). Default 0.3
 * @param {'left'|'right'} [options.side] where the 'visible' profile sits. Default 'right'
 * @param {boolean} [options.valueArea] tint value-area bins and draw VAH/VAL. Default true
 * @param {boolean} [options.poc] draw the POC line. Default true
 * @param {boolean} [options.extendPoc] carry each POC right until price trades through it. Default false
 * @param {boolean} [options.tags] POC/VAH/VAL price tags in the axis gutter. Default true
 * @param {boolean} [options.label] a small caption with data.source. Default true
 * @param {boolean} [options.hideFutureInReplay] under replay, hide sessions not finished by the last revealed bar. Default true
 * @param {object} [options.colors] Partial<ProfileColors>; defaults come from the theme
 * @returns {VolumeProfile} the controller: setData, upsertSession, setOptions, on, off, destroy
 */
export function createVolumeProfile(chart, options) {
  checkCore()
  return new VolumeProfile(chart, options)
}
