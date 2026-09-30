/**
 * The snap pipeline (§5.5): where a pointer lands, in data terms.
 *
 * Every point a drawing stores — a new anchor, a dragged handle, the preview
 * reticle, a quick-measure end — comes out of snapPoint, so "where would this
 * land?" has exactly one answer everywhere. The stages run in a fixed order
 * and the FIRST one that matches wins:
 *
 *   1. Alt              free: the exact pointer, fractional bar and all
 *   2. Shift + origin   0° / 45° / 90° from the fixed anchor, in screen space
 *   3. anchor           another drawing's anchor, copied exactly
 *   4. level rails      horizontal lines, fib levels, position levels, price
 *                       lines, the channel fit; then a 4 px alignment guide
 *   5. OHLC magnet      the bar's open/high/low/close (a series on a sub-pane)
 *   6. bar slot         the bar under the pointer, the price under the pointer
 *
 * Stages 3–5 would each grab the pointer from anywhere within their radius and
 * let go at exactly the same radius, which flickers when the hand shakes on
 * the boundary. So an engaged snap is held out to 1.5× its engage radius
 * (hysteresis), keyed on the previous result's kind, which the state machine
 * owns and passes back in as `input.prev`.
 *
 * Pure apart from reading the scales. It runs once per pointer event or
 * re-derive, never per drawing, so a result object per call is fine.
 */
import { toNumber } from '../../chart/index.js'
import { pointFromIndex } from '../model/time.js'
import { tolerance } from './tolerance.js'

/** Screen distance at which another anchor's price is offered as a guide. */
const ALIGN_PX = 4

const OHLC = ['open', 'high', 'low', 'close']
const OHLC_TAG = { open: 'O', high: 'H', low: 'L', close: 'C' }
/** Close first: it is the level a trader most often means by "this bar". */
const DEFAULT_PREFS = ['close', 'high', 'low', 'open']

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

/**
 * The effective magnet for one gesture. `'inherit'` follows the chart's own
 * magnet toggle (true reads as weak), so the Playground's single switch drives
 * the crosshair and the drawings together. The platform modifier (`invert`)
 * flips it for the gesture: any magnet off, or no magnet on (weak).
 */
export function resolveMagnet(mode, hostMagnet, invert) {
  let m = mode == null || mode === 'inherit' ? (hostMagnet ? 'weak' : 'off') : mode
  if (m !== 'weak' && m !== 'strong') m = 'off'
  if (invert) m = m === 'off' ? 'weak' : 'off'
  return m
}

/**
 * Engage radius with hysteresis: a snap of the kind that held last time is
 * released only past 1.5× the radius it engaged at.
 */
function reach(prev, kind, radius) {
  const r = prev && prev.kind === kind ? radius * 1.5 : radius
  return r
}

/** A stored point verbatim: time, price and — when present — offset and tf. */
function exactCopy(p) {
  const o = { time: p.time, price: p.price }
  if (p.offset !== undefined) o.offset = p.offset
  if (p.tf !== undefined) o.tf = p.tf
  return o
}

/**
 * The point an anchor snap stores. An exact copy, `offset` and `tf` included:
 * two trendlines that share an anchor ten bars past the newest bar must stay
 * joined after the next session arrives or the timeframe changes, which only
 * holds if both store the very same bar count. Re-deriving it from the slot
 * would round a fractional anchor and rescale an offset drawn on another
 * timeframe.
 */
function anchorPoint(hit, env, tf) {
  if (hit.point) {
    return exactCopy(hit.point)
  }
  return pointFromIndex(env.host.source, hit.u, hit.price, tf)
}

/** A target's current screen y, re-projected so a target list built a frame ago is still exact. */
function targetY(ps, t) {
  const p = toNumber(t.price)
  return Number.isFinite(p) ? ps.y(p) : NaN
}

