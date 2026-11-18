import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react'
import { defaultTheme, lightTheme } from '../chart/index.js'

/**
 * The landing page's light/dark switch.
 *
 * The page palette is CSS (html.lp-light in styles.css); the charts are canvas
 * and take their colours from a theme object, so every demo reads the same
 * flag from LightContext and calls setTheme() when it flips. Nothing in the
 * chart core knows about this: it is the public setTheme(), exactly as a
 * user's app would call it.
 */
const KEY = 'emberwick-theme'

/** Dark is the page's own palette: the plot sits a shade lighter than the page. */
export const PAGE_DARK = { ...defaultTheme, background: '#0a0d15' }
export const PAGE_LIGHT = { ...lightTheme, background: '#ffffff' }

export const chartTheme = (light) => (light ? PAGE_LIGHT : PAGE_DARK)

export const LightContext = createContext(false)

/** [light, setLight]: remembered across visits, and applied to <html> before paint. */
export function usePageScheme() {
  const [light, setLight] = useState(() => {
    try { return localStorage.getItem(KEY) === 'light' } catch { return false }
  })
  useLayoutEffect(() => {
    const root = document.documentElement
    root.classList.toggle('lp-light', light)
    try { localStorage.setItem(KEY, light ? 'light' : 'dark') } catch { /* storage blocked: the switch still works */ }
    // Leaving the landing page (for the playground) takes the page palette with
    // it: the playground has its own .app.light switch.
    return () => root.classList.remove('lp-light')
  }, [light])
  return [light, setLight]
}

/**
 * Recolours the chart held in chartRef whenever the page theme flips, and
 * returns the flag so the chart can be CREATED in the right theme too. On
 * mount the ref is still empty, so the first run is a no-op.
 */
export function useChartTheme(chartRef) {
  const light = useContext(LightContext)
  useEffect(() => { chartRef.current?.setTheme(chartTheme(light)) }, [light])
  return light
}
