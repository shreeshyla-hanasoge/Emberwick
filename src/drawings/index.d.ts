/**
 * Emberwick drawings: typings for `emberwick/drawings`.
 *
 * Hand-written, like the core's. Everything here is @experimental: the
 * drawings API may change before 1.0, and the ToolDef contract at the bottom
 * (for custom tools) is the part most likely to.
 *
 * The one import is the core's entry, and it is rewritten to `./index.js` by
 * scripts/pack-lib.mjs when the package is assembled, so the shipped
 * drawings.d.ts sits next to the shipped index.d.ts.
 */
import type { Bar, Chart, PaneView, PluginHost, Rect } from '../chart/index.js'

/* ---------------------------------------------------------------- schema -- */

/**
 * A stored anchor. `time` is in the unit and epoch convention of your bars and
 * is never converted. A point past the newest bar is `{ time: lastBarTime,
 * price, offset: k, tf }` (k bars after it), and one before the oldest bar is
 * `{ time: firstBarTime, price, offset: -k, tf }`, so the anchor keeps its
 * distance in bars across session gaps, appends and history prepends.
 * @experimental
 */
export interface DrawingPoint {
  time: number
  price: number
  /** Bars AFTER `time` (> 0) or BEFORE it (< 0). Absent: the point is on `time`. */
  offset?: number
  /** The timeframe (ms) `offset` was counted in; absent means the current one. */
  tf?: number
}

/** @experimental */
export type LineStyleName = 'solid' | 'dashed' | 'dotted'

/** @experimental */
export interface DrawingStyle {
  /** null follows the theme, so a light/dark switch recolours the drawing. */
  color: string | null
  /** 0.5 to 8. */
  lineWidth: number
  lineStyle: LineStyleName
  /** null derives the fill from `color`. */
  fill: string | null
  /** 0 to 1. */
  fillOpacity: number
  textColor: string | null
  /** 9 to 32. */
  fontSize: number
}

/** One fibonacci level: `value` is the ratio (0 to 1 is the leg; 1.618 extends it). */
export interface FibLevel {
  value: number
  color: string | null
  visible: boolean
}

/** The per-type options of the nine standard tools, as stored (always complete). */
export interface TrendLineOptions {
  extend: 'none' | 'left' | 'right' | 'both'
  startCap: 'none' | 'arrow'
  endCap: 'none' | 'arrow'
  stats: 'active' | 'always' | 'never'
  text: string
}
export interface HorizontalLineOptions {
  extend: 'both' | 'right'
  axisLabel: boolean
  text: string
  textAlign: 'left' | 'center' | 'right'
}
export interface VerticalLineOptions {
  /** 'all' crosses every pane; 'pane' stays in the pane it was drawn on. */
  span: 'all' | 'pane'
  timeLabel: boolean
  text: string
}
export interface RectangleOptions {
  extend: 'none' | 'right'
  text: string
  middleLine: boolean
  stats: 'active' | 'always' | 'never'
}
export interface ParallelChannelOptions {
  extend: 'none' | 'left' | 'right' | 'both'
  middle: boolean
  fill: boolean
}
export interface FibRetracementOptions {
  levels: FibLevel[]
  reverse: boolean
  logLevels: boolean
  extend: 'none' | 'left' | 'right' | 'both'
  labels: 'left' | 'right' | 'none'
  showPrices: boolean
  fill: boolean
  trend: boolean
}
export interface MeasureOptions {
  volume: boolean
}
export interface PositionOptions {
  side: 'long' | 'short'
  /** A quantity above 0 adds a money line to the label; null hides it. */
  qty: number | null
  outcome: boolean
  labels: boolean
}
export interface TextOptions {
  text: string
  background: boolean
  align: 'left' | 'center' | 'right'
}

/**
 * A drawing as `getDrawings()` returns it, and as `add()`/`setDrawings()`
 * accept it (most fields are optional on the way in). `v` is per drawing, so a
 * host that stores one row per drawing keeps one schema version per row.
 * @experimental
 */
export interface Drawing<O = Record<string, unknown>> {
  v: 1
  id: string
  /** 'trendLine' | 'horizontalLine' | 'verticalLine' | 'rectangle' | 'parallelChannel'
   *  | 'fibRetracement' | 'measure' | 'position' | 'text', or a custom ToolDef's type. */
  type: string
  /** 'price' by default. */
  pane: string
  /** The count is fixed per type, and the order is meaningful (fib direction, position roles). */
  points: DrawingPoint[]
  style: DrawingStyle
  /** The FULL normalised options, so a later default change never restyles a stored drawing. */
  options: O
  locked: boolean
  visible: boolean
  /** Sparse stacking order; bringToFront is max + 1. */
  z: number
  /** Host passthrough, JSON-cloned and never read. */
  meta?: unknown
  /** Keys a newer build wrote are carried and written back. */
  [unknownKey: string]: unknown
}

