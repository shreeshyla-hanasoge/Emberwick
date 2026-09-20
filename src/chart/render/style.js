/**
 * Stroke styles shared by everything that draws a line.
 *
 * Lifted out of render/annotations.js when series arrived, so price lines and
 * series cannot drift apart on what 'dashed' means.
 */
export const DASH = {
  solid: [],
  dashed: [6, 4],
  dotted: [1, 3],
}
