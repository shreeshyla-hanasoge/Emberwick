/**
 * Motion for drawings: the liquid half.
 *
 * Two rules shape everything in this file.
 *
 * - Glue. Nothing here eases the data-to-pixel mapping and nothing animates
 *   the model. A jump in where a point is DISPLAYED (a snap kind changing, an
 *   undo, a nudge) is absorbed by a residual that lives in DATA space, bars
 *   and fwd(price), and decays to zero. The scene projects `u + ru` through
 *   the same live scales as the candles, so a glide that is in flight when
 *   the reader wheel-zooms stays pinned to its bar instead of sliding across
 *   the chart the way a pixel offset would.
 * - Idle means idle. Every settle test is in pixels (0.1 px for residuals,
 *   about 1/255 for alpha-like values), never Smoothed's relative epsilon,
 *   which toward a target of 0 is 1e-9 and would repaint an invisible tail
 *   for another twenty time constants. `Motion.tick` iterates a Set of live
 *   entries only, so an armed tool under a still mouse costs zero frames.
 *
 * Stepping stays in the core's Smoothed and Tween: "one place owns easing".
 * This file only chooses targets, durations and ease curves.
 */
import { Smoothed, Tween, easeOutCubic, easeInOutCubic } from '../../chart/index.js'
/** Smoothed with an ABSOLUTE epsilon. Smoothed.settled is relative (1e-9 + |target|·1e-6):
 *  toward 0 that is 1e-9, ~20τ of invisible repaints. Easing math stays in Tween.js.
 *  Written as !(d > eps), not d <= eps: a NaN value or eps then reads as settled and
 *  tick() snaps it to the target, instead of ticking NaN at 60fps forever. */
export class Eased extends Smoothed {
  constructor(value, tau, eps) { super(value, tau); this.eps = eps }
  get settled() { return !(Math.abs(this.target - this.value) > this.eps) }
}
export const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2) }
export const easeInCubic = (t) => t * t * t
export const stagger = (age, i, gap, dur) => Math.min(1, Math.max(0, (age - i * gap) / dur))

const linear = (t) => t

/** Deep-frozen, so a host poking MOTION.hover.tau cannot retune every chart on the page. */
function freeze(o) {
  for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') freeze(o[k])
  return Object.freeze(o)
}

/**
 * Every duration and time constant, in one table (spec §6.3). `tau` values
 * feed an exponential ease (95% after about 3τ); `ms` values are one-shot
 * Tween durations.
 */
export const MOTION = freeze({
  /** Line width +0.75 px, halo at 12% alpha, ghost handles at 50% (mouse). */
  hover: { tau: 60 },
  /** Handle radius ×1.35 and an accent fill while held. */
  press: { tau: 50, scale: 1.35 },
  /** Handle radius, mouse ↔ touch. */
  handleSize: { tau: 80, mouse: 4.5, touch: 7 },
  /** Handles pop 0 → 1 with a little overshoot, 25 ms apart. */
  selectIn: { ms: 180, stagger: 25 },
  selectOut: { ms: 120 },
  /** Residual on a snap kind engaging, changing or releasing: ~85 ms to 95%. */
  snapGlide: { tau: 28 },
  /** Ring 0 → 7 px (overshooting), then its tag fades. Origin in data space. */
  snapRing: { ms: 160, fade: 80, r: 7 },
  /** Touch slop catch-up. */
  slop: { tau: 40 },
  nudge: { tau: 45 },
  /** Undo, redo, API update: ~210 ms. */
  morph: { tau: 70 },
  /** The "what changed" halo on undo/redo. */
  pulse: { ms: 300 },
  /** Drag cancel spring-back. */
  cancel: { tau: 60 },
  /** First-anchor ripple on touch: r 0 → 14, alpha .5 → 0. */
  ripple: { ms: 320, r: 14, alpha: 0.5 },
  /** Creation preview (60% alpha, dashed) → solid, stroke +1 px → 0. */
  commit: { ms: 180, from: 0.6 },
  /** A horizontal line grows out from the click; position boxes from the entry line. */
  reveal: { ms: 220 },
  /** Fib levels: stagger(age, i, 22, 180), all ten in under 400 ms. */
  fibStagger: { gap: 22, ms: 180, span: 400 },
  /** Delete / undo-create: alpha → 0, width ×0.6. Never hittable. */
  ghost: { ms: 160, width: 0.6 },
  /** Undo-delete, redo-create, API add: alpha 0 → 1. */
  appear: { ms: 180 },
  /** Stats label and axis-band alpha. */
  stats: { tau: 80, band: 50 },
  labelFlip: { tau: 60 },
  /** The position outcome path drawing itself in. */
  outcome: { ms: 420 },
  /** Locked refusal: a 3 px damped sine. */
  shake: { ms: 260, px: 3, cycles: 3 },
  /** One-shot warning-colour pulse into a wrong-side position (D21). Never periodic. */
  warnPulse: { ms: 300 },
  /** Settle thresholds: alpha-like values, and residuals in screen pixels. */
  eps: 0.004,
  settlePx: 0.1,
  /** 'reduced' keeps alpha fades, capped at this, and nothing else that moves. */
  reducedMs: 120,
  /** An exponential fade under 'reduced' reaches 98% inside reducedMs. */
  reducedTau: 30,
})