/** First position in `drawable` whose index is >= `from` (series.js's lowerBound; deep imports split the core). */
function lowerBoundIndex(drawable, from) {
  let lo = 0
  let hi = drawable.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (drawable[mid].index < from) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Result of magnetSnap; module scope so the per-move path allocates nothing.
const MAG = { price: NaN, kind: 'ohlc', tag: null }

const isPricePane = (pane, host) => pane.id === 'price' || (!!host.panes && host.panes[0] === pane)

/**
 * OHLC magnet at bar `slot` (stage 5). Writes MAG and returns it, or null.
 *
 * Reads only `host.bars`, the REVEALED bars: during replay the source runs
 * past the cursor, and snapping to a high the reader has not been shown yet
 * would leak the future into a backtest. The slot guard is also what keeps a
 * pointer in the whitespace right of the newest bar from reading bars[n].
 *
 * The tool's preferred pair (its first two snapPrefs) engages at
 * `boost` × the radius: a fib is almost always drawn from a high to a low.
 */
function magnetSnap(slot, y, pane, env, mode, prefs, boost, radius, prev) {
  if (mode === 'off') return null
  if (slot < 0 || slot > env.host.bars.length - 1) return null
  const ps = pane.ps
  const log = ps.mode === 'log'
  let best = NaN
  let bestD = Infinity
  let bestEff = Infinity
  let bestW = 1
  let bestTag = null
  let kind = 'ohlc'
  if (isPricePane(pane, env.host)) {
    const bar = env.host.bars[slot]
    // Preferred keys first, then whatever OHLC key the tool did not list, so
    // ties go to the preference and no price the reader can see is unsnappable.
    for (let i = 0; i < prefs.length + OHLC.length; i++) {
      const key = i < prefs.length ? prefs[i] : OHLC[i - prefs.length]
      if (i >= prefs.length && prefs.indexOf(key) >= 0) continue
      if (!OHLC_TAG[key]) continue
      const p = toNumber(bar[key])
      if (!Number.isFinite(p) || (log && p <= 0)) continue
      const d = Math.abs(ps.y(p) - y)
      const w = i < 2 && i < prefs.length ? boost : 1
      const eff = d / w
      if (eff < bestEff) { bestEff = eff; bestD = d; bestW = w; best = p; bestTag = OHLC_TAG[key] }
    }
  } else {
    // A sub-pane has no bars of its own: its magnet is the series drawn in it
    // (RSI, MACD), found at this slot exactly as the series renderer indexes it.
    kind = 'series'
    const vis = pane.visible || []
    for (let s = 0; s < vis.length; s++) {
      const dr = vis[s] && vis[s].drawable
      if (!dr || !dr.length) continue
      const j = lowerBoundIndex(dr, slot)
      if (j >= dr.length || dr[j].index !== slot) continue
      const v = toNumber(dr[j].value)
      if (!Number.isFinite(v) || (log && v <= 0)) continue
      const d = Math.abs(ps.y(v) - y)
      if (d < bestEff) { bestEff = d; bestD = d; best = v; bestTag = null }
    }
  }
  if (!Number.isFinite(best)) return null
  if (mode !== 'strong' && bestD > reach(prev, kind, radius * bestW)) return null
  MAG.price = best
  MAG.kind = kind
  MAG.tag = bestTag
  return MAG
}

/**
 * u of the angle origin. A creation origin carries its stored `point`, which
 * is re-resolved against the current bars (a history prepend renumbers every
 * bar mid-gesture); a ScreenAnchor from the controller is already fresh.
 */
function originU(origin, env) {
  if (origin.point && env.ctx && typeof env.ctx.indexOf === 'function') {
    const u = env.ctx.indexOf(origin.point)
    if (Number.isFinite(u)) return u
  }
  return origin.u
}

/**
 * Snap a pointer (§5.5). Returns null when there is nothing to place: no pane,
 * an unprimed pane (its scale is not a price range yet), or zero bars.
 *
 *   input: { x, y, pane, pointerType, shift, alt, invert, origin?, excludeId?,
 *            prefs?, prefBoost?, prev, allowAngle, fit }
 *   env:   { host, ctx, targets, magnet }
 *
 * The pointer is clamped into the pane first: a drawing never changes pane,
 * and a handle dragged past the edge parks on it instead of storing a price
 * from the neighbouring pane's scale.
 */
export function snapPoint(input, env) {
  const pane = input.pane
  const host = env.host
  if (!pane || !pane.ps || !pane.rect || !host || !host.ts) return null
  const src = host.source || host.bars || []
  if (!src.length || pane.ps.primed === false) return null
  const px = toNumber(input.x)
  const py = toNumber(input.y)
  if (Number.isNaN(px) || Number.isNaN(py)) return null

  const ts = host.ts
  const ps = pane.ps
  const rect = pane.rect
  const tf = env.ctx && env.ctx.tf > 0 ? env.ctx.tf : host.timeframeMs
  const tol = tolerance(input.pointerType)
  const prev = input.prev || null
  const log = ps.mode === 'log'
  const x = clamp(px, rect.x, rect.x + rect.w)
  const y = clamp(py, rect.y, rect.y + rect.h)
  // Identical to the crosshair's rounding, so the reticle and the crosshair
  // never disagree about which bar the pointer is on. `+ 0` turns the -0 that
  // Math.round(-0.4) gives into 0, so no stored u prints as "-0".
  const slot = Math.round(ts.index(x)) + 0
  const prefs = input.prefs && input.prefs.length ? input.prefs : DEFAULT_PREFS
  const boost = input.prefBoost > 0 ? input.prefBoost : 1
  const magnet = resolveMagnet(env.magnet, host.magnet, input.invert)
  const targets = env.targets || []
  const origin = !input.alt && input.shift && input.allowAngle && input.origin ? input.origin : null
  const ou = origin ? originU(origin, env) : NaN

  let u = slot
  let price = NaN
  let kind = 'slot'
  let tag = null
  let targetId = null
  let guide = null
  let point = null
  let ox = NaN
  let oy = NaN

  if (input.alt) {
    u = ts.index(x)
    price = ps.price(y)
    kind = 'free'
  } else if (origin && Number.isFinite(ou) && Number.isFinite(origin.price)) {
    // Octants of the screen angle from the fixed anchor: 0/4 horizontal,
    // 2/6 vertical, odd = the diagonals. Screen space, because "level" and
    // "45°" are what the reader sees; a data-space angle depends on the zoom.
    ox = ts.x(ou)
    oy = ps.y(origin.price)
    const oct = ((Math.round(Math.atan2(oy - y, x - ox) / (Math.PI / 4)) % 8) + 8) % 8
    kind = 'angle'
    if (oct === 0 || oct === 4) {
      // Level: the price is the origin's, bit for bit. Round-tripping it
      // through y would store 101.25000000000001 and the two anchors of a
      // "horizontal" line would differ in the saved JSON.
      u = slot
      price = origin.price
    } else if (oct === 2 || oct === 6) {
      // Vertical: u is the origin's, bit for bit; the magnet still applies
      // to y, on the origin's bar.
      u = ou
      const m = magnetSnap(Math.round(ou), y, pane, env, magnet, prefs, boost, tol.magnet, prev)
      price = m ? m.price : ps.price(y)
      if (m) tag = m.tag
    } else {
      // 45°: x stays on the bar slot (crisp) and y follows from it.
      u = slot
      const d = Math.abs(ts.x(slot) - ox)
      price = ps.price(oct === 1 || oct === 3 ? oy - d : oy + d)
    }
  } else {
    // 3. Anchor to anchor: the nearest anchor of another drawing on this pane.
    let hit = null
    let hitD = Infinity
    const ar = reach(prev, 'anchor', tol.anchor)
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      if (!t || t.kind !== 'anchor' || t.paneId !== pane.id || t.id === input.excludeId) continue
      if (!Number.isFinite(t.u)) continue
      const d = Math.hypot(ts.x(t.u) - x, targetY(ps, t) - y)
      if (d <= ar && d < hitD) { hitD = d; hit = t }
    }
    if (hit) {
      point = anchorPoint(hit, env, tf)
      u = hit.u
      price = point ? point.price : NaN
      kind = 'anchor'
      tag = '⊕'
      targetId = hit.id
    }

    // 4. Level rails (y only; x stays on the slot), then the alignment guide.
    if (kind === 'slot') {
      let railD = Infinity
      const consider = (p, k, id, tg) => {
        if (!Number.isFinite(p) || (log && p <= 0)) return
        const d = Math.abs(ps.y(p) - y)
        if (d <= reach(prev, k, tol.level) && d < railD) {
          railD = d
          price = p
          kind = k
          targetId = id
          tag = tg
        }
      }
      for (let i = 0; i < targets.length; i++) {
        const t = targets[i]
        if (!t || t.kind !== 'level' || t.paneId !== pane.id || t.id === input.excludeId) continue
        consider(toNumber(t.price), 'level', t.id, t.tag == null ? null : t.tag)
      }
      if (isPricePane(pane, host) && host.priceLines) {
        for (let i = 0; i < host.priceLines.length; i++) {
          const L = host.priceLines[i]
          if (L) consider(toNumber(L.price), 'level', 'priceLine:' + (L.id != null ? L.id : i), null)
        }
      }
      if (input.fit) consider(toNumber(input.fit.price), 'fit', input.fit.id == null ? null : input.fit.id, input.fit.tag == null ? null : input.fit.tag)

      if (kind === 'slot') {
        // Figma-style: another anchor at (almost) this height lends its exact
        // price, and a dashed guide shows which one.
        let alignD = Infinity
        let at = null
        const alr = reach(prev, 'align', ALIGN_PX)
        for (let i = 0; i < targets.length; i++) {
          const t = targets[i]
          if (!t || t.kind !== 'anchor' || t.paneId !== pane.id || t.id === input.excludeId) continue
          const p = toNumber(t.price)
          if (!Number.isFinite(p) || (log && p <= 0) || !Number.isFinite(t.u)) continue
          const d = Math.abs(ps.y(p) - y)
          if (d <= alr && d < alignD) { alignD = d; at = t }
        }
        if (at) {
          price = toNumber(at.price)
          kind = 'align'
          targetId = at.id
          ox = ts.x(at.u)
          oy = ps.y(price)
        }
      }
    }

    // 5. OHLC magnet (a sub-pane's series), 6. the bar slot.
    if (kind === 'slot') {
      const m = magnetSnap(slot, y, pane, env, magnet, prefs, boost, tol.magnet, prev)
      if (m) {
        price = m.price
        kind = m.kind
        tag = m.tag
      } else {
        price = ps.price(y)
      }
    }
  }

  if (!Number.isFinite(u) || !Number.isFinite(price)) return null
  if (!point) point = pointFromIndex(src, u, price, tf)
  if (!point) return null
  const sx = ts.x(u)
  const sy = ps.y(price)
  if ((kind === 'angle' || kind === 'align') && Number.isFinite(ox) && Number.isFinite(oy)) {
    guide = { x0: ox, y0: oy, x1: sx, y1: sy }
  }
  // `u0` / `price0`: where the same pointer lands with every snap off (the bar
  // slot, or the free position under Alt), at THIS view. A glide is measured
  // between the two inside one frame: comparing against the previous frame's
  // point would count a view that jumped in between as the snap's distance.
  const free = !!input.alt
  return {
    u, point, x: sx, y: sy, kind, tag, targetId, guide,
    u0: free ? ts.index(x) : slot, price0: ps.price(y),
    state: { kind, targetId, tag, x: sx, y: sy },
  }
}

