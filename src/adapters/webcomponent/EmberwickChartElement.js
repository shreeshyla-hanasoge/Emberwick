import { createChart, defaultTheme, lightTheme } from '../../chart/index.js'

/**
 * <emberwick-chart> — drop-in custom element, no framework required.
 *
 *   <emberwick-chart theme="dark" style="height:420px"></emberwick-chart>
 *   document.querySelector('emberwick-chart').feed = myFeed
 *
 * Attributes : theme="dark|light", animate="false", magnet="false"
 * Properties : feed, data, chart (read-only)
 * Events     : "crosshair" (detail = payload | null)
 *
 * The chart is built in a shadow root so the host page's CSS can't reach in
 * and reposition the stacked canvases.
 */

/**
 * A class heritage clause is evaluated when the MODULE is evaluated, so
 * `extends HTMLElement` threw a ReferenceError at import time under Node —
 * long before the `typeof customElements` guard inside register() could run.
 * That made this entry unimportable during an SSR or prerender pass, which is
 * precisely the path the README points Vue, Svelte and Angular users at.
 * In a browser this is exactly HTMLElement; elsewhere it is an inert stand-in
 * that is never instantiated, because register() still declines to define the
 * element without customElements.
 */
const ElementBase = typeof HTMLElement !== 'undefined' ? HTMLElement : class {}

export class EmberwickChartElement extends ElementBase {
  static get observedAttributes() {
    return ['theme', 'animate', 'magnet']
  }

  constructor() {
    super()
    this._chart = null
    this._feed = null
    this._data = null
    this._host = null
    this._off = null
  }

  connectedCallback() {
    if (this._chart) return

    const root = this.shadowRoot || this.attachShadow({ mode: 'open' })
    root.innerHTML = `
      <style>
        :host { display: block; position: relative; width: 100%; height: 100%; min-height: 240px; }
        .host { position: relative; width: 100%; height: 100%; }
      </style>
      <div class="host"></div>
    `
    this._host = root.querySelector('.host')

    this._chart = createChart(this._host, {
      theme: this.getAttribute('theme') === 'light' ? lightTheme : defaultTheme,
      animate: this.getAttribute('animate') !== 'false',
      magnet: this.getAttribute('magnet') !== 'false',
    })

    this._off = this._chart.subscribe('crosshair', (payload) => {
      this.dispatchEvent(new CustomEvent('crosshair', { detail: payload }))
    })

    // Values assigned before upgrade/connection still apply.
    if (this._data) this._chart.setData(this._data)
    if (this._feed) this._chart.setFeed(this._feed)
  }

  disconnectedCallback() {
    if (this._off) this._off()
    this._off = null
    if (this._chart) this._chart.destroy()
    this._chart = null
  }

  attributeChangedCallback(name, oldValue, value) {
    if (!this._chart || oldValue === value) return
    if (name === 'theme') this._chart.setTheme(value === 'light' ? lightTheme : defaultTheme)
    else if (name === 'animate') this._chart.setAnimate(value !== 'false')
    else if (name === 'magnet') this._chart.setMagnet(value !== 'false')
  }

  get chart() {
    return this._chart
  }

  set feed(feed) {
    this._feed = feed
    if (this._chart) this._chart.setFeed(feed)
  }

  get feed() {
    return this._feed
  }

  set data(bars) {
    this._data = bars
    if (this._chart) this._chart.setData(bars)
  }

  get data() {
    return this._data
  }
}

/** Registers <emberwick-chart>. Safe to call more than once. */
export function register(tagName = 'emberwick-chart') {
  if (typeof customElements === 'undefined') return
  if (!customElements.get(tagName)) customElements.define(tagName, EmberwickChartElement)
}
