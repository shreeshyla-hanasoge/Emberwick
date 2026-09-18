import type * as React from 'react'
import type { Bar, Chart, ChartOptions, CrosshairPayload, Feed, PriceMode, Theme } from '../../chart/index.js'

export interface EmberwickChartProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Static dataset. Ignored while a feed is attached and driving updates. */
  data?: Bar[]
  /** Data source. Passing a new instance re-loads history. */
  feed?: Feed
  /** Options applied at construction time only. */
  options?: ChartOptions
  /** Partial theme; re-applied whenever the object identity changes. */
  theme?: Partial<Theme>
  priceMode?: PriceMode
  animate?: boolean
  magnet?: boolean
  onCrosshair?: (payload: CrosshairPayload | null) => void
  className?: string
  style?: React.CSSProperties
}

export interface EmberwickChartHandle {
  /** The underlying chart instance, or null before mount / after unmount. */
  readonly chart: Chart | null
}

export declare const EmberwickChart: React.ForwardRefExoticComponent<
  EmberwickChartProps & React.RefAttributes<EmberwickChartHandle>
>

export default EmberwickChart
