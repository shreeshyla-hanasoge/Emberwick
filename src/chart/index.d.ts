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
  /** Candle BODY fill. Falls back to `up` when unset. */
  upFill?: string
  /** Candle BODY fill. Falls back to `down` when unset. */
  downFill?: string
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

/**
 * One point of a series.
 *
 * A point whose `value` is absent, null or non-numeric is a GAP: it lifts the
 * pen, so the line ends there and the next valued point starts a fresh one.
 * It is never drawn as zero and never interpolated across.
 */
export interface SeriesPoint {
  /** ms since epoch, resolved to the nearest bar */
  time: number
  value?: number | string | null
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface PaneOptions {
  /** Flex share of the plot height. Default 1; the price pane is 3. */
  weight?: number
  /** Floor on this pane's height in CSS px. Default 40. */
  minHeight?: number
  /** This pane's scale. Defaults to the chart's `priceScale` option. */
  priceScale?: PriceScaleOptions
  /** Passthrough caption. Not drawn. */
  title?: string
}

export interface PaneInfo {
  id: string
  weight: number
  minHeight: number
  title: string
  /** Live rect in CSS px, mutated in place on resize. */
  readonly rect: Rect
  readonly ps: PriceScale
  /** False until this pane's scale has fitted a value — it draws no axis. */
  readonly primed: boolean
  /** Ids of the series drawn here, in draw order. */
  readonly series: string[]
}

export interface SeriesOptions {
  /** Points. Omit to leave the existing data untouched. */
  data?: SeriesPoint[]
  /** Defaults to theme.textStrong. */
  color?: string
  /** Default 1.5. */
  lineWidth?: number
  /** Default 'solid'. */
  lineStyle?: LineStyle
  /** Draw as a step function rather than interpolating. Default false. */
  stepped?: boolean
  /** Default true. A hidden series is neither drawn nor autoscaled. */
  visible?: boolean
  /** Passthrough metadata, handed back by getSeries(). Never drawn. */
  title?: string
  /**
   * Which pane draws this series. Defaults to 'price'.
   * Throws if the pane does not exist — call addPane() first.
   */
  pane?: string
}

/** A series' resolved options, as returned by getSeries(). */
export interface SeriesInfo {
  id: string
  color: string | null
  lineWidth: number
  lineStyle: LineStyle
  stepped: boolean
  visible: boolean
  title: string
}

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
  /** Draw the horizontal rule. False keeps the title pill and axis tag only. */
  lineVisible?: boolean
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
  /** Vertical gap between panes in CSS px. Default 6. */
  paneGap?: number
  /**
   * IANA time zone for every rendered timestamp, e.g. 'Asia/Kolkata'.
   * Defaults to the browser's local zone. Display only.
   */
  timeZone?: string
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

/** Payload of the 'visibleRange' event, and the return of chart.visibleRange(). */
export interface VisibleRangePayload {
  /** First visible bar index, clamped to the loaded data. */
  from: number
  /** Last visible bar index, clamped to the loaded data. */
  to: number
  /** `bars[from].time`, or null when no bars are loaded. */
  fromTime: number | null
  /** `bars[to].time`, or null when no bars are loaded. */
  toTime: number | null
  /** Total bars currently loaded. */
  barCount: number
  /** Current pixels per bar — useful for level-of-detail decisions. */
  spacing: number
  /**
   * False while the view is still easing. The last event of a gesture always
   * arrives with `settled: true`, so it is safe to defer expensive work
   * (a fetch, a re-aggregation) until you see it.
   */
  settled: boolean
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

/* ---------------------------------------------------------------- replay -- */

export interface ReplayOptions {
  /** Dataset to replay. Defaults to the chart's current bars. */
  bars?: Bar[]
  /** Starting cursor index. Default: the midpoint of the dataset. */
  from?: number
  /** Rate multiplier, clamped to 0.25–500. Default 1. */
  speed?: number
  /** Real milliseconds one bar takes at 1×. Default 1000. */
  baseInterval?: number
  /** Restart from the beginning instead of stopping at the end. Default false. */
  loop?: boolean
  /** Re-anchor the right edge on the cursor when scrubbing. Default true. */
  follow?: boolean
}

/** Payload of the 'replay' event, and the return of chart.replayState(). */
export interface ReplayState {
  /** False when the chart is not replaying; every other field is then inert. */
  active: boolean
  playing: boolean
  /** Cursor: index of the newest revealed bar. -1 when inactive. */
  index: number
  /** Size of the dataset being replayed. */
  length: number
  /** 0 at the first playable bar, 1 at the last. */
  progress: number
  speed: number
  /** `time` of the bar at the cursor. */
  time: number | null
  bar: Bar | null
  atEnd: boolean
}

/**
 * Bar-by-bar playback over a fixed dataset. Obtained from
 * `chart.startReplay()` or `chart.replay`; not constructed directly.
 */
export declare class Replay {
  readonly source: Bar[]
  readonly length: number
  readonly lastIndex: number
  readonly atEnd: boolean
  readonly bar: Bar | null
  readonly time: number | null
  readonly progress: number
  /** Real ms between bars at the current speed. */
  readonly interval: number
  index: number
  speed: number
  playing: boolean
  looping: boolean
  follow: boolean
  baseInterval: number

