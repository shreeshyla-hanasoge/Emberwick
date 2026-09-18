/**
 * Inertia — momentum panning with friction decay.
 * sample() while dragging, release() on pointer up, then tick() each frame
 * until it returns 0.
 */
export class Inertia {
  constructor({ friction = 0.92, min = 0.015 } = {}) {
    this.friction = friction
    this.min = min
    this.v = 0 // px per ms
    this.active = false
  }

  sample(dx, dt) {
    if (dt <= 0) return
    const instant = dx / dt
    // low-pass so one jittery frame doesn't define the throw
    this.v = this.v * 0.6 + instant * 0.4
    this.active = false
  }

  release() {
    if (Math.abs(this.v) > this.min) this.active = true
  }

  stop() {
    this.v = 0
    this.active = false
  }

  /** @returns {number} px to pan this frame (0 when idle) */
  tick(dt) {
    if (!this.active) return 0
    const dx = this.v * dt
    this.v *= Math.pow(this.friction, dt / 16.6667)
    if (Math.abs(this.v) < this.min) this.stop()
    return dx
  }
}
