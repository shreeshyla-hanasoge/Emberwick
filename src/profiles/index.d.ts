/**
 * Emberwick volume profiles: typings for `emberwick/profiles`.
 *
 * Hand-written, like the core's. Everything here is @experimental: it is
 * built on the plugin seam, which may change before 1.0.
 *
 * The one import is the core's entry, and it is rewritten to `./index.js` by
 * scripts/pack-lib.mjs when the package is assembled, so the shipped
 * profiles.d.ts sits next to the shipped index.d.ts.
 */
import type { Chart } from '../chart/index.js'

/* -------------------------------------------------------------- contract -- */

/**
 * One session's profile: a column of volumes over fixed price bins.
 *
 * Bin `i` covers `[lo + i*step, lo + (i+1)*step)`, where `step` is the
 * ProfileData's. Times are ms since epoch, on the same clock as `Bar.time`.
 * @experimental
 */
export interface ProfileSession {
  /** Open time of the session's first bar. Also the session's identity: upsertSession() replaces by it. */
  start: number
  /** Open time of its last bar (inclusive). Must not be before `start`. */
  end: number
  /** Price of the LOW edge of bin 0. */
  lo: number
  /** Volume per bin, lowest price first. Anything that is not a positive finite number counts as zero. */
  bins: ArrayLike<number>
  /** Point of control, a price. Computed when absent: the centre of the busiest bin. */
  poc?: number
  /** Value-area high: a bin's HIGH edge. Computed, with `val`, when either is absent. */
  vah?: number
  /** Value-area low: a bin's LOW edge. */
  val?: number
  /** Total volume. Computed as the sum of `bins` when absent. */
  total?: number
  /** Live: this session is still forming. */
  developing?: boolean
}

/**
 * What a host sends: profiles it computed itself, from data finer than the
 * chart draws. Emberwick never computes a profile from bars.
 * @experimental
 */
export interface ProfileData {
  /** The contract version. This build reads 1. */
  version: 1
  /** Where the volume came from, shown in the caption ("Vol: …"). */
  source?: string
  /** Price width of ONE bin, the same for every session. Must be above 0. */
  step: number
  /** Any order; drawn ascending by `start`. May be empty. */
  sessions: ProfileSession[]
}

/* --------------------------------------------------------------- options -- */

/** Which profiles are drawn. @experimental */
export type ProfileMode = 'session' | 'visible' | 'both'

/**
 * The colours a profile draws with. Each defaults to a theme key
 * (`profileFill`, `profileValueArea`, `profilePoc`, `profileVaLine`) and then
 * to a colour derived from `theme.background`.
 * @experimental
 */
export interface ProfileColors {
  /** Bins outside the value area. */
  fill: string
  /** Bins inside the value area (and every bin when `valueArea` is false uses `fill`). */
  valueArea: string
  /** The POC line and its tag. */
  poc: string
  /** The VAH and VAL lines and their tags. */
  vaLine: string
  /** The bin under the pointer. Never drawn in an export. */
  hover: string
}

/** @experimental */
export interface VolumeProfileOptions {
  /** null or empty draws nothing. */
  data?: ProfileData | null
  /** Default 'session'. */
  mode?: ProfileMode
  /**
   * The longest bar, as a share (0 to 1) of the session's pixel span; for the
   * 'visible' profile, of the price pane's width. Default 0.3.
   */
  width?: number
  /** Which side of the pane the 'visible' profile grows from. Default 'right'. */
  side?: 'left' | 'right'
  /** Tint the value-area bins and draw VAH and VAL. Default true. */
  valueArea?: boolean
  /** Draw the POC line. Default true. */
  poc?: boolean
  /**
   * Carry each session's POC line right until a later bar trades through it,
   * or to the right edge (a "naked" POC). Default false.
   */
  extendPoc?: boolean
  /** POC/VAH/VAL price tags in the axis gutter: the latest session's, and the visible profile's. Default true. */
  tags?: boolean
  /** A small caption with `data.source`. Default true; nothing is drawn without a source. */
  label?: boolean
  /** Under replay, hide every session not finished by the last revealed bar. Default true. */
  hideFutureInReplay?: boolean
  /** Overrides the theme. null goes back to it. */
  colors?: Partial<ProfileColors> | null
}

/* ---------------------------------------------------------------- events -- */

/**
 * The bin under the pointer.
 * @experimental
 */
export interface ProfileHover {
  /** The host's own session object, or null for the 'visible' profile (a sum of sessions). */
  session: ProfileSession | null
  /** The price under the pointer. */
  price: number
  /** The bin's low edge. */
  binLow: number
  /** The bin's high edge. */
  binHigh: number
  /** Volume in this bin. */
  volume: number
  /** This bin's share of its profile's total volume, 0 to 100. */
  pct: number
  inValueArea: boolean
}

/* ------------------------------------------------------------ controller -- */

/**
 * A volume profile attached to a chart. Obtained from createVolumeProfile().
 * It paints under the candles and never claims a gesture.
 * @experimental
 */
export interface VolumeProfile {
  /** Replace every session. null draws nothing. Throws on a bad `step` or session, leaving the old data in place. */
  setData(data: ProfileData | null): this
  /**
   * Add one session, or replace the one with the same `start`: how a live
   * host feeds the developing session. Needs setData() first, for the bin step.
   */
  upsertSession(session: ProfileSession): this
  /** Change any option except `data`. Throws on a bad value before applying anything. */
  setOptions(options: Omit<VolumeProfileOptions, 'data'>): this
  /** 'hover': the bin under the pointer, or null when it is over none. */
  on(event: 'hover', fn: (hover: ProfileHover | null) => void): this
  off(event: 'hover', fn: (hover: ProfileHover | null) => void): this
  /** Detach from the chart for good. Idempotent, and safe after chart.destroy(). */
  destroy(): void
  readonly chart: Chart
}

/**
 * Draw volume profiles on `chart`, under its candles.
 *
 * Throws for programmer errors only: not a chart, a destroyed chart, a core
 * older than 0.13, an unknown option value, a `step` of 0 or less, `bins`
 * that is not an array, a `start` after its `end`, or a `lo` that is not a
 * price. A session outside the loaded bars is skipped silently.
 * @experimental
 */
export declare function createVolumeProfile(chart: Chart, options?: VolumeProfileOptions): VolumeProfile

/**
 * Point of control and value area of one profile, as prices: `poc` is the
 * centre of the busiest bin, `vah` the high edge of the top bin of the area
 * and `val` the low edge of the bottom one. null when nothing traded.
 *
 * The standard algorithm: start at the POC, compare the two bins above with
 * the two below, add the larger pair, stop at `share` of the total. A POC tie
 * goes to the bin nearest the middle, then the lower one; two equal pairs
 * resolve to the upper one.
 */
export declare function computeValueArea(
  bins: ArrayLike<number>,
  lo: number,
  step: number,
  share?: number,
): { poc: number; vah: number; val: number } | null

/** The ProfileData contract version this build reads. */
export declare const DATA_VERSION: 1
export declare const version: string
