import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { createChart } from '../../chart/index.js'
import { planDataUpdate } from './dataPlan.js'

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
  /** Fingerprint of the bars last handed to the chart — see the data effect. */
  const appliedRef = useRef(null)

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
  /**
   * `data` is compared by CONTENT, not identity.
   *
   * React gives a new array identity on every render when the caller writes
   * an inline literal, and setData() re-anchors to the right edge, clears the
   * price scale's primed flag and resets the live candle. Keyed on identity,
   * the README's own `onCrosshair -> setState` example therefore threw away
   * the user's pan and zoom on every mouse sample.
   *
   * Three shapes are recognised, cheapest first: unchanged (do nothing), the
   * forming candle moved (update), and bars appended to the same history
   * (append each). Anything else is a genuinely new dataset and re-anchors,
   * which is what setData is for.
   */
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !data) return

    const plan = planDataUpdate(appliedRef.current, data)
    if (plan.action === 'update') chart.update(data[data.length - 1])
    else if (plan.action === 'append') {
      for (let i = plan.from; i < data.length; i++) chart.append(data[i])
    } else if (plan.action === 'replace') chart.setData(data)
    appliedRef.current = plan.next
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
