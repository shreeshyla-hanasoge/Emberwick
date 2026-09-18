import type { Bar, Chart, Feed } from '../../chart/index.js'

export declare class EmberwickChartElement extends HTMLElement {
  readonly chart: Chart | null
  feed: Feed | null
  data: Bar[] | null
}

/** Registers <emberwick-chart>. Safe to call more than once. */
export declare function register(tagName?: string): void

declare global {
  interface HTMLElementTagNameMap {
    'emberwick-chart': EmberwickChartElement
  }
}
