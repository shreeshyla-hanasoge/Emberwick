import React from 'react'

/**
 * The demo's icon set: inline SVG, 24x24 grid, stroked with currentColor so a
 * button's own colour (muted, hover, active) recolours the glyph with no extra
 * CSS. Nothing is fetched and nothing is a font.
 *
 * The tool glyphs are keyed by TOOL_PRESETS name, so the rail can look an icon
 * up from the API's own preset list instead of keeping a parallel table of
 * tools that could drift from what the library really draws.
 */
const dot = (cx, cy, r = 1.9) => <circle cx={cx} cy={cy} r={r} fill="var(--panel, #0f131c)" />

const G = {
  // ---- tools (keys are TOOL_PRESETS names) --------------------------------
  cursor: <path d="M6 3.5l12 6.6-5.2 1.5-2.1 5.2z" />,
  trendLine: (
    <>
      <path d="M6 18L18 6" />
      {dot(6, 18)}
      {dot(18, 6)}
    </>
  ),
  ray: (
    <>
      <path d="M6 17L21 4.5" />
      {dot(6, 17)}
      <path d="M17 4.5h4v4" />
    </>
  ),
  extendedLine: (
    <>
      <path d="M3 21L21 3" />
      {dot(9, 15)}
      {dot(15, 9)}
    </>
  ),
  arrow: (
    <>
      <path d="M5 19L19 5" />
      <path d="M11.5 5H19v7.5" />
    </>
  ),
  horizontalLine: (
    <>
      <path d="M3 12h18" />
      {dot(12, 12)}
    </>
  ),
  horizontalRay: (
    <>
      <path d="M7 12h14" />
      {dot(6, 12)}
      <path d="M18 8.5l3.5 3.5-3.5 3.5" />
    </>
  ),
  verticalLine: (
    <>
      <path d="M12 3v18" />
      {dot(12, 12)}
    </>
  ),
  rectangle: (
    <>
      <rect x="4.5" y="7" width="15" height="10" rx="1.4" />
      {dot(4.5, 7, 1.7)}
      {dot(19.5, 17, 1.7)}
    </>
  ),
  parallelChannel: (
    <>
      <path d="M3.5 15L15.5 5" />
      <path d="M8.5 20L20.5 10" />
      <path d="M3.5 15l5 5M15.5 5l5 5" strokeOpacity="0.35" />
    </>
  ),
  fibRetracement: (
    <>
      <path d="M4 5h16M4 10h16M4 15h16M4 20h16" strokeOpacity="0.85" />
      <path d="M7 20L17 5" strokeDasharray="2 2.4" />
      {dot(7, 20, 1.7)}
      {dot(17, 5, 1.7)}
    </>
  ),
  measure: (
    <>
      <rect x="4" y="6" width="16" height="12" rx="1.2" strokeDasharray="2.6 2.4" />
      <path d="M12 8.5v7M9.6 10.8L12 8.4l2.4 2.4M9.6 13.2L12 15.6l2.4-2.4" />
    </>
  ),
  long: (
    <>
      <rect x="4.5" y="4.5" width="15" height="7" rx="1" fill="currentColor" fillOpacity="0.22" />
      <rect x="4.5" y="11.5" width="15" height="8" rx="1" />
      <path d="M4.5 11.5h15" />
    </>
  ),
  short: (
    <>
      <rect x="4.5" y="4.5" width="15" height="8" rx="1" />
      <rect x="4.5" y="12.5" width="15" height="7" rx="1" fill="currentColor" fillOpacity="0.22" />
      <path d="M4.5 12.5h15" />
    </>
  ),
  text: <path d="M6 6.5h12M12 6.5V19M9 19h6" />,

  // ---- controls -----------------------------------------------------------
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />,
  redo: <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />,
  magnet: <path d="M6 4v7a6 6 0 0012 0V4h-4v7a2 2 0 01-4 0V4zM6 8h4M14 8h4" />,
  pin: <path d="M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9zM12 12.5V21" />,
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
    </>
  ),
  unlock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 016.6-1.6" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 6a9 9 0 012.1-.5c6 0 9.5 6.5 9.5 6.5a16 16 0 01-3 3.9M6.4 7.9A15.6 15.6 0 002.5 12S6 18.5 12 18.5a8.7 8.7 0 003.6-.8" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l.9 12.5h9.2L17.5 7M10 10.5v6M14 10.5v6" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.8" />
      <path d="M15.5 8.5V6a1.8 1.8 0 00-1.8-1.8H6A1.8 1.8 0 004.2 6v7.7A1.8 1.8 0 006 15.5h2.5" />
    </>
  ),
  front: (
    <>
      <rect x="9" y="9" width="10.5" height="10.5" rx="1.6" fill="currentColor" fillOpacity="0.22" />
      <path d="M14 6.5V4.2H4.2V14h2.3" />
    </>
  ),
  back: (
    <>
      <rect x="4.5" y="4.5" width="10.5" height="10.5" rx="1.6" fill="currentColor" fillOpacity="0.22" />
      <path d="M10 17.5v2.3h9.8V10h-2.3" />
    </>
  ),
  edit: <path d="M4.5 19.5l1-4.2L16.2 4.6a1.9 1.9 0 012.7 0l.5.5a1.9 1.9 0 010 2.7L8.7 18.5z" />,
  solid: <path d="M3.5 12h17" />,
  dashed: <path d="M3.5 12h4M10 12h4M16.5 12h4" />,
  dotted: <path d="M4 12h.01M8.5 12h.01M13 12h.01M17.5 12h.01" strokeWidth="2.6" />,
  save: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  load: <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 11-2.2-5.3M19.5 4.5v4.2h-4.2" />,
  bolt: <path d="M13 3L5.5 13.5H11L10 21l7.5-10.5H12z" />,
  inspect: <path d="M8.5 4.5C6.5 4.5 6.5 6 6.5 7.5S6.5 10 4.5 12c2 2 2 3.5 2 4.5s0 3 2 3M15.5 4.5c2 0 2 1.5 2 3s0 2.5 2 4.5c-2 2-2 3.5-2 4.5s0 3-2 3" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  keyboard: (
    <>
      <rect x="2.8" y="6.5" width="18.4" height="11" rx="2" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" strokeWidth="1.8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
}

export function Icon({ name, size = 18, className, style }) {
  const body = G[name]
  if (!body) return null
  return (
    <svg
      className={className ? `ic ${className}` : 'ic'}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {body}
    </svg>
  )
}

export const hasIcon = (name) => Object.prototype.hasOwnProperty.call(G, name)
