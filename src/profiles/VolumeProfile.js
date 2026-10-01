/**
 * VolumeProfile: the controller createVolumeProfile() returns, and the plugin
 * the chart draws.
 *
 * One object is both, the way Drawings is: the chart calls the hooks (attach,
 * detach, tick, draw, hover), the host application calls the rest. It paints
 * on the `below` layer, under the candles, and it never claims a gesture: it
 * has no pointerDown, so pan, zoom, drawings, markers and the crosshair behave
 * exactly as they do without it.
 */
import { normalizeData, normalizeSession, upsert } from './data.js'
import { DEFAULTS, mergeOptions } from './options.js'

const fail = (msg) => { throw new Error(`emberwick/profiles: ${msg}`) }

export class VolumeProfile {
  /**
   * @param {object} chart an Emberwick Chart
   * @param {object} [options] see createVolumeProfile
   */
  constructor(chart, options) {
    if (!chart || typeof chart.addPlugin !== 'function') fail('createVolumeProfile needs an Emberwick chart')
    /** Read once by chart.addPlugin: this plugin paints under the candles. */
    this.layer = 'below'
    this.chart = chart
    /** Vue's ReactiveFlags.SKIP, as on the Chart: never deep-proxy a controller that repaints. */
    this.__v_skip = true
    this._host = null
    this._destroyed = false
    this._listeners = { hover: new Set() }
    // Options and data are validated BEFORE the plugin is attached, so a
    // throw here leaves the chart exactly as it was: no layer, no plugin.
    this._opts = mergeOptions(DEFAULTS, options)
    this._data = normalizeData(options ? options.data : null)
    /** Bumped by everything that changes what is drawn; caches key on it. */
    this._rev = 0
    // Throws on a destroyed chart; attach() has not run then, so nothing leaks.
    chart.addPlugin(this)
    // attach() declines a host that lacks what 0.13 added. It cannot throw
    // from there (the chart isolates hook errors), so the refusal lands here.
    if (!this._host) {
      chart.removePlugin(this)
      fail('this chart is an older Emberwick core; emberwick/profiles needs 0.13 or newer')
    }
  }

  // ================================================================ public API

  /**
   * Replace every session. `null` (or an empty `sessions`) draws nothing.
   * Throws on a bad `step` or session, leaving the previous data in place.
   * @param {object|null} data ProfileData
   * @returns {this}
   */
  setData(data) {
    this._data = normalizeData(data)
    return this._changed()
  }

  /**
   * Add one session, or replace the session with the same `start`: how a live
   * host feeds the developing session, once per update. Only that session is
   * re-read. Needs setData() first, because the bin `step` belongs to the data.
   * @param {object} session ProfileSession
   * @returns {this}
   */
  upsertSession(session) {
    const d = this._data
    if (!(d.step > 0)) fail('upsertSession() needs setData() first: the bin step comes from the data')
    upsert(d.sessions, normalizeSession(session, d.step))
    return this._changed()
  }

  /**
   * Change any option except `data`. Throws on a bad value before applying
   * anything.
   * @param {object} partial
   * @returns {this}
   */
  setOptions(partial) {
    this._opts = mergeOptions(this._opts, partial)
    return this._changed()
  }

  /**
   * Listen for an event. The only one is 'hover': the bin under the pointer,
   * or null when it is over none.
   * @param {'hover'} event
   * @param {(payload: object|null) => void} fn
   * @returns {this}
   */
  on(event, fn) {
    this._set(event).add(fn)
    return this
  }

  /** Stop listening. @returns {this} */
  off(event, fn) {
    this._set(event).delete(fn)
    return this
  }

  /** Detach from the chart for good. Idempotent, and safe after chart.destroy(). */
  destroy() {
    if (this._destroyed) return
    // removePlugin calls detach(), which is what marks this destroyed: the
    // same path chart.destroy() takes, so there is one way out, not two.
    this.chart.removePlugin(this)
    this._destroyed = true
  }

  // ============================================================== plugin hooks

  attach(host) {
    // A core older than 0.13 has no `below` layer and would paint this over
    // the candles without a word. Leave _host unset; the constructor reports it.
    if (typeof host.timeToIndex !== 'function' || typeof host.drawPriceTag !== 'function') return
    this._host = host
  }

  detach() {
    this._host = null
    this._destroyed = true
    for (const set of Object.values(this._listeners)) set.clear()
  }

  // ================================================================== internal

  _set(event) {
    const set = this._listeners[event]
    if (!set) fail(`unknown event "${String(event)}"`)
    return set
  }

  /** Something drawn changed: bump the revision and repaint this layer only. */
  _changed() {
    this._rev++
    if (this._host) this._host.invalidate()
    return this
  }
}
