/**
 * Is a colour light? The one question a plugin has to ask of a theme.
 *
 * A theme carries no dark/light flag, and a plugin that derives its own
 * colours (a drawing's default stroke, a profile's fill) has to pick a set
 * that reads on whatever `background` the host passed. This lived in
 * src/drawings until a second plugin needed the same answer.
 */

/**
 * Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba() into [r, g, b]
 * (0..255), or null. Deliberately small: named colours, hsl() and
 * color-mix() read as unknown, and unknown reads as dark (the house theme).
 */
function parseColor(color) {
  if (typeof color !== 'string') return null
  const s = color.trim().toLowerCase()
  if (s[0] === '#') {
    const h = s.slice(1)
    if (!/^[0-9a-f]+$/.test(h)) return null
    if (h.length === 3 || h.length === 4) {
      return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
    }
    if (h.length === 6 || h.length === 8) {
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
    }
    return null
  }
  const m = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?/.exec(s)
  if (!m) return null
  const out = [+m[1], +m[2], +m[3]]
  for (let i = 0; i < 3; i++) {
    if (!isFinite(out[i])) return null
    out[i] = Math.max(0, Math.min(255, out[i]))
  }
  return out
}

/** sRGB channel (0..255) to linear light, per WCAG's relative luminance. */
const lin = (c) => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/**
 * True when `color` is a light background: relative luminance > 0.5.
 * Unknown formats read as dark, because the default theme is dark and a
 * wrong guess there costs least.
 *
 * @param {string} color #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() or rgba()
 * @returns {boolean}
 */
export function isLight(color) {
  const rgb = parseColor(color)
  if (!rgb) return false
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]) > 0.5
}