/** Kinds a residual can be seeded with, and their time constants. */
const GLIDE_TAU = { snapGlide: MOTION.snapGlide.tau, slop: MOTION.slop.tau, nudge: MOTION.nudge.tau,
  morph: MOTION.morph.tau, cancel: MOTION.cancel.tau }

/** Handles on the busiest tool (rectangle: 4 corners + 4 edges); bounds the select-in stagger. */
const MAX_HANDLES = 8
const SELECT_SPAN = MOTION.selectIn.ms + MOTION.selectIn.stagger * (MAX_HANDLES - 1)
/** "Long ago": an age that has saturated every stagger. */
const REST = 1e9
const MODES = new Set(['full', 'reduced', 'none'])

/** Forward price space of a scale: identity, or ln for log (as PriceScale._fwd, read from the public mode). */
export function fwdOf(mode, p) { return mode === 'log' ? Math.log(Math.max(p, 1e-9)) : p }
export function invOf(mode, v) { return mode === 'log' ? Math.exp(v) : v }

/** An Eased that remembers its full-motion τ, so 'reduced' can shorten it and 'full' restore it. */
function eased(value, tau) {
  const e = new Eased(value, tau, MOTION.eps)
  e.base = tau
  return e
}

/** Advance a one-shot; true while it still has frames to give. */
function stepTween(tw, dt) {
  if (!tw || tw.done) return false
  tw.tick(dt)
  return !tw.done
}

function finishTween(tw) { if (tw) tw.t = tw.duration }

/**
 * One anchor's displayed-minus-true offset, in data units: `ru` in bars and
 * `rv` in fwd units of its pane. Stamped with the pane's price mode when
 * seeded: a linear residual of 150 price units read as ln units after a
 * setPriceMode('log') would put the anchor at p·e^150.
 */
export class Residual {
  constructor(id, k, paneId, mode, tau) {
    this.id = id
    this.k = k
    this.paneId = paneId
    /** The pane's ps.mode when seeded; null until a scale has been seen. */
    this.mode = mode
    // eps is recomputed from the live scales on every tick, before stepping.
    this.ru = new Eased(0, tau, 0)
    this.rv = new Eased(0, tau, 0)
  }
}

/** Everything that animates on one drawing. Created lazily, on its first motion. */
class Rec {
  constructor(id) {
    this.id = id
    this.hover = eased(0, MOTION.hover.tau)
    this.press = eased(0, MOTION.press.tau)
    this.pressedHandle = -1
    this.stats = eased(0, MOTION.stats.tau)
    this.band = eased(0, MOTION.stats.band)
    /** Label side, eased; created on the first report so it starts where it is. */
    this.flip = null
    this.selected = false
    this.selAge = REST
    this.selOut = null
    this.appear = null
    this.commit = null
    this.reveal = null
    this.revealKind = null
    this.revealU = NaN
    /** ms since the last reveal (drives the fib stagger); REST when long settled. */
    this.age = REST
    this.pulse = null
    this.shake = null
    this.outcome = null
    this.warn = null
  }

