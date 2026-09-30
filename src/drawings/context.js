/**
 * ToolContext (§11, contract D): everything a tool may know about the world,
 * for one pane.
 *
 * Tools are pure functions of (drawing, screen anchors, context). They never
 * reach for the chart, so this object is the whole of their view of it: the
 * revealed bars and the resolution source, formatting, the pane's forward
 * price space, and the bar-index <-> stored-point mapping of model/time.js.
 *
 * One context per pane, made once and kept (the controller holds them in a
 * WeakMap keyed by the pane object). Its functions therefore keep their
 * identity from frame to frame, which is what the tools' label caches key on;
 * everything that changes between frames is either a getter over the live
 * host or a field the controller rewrites before painting (`dataRev`,
 * `theme`, `pointerType`).
 */
import { formatSpan } from './render/labels.js'
import { fwdOf, invOf } from './render/motion.js'
import { indexToTime, pointIndex, pointFromIndex } from './model/time.js'

/** measureText is not free and labels ask for the same few strings every frame. */
const WIDTH_CACHE_MAX = 2048

/**
 * `measure()` returns a 2D context to measure text with, or null (before the
 * first paint). Without one a width is estimated from the font size, which
 * is only ever used for hit boxes until the first frame measures for real.
 */
export function makeContext(host, pane, theme, measure) {
  const widths = new Map()
  return {
    host,
    pane,
    theme,
    /** Bumped by the controller when anything a bar-derived cache reads may have changed (§3.3). */
    dataRev: 0,
    pointerType: 'mouse',
    get exporting() { return host.exporting },
    /** Revealed bars: what the reader has been shown. Magnet, outcome and volume read only these (§3.4). */
    get bars() { return host.bars },
    /** What anchors resolve against: the replay source, or the bars. */
    get source() { return host.source },
    get tf() { return host.timeframeMs },
    get visibleBars() {
      const ts = host.ts
      return ts.spacing > 0 ? ts.width / ts.spacing : 0
    },
    formatPrice: (p) => host.formatPrice(p, pane),
    formatTime: (t) => host.fmt.full(t),
    formatSpan,
    // From the public mode, never ps._fwd: plugins do not read private members.
    fwd: (p) => fwdOf(pane.ps.mode, p),
    inv: (v) => invOf(pane.ps.mode, v),
    timeAt: (u) => indexToTime(host.source, u, host.timeframeMs),
    indexOf: (pt) => pointIndex(host.source, pt, host.timeframeMs),
    pointAt: (u, price) => pointFromIndex(host.source, u, price, host.timeframeMs),
    textWidth(font, text) {
      const f = String(font)
      const s = String(text)
      // Keyed on (font, text): setTheme({ font }) changes the font string and
      // so re-measures. Bounded, so a stream of unique labels cannot grow it.
      const key = f + '\u0001' + s
      if (widths.size > WIDTH_CACHE_MAX) widths.clear()
      let w = widths.get(key)
      if (w === undefined) {
        const c = measure ? measure() : null
        if (c) {
          c.font = f
          const m = c.measureText(s)
          w = m && m.width >= 0 ? m.width : 0
          widths.set(key, w)
        } else {
          // Not cached: the first real paint measures it properly.
          const px = /(\d+(?:\.\d+)?)px/.exec(f)
          return s.length * (px ? +px[1] : 12) * 0.6
        }
      }
      return w
    },
  }
}