/** What `add()` takes: only `type` and `points` are required. */
export interface DrawingInput<O = Record<string, unknown>> {
  type: string
  points: DrawingPoint[]
  id?: string | number
  pane?: string
  style?: Partial<DrawingStyle>
  options?: Partial<O>
  locked?: boolean
  visible?: boolean
  z?: number
  meta?: unknown
  v?: number
}

/**
 * What `update()` takes: `points` is replaced, `style` and `options` merge per
 * key (a fib's `levels` is replaced as a whole), the rest is replaced.
 * `id`, `type` and `v` cannot be patched.
 */
export interface DrawingPatch<O = Record<string, unknown>> {
  points?: DrawingPoint[]
  pane?: string
  style?: Partial<DrawingStyle>
  options?: Partial<O>
  locked?: boolean
  visible?: boolean
  z?: number
  meta?: unknown
}

/**
 * A row this build cannot read (an unknown type, or a `v` newer than this
 * build) is carried verbatim and never drawn, hit, selected or edited, so
 * saving what `getDrawings()` returns never destroys a newer build's data.
 */
export type CarriedDrawing = Record<string, unknown>

/** @experimental */
export interface LoadReport {
  /** Drawings of a known type accepted. */
  loaded: number
  /** Ids of carried (inert) rows. */
  carried: string[]
  rejected: { index: number; id?: string; reason: string }[]
  renamed: { index: number; from: string | null; to: string }[]
  /** Ids whose extra points or unknown keys were dropped. */
  truncated: string[]
  /** Ids whose pane did not exist at load time (kept; they return with the pane). */
  orphaned: string[]
}

/* --------------------------------------------------------------- options -- */

/** @experimental */
export type PresetName =
  | 'trendLine' | 'ray' | 'extendedLine' | 'arrow'
  | 'horizontalLine' | 'horizontalRay' | 'verticalLine'
  | 'rectangle' | 'parallelChannel' | 'fibRetracement'
  | 'measure' | 'long' | 'short' | 'text'

/** Colours of the drawing layer. Derived from the chart theme; every key can be overridden. */
export interface DrawingTheme {
  line: string
  accent: string
  handleFill: string
  halo: string
  labelBg: string
  labelText: string
  tagText: string
  up: string
  down: string
  warn: string
  guide: string
  font: string
  textColor: string
  fib: string[]
}

/** @experimental */
export interface DrawingsOptions {
  /** Initial load (not undoable). Its report is kept as `lastLoadReport`, and one console.warn is logged if anything was rejected. */
  drawings?: unknown
  /** 'inherit' follows chart.options.magnet (true means weak). The platform modifier (Meta on macOS/iOS, Ctrl elsewhere) inverts it for one gesture. */
  magnet?: 'inherit' | 'off' | 'weak' | 'strong'
  /** Keep the tool armed after each drawing. Default false. */
  stickyTools?: boolean
  /** Shift+click-click measures without arming a tool. Default true. */
  quickMeasure?: boolean
  /** Delete, arrows, Ctrl/Cmd+Z and friends, while the container has focus. Default true. */
  keyboard?: boolean
  /** Edit text in place. false hands editing to the host through the 'edit' event. Default true. */
  textEditor?: boolean
  /** Undo depth. Default 100. */
  historyLimit?: number
  /** 'auto' follows chart.options.animate and prefers-reduced-motion. */
  motion?: 'auto' | 'full' | 'reduced' | 'none'
  /** Injectable for tests and hosts. */
  prefersReducedMotion?: () => boolean
  /** Injectable; detected from the browser by default. */
  platform?: 'mac' | 'other'
  /** Render, hover, select and events, but no edits. */
  readOnly?: boolean
  /** Per-type starting style and options for new drawings. */
  defaults?: Partial<Record<string, { style?: Partial<DrawingStyle>; options?: object }>>
  theme?: Partial<DrawingTheme>
  /** Default: 'd' + base36 time + counter + 4 random base36 characters. */
  idFactory?: () => string
  /** Default 5000. Rows beyond it are rejected with reason 'limit'. */
  maxDrawings?: number
}