  /** Advance one frame. True while anything on this drawing still moves. */
  step(dt) {
    let live = false
    if (this.hover.tick(dt)) live = true
    if (this.press.tick(dt)) live = true
    if (this.stats.tick(dt)) live = true
    if (this.band.tick(dt)) live = true
    if (this.flip && this.flip.tick(dt)) live = true
    if (this.selAge < SELECT_SPAN) {
      this.selAge += dt
      if (this.selAge < SELECT_SPAN) live = true
    }
    if (this.age < MOTION.fibStagger.span) {
      this.age += dt
      if (this.age < MOTION.fibStagger.span) live = true
    }
    if (stepTween(this.selOut, dt)) live = true
    if (stepTween(this.appear, dt)) live = true
    if (stepTween(this.commit, dt)) live = true
    if (stepTween(this.reveal, dt)) live = true
    if (stepTween(this.pulse, dt)) live = true
    if (stepTween(this.shake, dt)) live = true
    if (stepTween(this.outcome, dt)) live = true
    if (stepTween(this.warn, dt)) live = true
    return live
  }

  finish() {
    for (const e of [this.hover, this.press, this.stats, this.band, this.flip]) if (e) e.jump(e.target)
    this.selAge = REST
    if (this.age < REST) this.age = REST
    for (const tw of [this.selOut, this.appear, this.commit, this.reveal, this.pulse, this.shake, this.outcome, this.warn]) {
      finishTween(tw)
    }
  }
}

/** The global handle radius (mouse ↔ touch), as a live entry. */
class HandleSize {
  constructor() { this.e = eased(MOTION.handleSize.mouse, MOTION.handleSize.tau) }
  step(dt) { return this.e.tick(dt) }
}

/** A deleted drawing fading out, resolved from its data every frame (so glued). Never hittable. */
class Ghost {
  constructor(slot, ms) {
    this.slot = slot
    this.tween = new Tween(ms, easeInCubic)
    this.tween.restart()
  }
  step(dt) { return stepTween(this.tween, dt) }
}

/** A snap ring or a touch ripple: a decoration at (u, price) on a pane, projected at paint time. */
class Mark {
  constructor(u, price, paneId, tag, ms, grow, ease) {
    this.u = u
    this.price = price
    this.paneId = paneId
    this.tag = tag
    /** Whether the radius animates (false under 'reduced': overshoot is dropped). */
    this.grow = grow
    this.tween = new Tween(ms, ease)
    this.tween.restart()
  }
  step(dt) { return stepTween(this.tween, dt) }
}

/**
 * The motion state of one drawings controller.
 *
 * Seeding methods are called from input hooks (outside a frame) and from
 * tick (inside one). Whenever an entry joins an EMPTY live set, `onWake`
 * runs (the controller passes `() => host.invalidate()`), so a hover fade
 * started from a pointermove gets its first frame without the caller having
 * to remember an invalidate. Inside a frame the controller returns
 * `motion.active` after ticking, which counts anything seeded that frame.
 */
export class Motion {
  constructor({ mode = 'full', onWake = null } = {}) {
    this.mode = MODES.has(mode) ? mode : 'full'
    this.onWake = typeof onWake === 'function' ? onWake : null
    /** Every live entry: Recs, Residuals, Ghosts, Marks and the handle size. */
    this._active = new Set()
    this._recs = new Map()
    /** id -> Residual[] indexed by anchor; a slot is null once it settles. */
    this._res = new Map()
    this._selected = new Set()
    this._hover = null
    this._press = null
    this._handle = new HandleSize()
    /** The last host seen by tick: lets a seed stamp its residual with the pane's price mode. */
    this._host = null
    /** Painted by the scene. Public so a controller or test can count them. */
    this.ghosts = new Set()
    this.rings = new Set()
    this.ripples = new Set()
  }

