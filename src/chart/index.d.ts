/**
 * Emberwick — type declarations for the public API.
 *
 * Hand-written against the actual implementation (the core is plain JS).
 * Only what is exported from src/chart/index.js is described here.
 */

/** A single OHLCV bar. `time` is ms since epoch. */
export interface Bar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

export type PriceMode = 'linear' | 'log'

export interface Theme {
  background: string
  grid: string
  axisLine: string
  text: string
  textStrong: string
  up: string
  down: string
  upFill: string
  downFill: string
  wickUp: string
  wickDown: string
  volumeUp: string
  volumeDown: string
  crosshair: string
  labelBg: string
  labelText: string
  tagText: string
  font: string
  priceAxisWidth: number
  timeAxisHeight: number
}

/* --------------------------------------------------------------- markers -- */

export type MarkerShape =
  | 'arrowUp'
  | 'arrowDown'
  | 'triangleUp'
  | 'triangleDown'
  | 'circle'
  | 'square'
  | 'diamond'
  | 'flag'
  | 'label'

export type MarkerPosition = 'aboveBar' | 'belowBar' | 'inBar' | 'atPrice'

/** A point annotation pinned to the bar nearest `time`. */
export interface Marker<T = unknown> {
  /** Stable id. Generated when omitted; required for removeMarker(). */
  id?: string
  /** ms since epoch — snapped to the closest bar. */
  time: number
  /** Only used when position is 'atPrice'. */
  price?: number
  /** Default 'circle'. */
  shape?: MarkerShape
  /**
   * Default depends on the shape: up shapes sit below the bar, down shapes
   * above it, everything else above.
   */
  position?: MarkerPosition
  /** Defaults to theme.up, or theme.down for the down-pointing shapes. */
  color?: string
  textColor?: string
  /** Short caption. For shape 'label' it is drawn inside the pill. */
  text?: string
  /** Scale factor. Default 1. */
  size?: number
  /** Passed straight back to you on hover/click. */
  data?: T
}

/** A marker after normalisation, as returned by getMarkers(). */
export interface ResolvedMarker<T = unknown> extends Marker<T> {
  id: string
  shape: MarkerShape
  position: MarkerPosition
  size: number
  /** Bar index the marker resolved to, or -1 when there are no bars. */
  index: number
}

export type LineStyle = 'solid' | 'dashed' | 'dotted'

/** A horizontal line at a fixed price. */
export interface PriceLine {
  id?: string
  price: number
  /** Defaults to theme.textStrong. */
  color?: string
  /** Default 'dashed'. */
  lineStyle?: LineStyle
  /** Default 1. */
  lineWidth?: number
  /** Optional pill drawn at the left end. */
  title?: string
  titleColor?: string
  /** Price tag on the axis. Default true. */
  axisLabel?: boolean
  tagTextColor?: string
}

/**
 * A shaded region: supply `from`/`to` for a price band spanning the full
 * width, or `fromTime`/`toTime` for a time band spanning the full height.
 */
export interface Zone {
  id?: string
  from?: number
  to?: number
  fromTime?: number
  toTime?: number
  /** Fill. Use rgba(). Default a faint theme-green wash. */
  color?: string
  /** Optional 1px outline. */
  border?: string
  label?: string
  labelColor?: string
}

/* --------------------------------------------------------------- options -- */

export interface TimeScaleOptions {
  /** Pixels per bar. Default 9. */
  spacing?: number
  /** Default 0.8. */
  minSpacing?: number
  /** Default 160. */
  maxSpacing?: number
  /** Bars of empty space kept at the right edge. Default 12. */
  rightOffset?: number
}

export interface PriceScaleOptions {
  /** Default 'linear'. */
  mode?: PriceMode
  /** Autoscale easing time constant in ms. Default 120. */
  tau?: number
  /** Headroom above the high, as a fraction. Default 0.12. */
  marginTop?: number
  /** Headroom below the low, as a fraction. Default 0.12. */
  marginBottom?: number
}

export interface ChartOptions {
  /** Partial theme merged over defaultTheme. */
  theme?: Partial<Theme>
  /** Share of plot height used by the volume strip. Default 0.18. */
  volumeRatio?: number
  /** Crosshair snaps to the nearest OHLC value. Default true. */
  magnet?: boolean
  /** Master switch for tick/candle animation. Default true. */
  animate?: boolean
  /** Bars requested from the feed on setFeed(). Default 1500. */
  initialBars?: number
  /** Initial markers; equivalent to calling setMarkers() after construction. */
  markers?: Marker[]
  priceLines?: PriceLine[]
  zones?: Zone[]
  timeScale?: TimeScaleOptions
  priceScale?: PriceScaleOptions
}

/** Payload of the 'crosshair' event. `null` when the cursor leaves the plot. */
export interface CrosshairPayload {
  index: number
  bar: Bar
  price: number
}

/* ------------------------------------------------------------------ feed -- */

export interface GetBarsRequest {
  symbol: string
  timeframe: number
  /** Fetch bars ending before this ms timestamp. `null` means "latest". */
  to: number | null
  limit: number
}

export type FeedMessage =
  | { type: 'update'; bar: Bar }
  | { type: 'append'; bar: Bar }

export type FeedHandler = (msg: FeedMessage) => void

/**
 * The seam of the library. Implement this to plug in any data source.
 * Extend the DataFeed base class, or supply any object with this shape.
 */
