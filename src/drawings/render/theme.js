/**
 * The drawing theme, derived from the chart theme.
 *
 * Nothing is added to the core's defaultTheme: a chart that never imports
 * drawings must not carry drawing colours. The three optional Theme keys read
 * here (drawingAccent, drawingLine, drawingFib) are the whole list; the core's
 * index.d.ts types them, which costs no bytes.
 *
 * Why derive rather than ship a second palette: a host that calls
 * setTheme(lightTheme) should get legible drawings without knowing drawings
 * exist. Everything that can follow the chart (label pills, up/down, the font,
 * the crosshair's guide colour) does; the two colours that cannot be derived
 * (the default line and the accent) are picked per light/dark background.
 */

import { isLight } from '../../chart/index.js'

// isLight moved into the core in 0.13, so every plugin asks the question the
// same way. It is re-exported because this module has always exported it.
export { isLight }

/**
 * Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb() and rgba() into [r, g, b]
 * (0..255), or null. Deliberately small: named colours, hsl() and
 * color-mix() read as unknown, and unknown reads as dark (the house theme).
 *
 * A private copy of the parser inside the core's isLight, which the core
 * entry does not export: the paint helpers and their tests still parse
 * colours here.
 */
export function parseColor(color) {
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

export function drawingTheme(t, overrides) {
  // The chart always hands over its merged, complete theme; this only stops a
  // missing one (a test, a host calling this directly) from throwing.
  t = t || {}
  const light = isLight(t.background)      // relative luminance > 0.5, parsed #rgb/#rrggbb/rgb(); unknown -> dark
  const accent = t.drawingAccent || (light ? '#d97706' : '#f5a524')   // ember amber, distinct from up/down
  // The wrong-side position colour (D21). It was amber (#f59e0b), within one
  // degree of hue of the dark accent (#f5a524), so a wrong-side box read as a
  // selected one. Everything near amber is the accent's, red and green are
  // down and up, so "wrong" goes to magenta: about 105 degrees of hue from
  // amber and 70 from red, and the colour renderers use for "this value is not
  // valid". Per background, like the accent: the light shade keeps white tag
  // text above 4.5:1, the dark one keeps dark tag text above 8:1.
  const warn = light ? '#c026d3' : '#e879f9'
  return {
    line: t.drawingLine || (light ? '#2962ff' : '#6ea8fe'),
    accent, handleFill: t.background, halo: accent, labelBg: t.labelBg, labelText: t.labelText,
    tagText: t.tagText || t.labelText, up: t.up, down: t.down, warn,
    guide: t.crosshair, font: t.font, textColor: t.textStrong || t.labelText,
    fib: t.drawingFib || ['#787b86','#ef5350','#f5a524','#26a69a','#22b8cf','#5b9cf6','#787b86','#c084fc','#ec407a','#9ca3af'],
    ...overrides,
  }
}