  get active() { return this._active.size > 0 }

  /** 'none' is applied by the next tick (every entry finished, zero keep-alive frames). */
  setMode(m) {
    const next = MODES.has(m) ? m : 'full'
    if (next === this.mode) return
    this.mode = next
    if (next === 'reduced') this._reduce()
    else if (next === 'full') {
      // Give decorations their full time constants back.
      for (const r of this._recs.values()) for (const e of [r.hover, r.press, r.stats, r.band, r.flip]) if (e) e.tau = e.base
      this._handle.e.tau = this._handle.e.base
    }
  }

  /**
   * Advance every live entry. True while anything still animates.
   * `view.host` supplies the live scales that residual epsilons and price
   * modes are read from.
   */
  tick(dt, view) {
    if (this.mode === 'none') return this.finishAll()
    const host = view && view.host ? view.host : null
    if (host) this._host = host
    // dt 0 is a pure re-render (toImage runs a frame with it); a NaN or
    // negative dt from a confused caller is treated the same way.
    const step = dt > 0 ? Math.min(dt, 1000) : 0
    for (const e of this._active) {
      const live = e instanceof Residual ? this._stepResidual(e, step, host) : e.step(step)
      if (!live) this._retire(e)
    }
    for (const g of this.ghosts) {
      if (g.tween.done) this.ghosts.delete(g)
    }
    for (const m of this.rings) if (m.tween.done) this.rings.delete(m)
    for (const m of this.ripples) if (m.tween.done) this.ripples.delete(m)
    return this._active.size > 0
  }

  /**
   * Step one residual. Its settle epsilon is recomputed from the CURRENT
   * scales each frame, so "under 0.1 px" stays true through a zoom: 0.1 px
   * in bars is 0.1 / spacing, and in fwd units it is the fwd distance 0.1 px
   * spans at the pane's middle.
   */
  _stepResidual(r, dt, host) {
    const pane = host && typeof host.paneById === 'function' ? host.paneById(r.paneId) : null
    if (pane && pane.ps) {
      if (r.mode === null) r.mode = pane.ps.mode
      if (r.mode !== pane.ps.mode) r.rv.jump(0)
      r.mode = pane.ps.mode
      const ps = pane.ps
      const mid = pane.rect ? pane.rect.y + pane.rect.h / 2 : ps.top + ps.height / 2
      r.ru.eps = MOTION.settlePx / host.ts.spacing
      r.rv.eps = Math.abs(fwdOf(ps.mode, ps.price(mid)) - fwdOf(ps.mode, ps.price(mid + MOTION.settlePx)))
    } else {
      // The pane is gone (removePane) or there is no view to measure against:
      // the offset can no longer be projected, so it has nothing left to show.
      r.ru.jump(0)
      r.rv.jump(0)
    }
    const a = r.ru.tick(dt)
    const b = r.rv.tick(dt)
    return a || b
  }

  /** Drop a settled entry from the live set, and a settled residual from its drawing's list. */
  _retire(e) {
    this._active.delete(e)
    if (e instanceof Residual) {
      const list = this._res.get(e.id)
      if (list && list[e.k] === e) {
        list[e.k] = null
        if (!list.some(Boolean)) this._res.delete(e.id)
      }
    }
  }

  /**
   * Put `e` in the live set, waking the loop if it was idle. With no entry,
   * only the wake: a change that animates nothing under this mode (a glide
   * under 'reduced', a hover under 'none') still needs its one repaint.
   */
  _wake(e) {
    if (e && this._active.has(e)) return
    if (!this._active.size && this.onWake) this.onWake()
    if (e) this._active.add(e)
  }

  _rec(id) {
    let r = this._recs.get(id)
    if (!r) {
      r = new Rec(id)
      if (this.mode === 'reduced') for (const e of [r.hover, r.press, r.stats, r.band]) e.tau = Math.min(e.base, MOTION.reducedTau)
      this._recs.set(id, r)
    }
    return r
  }

