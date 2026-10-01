/**
 * Shared by the profile rendering tests: fixtures, and a reader that turns
 * the recording context's flat op list back into what was painted.
 *
 * The recording context (dom-stub) has no state stack, so "this rect was
 * filled in that colour" is recovered from ORDER: the last fillStyle assigned
 * before the fillRect. That is exactly how a real context behaves, minus
 * save/restore, which the profile never relies on for its colours.
 */
import { makeContainer, makeBars, frame, settle, clearOps } from './dom-stub.mjs'

export const MIN = 60_000
export const D0 = Date.UTC(2024, 0, 2, 9, 15)

/**
 * Read a layer's ops: `rects` (each with the fill in force), `lines` (each
 * stroked segment with its stroke, width and dash), `texts`, the `clip` rect,
 * and where the clip was restored (`restoreAt`, an index into `ops`).
 */
export function read(ops) {
  const out = { ops, rects: [], lines: [], texts: [], clip: null, restoreAt: -1 }
  let fill = null
  let stroke = null
  let width = null
  let dash = []
  let path = []
  let pen = null
  let clipDepth = -1
  let depth = 0
  ops.forEach((o, at) => {
    if (o.op === 'set') {
      if (o.prop === 'fillStyle') fill = o.value
      else if (o.prop === 'strokeStyle') stroke = o.value
      else if (o.prop === 'lineWidth') width = o.value
      return
    }
    if (o.op === 'save') depth++
    else if (o.op === 'restore') {
      if (depth === clipDepth) { out.restoreAt = at; clipDepth = -1 }
      depth--
    } else if (o.op === 'setLineDash') dash = o.args[0]
    else if (o.op === 'beginPath') path = []
    else if (o.op === 'moveTo') pen = o.args
    else if (o.op === 'lineTo') { path.push({ x1: pen[0], y1: pen[1], x2: o.args[0], y2: o.args[1] }); pen = o.args }
    else if (o.op === 'rect') out.pendingRect = o.args
    else if (o.op === 'clip') { out.clip = out.pendingRect; clipDepth = depth; out.clipAt = at }
    else if (o.op === 'stroke') for (const seg of path) out.lines.push({ ...seg, stroke, width, dash, at })
    else if (o.op === 'fillRect') out.rects.push({ x: o.args[0], y: o.args[1], w: o.args[2], h: o.args[3], fill, at })
    else if (o.op === 'fillText') out.texts.push({ text: String(o.args[0]), x: o.args[1], y: o.args[2], fill, at })
  })
  return out
}

/** Run one frame and read what the profile layer recorded in it. */
export function paint(chart, dt = 16, dirty = ['all']) {
  clearOps(chart)
  frame(chart, dt, dirty)
  const canvas = chart.layers.canvas.pluginsBelow
  return read(canvas ? canvas.ops.slice() : [])
}

/** Bars with a real spread, so a POC can be traded through: low/high are price ∓ 1. */
export const bars = (count, tf = MIN, price = 100, start = D0) => makeBars(start, count, tf, price)

/**
 * A chart of `count` bars, all on screen, settled. 900×500 gives an 832×474
 * price pane; with every bar carrying volume the strip takes its bottom 18%.
 */
export function charted(createChart, count = 120, options, tf = MIN) {
  const chart = createChart(makeContainer(), options)
  chart.setData(bars(count, tf))
  chart.fitContent()
  settle(chart); frame(chart)
  return chart
}

/** A session over bars [a, b] of a `charted()` chart. */
export const session = (a, b, bins = [1, 4, 9, 5, 1, 2, 3, 1], extra = {}) => ({
  start: D0 + a * MIN, end: D0 + b * MIN, lo: 99, bins, ...extra,
})

export const data = (sessions, extra = {}) => ({ version: 1, step: 0.25, sessions, ...extra })

/** The profile's bins among the rects: everything filled inside the clip, minus the caption box. */
export const binRects = (p) => p.rects.filter((r) => r.at > p.clipAt && r.at < p.restoreAt && !(r.h === 15 && r.y === p.clip[1]))
