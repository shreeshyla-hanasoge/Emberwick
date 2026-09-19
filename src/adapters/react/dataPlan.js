/**
 * What to do with a new `data` prop.
 *
 * Pulled out of the React adapter so it can be reasoned about — and tested —
 * without React. It imports nothing: the same decision applies to any
 * framework wrapper that receives an array it does not own.
 *
 * The problem it solves: a wrapper is handed a fresh array identity on every
 * render, while `setData()` re-anchors the view to the right edge. Applying it
 * on identity throws away the user's pan and zoom on every parent render.
 */

/** Cheap content signature of a bar array. Null for an empty or absent one. */
export function fingerprint(bars) {
  if (!Array.isArray(bars) || !bars.length) return null
  const last = bars[bars.length - 1]
  return {
    len: bars.length,
    firstTime: bars[0].time,
    lastTime: last.time,
    lastClose: last.close,
  }
}

/**
 * Decide how to apply `bars` given the fingerprint of what was applied last.
 *
 * @returns {{action: 'none'|'update'|'append'|'replace', from?: number, next: object|null}}
 *   - none    nothing changed; do not touch the chart
 *   - update  the forming candle moved; merge it
 *   - append  bars were added to the same history; append from `from`
 *   - replace a different dataset; setData and re-anchor
 */
export function planDataUpdate(prev, bars) {
  const next = fingerprint(bars)
  if (!next) return { action: 'none', next: prev }
  if (!prev) return { action: 'replace', next }

  const sameWindow = prev.len === next.len && prev.firstTime === next.firstTime

  if (sameWindow && prev.lastTime === next.lastTime) {
    // Same bars behind a new array identity, or a new close on the last one.
    return prev.lastClose === next.lastClose
      ? { action: 'none', next: prev }
      : { action: 'update', next }
  }

  // A strict extension: the history is untouched and bars were added on the
  // end. Appending keeps the viewport where the user left it; setData would
  // yank it back to the right edge.
  const extends_ =
    next.len > prev.len &&
    prev.firstTime === next.firstTime &&
    bars[prev.len - 1] &&
    bars[prev.len - 1].time === prev.lastTime

  return extends_ ? { action: 'append', from: prev.len, next } : { action: 'replace', next }
}
