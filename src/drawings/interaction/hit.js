/**
 * Hit testing: which drawing, and which part of it, is under a point.
 *
 * Geometry is never recomputed here. Each slot carries the Geom its tool
 * projected for the last paint, and `tool.hit` answers against that, so what
 * the reader sees is exactly what the reader can grab. This file only decides
 * the ORDER in which drawings are asked, which is the part that makes a chart
 * with a translucent box over a thin line usable at all.
 */
import { tolerance } from './tolerance.js'

/**
 * Distance from (px, py) to the segment A–B, in the same units as the input.
 *
 * Math.hypot rather than a squared length: a ray clipped to a rect is bounded,
 * but a caller passing raw projected anchors can hand over 1e200, and dx*dx
 * overflows to Infinity long before hypot does. A zero-length segment is its
 * point. Non-finite input comes back NaN, which fails every `d <= tol`
 * comparison — a broken anchor is never "close".
 */
export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  let t = 0
  if (len > 0) {
    t = ((px - ax) * (dx / len) + (py - ay) * (dy / len)) / len
    if (t < 0) t = 0
    else if (t > 1) t = 1
  }
  return Math.hypot(ax + t * dx - px, ay + t * dy - py)
}

// Liang–Barsky's running parameter window. Module scope so clipLine allocates
// nothing: it runs for every segment of every drawing on every frame.
let T0 = 0
let T1 = 1

/** Narrow [T0, T1] by one edge. false = the line is parallel to and outside it. */
function edge(p, q) {
  if (p === 0) return q >= 0
  const r = q / p
  if (p < 0) { if (r > T0) T0 = r }
  else if (r < T1) T1 = r
  return true
}

/**
 * Clip A→B to `rect` (Liang–Barsky), optionally extended past A (`extStart`)
 * and past B (`extEnd`) to infinity. Writes the visible part to `out` and
 * returns true, or returns false when none of it is inside.
 *
 * Every segment a drawing strokes goes through here before it reaches the
 * canvas. An infinite ray, or an anchor at a price of 1e12 on a 100-point
 * chart, would otherwise hand the canvas coordinates far outside what it can
 * rasterise reliably; after clipping every coordinate lies on the rect.
 *
 * A zero-length segment has no direction to extend in, so it is treated as a
 * point whatever the flags say (the tools' "degenerate: no extension" rule).
 */
export function clipLine(ax, ay, bx, by, extStart, extEnd, rect, out) {
  const dx = bx - ax
  const dy = by - ay
  // Also catches finite anchors whose difference overflows (1e308 - -1e308).
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(ax) || !Number.isFinite(ay)) return false
  const point = dx === 0 && dy === 0
  T0 = extStart && !point ? -Infinity : 0
  T1 = extEnd && !point ? Infinity : 1
  const x0 = rect.x
  const y0 = rect.y
  if (!edge(-dx, ax - x0) || !edge(dx, x0 + rect.w - ax)) return false
  if (!edge(-dy, ay - y0) || !edge(dy, y0 + rect.h - ay)) return false
  const t0 = T0
  const t1 = T1
  if (t0 > t1) return false
  out.ax = ax + t0 * dx
  out.ay = ay + t0 * dy
  out.bx = ax + t1 * dx
  out.by = ay + t1 * dy
  return true
}

const inside = (r, x, y, pad) =>
  !!r && x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad

/**
 * A custom tool's hit() or handles() that throws counts as a miss for that
 * drawing: one broken ToolDef must not take pointer input down for every
 * other drawing on the chart (the scene isolates its draw() the same way).
 */
function toolHit(s, x, y, tol) {
  try { return s.tool.hit(s.geom, x, y, tol) || null } catch (_) { return null }
}

function toolHandles(s, out, touch) {
  try { return s.tool.handles(s.geom, s.d, out, touch) | 0 } catch (_) { return 0 }
}

/**
 * The cursor a hit asks for (§5.9). Locked drawings can be clicked to select
 * them, so their strokes say `pointer`; a locked FILL says nothing, because a
 * press there pans the chart and the chart's own cursor is the honest one.
 */
