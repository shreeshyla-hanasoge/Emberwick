import { Smoothed, Tween } from './Tween.js'

/**
 * LiveCandle — makes the forming (rightmost) candle *flow* instead of snapping.
 *
 * A raw feed tick replaces close/high/low instantly, which reads as a jitter.
 * Here every component eases toward the incoming value, and a brand new candle
 * plays a short grow-from-centre animation as it scrolls in.
 */
export class LiveCandle {
  constructor(tau = 55) {
    this.enabled = true
    this.o = new Smoothed(0, tau)
    this.h = new Smoothed(0, tau)
    this.l = new Smoothed(0, tau)
    this.c = new Smoothed(0, tau)
    this.vol = new Smoothed(0, tau * 2)
    this.spawn = new Tween(240)
    this._has = false
    this._time = null
  }

  setTarget(bar) {
    if (!bar) {
      this._has = false
      return
    }
    if (!this._has || bar.time !== this._time) {
      // New candle: start collapsed at its open, then animate outward.
      this.o.jump(bar.open)
      this.h.jump(bar.open)
      this.l.jump(bar.open)
      this.c.jump(bar.open)
      this.vol.jump(0)
      this.spawn.restart()
      this._time = bar.time
      this._has = true
    }
    this.o.set(bar.open)
    this.h.set(bar.high)
    this.l.set(bar.low)
    this.c.set(bar.close)
    this.vol.set(bar.volume || 0)
  }

  reset() {
    this._has = false
    this._time = null
  }

  /** @returns {boolean} true while animating */
  tick(dt) {
    if (!this._has) return false
    let moving = false
    if (this.o.tick(dt)) moving = true
    if (this.h.tick(dt)) moving = true
    if (this.l.tick(dt)) moving = true
    if (this.c.tick(dt)) moving = true
    if (this.vol.tick(dt)) moving = true
    if (this.spawn.tick(dt)) moving = true
    return moving
  }

  /** Interpolated view of `bar`, or `bar` itself when disabled. */
  read(bar) {
    if (!this._has || !this.enabled || bar.time !== this._time) return bar
    const o = this.o.value
    const c = this.c.value
    return {
      time: bar.time,
      open: o,
      close: c,
      // keep the wick consistent while values chase each other
      high: Math.max(this.h.value, o, c),
      low: Math.min(this.l.value, o, c),
      volume: this.vol.value,
      _spawn: this.spawn.progress,
    }
  }
}
