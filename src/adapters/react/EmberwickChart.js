import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createChart } from '../../chart/index.js'

/**
 * React adapter.
 *
 * Deliberately written with createElement instead of JSX so the library build
 * needs no JSX transform and no react/jsx-runtime external.
 *
 * The chart instance is created ONCE and then driven imperatively by effects —
 * re-creating a canvas chart on every render would throw away the animation
 * state (and the user's pan/zoom position) on each prop change.
 *
 *   <EmberwickChart feed={feed} theme={{ up: '#0f0' }} onCrosshair={fn} />
 *
 * Imperative escape hatch:
 *   const ref = useRef(null)
 *   <EmberwickChart ref={ref} />
 *   ref.current.chart.snapToRealtime()
 */
export const EmberwickChart = forwardRef(function EmberwickChart(props, ref) {
  const {
    data,
    feed,
    options,
    theme,
    priceMode,
    animate,
    magnet,
    onCrosshair,
    className,
    style,
    ...rest
  } = props

  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const crosshairRef = useRef(onCrosshair)

  // Keep the latest callback without re-subscribing on every render.
  crosshairRef.current = onCrosshair

  // --- create / destroy (once) ---------------------------------------------
  useEffect(() => {
    const chart = createChart(hostRef.current, {
      ...(options || {}),
      ...(theme ? { theme } : {}),
      ...(animate !== undefined ? { animate } : {}),
      ...(magnet !== undefined ? { magnet } : {}),
    })
    chartRef.current = chart

    const off = chart.subscribe('crosshair', (payload) => {
      const fn = crosshairRef.current
      if (fn) fn(payload)
    })

    return () => {
      off()
      chart.destroy()
      chartRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- imperative handle ----------------------------------------------------
  useImperativeHandle(ref, () => ({
    get chart() {
      return chartRef.current
    },
  }), [])

  // --- prop -> chart wiring -------------------------------------------------
  useEffect(() => {
    if (chartRef.current && data) chartRef.current.setData(data)
  }, [data])

  useEffect(() => {
    if (!chartRef.current) return
    if (feed) chartRef.current.setFeed(feed)
    else chartRef.current.detachFeed()
  }, [feed])

  useEffect(() => {
    if (chartRef.current && theme) chartRef.current.setTheme(theme)
  }, [theme])

  useEffect(() => {
    if (chartRef.current && priceMode) chartRef.current.setPriceMode(priceMode)
  }, [priceMode])

  useEffect(() => {
    if (chartRef.current && animate !== undefined) chartRef.current.setAnimate(animate)
  }, [animate])

  useEffect(() => {
    if (chartRef.current && magnet !== undefined) chartRef.current.setMagnet(magnet)
  }, [magnet])

  return createElement('div', {
    ref: hostRef,
    className,
    // The chart measures its container, so it needs real dimensions.
    style: { position: 'relative', width: '100%', height: '100%', ...(style || {}) },
    ...rest,
  })
})

export default EmberwickChart
