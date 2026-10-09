/**
 * Mutants for the candle-close countdown (test/chart-countdown.test.mjs).
 * Aggregated by test/mutants.js; `file` is repo-relative.
 */
const CHART = 'src/chart/core/Chart.js'
const FMT = 'src/chart/core/formatters.js'
const CANDLES = 'src/chart/render/candles.js'
const REPLAY = 'src/chart/replay/Replay.js'
const FEED = 'src/chart/data/RandomFeed.js'

export const MUTANTS = [
  {
    name: 'Seconds are rounded down, so a bar idles on 00:00 for its last second',
    file: FMT,
    find: 'const total = Math.max(0, Math.ceil(remainingMs / 1000))',
    replace: 'const total = Math.max(0, Math.floor(remainingMs / 1000))',
  },
  {
    name: 'The shape follows what is left, not the timeframe',
    file: FMT,
    find: "if (tfMs < 36e5) return `${p2(m + (h * 60))}:${p2(s)}`",
    replace: "if (h === 0) return `${p2(m)}:${p2(s)}`",
  },
  {
    name: 'Stale data a whole bar past its close still counts 00:00',
    file: CHART,
    find: 'if (remaining > 2 * tf || remaining <= -tf) return null',
    replace: 'if (remaining > 2 * tf) return null',
  },
  {
    name: 'A clock far ahead of the bars is shown as a full bar',
    file: CHART,
    find: 'if (remaining > 2 * tf || remaining <= -tf) return null',
    replace: 'if (remaining <= -tf) return null',
  },
  {
    name: 'A few seconds of clock skew blinks the tag off at every open',
    file: CHART,
    find: 'remaining = Math.min(tf, Math.max(0, remaining))',
    replace: 'if (remaining > tf) return null',
  },
  {
    name: "The host's clock does not win over the feed's",
    file: CHART,
    find: "    if (typeof clock === 'function') return +clock()\n    if (this.feed",
    replace: '    if (this.feed',
  },
  {
    name: 'Under replay the countdown reads the wall clock',
    file: CHART,
    find: '    if (this._replay) {\n      remaining = tf * (1 - this._replay.phase)\n    } else {',
    replace: '    if (false) {\n    } else {',
  },
  {
    name: 'countdown: false is ignored',
    file: CHART,
    find: "if (this.options.countdown === false || !this.bars.length) return null",
    replace: 'if (!this.bars.length) return null',
  },
  {
    name: 'The wake-up is due a whole second from now, not at the next whole second',
    file: CHART,
    find: '}, 1000 - phase + 1)',
    replace: '}, 1000)',
  },
  {
    name: 'A second timer is armed while one is pending',
    file: CHART,
    find: 'if (this._countdownTimer !== null || this._destroyed) return\n    const now = this._now()',
    replace: 'if (this._destroyed) return\n    const now = this._now()',
  },
  {
    name: 'destroy() leaves the countdown timer running',
    file: CHART,
    find: '    if (this._countdownTimer !== null) {\n      clearTimeout(this._countdownTimer)\n      this._countdownTimer = null\n    }\n    const el = this.container',
    replace: '    const el = this.container',
  },
  {
    name: 'A timer firing after destroy() invalidates the dead loop',
    file: CHART,
    find: "      if (!this._destroyed) this.loop.invalidate('main')",
    replace: "      this.loop.invalidate('main')",
  },
  {
    name: 'The countdown row is drawn in the single-row box',
    file: CANDLES,
    find: 'ctx.fillRect(plot.w + 1, y - 15, tw + 14, 30)',
    replace: 'ctx.fillRect(plot.w + 1, y - 9, tw + 14, 18)',
  },
  {
    name: 'The tag box is not widened for a countdown wider than the price',
    file: CANDLES,
    find: 'tw = Math.max(tw, ctx.measureText(countdown).width)',
    replace: '',
  },
  {
    name: 'replay.phase ignores the bar length',
    file: REPLAY,
    find: 'return this.length < 2 ? 0 : this._acc / this.baseInterval',
    replace: 'return this.length < 2 ? 0 : this._acc / 1000',
  },
  {
    name: 'RandomFeed.now() is the wall clock',
    file: FEED,
    find: 'return slot + (real - slot) * this.speed',
    replace: 'return real',
  },
]