/**
 * Snap targets for pane `paneId` from the controller's slots: each tool's own
 * `snapTargets` when it has them, else its anchors. Skips `excludeId` (the
 * drawing being dragged must not snap to itself) and everything that is not
 * visible and painted. Allocates; call it per gesture event, not per frame.
 */
export function collectSnapTargets(slots, paneId, excludeId, ctxFor, out) {
  out.length = 0
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i]
    if (!s || !s.d || s.inert || s.d.visible === false || !s.pane || s.pane.id !== paneId) continue
    if (s.id === excludeId || s.broken === s.d || s.drawn !== true) continue
    const ctx = ctxFor(s.pane)
    if (typeof s.tool.snapTargets === 'function') {
      const tmp = []
      let n = 0
      try { n = s.tool.snapTargets(s.d, s.geom, ctx, tmp) | 0 } catch (_) { n = 0 }
      for (let k = 0; k < n; k++) if (tmp[k]) out.push(tmp[k])
      continue
    }
    const ts = ctx.host.ts
    const pts = s.d.points
    for (let k = 0; k < pts.length; k++) {
      const u = s.u ? s.u[k] : NaN
      if (!Number.isFinite(u)) continue
      out.push({
        kind: 'anchor', x: ts.x(u), y: s.pane.ps.y(pts[k].price), u, price: pts[k].price,
        point: pts[k], paneId: s.pane.id, id: s.id, tag: null,
      })
    }
  }
  return out
}