  /** Retarget an Eased decoration, with the shortened τ under 'reduced'. */
  _aim(e, v) {
    e.tau = this.mode === 'reduced' ? Math.min(e.base, MOTION.reducedTau) : e.base
    e.set(v)
  }

  /** A one-shot's duration under the current mode: alpha fades are capped under 'reduced'. */
  _ms(ms) { return this.mode === 'reduced' ? Math.min(ms, MOTION.reducedMs) : ms }

  /** Restart (creating once) a Tween field of a Rec. */
  _shot(r, field, ms, ease) {
    let tw = r[field]
    if (!tw) tw = r[field] = new Tween(ms, ease)
    tw.duration = ms
    tw.ease = ease
    tw.restart()
    this._wake(r)
    return tw
  }

  /* ----------------------------------------------------------- seeding -- */

  hover(id) {
    const next = id == null ? null : id
    if (next === this._hover) return
    const prev = this._hover !== null ? this._recs.get(this._hover) : null
    this._hover = next
    if (prev) { this._aim(prev.hover, 0); this._wake(prev) }
    if (next !== null) { const r = this._rec(next); this._aim(r.hover, 1); this._wake(r) }
  }

  select(ids) {
    const next = Array.isArray(ids) ? ids : ids == null ? [] : [ids]
    for (const id of [...this._selected]) if (next.indexOf(id) < 0) this._deselect(id)
    for (const id of next) if (id != null && !this._selected.has(id)) this._select(id)
  }

  _select(id) {
    const r = this._rec(id)
    this._selected.add(id)
    r.selected = true
    finishTween(r.selOut)
    // Overshoot and stagger are motion, not fades: 'reduced' shows the handles at once.
    r.selAge = this.mode === 'full' ? 0 : REST
    this._aim(r.stats, 1)
    this._aim(r.band, 1)
    this._wake(r)
  }

  _deselect(id) {
    this._selected.delete(id)
    const r = this._recs.get(id)
    if (!r) return
    r.selected = false
    r.selAge = REST
    if (this.mode === 'full') this._shot(r, 'selOut', MOTION.selectOut.ms, easeInCubic)
    else finishTween(r.selOut)
    this._aim(r.stats, 0)
    this._aim(r.band, 0)
    this._wake(r)
  }

  press(id, handle) {
    const next = id == null ? null : id
    const prev = this._press !== null ? this._recs.get(this._press) : null
    if (prev && next !== this._press) { this._aim(prev.press, 0); this._wake(prev) }
    this._press = next
    if (next === null) return
    const r = this._rec(next)
    r.pressedHandle = Number.isInteger(handle) ? handle : -1
    this._aim(r.press, 1)
    this._wake(r)
  }

  handleSize(touch) {
    const e = this._handle.e
    const target = touch ? MOTION.handleSize.touch : MOTION.handleSize.mouse
    if (e.target === target) return
    this._aim(e, target)
    this._wake(this._handle)
  }

  /**
   * Absorb a jump in anchor k's displayed position. `du` (bars) and `dv`
   * (fwd units of the pane) are OLD minus NEW, so the anchor is drawn where
   * it was and decays onto where it is. Deltas add to a glide in flight.
   */
  glide(id, k, du, dv, kind, paneId) {
    if (!Number.isFinite(du) || !Number.isFinite(dv)) return
    if (this.mode !== 'full') { this._wake(null); return }
    if (du === 0 && dv === 0) return
    if (!(k >= 0 && k < 64) || k !== Math.floor(k)) return
    const tau = GLIDE_TAU[kind] || MOTION.morph.tau
    const mode = this._paneMode(paneId)
    let list = this._res.get(id)
    if (!list) this._res.set(id, (list = []))
    let r = list[k]
    if (!r) r = list[k] = new Residual(id, k, paneId, mode, tau)
    else if (mode !== null && r.mode !== null && r.mode !== mode) r.rv.jump(0)
    if (mode !== null) r.mode = mode
    r.paneId = paneId
    r.ru.tau = tau
    r.rv.tau = tau
    r.ru.value += du
    r.rv.value += dv
    r.ru.target = 0
    r.rv.target = 0
    this._wake(r)
  }

