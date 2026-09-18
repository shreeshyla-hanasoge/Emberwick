// Motion primitives. Everything animated in Emberwick goes through one of these
// two classes so there is exactly one place that owns easing behaviour.

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

/**
 * Smoothed — exponential smoothing toward a target that may move every frame.
 * Frame-rate independent: the same visual speed at 30fps and 144fps.
 * Use for values that are continuously re-targeted (autoscale, live candle, zoom).
 */
export class Smoothed {
  constructor(value = 0, tau = 90) {
    this.value = value
    this.target = value
    this.tau = tau
  }

  set(target) {
    this.target = target
  }

  /** Snap with no animation. */
  jump(v) {
    this.value = v
    this.target = v
  }

  get settled() {
    const eps = 1e-9 + Math.abs(this.target) * 1e-6
    return Math.abs(this.target - this.value) <= eps
  }

  /** @returns {boolean} true while still moving (caller keeps the loop alive) */
  tick(dt) {
    if (this.settled) {
      this.value = this.target
      return false
    }
    this.value += (this.target - this.value) * (1 - Math.exp(-dt / this.tau))
    return true
  }
}

/**
 * Tween — fixed-duration one-shot, for discrete events (a candle being born).
 */
export class Tween {
  constructor(duration = 200, ease = easeOutCubic) {
    this.duration = duration
    this.ease = ease
    this.t = duration
  }

  restart() {
    this.t = 0
  }

  get done() {
    return this.t >= this.duration
  }

  get progress() {
    return this.ease(Math.min(1, this.t / this.duration))
  }

  tick(dt) {
    if (this.done) return false
    this.t += dt
    return true
  }
}
