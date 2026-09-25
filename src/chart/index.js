/**
 * Emberwick — public API surface.
 *
 * This file is the future package entry point. Nothing below imports a
 * framework, so the same build drops into React, Vue, Svelte or a script tag.
 *
 *   import { createChart, RandomFeed } from './chart/index.js'
 *   const chart = createChart(el, { theme: { background: '#000' } })
 *   await chart.setFeed(new RandomFeed({ timeframe: 60000 }))
 */
export { Chart } from './core/Chart.js'
export { TimeScale } from './core/TimeScale.js'
export { PriceScale } from './core/PriceScale.js'
export { defaultTheme, lightTheme } from './core/palette.js'
export { DataFeed, mulberry32 } from './data/DataFeed.js'
export { RandomFeed } from './data/RandomFeed.js'
export { Smoothed, Tween, easeOutCubic, easeInOutCubic } from './motion/Tween.js'
export { Inertia } from './motion/Inertia.js'
export { LiveCandle } from './motion/LiveCandle.js'
export { Replay, MIN_SPEED, MAX_SPEED } from './replay/Replay.js'

import { Chart } from './core/Chart.js'

/** Preferred entry point. */
export function createChart(container, options) {
  return new Chart(container, options)
}

export const version = '0.11.0'