  /**
   * Undo, redo or an animated API update: `before`/`after` are (u, fwd)
   * pairs per anchor. Seeds a residual per anchor and the "what changed"
   * halo. A NaN pair (zero bars, an unresolvable time) seeds nothing.
   */
  morph(id, before, after, paneId) {
    const n = Math.min(before ? before.length : 0, after ? after.length : 0) >> 1
    for (let k = 0; k < n; k++) {
      this.glide(id, k, before[2 * k] - after[2 * k], before[2 * k + 1] - after[2 * k + 1], 'morph', paneId)
    }
    const r = this._rec(id)
    this._shot(r, 'pulse', this._ms(MOTION.pulse.ms), easeInOutCubic)
  }

  /** Undo-delete, redo-create, API add: alpha 0 → 1. */
  appear(id) {
    this._shot(this._rec(id), 'appear', this._ms(MOTION.appear.ms), easeOutCubic)
  }

  /** A user create: the 60%-alpha dashed preview settles into the solid drawing. */
  commit(id) {
    this._shot(this._rec(id), 'commit', this._ms(MOTION.commit.ms), easeOutCubic)
  }

  /** Grow a new drawing in: 'hline' from `originU`, 'position' from the entry line, 'fib' level by level. */
  reveal(id, kind, originU) {
    const r = this._rec(id)
    r.revealKind = kind || null
    r.revealU = Number.isFinite(originU) ? originU : NaN
    if (this.mode !== 'full') { finishTween(r.reveal); r.age = REST; this._wake(r); return }
    this._shot(r, 'reveal', MOTION.reveal.ms, easeOutCubic)
    r.age = kind === 'fib' ? 0 : REST
  }

  /** Keep painting a removed drawing while it fades. `slot` keeps its d and tool. */
  ghost(slot) {
    if (!slot || !slot.d || !slot.tool || this.mode === 'none') { this._wake(null); return }
    const g = new Ghost(slot, this._ms(MOTION.ghost.ms))
    this.ghosts.add(g)
    this._wake(g)
  }

  /** The snap ring, at a data-space point: a pinch inside its 240 ms never leaves it floating. */
  ring(u, price, paneId, tag) {
    if (!Number.isFinite(u) || !Number.isFinite(price) || this.mode === 'none') { this._wake(null); return }
    // One ring at a time: a newer engage makes the old one meaningless.
    for (const m of this.rings) this._active.delete(m)
    this.rings.clear()
    const full = this.mode === 'full'
    const ms = full ? MOTION.snapRing.ms + MOTION.snapRing.fade : MOTION.snapRing.fade
    const m = new Mark(u, price, paneId, tag == null ? null : String(tag), ms, full, linear)
    this.rings.add(m)
    this._wake(m)
  }

  /** The first-anchor ripple on touch. Dropped under 'reduced': it is pure motion. */
  ripple(u, price, paneId) {
    if (!Number.isFinite(u) || !Number.isFinite(price) || this.mode !== 'full') { this._wake(null); return }
    const m = new Mark(u, price, paneId, null, MOTION.ripple.ms, true, easeOutCubic)
    this.ripples.add(m)
    this._wake(m)
  }

  /** A refused edit on a locked drawing. */
  shake(id) {
    if (this.mode !== 'full') { this._wake(null); return }
    this._shot(this._rec(id), 'shake', MOTION.shake.ms, linear)
  }

  /** The position outcome path draws itself in, once per outcome change. */
  outcome(id) {
    const r = this._rec(id)
    if (this.mode !== 'full') { finishTween(r.outcome); this._wake(r); return }
    this._shot(r, 'outcome', MOTION.outcome.ms, easeInOutCubic)
  }

  /** One-shot warning-colour pulse on the transition INTO a wrong-side position. Never repeats on its own. */
  warn(id) {
    if (this.mode !== 'full') { this._wake(null); return }
    this._shot(this._rec(id), 'warn', MOTION.warnPulse.ms, easeInOutCubic)
  }

