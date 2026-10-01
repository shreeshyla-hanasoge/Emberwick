/**
 * The colours a profile draws with, derived from the chart theme.
 *
 * Nothing is added to the core's defaultTheme: a chart that never imports
 * profiles must not carry profile colours. The four optional Theme keys read
 * here (profileFill, profileValueArea, profilePoc, profileVaLine) are the
 * whole list; the core's index.d.ts types them, which costs no bytes.
 *
 * Why derive rather than ship a palette: a host that calls
 * setTheme(lightTheme) should get a legible profile without knowing profiles
 * exist. The fills are a neutral picked against the background, light on a
 * dark theme and dark on a light one, at an alpha low enough that candles
 * drawn over them keep their own colours. The POC is the one accent.
 */
import { isLight } from '../chart/index.js'

/**
 * @param {object} theme the chart's merged theme
 * @param {object|null} [overrides] the `colors` option; each key wins over the theme
 * @returns {{fill:string, valueArea:string, poc:string, vaLine:string, hover:string}}
 */
export function profileColors(theme, overrides) {
  // The chart always hands over its merged, complete theme; this only stops a
  // missing one (a test, a host calling this directly) from throwing.
  const t = theme || {}
  const o = overrides || {}
  const light = isLight(t.background)
  // One neutral, three strengths: resting bins, value-area bins, the hovered bin.
  const rgb = light ? '31,41,55' : '226,232,244'
  return {
    fill: o.fill || t.profileFill || `rgba(${rgb},0.18)`,
    valueArea: o.valueArea || t.profileValueArea || `rgba(${rgb},0.32)`,
    // A warm orange on both: it has to read against a dark and a white
    // background, and stay apart from up-green, down-red and the drawings'
    // amber selection accent. The light shade keeps 4.5:1 on white.
    poc: o.poc || t.profilePoc || (light ? '#c2570c' : '#ff9f43'),
    vaLine: o.vaLine || t.profileVaLine || t.text,
    hover: o.hover || `rgba(${rgb},0.55)`,
  }
}