export interface Feed {
  symbol: string
  timeframe: number
  getBars(req: GetBarsRequest): Promise<Bar[]>
  subscribe(handler: FeedHandler): () => void
  /** Optional: called once with the newest bar after initial load. */
  prime?(bar: Bar | undefined): void
}

export declare class DataFeed implements Feed {
  constructor(opts?: { symbol?: string; timeframe?: number })
  symbol: string
  timeframe: number
  getBars(req: GetBarsRequest): Promise<Bar[]>
  subscribe(handler: FeedHandler): () => void
}

export interface RandomFeedOptions {
  /** Default 'EMBR'. */
  symbol?: string
  /** Bar duration in ms. Default 60000. */
  timeframe?: number
  /** PRNG seed — same seed gives the same market. Default 7. */
  seed?: number
  /** Starting price. Default 100. */
  start?: number
  /** Per-tick volatility. Default 0.0022. */
  volatility?: number
  /** Per-tick drift. Default 0.00002. */
  drift?: number
  /** Live ticks emitted per second. Default 8. */
  ticksPerSecond?: number
  /** Wall-clock multiplier for candle formation. Default 1. */
  speed?: number
}

export declare class RandomFeed extends DataFeed {
  constructor(opts?: RandomFeedOptions)
  setSpeed(speed: number): void
  setTicksPerSecond(n: number): void
  setPaused(paused: boolean): void
  readonly paused: boolean
  stop(): void
}

/* ---------------------------------------------------------------- scales -- */

export declare class TimeScale {
  constructor(opts?: TimeScaleOptions)
  visibleRange(): { from: number; to: number }
  barWidth(): number
  x(index: number): number
  index(x: number): number
  panBy(dx: number): void
  zoomAt(x: number, factor: number): void
  snapToRealtime(): void
}

export declare class PriceScale {
  constructor(opts?: PriceScaleOptions)
  y(price: number): number
  price(y: number): number
  setMode(mode: PriceMode): void
  resetAuto(): void
  readonly lo: number
  readonly hi: number
}

/* ----------------------------------------------------------------- chart -- */

export declare class Chart {
  constructor(container: HTMLElement, options?: ChartOptions)

  /** Replace the whole dataset. Resets zoom to the right edge. */
  setData(bars: Bar[]): void
  /** Merge a tick into the forming candle (animated). */
  update(bar: Bar): void
  /** Open a new candle; the previous one is closed. */
  append(bar: Bar): void
  /** Load history from a feed and subscribe to live updates. */
  setFeed(feed: Feed): Promise<void>
  detachFeed(): void

  /** Replace every marker. */
  setMarkers(markers: Marker[]): void
  /** Current markers, normalised, each with its resolved bar index. */
  getMarkers(): ResolvedMarker[]
  addMarker(marker: Marker): void
  /** Removes by id — including ids generated for you. */
  removeMarker(id: string): void
  clearMarkers(): void
  setPriceLines(lines: PriceLine[]): void
  setZones(zones: Zone[]): void
  /** Topmost marker under a plot-relative point, else null. */
  markerAt(x: number, y: number): ResolvedMarker | null

  setTheme(theme: Partial<Theme>): void
  setPriceMode(mode: PriceMode): void
  setAnimate(on: boolean): void
  setMagnet(on: boolean): void
  snapToRealtime(): void

  /** PNG data URL of all layers composited. */
  toImage(): string
  /** Rolling frames-per-second of the render loop. */
  readonly fps: number

  /**
   * Subscribe to a chart event. Returns an unsubscribe function.
   * NOTE: 'visibleRange' is accepted but is not currently emitted.
   */
  subscribe(event: 'crosshair', fn: (payload: CrosshairPayload | null) => void): () => void
  subscribe(event: 'markerClick', fn: (marker: ResolvedMarker) => void): () => void
  subscribe(event: 'markerHover', fn: (marker: ResolvedMarker | null) => void): () => void
  subscribe(event: 'visibleRange', fn: (range: { from: number; to: number }) => void): () => void

  /** Removes listeners, canvases and the render loop. */
  destroy(): void

  readonly bars: Bar[]
  readonly priceLines: PriceLine[]
  readonly zones: Zone[]
  readonly ts: TimeScale
  readonly ps: PriceScale
}

/** Preferred entry point. */
export declare function createChart(container: HTMLElement, options?: ChartOptions): Chart

export declare const defaultTheme: Theme
export declare const lightTheme: Theme
export declare const version: string

/* ------------------------------------------------------------- utilities -- */

/** Seeded PRNG used by RandomFeed. */
export declare function mulberry32(seed: number): () => number

export declare class Smoothed {
  constructor(value?: number, tau?: number)
  value: number
  target: number
  tau: number
  set(target: number): void
  jump(v: number): void
  tick(dt: number): boolean
  readonly settled: boolean
}

export declare class Tween {
  constructor(duration?: number, ease?: (t: number) => number)
  restart(): void
  tick(dt: number): boolean
  readonly progress: number
  readonly done: boolean
}

export declare class Inertia {
  constructor(opts?: { friction?: number; min?: number })
  sample(dx: number, dt: number): void
  release(): void
  stop(): void
  tick(dt: number): number
}

export declare class LiveCandle {
  constructor(tau?: number)
  enabled: boolean
  setTarget(bar: Bar | null): void
  reset(): void
  tick(dt: number): boolean
  read(bar: Bar): Bar
}

export declare function easeOutCubic(t: number): number
export declare function easeInOutCubic(t: number): number