  /**
   * Report which side a drawing's label sits on (any number, typically 0/1
   * or ±1). The first report jumps; later changes ease, so a stats pill that
   * flips at the plot edge slides across instead of teleporting.
   */
  labelSide(id, side) {
    if (!Number.isFinite(side)) return
    const r = this._rec(id)
    if (!r.flip) { r.flip = eased(side, MOTION.labelFlip.tau); return }
    if (r.flip.target === side) return
    if (this.mode === 'reduced') r.flip.jump(side)
    else r.flip.set(side)
    this._wake(r)
  }

  /* ----------------------------------------------------------- reading -- */

  /** Anchor k's residual as numbers, or null at rest. Allocates: for tests and the controller, not per anchor per frame. */
  residual(id, k) {
    const list = this._res.get(id)
    const r = list ? list[k] : null
    return r ? { ru: r.ru.value, rv: r.rv.value } : null
  }

  /** The live Residual list of a drawing (indexed by anchor, entries may be null), or null. For the scene. */
  residuals(id) {
    return this._res.get(id) || null
  }

  /**
   * Fill `out` with how drawing `id` should look this frame. The scene owns
   * `preview`, `exporting`, `locked` and `editing` and overwrites them.
   *
   * Beyond the ToolDef contract's Look, it also fills `pulse` (the undo halo,
   * already folded into `hover` so every tool shows it), `commit` (1 → 0
   * after a create, folded into `alpha` and `widthAdd`), `widthScale` (1, or
   * shrinking on a ghost), `widthAdd`, `revealKind`/`revealU` (the data-space
   * origin a horizontal line grows from), `outcome` (path draw-in, 1 at rest),
   * `flip` (the eased label side) and `band` (axis-band alpha).
   */
  look(id, out) {
    const r = id == null ? null : this._recs.get(id)
    const hs = this._handle.e.value
    out.preview = false
    out.exporting = false
    out.locked = false
    out.editing = false
    out.handleR = hs > 0 ? hs : MOTION.handleSize.mouse
    out.widthScale = 1
    if (!r) {
      out.hover = 0; out.select = 0; out.press = 0; out.pressedHandle = -1; out.alpha = 1
      out.reveal = 1; out.age = REST; out.stats = 0; out.shake = 0; out.warnPulse = 0
      out.pulse = 0; out.commit = 0; out.widthAdd = 0; out.revealKind = null; out.revealU = NaN
      out.outcome = 1; out.flip = NaN; out.band = 0
      return out
    }
    const pulse = r.pulse && !r.pulse.done ? Math.sin(Math.PI * r.pulse.progress) : 0
    const commit = r.commit && !r.commit.done ? 1 - r.commit.progress : 0
    const appear = r.appear && !r.appear.done ? r.appear.progress : 1
    out.hover = clamp01(Math.max(r.hover.value, pulse))
    out.select = this._selectValue(r)
    out.press = clamp01(r.press.value)
    out.pressedHandle = r.press.value > 0.001 || r.press.target > 0 ? r.pressedHandle : -1
    out.alpha = clamp01(appear * (1 - (1 - MOTION.commit.from) * commit))
    out.reveal = r.reveal && !r.reveal.done ? r.reveal.progress : 1
    out.revealKind = r.revealKind
    out.revealU = r.revealU
    out.age = r.age
    out.stats = clamp01(r.stats.value)
    out.band = clamp01(r.band.value)
    out.shake = r.shake && !r.shake.done ? shakeAt(r.shake.t / r.shake.duration) : 0
    out.warnPulse = r.warn && !r.warn.done ? r.warn.progress : 0
    out.pulse = pulse
    out.commit = commit
    out.widthAdd = commit
    out.outcome = r.outcome && !r.outcome.done ? r.outcome.progress : 1
    out.flip = r.flip ? r.flip.value : NaN
    return out
  }

  _selectValue(r) {
    if (r.selected) {
      if (r.selAge >= MOTION.selectIn.ms) return 1
      return r.selAge > 0 ? easeOutBack(r.selAge / MOTION.selectIn.ms) : 0
    }
    if (r.selOut && !r.selOut.done) return 1 - r.selOut.progress
    return 0
  }

