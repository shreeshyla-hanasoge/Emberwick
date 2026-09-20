/**
 * Panes — horizontal bands of the plot, each with its own price scale,
 * all sharing one time axis.
 *
 * The motivating case is an oscillator. RSI lives on 0..100 and MACD around
 * zero; neither can share a scale with a price near 24,000 without collapsing
 * the candles into a flat line.
 *
 * There is no special case for the first pane. `panes[0]` is the price pane
 * by convention — it is where the candles, volume and annotations draw — but
 * nothing in this file tests for index 0, and the layout arithmetic for one
 * pane is the same arithmetic as for four.
 */
import { PriceScale } from './PriceScale.js'

/** Floor on a pane's height, in CSS px, before weights are applied. */
const DEFAULT_MIN_HEIGHT = 40

export class Pane {
  constructor(id, options = {}, defaults = {}) {
    this.id = String(id)
    /** Flex share of the plot height. The price pane is 3, sub-panes 1. */
    this.weight = isFinite(options.weight) && options.weight > 0 ? +options.weight : 1
    this.minHeight =
      isFinite(options.minHeight) && options.minHeight > 0 ? +options.minHeight : DEFAULT_MIN_HEIGHT
    /** Passthrough caption. Not drawn. */
    this.title = options.title != null ? String(options.title) : ''
    this.ps = new PriceScale(options.priceScale || defaults.priceScale)
    /**
     * Mutated in place by layoutPanes, never replaced, so a consumer holding
     * the object through a resize keeps a live rect rather than a stale copy.
     */
    this.rect = { x: 0, y: 0, w: 1, h: 1 }
    /** Visible series routed here. Rebuilt every frame; not a public list. */
    this.visible = []
  }
}

/**
 * Assign every pane a rect, top to bottom, and lay its scale out to match.
 *
 * Heights are each pane's floor plus a share of what is left over, split by
 * weight. The last pane absorbs the rounding so the bands always add up to
 * exactly `h` — a one-pixel shortfall would show as a seam above the time
 * axis on every frame.
 */
export function layoutPanes(panes, w, h, gap = 0) {
  const n = panes.length
  if (!n) return
  const available = Math.max(n, Math.floor(h) - gap * (n - 1))
  const floors = panes.map((p) => Math.min(p.minHeight, Math.floor(available / n)))
  const floorSum = floors.reduce((a, b) => a + b, 0)
  const slack = Math.max(0, available - floorSum)
  const weightSum = panes.reduce((a, p) => a + p.weight, 0) || 1

  let y = 0
  let used = 0
  for (let i = 0; i < n; i++) {
    const p = panes[i]
    const last = i === n - 1
    const height = last
      ? available - used
      : Math.max(1, Math.round(floors[i] + (slack * p.weight) / weightSum))

    p.rect.x = 0
    p.rect.y = y
    p.rect.w = w
    p.rect.h = Math.max(1, height)
    p.ps.layout(p.rect.y, p.rect.h)

    used += p.rect.h
    y += p.rect.h + gap
  }
}

/**
 * The pane containing `y`, or null when it falls in a gap between panes or
 * below the last one — which is the time axis, and belongs to no pane.
 */
export function paneAtY(panes, y) {
  for (const p of panes) {
    if (y >= p.rect.y && y <= p.rect.y + p.rect.h) return p
  }
  return null
}