function cursorFor(s, part, handle, selected) {
  if (s.d.locked) return part === 'fill' ? null : 'pointer'
  if (part === 'handle') return (handle && handle.cursor) || 'grab'
  if (part === 'move') return 'move'
  return selected ? 'move' : 'pointer'
}

function result(s, part, index, handle, selected) {
  return {
    id: s.id,
    part,
    index,
    locked: s.d.locked === true,
    cursor: cursorFor(s, part, handle, selected),
    // Where the grabbed handle is drawn, so a drag can keep it exactly under
    // the finger (the grab offset, §5.2). NaN for anything but a handle.
    hx: handle ? handle.x : NaN,
    hy: handle ? handle.y : NaN,
  }
}

/**
 * The drawing part under (x, y), in priority order (§4.2):
 *
 *   1. a handle of the selected drawing (nearest within the handle radius);
 *   2. an axis tag of the selected drawing;
 *   3. a stroke, label or tag of ANY drawing, top of the z-order first;
 *   4. a fill ('fill' = an interior-only hit), top first.
 *
 * Classes 3 and 4 are split so a thin trendline under a translucent box stays
 * grabbable: the box's interior only wins where no stroke is. `slots` is in z
 * order (ascending), as the controller keeps it.
 *
 * Never hit: hidden, orphaned (no pane), inert, broken (its project/draw threw
 * for this very drawing identity), unpainted (not on screen last frame) and
 * unprimed-pane drawings. A hit outside the slot's clip rect — its own pane,
 * or the whole plot for a full-height vertical line — does not count either,
 * except an axis tag, which lives in the gutter by definition.
 *
 * Locked drawings ARE hit (a click must be able to select one to unlock it);
 * the result says `locked: true` and the state machine refuses the press.
 */
export function pickHit(slots, x, y, pointerType, selectedId, scratch, clipRect) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !slots) return null
  const tol = tolerance(pointerType)
  const touch = pointerType === 'touch'
  const rectOf = (s) => (clipRect ? clipRect(s) : s.pane.rect)

  if (selectedId != null) {
    let sel = null
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].id === selectedId) { sel = slots[i]; break }
    }
    if (sel && hittable(sel)) {
      const out = scratch || []
      const n = toolHandles(sel, out, touch)
      let best = null
      let bestD = Infinity
      for (let k = 0; k < n; k++) {
        const h = out[k]
        if (!h) continue
        const d = Math.hypot(h.x - x, h.y - y)
        if (d <= tol.handle && d < bestD) { bestD = d; best = h }
      }
      // A handle at a pane edge is drawn whole across the edge (the handle
      // pass inflates its clip), so it is grabbable across it too.
      if (best && inside(rectOf(sel), x, y, tol.handle)) {
        return result(sel, best.move ? 'move' : 'handle', best.index, best, true)
      }
      const t = toolHit(sel, x, y, tol.line)
      if (t && t.part === 'tag') return result(sel, 'tag', -1, null, true)
    }
  }

  let best = null
  let bestSlot = null
  for (let i = slots.length - 1; i >= 0; i--) {
    // The first stroke found from the top wins outright; only a fill keeps
    // looking, for a stroke underneath it.
    if (best && best.part !== 'fill') break
    const s = slots[i]
    if (!s || !s.d) continue
    if (!s.d.visible || !s.pane || s.inert) continue
    if (!painted(s)) continue
    const h = toolHit(s, x, y, tol.line)
    if (!h) continue
    if (h.part !== 'tag' && !inside(rectOf(s), x, y, 0)) continue
    if (best && best.part === 'fill' && h.part !== 'fill') best = null
    if (!best) { best = h; bestSlot = s }
  }
  if (!best) return null
  return result(bestSlot, best.part, -1, null, bestSlot.id === selectedId)
}

/**
 * On screen last paint, on a primed pane, and not the drawing identity that
 * last threw. An unprimed pane's scale is still its 0..1 constructor default,
 * so its drawings were not projected and their geometry means nothing.
 */
function painted(s) {
  return s.drawn === true && s.broken !== s.d && !!s.pane.ps && s.pane.ps.primed !== false
}

function hittable(s) {
  return !!s.d && s.d.visible !== false && !!s.pane && !s.inert && painted(s)
}