/** @experimental */
export type ChangeSource = 'user' | 'api' | 'history'
/** @experimental */
export type ChangeReason =
  | 'create' | 'move' | 'reshape' | 'style' | 'options' | 'text' | 'lock' | 'visibility' | 'order'
  | 'remove' | 'clear' | 'duplicate' | 'nudge' | 'batch' | 'undo' | 'redo'

/* ---------------------------------------------------------------- events -- */

export interface DrawingChangeEvent {
  source: ChangeSource
  reason: ChangeReason
  created: Drawing[]
  updated: { before: Drawing; after: Drawing }[]
  removed: Drawing[]
}

/** Live readout while a drawing is created or dragged. */
export interface DrawingStats {
  from: number
  to: number
  change: number
  /** null when `from` is 0. */
  changePct: number | null
  /** null with no bars. */
  bars: number | null
  durationMs: number | null
  /** True when an anchor is off the data, so the duration is an estimate. */
  approx: boolean
}

export interface DrawingStreamEvent {
  phase: 'create' | 'move' | 'reshape'
  /** During a creation the draft has `id: null`: it is not stored yet. */
  drawing: Drawing
  snap: { kind: string; tag: string | null } | null
  stats: DrawingStats
}

export interface DrawingSelectEvent { ids: string[]; drawings: Drawing[] }
export interface DrawingBoxEvent { id: string | null; box: Rect | null }
export interface DrawingToolEvent { tool: string | null; sticky: boolean }
export interface DrawingHistoryEvent { canUndo: boolean; canRedo: boolean; undoSize: number; redoSize: number }
export interface DrawingEditEvent { id: string; drawing: Drawing; box: Rect | null }
export interface DrawingContextMenuEvent {
  id: string
  drawing: Drawing
  part: 'handle' | 'body' | 'fill' | 'label' | 'tag'
  x: number
  y: number
  event: Event
}

/** Payload of each event. `select`, `box`, `tool` and `history` also fire once on subscribe. */
export interface DrawingsEventMap {
  /** Once per commit: a gesture end, an API call, an undo or redo. Never per drag frame, never on setDrawings. */
  change: DrawingChangeEvent
  /** Stream: at most once per frame while a draft changed, and only if subscribed. */
  drawing: DrawingStreamEvent
  select: DrawingSelectEvent
  /** The selected drawing's painted box, whenever it moved by half a pixel or more. */
  box: DrawingBoxEvent
  tool: DrawingToolEvent
  history: DrawingHistoryEvent
  /** A double-click on a non-text drawing, or text creation/editing with `textEditor: false`. */
  edit: DrawingEditEvent
  /** A right-click or long-press on a drawing. The native menu is prevented only while this has a listener. */
  contextmenu: DrawingContextMenuEvent
}

export type DrawingsEventName = keyof DrawingsEventMap

/* ------------------------------------------------------------ controller -- */

export interface DrawingHit {
  id: string
  part: 'handle' | 'body' | 'fill' | 'label' | 'tag'
  /** The handle index for part 'handle', else -1. */
  handle: number
  locked: boolean
}

/**
 * The drawings on one chart. Mutators are no-ops after `destroy()` (returning
 * false, 0 or null); readers keep working.
 * @experimental
 */
export interface DrawingsController {
  readonly chart: Chart
  readonly destroyed: boolean
  /** The report of the most recent load, including the initial `drawings` option. */
  readonly lastLoadReport: LoadReport | null

  /** z-ascending deep clones, carried rows verbatim, orphaned drawings included. Works after destroy(). */
  getDrawings(): (Drawing | CarriedDrawing)[]
  /** A load, not an edit: clears history and selection, aborts any gesture, emits no `change`. */
  setDrawings(input: unknown): LoadReport
  get(id: string): Drawing | CarriedDrawing | null
  /** Returns the id. Throws on invalid input, a duplicate id (carried rows included) and an unknown pane. */
  add(input: DrawingInput, opts?: { history?: boolean; select?: boolean; animate?: boolean }): string
  /** false for an unknown or carried id, and for a patch that changes nothing. Throws on id/type/v, an unknown pane and non-finite points. */
  update(id: string, patch: DrawingPatch, opts?: { history?: boolean; animate?: boolean }): boolean
  /** Carried rows are skipped and not counted. */
  remove(idOrIds: string | string[], opts?: { history?: boolean }): number
  /** One undoable entry. Carried rows are skipped. */
  clear(opts?: { history?: boolean }): number
  /** null with zero bars or for a carried id. */
  duplicate(id: string, opts?: { offsetBars?: number }): string | null
  bringToFront(id: string): boolean
  sendToBack(id: string): boolean
  setLocked(id: string, on: boolean): boolean
  setVisible(id: string, on: boolean): boolean
  /** View-level hide-all; not a document change. */
  setHidden(on: boolean): this
  readonly hidden: boolean

