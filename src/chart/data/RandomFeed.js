import { DataFeed, mulberry32 } from './DataFeed.js'

/**
 * RandomFeed — a plausible synthetic market. One implementation of DataFeed,
 * nothing more: swapping in a real provider is writing another class, with
 * zero changes to the chart core.
 *
 * Generates a GBM-ish random walk with volatility clustering and a volume
 * profile, then drives a live forming candle from sub-bar ticks.
 */
export class RandomFeed extends DataFeed {
  constructor({
    symbol = 'EMBR',
    timeframe = 60000,
    seed = 7,
    start = 100,
    volatility = 0.0022,
    drift = 0.00002,
    ticksPerSecond = 8,
    speed = 1,
  } = {}) {
    super({ symbol, timeframe })
    this.seed = seed
    this.start = start
    this.volatility = volatility
    this.drift = drift
    this.ticksPerSecond = ticksPerSecond
    this.speed = speed

    this._rnd = mulberry32(seed)
    this._handlers = new Set()
    this._timer = null
    this._forming = null
    this._last = start
    this._vol = volatility
    this._anchorTime = Math.floor(Date.now() / timeframe) * timeframe
  }

  _gauss() {
    // Box-Muller
    let u = 0
    let v = 0
    while (u === 0) u = this._rnd()
    while (v === 0) v = this._rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  _step(price) {
    // volatility clusters: vol mean-reverts but gets kicked by shocks
    const shock = this._gauss()
    this._vol += (this.volatility - this._vol) * 0.02 + Math.abs(shock) * this.volatility * 0.015
    this._vol = Math.min(this._vol, this.volatility * 6)
    return Math.max(0.01, price * (1 + this.drift + shock * this._vol))
  }

  _makeBar(time, open) {
    let c = open
    const n = 14
    let hi = open
    let lo = open
    for (let i = 0; i < n; i++) {
      c = this._step(c)
      if (c > hi) hi = c
      if (c < lo) lo = c
    }
    const range = Math.max(1e-9, hi - lo)
    const volume = Math.round(
      (300 + this._rnd() * 900) * (1 + (range / open) * 260)
    )
    return { time, open, high: hi, low: lo, close: c, volume }
  }

  /**
   * Historical bars ending just before `to`. Walks BACKWARDS from a synthetic
   * anchor, so paging further left keeps producing coherent history.
   */
  async getBars({ to, limit = 1500, timeframe = this.timeframe } = {}) {
    const end = to == null ? this._anchorTime : to
    const bars = []
    // generate forward from an earlier point for realistic shape, then slice
    const startTime = end - limit * timeframe
    const gen = mulberry32(this.seed ^ Math.floor(startTime / timeframe))
    const saved = this._rnd
    this._rnd = gen

    let price = this.start * (1 + (gen() - 0.5) * 0.04)
    for (let i = 0; i < limit; i++) {
      const t = startTime + i * timeframe
      const bar = this._makeBar(t, price)
      price = bar.close
      bars.push(bar)
    }
    this._rnd = saved

    if (to == null) {
      this._last = bars.length ? bars[bars.length - 1].close : this.start
    }
    return bars
  }

  subscribe(handler) {
    this._handlers.add(handler)
    if (!this._timer) this._start()
    return () => {
      this._handlers.delete(handler)
      if (!this._handlers.size) this.stop()
    }
  }

  _emit(msg) {
    for (const h of this._handlers) h(msg)
  }

  _start() {
    const interval = Math.max(16, 1000 / this.ticksPerSecond)
    this._timer = setInterval(() => this._tick(), interval)
  }

  /** Seed the live candle from wherever history ended. */
  prime(lastBar) {
    if (lastBar) {
      this._last = lastBar.close
      this._forming = { ...lastBar }
    }
  }

  _tick() {
    const tf = this.timeframe / this.speed
    const now = Date.now()
    const slot = Math.floor(now / tf) * tf

    if (!this._forming || this._forming.time !== slot) {
      const open = this._last
      this._forming = { time: slot, open, high: open, low: open, close: open, volume: 0 }
      this._emit({ type: 'append', bar: { ...this._forming } })
      return
    }

    const next = this._step(this._last)
    this._last = next
    const f = this._forming
    f.close = next
    if (next > f.high) f.high = next
    if (next < f.low) f.low = next
    f.volume += Math.round(20 + this._rnd() * 120)
    this._emit({ type: 'update', bar: { ...f } })
  }

  setSpeed(s) { this.speed = s }

  setTicksPerSecond(n) {
    this.ticksPerSecond = n
    if (this._timer) { this.stop(); this._start() }
  }

  setPaused(paused) {
    if (paused) this.stop()
    else if (!this._timer && this._handlers.size) this._start()
  }

  get paused() { return !this._timer }

  stop() {
    if (this._timer) clearInterval(this._timer)
    this._timer = null
  }

  destroy() {
    this.stop()
    this._handlers.clear()
  }
}