  /**
   * Scale of handle `i` (0-based paint order) of drawing `id`: popping in
   * 25 ms apart after a select, shrinking together after a deselect, 1 at
   * rest while selected, 0 otherwise.
   */
  handlePop(id, i) {
    const r = this._recs.get(id)
    if (!r) return 0
    if (r.selected) {
      if (r.selAge >= SELECT_SPAN) return 1
      const s = stagger(r.selAge, i, MOTION.selectIn.stagger, MOTION.selectIn.ms)
      // easeOutBack(0) is 2e-16, not 0: a handle that has not started is not drawn at all.
      return s > 0 ? easeOutBack(s) : 0
    }
    if (r.selOut && !r.selOut.done) return 1 - r.selOut.progress
    return 0
  }

  /** Axis-band strength of drawing `id`, 0..1: follows the selection, eased (τ 50). */
  bandAlpha(id) {
    const r = this._recs.get(id)
    return r ? clamp01(r.band.value) : 0
  }

  /** True while drawing `id`'s handles are still shrinking after a deselect. */
  deselecting(id) {
    const r = this._recs.get(id)
    return !!(r && !r.selected && r.selOut && !r.selOut.done)
  }

  /* --------------------------------------------------------- lifecycle -- */

  /**
   * End everything now: every Tween finished, every Eased at its target,
   * residuals zeroed, ghosts and decorations dropped. Returns false, so
   * `motion: 'none'` costs zero keep-alive frames.
   */
  finishAll() {
    // Everything that can still move is in the live set, so an empty set means
    // there is nothing to finish: 'none' costs one Set check per frame.
    if (!this._active.size) return false
    for (const r of this._recs.values()) r.finish()
    this._handle.e.jump(this._handle.e.target)
    this._res.clear()
    this.ghosts.clear()
    this.rings.clear()
    this.ripples.clear()
    this._active.clear()
    return false
  }

  /** A drawing left the document: drop its state (its ghost, if any, keeps fading). */
  forget(id) {
    const r = this._recs.get(id)
    if (r) this._active.delete(r)
    this._recs.delete(id)
    const list = this._res.get(id)
    if (list) for (const e of list) if (e) this._active.delete(e)
    this._res.delete(id)
    this._selected.delete(id)
    if (this._hover === id) this._hover = null
    if (this._press === id) this._press = null
  }

  /** Moving into 'reduced': drop what is pure motion, keep (shortened) fades. */
  _reduce() {
    for (const list of this._res.values()) for (const e of list) if (e) this._active.delete(e)
    this._res.clear()
    for (const m of this.ripples) this._active.delete(m)
    this.ripples.clear()
    for (const r of this._recs.values()) {
      for (const e of [r.hover, r.press, r.stats, r.band]) e.tau = Math.min(e.base, MOTION.reducedTau)
      if (r.flip) r.flip.jump(r.flip.target)
      r.selAge = REST
      if (r.age < REST) r.age = REST
      finishTween(r.reveal)
      finishTween(r.shake)
      finishTween(r.warn)
      finishTween(r.outcome)
      finishTween(r.selOut)
    }
    this._handle.e.tau = Math.min(this._handle.e.base, MOTION.reducedTau)
  }

  /** The price mode of `paneId` from the last host seen, or null before any tick. */
  _paneMode(paneId) {
    const h = this._host
    const pane = h && typeof h.paneById === 'function' ? h.paneById(paneId) : null
    return pane && pane.ps ? pane.ps.mode : null
  }
}

function clamp01(v) { return v > 0 ? (v < 1 ? v : 1) : 0 }

/** The locked-refusal offset in px at progress t: three damped cycles of a sine. */
function shakeAt(t) {
  const p = t < 0 ? 0 : t > 1 ? 1 : t
  return MOTION.shake.px * (1 - p) * Math.sin(p * MOTION.shake.cycles * 2 * Math.PI)
}