  play(): this
  pause(): this
  toggle(): this
  /** Clamped to 0.25–500. */
  setSpeed(speed: number): this
  setLoop(on: boolean): this
  /**
   * Stop this controller from ever touching the chart again. Called for you
   * by startReplay(), stopReplay(), setData() and destroy(); a controller you
   * are still holding after any of those is inert. Idempotent.
   */
  detach(): this
  /** Move the cursor. Out-of-range values clamp. */
  seek(index: number): this
  step(n?: number): this
  toStart(): this
  toEnd(): this
  state(): ReplayState
}

/** Speed bounds accepted by `setSpeed`. */
export declare const MIN_SPEED: number
export declare const MAX_SPEED: number

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
  /**
   * Create or update a series — an arbitrary y-value over the bar time axis.
   * Calling it again with the same id updates in place. Insertion order is
   * draw order. Throws if `id` is null or undefined.
   */
  /**
   * Add a pane below the existing ones — a horizontal band with its own price
   * scale, sharing the time axis. What an oscillator needs: RSI on 0..100
   * cannot share a scale with a price near 24,000.
   */
  addPane(id: string, options?: PaneOptions): PaneInfo
  /** Remove a pane and every series routed to it. The price pane cannot go. */
  removePane(id: string): this
  /** Every pane, top to bottom. panes()[0] is always the price pane. */
  panes(): PaneInfo[]
  pane(id: string): PaneInfo | null
  /** A pane's live PriceScale. Supersedes `chart.ps`. */
  paneScale(id: string): PriceScale | null
  /** A copy of a pane's rect in CSS px. Supersedes `chart.plot`. */
  paneRect(id: string): Rect | null

  setSeries(id: string, options?: SeriesOptions): this
  /** Replace one series' points, leaving its presentation options alone. */
  setSeriesData(id: string, points: SeriesPoint[]): this
  /** Show or hide a series. Hidden series do not influence autoscale. */
  setSeriesVisible(id: string, visible: boolean): this
  removeSeries(id: string): this
  clearSeries(): this
  /** Every series' options, in draw order. Point data is not included. */
  getSeries(): SeriesInfo[]

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

  /**
   * Start bar-by-bar playback. With no `bars`, the chart's current data is
   * the dataset. Returns null if there are fewer than two bars to replay.
   *
   *   chart.startReplay({ from: 200, speed: 4 })
   *   chart.replay.play()
   */
  startReplay(options?: ReplayOptions): Replay | null
  /** Leave replay and reveal the whole dataset again. */
  stopReplay(): void
  /** The active controller, or null. */
  readonly replay: Replay | null
  /** Current playback state; `{ active: false, ... }` when not replaying. */
  replayState(): ReplayState

  setTheme(theme: Partial<Theme>): void
  setPriceMode(mode: PriceMode): void
  setAnimate(on: boolean): void
  setMagnet(on: boolean): void
  snapToRealtime(): void

  /** PNG data URL of all layers composited. */
  toImage(): string
  /** Rolling frames-per-second of the render loop. */
  readonly fps: number

  /** The window currently on screen. Cheap enough to poll. */
  visibleRange(): VisibleRangePayload

  /**
   * Subscribe to a chart event. Returns an unsubscribe function.
   *
   * 'visibleRange' is a state event rather than a notification: a new
   * subscriber is called immediately with the current window, and then only
   * when that window actually changes — so no debouncing is required.
   */
  subscribe(event: 'crosshair', fn: (payload: CrosshairPayload | null) => void): () => void
  subscribe(event: 'markerClick', fn: (marker: ResolvedMarker) => void): () => void
  subscribe(event: 'markerHover', fn: (marker: ResolvedMarker | null) => void): () => void
  subscribe(event: 'visibleRange', fn: (range: VisibleRangePayload) => void): () => void
  subscribe(event: 'replay', fn: (state: ReplayState) => void): () => void
  /**
   * Feed failures: a rejected `getBars()` from either `setFeed()` or lazy
   * history paging. With no subscriber the error is logged instead.
   */
  subscribe(event: 'error', fn: (error: unknown) => void): () => void

  /** Removes listeners, canvases and the render loop. */
  /**
   * Restart the render loop after it gave up on consecutive frame errors.
   * The loop stops itself after ten failing frames in a row and reports the
   * last error through the 'error' event; fix the cause, then call this.
   * Returns false if the chart is destroyed or the loop is already running.
   */
  /**
   * Re-measure the container and canvases now. Resizes and devicePixelRatio
   * changes are detected automatically; this is the escape hatch for layout
   * the element cannot observe, such as being revealed from display:none.
   */
  /**
   * Zoom and scroll so the whole dataset is on screen. Not animated.
   * Returns false when there are fewer than two bars to fit.
   *
   * Fitting is allowed to zoom out past `timeScale.minSpacing`, and lowers it
   * to match — that bound governs interactive zoom, not an explicit fit.
   */
  fitContent(): boolean
  /**
   * Format every rendered timestamp in `zone` — an IANA name such as
   * 'Asia/Kolkata', or null for the browser's local zone. Display only: bar
   * times, the crosshair payload and visibleRange stay in the ms epochs you
   * supplied.
   */
  setTimeZone(zone: string | null): this
  resize(): void
  resume(): boolean
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
