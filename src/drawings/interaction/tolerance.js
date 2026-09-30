/**
 * How close is close enough, per kind of pointer.
 *
 * One table, so "the finger tolerance" means the same thing to hit testing,
 * snapping, slop and the handles that are drawn. A fingertip covers about
 * 44 pt of glass and a mouse one pixel; a single radius for both makes the
 * phone unusable or the desktop sloppy, so every consumer asks here instead
 * of carrying its own literal.
 *
 *   line         a stroke counts as hit within this many px
 *   handle       a handle counts as hit within this radius (touch: a 44 pt target)
 *   handleDrawn  the radius a handle is PAINTED at, smaller than its hit radius
 *   anchor       snap onto another drawing's anchor
 *   level        snap onto a level rail (horizontal line, fib level, price line)
 *   magnet       weak OHLC magnet. The mouse value must equal the core
 *                crosshair's literal (render/crosshair.js), or the crosshair and
 *                a drawing would disagree about where the same high is; a
 *                parity test reads that file and fails when they drift.
 *   slop         travel before a press becomes a drag. Mouse matches the core's
 *                tap travel, touch its TOUCH_SLOP, so "a tap" means one thing.
 */
const TOLERANCE = {
  mouse: Object.freeze({ line: 5, handle: 8, handleDrawn: 4.5, anchor: 8, level: 6, magnet: 22, slop: 3 }),
  pen: Object.freeze({ line: 7, handle: 12, handleDrawn: 5, anchor: 10, level: 8, magnet: 22, slop: 4 }),
  touch: { line: 14, handle: 22, handleDrawn: 7, anchor: 16, level: 12, magnet: 28, slop: 10 },
}
// Frozen after the literal so the touch row stays a single greppable line.
Object.freeze(TOLERANCE.touch)

/**
 * The tolerances for `pointerType`. Anything unrecognised reads as a mouse:
 * some browsers report '' for a pointer they cannot classify, and a synthetic
 * event may carry none at all, and the mouse row is the conservative one
 * (small radii never grab a drawing the reader did not aim at).
 */
export function tolerance(pointerType) {
  if (pointerType === 'touch') return TOLERANCE.touch
  if (pointerType === 'pen') return TOLERANCE.pen
  return TOLERANCE.mouse
}