  /** One id in 0.12; the API is plural so multi-select can arrive without a breaking change. */
  select(ids: string | string[] | null, opts?: { focus?: boolean }): this
  readonly selection: readonly string[]
  /** Container px, for a host's own context menu. */
  drawingAt(x: number, y: number): DrawingHit | null
  /** Screen box of the last paint. To follow a drawing continuously, subscribe to `box`. */
  screenBox(id: string): Rect | null
  /** Price of a trendLine, channel baseline or horizontalLine at a time, extension-aware. null with zero bars. */
  priceAt(id: string, time: number): number | null

  /** A preset name or a registered tool type; null disarms. */
  setTool(tool: PresetName | string | null, opts?: { sticky?: boolean; style?: Partial<DrawingStyle>; options?: object; focus?: boolean }): this
  readonly tool: string | null
  /** Same as Esc. */
  cancel(): this

  undo(): boolean
  redo(): boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  clearHistory(): void
  /** Atomic: one history entry and one `change`; a throw restores everything and rethrows. */
  batch(fn: (drawings: this) => void): void

  setMagnet(mode: 'inherit' | 'off' | 'weak' | 'strong'): this
  readonly magnet: 'inherit' | 'off' | 'weak' | 'strong'
  setDefaults(type: string, def: { style?: Partial<DrawingStyle>; options?: object }): this
  /** Known keys only. */
  setOptions(partial: Partial<DrawingsOptions>): this
  /** Ids of drawings whose pane was removed; they return with the pane. */
  orphans(): string[]
  /** Call from a user-activation handler on iOS. */
  editText(id: string): boolean

  subscribe<E extends DrawingsEventName>(event: E, fn: (payload: DrawingsEventMap[E]) => void): () => void
  /** Idempotent. Removes the plugin and its listeners. */
  destroy(): void
}

/* ----------------------------------------------------------------- entry -- */

/** Drawings with exactly the tools you pass (they tree-shake). */
export declare function createDrawings(chart: Chart, options: DrawingsOptions & { tools: ToolDef[] }): DrawingsController
/** Drawings with the nine standard tools. Throws if drawings are already enabled on this chart. */
export declare function enableDrawings(chart: Chart, options?: DrawingsOptions): DrawingsController
export declare const STANDARD_TOOLS: readonly ToolDef[]

export declare const trendLine: ToolDef<TrendLineOptions>
export declare const horizontalLine: ToolDef<HorizontalLineOptions>
export declare const verticalLine: ToolDef<VerticalLineOptions>
export declare const rectangle: ToolDef<RectangleOptions>
export declare const parallelChannel: ToolDef<ParallelChannelOptions>
export declare const fibRetracement: ToolDef<FibRetracementOptions>
export declare const measure: ToolDef<MeasureOptions>
export declare const position: ToolDef<PositionOptions>
export declare const text: ToolDef<TextOptions>

/** The tool rail: 14 presets over the 9 stored types. `label` and `group` are for host toolbars. */
export declare const TOOL_PRESETS: Readonly<Record<PresetName, {
  type: string
  options?: object
  label: string
  group: string
}>>

/**
 * Validate and normalise a stored document with no chart. Pure and SSR-safe.
 * `drawings.length === report.loaded + report.carried.length`; carried rows
 * come back verbatim in their z slot.
 */
export declare function normalizeDrawings(input: unknown, tools?: readonly ToolDef[]): {
  drawings: (Drawing | CarriedDrawing)[]
  report: LoadReport
}

/** Fractional bar index of `time`; NaN with no bars. Outside the data it extrapolates at one `timeframeMs` per bar. */
export declare function timeToIndex(bars: readonly Bar[], time: number, timeframeMs: number): number
/** The inverse of timeToIndex; null with no bars or a non-finite index. */
export declare function indexToTime(bars: readonly Bar[], index: number, timeframeMs: number): number | null

export declare const SCHEMA_VERSION: 1
export declare const version: string

/* ------------------------------------------------- custom tools (ToolDef) -- */

/** An anchor on screen: the stored point resolved through the pane's scales, with any glide applied. */
export interface ScreenAnchor {
  x: number
  y: number
  /** Fractional bar index. */
  u: number
  time: number
  price: number
  /** True when the point is off the data, so anything derived from its time is an estimate. */
  approx: boolean
}

export interface HandleSpec {
  x: number
  y: number
  index: number
  axis: 'xy' | 'x' | 'y'
  cursor: string
  /** The touch move handle: a body drag. */
  move?: true
}

export interface SnapTarget {
  kind: 'anchor' | 'level' | 'fit'
  x: number
  y: number
  u: number
  price: number
  point: DrawingPoint | null
  paneId: string
  id: string
  tag: string | null
}

export interface AxisTag {
  axis: 'price' | 'time'
  pos: number
  text: string
  color: string
}

/** What `project` leaves for `draw` and `hit`: tool-owned, reused between frames. */
export interface Geom {
  bbox: { x0: number; y0: number; x1: number; y1: number }
  infinite: boolean
  /** 'plot' clips to the whole plot instead of the drawing's pane. Default 'pane'. */
  clip: 'pane' | 'plot'
  [key: string]: unknown
}

/** A pointer position after the snap pipeline. */
export interface Snapped {
  u: number
  point: DrawingPoint
  x: number
  y: number
  kind: string
  tag: string | null
  targetId: string | null
  guide: unknown
  state: { kind: string; targetId: string | null; tag: string | null; x: number; y: number }
}

/** Everything a tool may show, as absolute state (never a delta). All eased by the controller. */
export interface Look {
  hover: number
  select: number
  press: number
  pressedHandle: number
  alpha: number
  reveal: number
  age: number
  stats: number
  preview: boolean
  exporting: boolean
  locked: boolean
  handleR: number
  shake: number
  warnPulse: number
  editing: boolean
  [key: string]: unknown
}

export interface ToolContext {
  host: PluginHost
  pane: PaneView
  /** Revealed bars: what the reader has been shown. */
  bars: readonly Bar[]
  /** What anchors resolve against: the replay source, or the bars. */
  source: readonly Bar[]
  tf: number
  /** Key every cache of a bar-derived value on this. */
  dataRev: number
  theme: DrawingTheme
  exporting: boolean
  pointerType: string
  visibleBars: number
  formatPrice(price: number): string
  formatTime(time: number): string
  formatSpan(ms: number, approx: boolean): string
  fwd(price: number): number
  inv(value: number): number
  timeAt(u: number): number | null
  indexOf(point: DrawingPoint): number
  pointAt(u: number, price: number): DrawingPoint | null
  textWidth(font: string, text: string): number
}

/**
 * A drawing tool: a pure description of one type of drawing. Tools never
 * reach for the chart; the context is their whole view of it.
 * @experimental
 */
export interface ToolDef<O = object> {
  type: string
  label: string
  anchors: 1 | 2 | 3
  creation: 'points' | 'single'
  dragCreate?: boolean
  snapPrefs: ('high' | 'low' | 'open' | 'close')[]
  prefBoost: number
  defaultStyle: DrawingStyle
  defaultOptions: O
  /** Must return a NEW object with known keys only, and be idempotent. */
  normalizeOptions(raw: unknown): O
  normalizePoints?(points: DrawingPoint[]): DrawingPoint[]
  complete?(points: DrawingPoint[], ctx: ToolContext, drag: Snapped | null, options?: O): DrawingPoint[]
  project(d: Drawing<O>, anchors: ScreenAnchor[], ctx: ToolContext, out: Geom): boolean
  draw(c: CanvasRenderingContext2D, g: Geom, d: Drawing<O>, look: Look, ctx: ToolContext): void
  hit(g: Geom, x: number, y: number, tol: number): { part: 'body' | 'fill' | 'label' | 'tag' } | null
  handles(g: Geom, d: Drawing<O>, out: HandleSpec[], touch: boolean): number
  dragHandle(d0: Drawing<O>, index: number, s: Snapped, ctx: ToolContext): DrawingPoint[]
  dragBody?(d0: Drawing<O>, du: number, dv: number, ctx: ToolContext): DrawingPoint[]
  bleed?(d: Drawing<O>, g: Geom, ctx: ToolContext): number
  angleOrigin?(d: Drawing<O>, handleIndex: number): number
  snapTargets?(d: Drawing<O>, g: Geom, ctx: ToolContext, out: SnapTarget[]): number
  fitTarget?(d: Drawing<O>, placing: number, pointerY: number, ctx: ToolContext): SnapTarget | null
  axisTags?(g: Geom, d: Drawing<O>, ctx: ToolContext, out: AxisTag[]): number
  stats?(d: Drawing<O>, anchors: ScreenAnchor[], ctx: ToolContext): string[]
  priceAt?(d: Drawing<O>, u: number, ctx: ToolContext): number | null
}
