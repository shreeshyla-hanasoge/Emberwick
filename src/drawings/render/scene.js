/**
 * The scene: projects every drawing through the live scales and paints the
 * plugins layer in three passes.
 *
 *   1. Bodies. Each drawing's own `tool.draw`, clipped to its geometry's
 *      clip rect, inside its own save/try/restore.
 *   2. Axis tags and bands, clipped to the drawing's own gutter strip (price)
 *      or the time-axis strip (time). A price tag outside its pane is skipped.
 *   3. Chrome: handles, snap rings, ripples, guides. Clipped to the pane rect
 *      inflated by the largest handle, so a handle at a pane edge is whole.
 *
 * Tools own geometry and their own pixels; this file owns WHERE and WHEN
 * they paint: projection with residuals, culling, isolation, clipping, the
 * look of each frame, and the chrome no single tool should draw.
 *
 * Per-frame paths allocate nothing in the steady state: anchors, geometries,
 * handle and tag scratch arrays are created once and reused.
 */
import { handle, moveGlyph, lockBadge, clipRectOf, clamp } from './paint.js'
import { MOTION, easeOutBack, fwdOf, invOf } from './motion.js'

/** setLineDash copies its argument, so one frozen-in-practice constant serves every call. */
const NO_DASH = []
const GUIDE_DASH = [3, 3]
const TAU = Math.PI * 2

/** Painted beyond the anchors' x-extent when a tool does not say (§4.2 bleed). */
const DEFAULT_BLEED = 12
/** The largest handle ever drawn: touch radius, pressed. Pass 3 inflates its clip by this. */
const MAX_HANDLE_R = MOTION.handleSize.touch * MOTION.press.scale
/** Axis-band opacity at full strength (it fades with Look.band). */
const BAND_ALPHA = 0.14
/** Snap kinds worth a steady marker while held: everything but a bare slot or a free point. */
const MARKED_SNAPS = new Set(['anchor', 'level', 'align', 'fit', 'ohlc', 'series', 'angle'])

// Module-level scratch, reused every frame. Safe because painting is
// synchronous and never re-entrant.
const LOOK = {}
const HANDLES = []
const TAGS = []
const RECT = { x: 0, y: 0, w: 0, h: 0 }
const ONE = [null]
const NO_SLOTS = []

/**
 * Which drawing identity a slot's geometry has told us about. Culling needs
 * `geom.infinite` and `tool.bleed(d, geom)` from a previous projection; a
 * slot never projected for its current drawing is projected unculled once,
 * or a horizontal line anchored off to the left would be culled forever
 * without ever getting the chance to say it spans the plot.
 */
const LEARNED = new WeakMap()
/** The drawing identity already reported for a slot: one error per identity, not one per frame. */
const REPORTED = new WeakMap()

/**
 * Project every visible slot: build its ScreenAnchors from `u + ru` and
 * `inv(fwd(price) + rv)` through the live ts/ps (residuals ignored when
 * exporting), cull in screen space with the tool's bleed (D26), and let the
 * tool project into `slot.geom`. Sets `slot.drawn`. A throw in the tool marks
 * the slot broken (skipped by paint and hit until its drawing changes).
 *
 * Skipped outright: inert, hidden, orphaned (no pane), unprimed-pane,
 * broken, zero-bar, non-finite and — in log mode — non-positive-price slots.
 */
export function projectSlots(slots, ctxFor, motion, exporting) {
  if (!slots) return
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    if (!slot || slot.inert) continue
    slot.drawn = false
    const d = slot.d
    const pane = slot.pane
    if (!d || d.visible === false || !slot.tool || !pane || !pane.ps || !pane.ps.primed) continue
    if (slot.broken === d || !slot.u || !d.points) continue
    const ctx = ctxFor(pane)
    if (!ctx || !ctx.host) continue
    const host = ctx.host
    // Zero bars: nothing is drawn (§3.5). The drawings and selection are kept.
    if (host.bars && host.bars.length === 0) continue
    const ts = ctx.host.ts
    const ps = pane.ps
    const mode = ps.mode
    const n = Math.min(slot.u.length, d.points.length)
    const anchors = anchorsFor(slot, n)
    const res = exporting || !motion ? null : motion.residuals(slot.id)
    let loU = Infinity
    let hiU = -Infinity
    let ruMin = 0
    let ruMax = 0
    let ok = n > 0
    for (let k = 0; k < n; k++) {
      const pt = d.points[k]
      const u = slot.u[k]
      const p = pt ? pt.price : NaN
      // A NaN u (an unresolvable time) or a price log mode cannot place is
      // not drawn at all rather than drawn at a clamped, invented position.
      if (!Number.isFinite(u) || !Number.isFinite(p) || (mode === 'log' && p <= 0)) { ok = false; break }
      const r = res ? res[k] : null
      const ru = r ? r.ru.value : 0
      // A residual seeded under the other price mode is meaningless here
      // (linear units read as ln units): until the next tick zeroes it, ignore it.
      const rv = r && (r.mode === null || r.mode === mode) ? r.rv.value : 0
      const a = anchors[k]
      a.x = ctx.host.ts.x(slot.u[k] + ru)
      a.u = u + ru
      // At rest the stored price goes to ps.y untouched, so a line drawn at a
      // price sits bit-exactly where the core would put it.
      a.price = rv === 0 ? p : invOf(mode, fwdOf(mode, p) + rv)
      a.y = ps.y(a.price)
      a.time = pt.offset ? timeOf(ctx, u, pt.time) : pt.time
      a.approx = !!pt.offset
      if (u < loU) loU = u
      if (u > hiU) hiU = u
      if (ru < ruMin) ruMin = ru
      if (ru > ruMax) ruMax = ru
    }
    if (!ok) continue
    const plotW = pane.rect.w
    const g = geomOf(slot)
    // Infinite geometry (extended lines, horizontal and full-height vertical
    // lines) is never culled by x, and neither is a slot whose geometry we
    // have not seen for this drawing yet (Infinity bleed passes the test).
    const bleed = LEARNED.get(slot) === d && !g.infinite ? bleedOf(slot, ctx) : Infinity
    const x0 = ts.x(loU + ruMin)
    const x1 = ts.x(hiU + ruMax)
    if (x1 + bleed < 0 || x0 - bleed > plotW) { slot.drawn = false; continue }
    if (slot.broken === d) continue
    g.clip = 'pane'
    // Reset to "unknown": a tool that returns early before deciding leaves it
    // unknown, and the slot is then projected unculled until it does decide.
    g.infinite = undefined
    let shown = false
    try {
      shown = slot.tool.project(d, anchors, ctx, g) !== false
    } catch (err) {
      slot.broken = d
      reportOnce(host, slot, err, 'project')
      shown = false
    }
    if (typeof g.infinite === 'boolean' || shown) LEARNED.set(slot, d)
    if (typeof g.infinite !== 'boolean') g.infinite = false
    slot.drawn = shown && slot.broken !== d
  }
}

/**
 * Paint the plugins layer (or, with `info.exporting`, the export pass on the
 * composite canvas: committed drawings at rest and nothing else, §6.6).
 *
 * The controller calls projectSlots on its slots before this on every live
 * paint (geometry also feeds hit testing). The draft, the quick measure and
 * ghosts are not in `slots`; they are projected here.
 */
export function paintScene(c, scene) {
  if (!c || !scene || !scene.motion || typeof scene.ctxFor !== 'function') return
  const motion = scene.motion
  const slots = scene.slots || NO_SLOTS
  const exporting = !!(scene.info && scene.info.exporting)
  const hidden = !!scene.hidden
  // The export pass must not depend on the live frame having projected at
  // rest: residuals are ignored, so project again (it is a one-off).
  if (exporting) projectSlots(slots, scene.ctxFor, motion, true)

  const draft = !exporting && scene.draft && scene.draft.slot && scene.draft.slot.tool ? scene.draft : null
  const draftSlot = draft ? draft.slot : null
  // While an existing drawing is dragged, the draft IS that drawing: paint it
  // in the drawing's place (and with its look), never both.
  let dragged = null
  if (draftSlot && draftSlot.d) {
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && slots[i].id === draftSlot.d.id && slots[i] !== draftSlot) { dragged = slots[i]; break }
    }
  }
  const qm = !exporting && scene.quickMeasure && scene.quickMeasure.tool ? scene.quickMeasure : null
  if (draftSlot) projectOne(draftSlot, scene, motion)
  if (qm) projectOne(qm, scene, motion)
  if (!exporting && !hidden) for (const g of motion.ghosts) projectOne(g.slot, scene, motion)

  // Pass 1: bodies.
  if (!hidden) paintBodies(c, scene, slots, exporting, dragged)
  if (!exporting && !hidden) for (const g of motion.ghosts) paintGhost(c, scene, g)
  if (qm && qm.drawn && qm.broken !== qm.d) paintOne(c, qm, scene.ctxFor(qm.pane), lookMeasure(motion))
  if (draftSlot && draftSlot.drawn && draftSlot.broken !== draftSlot.d) {
    paintOne(c, draftSlot, scene.ctxFor(draftSlot.pane), lookDraft(motion, draftSlot, dragged, scene))
  }

  // Pass 2: axis tags and bands.
  if (!hidden) {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      if (slot && slot !== dragged && slot.drawn && slot.broken !== slot.d) paintTags(c, scene, slot, false, exporting)
    }
  }
  if (draftSlot && draftSlot.drawn && draftSlot.broken !== draftSlot.d) {
    paintTags(c, scene, draftSlot, true, false)
  }
  if (exporting) return

  // Pass 3: chrome.
  if (!hidden) {
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      if (!slot || slot.inert || (slot !== dragged && !slot.drawn)) continue
      const target = slot === dragged ? draftSlot : slot
      paintHandlesOf(c, scene, target, slot.id)
    }
  }
  paintMarks(c, scene, motion)
  paintGuides(c, scene)
}

/* ------------------------------------------------------------ pass 1 -- */

function paintBodies(c, scene, slots, exporting, skip) {
  const motion = scene.motion
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    if (!slot || !slot.drawn || slot.broken === slot.d || slot === skip) continue
    const ctx = scene.ctxFor(slot.pane)
    const look = lookOf(motion, slot, scene, exporting)
    c.save()
    try {
      clipTo(c, clipRectOf(ctx, slot.geom.clip, RECT))
      slot.tool.draw(c, slot.geom, slot.d, look, ctx)
    } catch (err) { slot.broken = slot.d; reportOnce(ctx.host, slot, err, 'draw') } finally { c.restore() }
  }
}

/** A slot outside `slots` (draft, quick measure, ghost): the same isolation as the bodies loop. */
function paintOne(c, slot, ctx, look) {
  c.save()
  try {
    clipTo(c, clipRectOf(ctx, slot.geom.clip, RECT))
    slot.tool.draw(c, slot.geom, slot.d, look, ctx)
  } catch (e) {
    slot.broken = slot.d
    reportOnce(ctx.host, slot, e, 'draw')
  } finally {
    c.restore()
  }
}

function paintGhost(c, scene, g) {
  const slot = g.slot
  if (!slot.drawn || slot.broken === slot.d) return
  const look = scene.motion.look(null, LOOK)
  const p = g.tween.progress
  look.alpha = 1 - p
  look.widthScale = 1 - (1 - MOTION.ghost.width) * p
  look.locked = !!slot.d.locked
  paintOne(c, slot, scene.ctxFor(slot.pane), look)
}

function projectOne(slot, scene, motion) {
  ONE[0] = slot
  projectSlots(ONE, scene.ctxFor, motion, false)
  ONE[0] = null
}

/* ------------------------------------------------------------- looks -- */

function lookOf(motion, slot, scene, exporting) {
  // An export is a picture of the document at rest: no hover, selection or
  // animation state, whatever the live canvas is showing.
  const look = motion.look(exporting ? null : slot.id, LOOK)
  look.exporting = exporting
  look.locked = !!slot.d.locked
  look.editing = !exporting && scene.editingId != null && slot.id === scene.editingId
  return look
}

/**
 * A creation draft previews at 60% alpha, dashed, with its stats showing; a
 * drag draft is the dragged drawing and keeps that drawing's own look.
 */
function lookDraft(motion, slot, dragged, scene) {
  const look = motion.look(dragged ? dragged.id : null, LOOK)
  look.locked = !!slot.d.locked
  look.editing = scene.editingId != null && slot.d.id === scene.editingId
  if (!dragged) {
    look.preview = true
    look.alpha = MOTION.commit.from
    look.stats = 1
  }
  return look
}

function lookMeasure(motion) {
  const look = motion.look(null, LOOK)
  look.stats = 1
  look.locked = false
  return look
}

/* ------------------------------------------------------------ pass 2 -- */

/**
 * The tool's own axis tags (a horizontal line's price, a vertical line's
 * time) in every paint, export included; plus, for the selected or dragged
 * drawing, the accent axis bands and one accent tag per anchor.
 */
function paintTags(c, scene, slot, held, exporting) {
  const ctx = scene.ctxFor(slot.pane)
  let n = 0
  if (typeof slot.tool.axisTags === 'function') {
    try {
      n = slot.tool.axisTags(slot.geom, slot.d, ctx, TAGS) | 0
    } catch (err) {
      slot.broken = slot.d
      reportOnce(ctx.host, slot, err, 'axisTags')
      return
    }
    // putTag reuses the objects in TAGS: clear the flag a previous frame's
    // selection tags may have left on them.
    for (let j = 0; j < n; j++) if (TAGS[j]) TAGS[j].sel = false
  }
  // A draft (creating, or dragging) is the drawing the reader is holding:
  // its bands show at full strength. A committed drawing's follow the
  // selection, eased, so they fade out after a deselect instead of blinking.
  const band = exporting ? 0 : held ? 1 : scene.motion.bandAlpha(slot.id)
  const sel0 = n
  if (band > MOTION.eps) n = selectionTags(slot, ctx, n)
  if (!n) return
  let hasPrice = false
  let hasTime = false
  for (let j = 0; j < n; j++) {
    const t = TAGS[j]
    if (!t) continue
    if (t.axis === 'time') hasTime = true
    else hasPrice = true
  }
  const theme = ctx.theme || {}
  if (hasPrice) priceTags(c, ctx.host, ctx, slot.pane, n, band, theme, sel0)
  if (hasTime) timeTags(c, ctx.host, ctx, slot.pane, n, band, theme, sel0)
}

/** One accent price tag and one time tag per anchor, appended after the tool's own. */
function selectionTags(slot, ctx, n) {
  const a = slot.anchors
  if (!a) return n
  const fp = typeof ctx.formatPrice === 'function' ? ctx.formatPrice : String
  const ft = typeof ctx.formatTime === 'function' ? ctx.formatTime : String
  for (let k = 0; k < a.length; k++) {
    const p = a[k]
    if (!Number.isFinite(p.y)) continue
    n = putSelTag(n, 'price', p.y, fp(p.price))
  }
  for (let k = 0; k < a.length; k++) {
    const p = a[k]
    if (!Number.isFinite(p.x)) continue
    // Two anchors on one bar (a position's target and stop) are one time.
    let dup = false
    for (let m = 0; m < k; m++) if (Math.abs(a[m].x - p.x) < 0.5) dup = true
    if (dup) continue
    n = putSelTag(n, 'time', p.x, (p.approx ? '≈' : '') + ft(p.time))
  }
  return n
}

function putSelTag(i, axis, pos, text) {
  let t = TAGS[i]
  if (!t) t = TAGS[i] = { axis: 'price', pos: 0, text: '', color: '' }
  t.axis = axis
  t.pos = pos
  t.text = text
  t.color = ''
  t.sel = true
  return i + 1
}

/**
 * Price tags in the drawing's own gutter strip. Mirrors the core's
 * drawPriceLines tag (same box, same inset), so a drawing's tag and a price
 * line's tag read as one family.
 */
function priceTags(c, host, ctx, pane, n, band, theme, sel0) {
  const plotW = pane.rect.w
  const width = host.width > plotW ? host.width : plotW + 68
  c.save()
  try {
    clipRect(c, plotW, pane.rect.y, width - plotW, pane.rect.h)
    if (band > MOTION.eps) {
      let y0 = Infinity
      let y1 = -Infinity
      for (let j = sel0; j < n; j++) {
        const s = TAGS[j]
        if (!s || !s.sel || s.axis !== 'price') continue
        if (s.pos < y0) y0 = s.pos
        if (s.pos > y1) y1 = s.pos
      }
      // Held to the strip it is clipped to. A selected drawing whose anchor
      // sits millions of pixels away (the data under it was replaced by a
      // different date range) would otherwise hand the canvas a rectangle
      // that big; the clip hides the excess, but the canvas keeps its
      // coordinates in 32-bit floats, and at that size the edge that IS in
      // view comes out several pixels off.
      if (y0 < pane.rect.y) y0 = pane.rect.y
      if (y1 > pane.rect.y + pane.rect.h) y1 = pane.rect.y + pane.rect.h
      if (y1 - y0 >= 1) {
        c.globalAlpha = BAND_ALPHA * band
        c.fillStyle = theme.accent
        c.fillRect(plotW, y0, width - plotW, y1 - y0)
      }
    }
    c.font = theme.font
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    for (let j = 0; j < n; j++) {
      const t = TAGS[j]
      if (!t || t.axis !== 'price' || !Number.isFinite(t.pos)) continue
      if (t.pos < pane.rect.y || t.pos > pane.rect.y + pane.rect.h) continue
      const text = String(t.text)
      const w = textWidth(ctx, c, theme.font, text)
      c.globalAlpha = t.sel ? band : 1
      // Fallback first: canvas ignores an invalid colour and would keep the last one.
      c.fillStyle = t.sel ? theme.accent : theme.line
      if (!t.sel && t.color) c.fillStyle = t.color
      c.fillRect(plotW + 1, t.pos - 9, w + 14, 18)
      c.fillStyle = theme.tagText
      c.fillText(text, plotW + 8, t.pos)
    }
  } finally {
    c.restore()
  }
}

/** Time tags on the time-axis strip below the last pane, centred and kept inside the plot, as the crosshair's. */
function timeTags(c, host, ctx, pane, n, band, theme, sel0) {
  const plotW = pane.rect.w
  const bottom = host.plotBottom > 0 ? host.plotBottom : pane.rect.y + pane.rect.h
  const height = host.height > bottom ? host.height : bottom + 26
  c.save()
  try {
    clipRect(c, 0, bottom, plotW, height - bottom)
    if (band > MOTION.eps) {
      let x0 = Infinity
      let x1 = -Infinity
      for (let j = sel0; j < n; j++) {
        const s = TAGS[j]
        if (!s || !s.sel || s.axis !== 'time') continue
        if (s.pos < x0) x0 = s.pos
        if (s.pos > x1) x1 = s.pos
      }
      // Held to the strip, for the reason the price band is (see priceTags).
      if (x0 < 0) x0 = 0
      if (x1 > plotW) x1 = plotW
      if (x1 - x0 >= 1) {
        c.globalAlpha = BAND_ALPHA * band
        c.fillStyle = theme.accent
        c.fillRect(x0, bottom, x1 - x0, height - bottom)
      }
    }
    c.font = theme.font
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    for (let j = 0; j < n; j++) {
      const t = TAGS[j]
      if (!t || t.axis !== 'time' || !Number.isFinite(t.pos)) continue
      // An anchor off the plot would be clamped onto its edge and name a
      // time that is not where the reader is looking: skip it instead.
      if (t.pos < 0 || t.pos > plotW) continue
      const text = String(t.text)
      const w = textWidth(ctx, c, theme.font, text)
      const x = Math.min(Math.max(t.pos, w / 2 + 6), plotW - w / 2 - 6)
      c.globalAlpha = t.sel ? band : 1
      // Fallback first: canvas ignores an invalid colour and would keep the last one.
      c.fillStyle = t.sel ? theme.accent : theme.line
      if (!t.sel && t.color) c.fillStyle = t.color
      c.fillRect(x - w / 2 - 7, bottom + 3, w + 14, 18)
      c.fillStyle = theme.tagText
      c.fillText(text, x, bottom + 12)
    }
  } finally {
    c.restore()
  }
}

/* ------------------------------------------------------------ pass 3 -- */

/**
 * Handles of `target` (the slot, or the draft standing in for it during a
 * drag): the selected drawing's, popping in; a just-deselected drawing's,
 * shrinking out; and, under a mouse, a hovered drawing's at half strength.
 */
function paintHandlesOf(c, scene, target, id) {
  const motion = scene.motion
  const selected = id === scene.selectedId
  const leaving = !selected && motion.deselecting(id)
  const ghostly = !selected && !leaving && !scene.touch && id === scene.hoverId
  if (!selected && !leaving && !ghostly) return
  if (!target || !target.drawn || target.broken === target.d || typeof target.tool.handles !== 'function') return
  const locked = !!target.d.locked
  // A locked drawing's handles are a "you cannot drag this" sign: show them
  // on the selection only, never as a hover invitation.
  if (ghostly && locked) return
  const ctx = scene.ctxFor(target.pane)
  let n = 0
  try {
    n = target.tool.handles(target.geom, target.d, HANDLES, !!scene.touch) | 0
  } catch (err) {
    target.broken = target.d
    reportOnce(ctx.host, target, err, 'handles')
    return
  }
  if (n <= 0) return
  const look = motion.look(id, LOOK)
  const theme = ctx.theme || {}
  const alpha = ghostly ? 0.5 * look.hover : 1
  if (!(alpha > MOTION.eps)) return
  c.save()
  try {
    handleClip(c, ctx.host, target.pane)
    c.globalAlpha = alpha
    for (let i = 0; i < n; i++) {
      const h = HANDLES[i]
      if (!h || !Number.isFinite(h.x) || !Number.isFinite(h.y)) continue
      const pop = ghostly ? 1 : motion.handlePop(id, i)
      const pressed = !ghostly && h.index === look.pressedHandle && look.press > MOTION.eps
      const r = look.handleR * pop * (pressed ? 1 + (MOTION.press.scale - 1) * look.press : 1)
      if (!(r > 0.1)) continue
      const x = h.x + look.shake
      if (locked) lockedHandle(c, x, h.y, theme)
      else {
        handle(c, x, h.y, r, theme.handleFill, theme.accent, pressed)
        if (h.move) moveGlyph(c, x, h.y, r, theme.accent)
      }
    }
    if (locked && selected && HANDLES[0]) lockBadge(c, HANDLES[0].x + look.shake + 12, HANDLES[0].y - 12, theme.guide)
  } finally {
    c.restore()
  }
}

/** A locked drawing's anchor: a small hollow square, not a grabbable circle. */
function lockedHandle(c, x, y, theme) {
  c.setLineDash(NO_DASH)
  c.lineWidth = 1
  c.strokeStyle = theme.guide
  c.strokeRect(Math.round(x) - 2.5, Math.round(y) - 2.5, 5, 5)
}

/** Snap rings and touch ripples, each projected from its data-space origin this frame. */
function paintMarks(c, scene, motion) {
  for (const m of motion.rings) paintMark(c, scene, m, true)
  for (const m of motion.ripples) paintMark(c, scene, m, false)
}

function paintMark(c, scene, m, ring) {
  const host = scene.host
  const pane = host && typeof host.paneById === 'function' ? host.paneById(m.paneId) : null
  if (!pane || !pane.ps || !pane.ps.primed) return
  if (pane.ps.mode === 'log' && !(m.price > 0)) return
  const x = host.ts.x(m.u)
  const y = pane.ps.y(m.price)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return
  const t = m.tween.t
  let r
  let alpha
  if (ring) {
    const grow = MOTION.snapRing.ms
    if (m.grow) {
      r = MOTION.snapRing.r * easeOutBack(Math.min(1, t / grow))
      alpha = t <= grow ? 1 : 1 - (t - grow) / MOTION.snapRing.fade
    } else {
      r = MOTION.snapRing.r
      alpha = 1 - t / MOTION.snapRing.fade
    }
  } else {
    const e = m.tween.progress
    r = MOTION.ripple.r * e
    alpha = MOTION.ripple.alpha * (1 - e)
  }
  if (!(alpha > 0) || !(r > 0)) return
  const theme = scene.ctxFor(pane).theme || {}
  c.save()
  try {
    handleClip(c, host, pane)
    c.globalAlpha = alpha > 1 ? 1 : alpha
    c.setLineDash(NO_DASH)
    c.lineWidth = 1.5
    c.strokeStyle = theme.accent
    c.beginPath()
    c.arc(x, y, r, 0, TAU)
    c.stroke()
    if (ring && m.tag) {
      c.font = theme.font
      c.textAlign = 'left'
      c.textBaseline = 'bottom'
      c.fillStyle = theme.accent
      c.fillText(m.tag, x + MOTION.snapRing.r + 3, y - MOTION.snapRing.r - 1)
    }
  } finally {
    c.restore()
  }
}

/** Alignment and angle guides, and a steady marker on a held snap. Clipped to the plot. */
function paintGuides(c, scene) {
  const snap = scene.snap
  const guides = scene.guides
  const marked = snap && MARKED_SNAPS.has(snap.kind) && Number.isFinite(snap.x) && Number.isFinite(snap.y)
  const hasGuides = (guides && guides.length) || (snap && snap.guide)
  if (!marked && !hasGuides) return
  const host = scene.host
  const pane = host && host.panes && host.panes[0]
  if (!pane) return
  const theme = scene.ctxFor(pane).theme || {}
  const plotW = pane.rect.w
  const bottom = host.plotBottom > 0 ? host.plotBottom : pane.rect.y + pane.rect.h
  c.save()
  try {
    clipRect(c, 0, 0, plotW, bottom)
    c.globalAlpha = 1
    c.lineWidth = 1
    c.strokeStyle = theme.guide
    c.setLineDash(GUIDE_DASH)
    if (guides) for (let i = 0; i < guides.length; i++) guideLine(c, guides[i], plotW, bottom)
    if (snap && snap.guide) guideLine(c, snap.guide, plotW, bottom)
    if (marked) {
      c.setLineDash(NO_DASH)
      c.lineWidth = 1.5
      c.strokeStyle = theme.accent
      c.beginPath()
      c.arc(snap.x, snap.y, 3.5, 0, TAU)
      c.stroke()
    }
  } finally {
    c.restore()
  }
}

/**
 * A guide is a level or vertical line from an anchor to the snapped point,
 * and the anchor may be anywhere: after the data under a drawing was replaced
 * by another date range it is millions of pixels off. Held just outside the
 * clip (the guides are axis-aligned, so pulling an end in along its own axis
 * does not tilt them), so the canvas is never handed a coordinate that size.
 */
function guideLine(c, g, plotW, bottom) {
  if (!g || !Number.isFinite(g.x0) || !Number.isFinite(g.y0) || !Number.isFinite(g.x1) || !Number.isFinite(g.y1)) return
  c.beginPath()
  c.moveTo(clamp(g.x0, -2, plotW + 2), clamp(g.y0, -2, bottom + 2))
  c.lineTo(clamp(g.x1, -2, plotW + 2), clamp(g.y1, -2, bottom + 2))
  c.stroke()
}

/* ----------------------------------------------------------- helpers -- */

/**
 * The pass-3 clip: the pane rect inflated by the largest handle, so a handle
 * the drag clamp parked on a pane edge is drawn whole; but never past the
 * midpoint of the gap to a neighbouring pane, so it never paints into the
 * RSI pane below.
 */
function handleClip(c, host, pane) {
  const R = MAX_HANDLE_R
  const r = pane.rect
  let top = r.y - R
  let bottom = r.y + r.h + R
  const panes = host && host.panes
  if (panes) {
    let idx = -1
    for (let i = 0; i < panes.length; i++) if (panes[i] === pane || panes[i].id === pane.id) { idx = i; break }
    if (idx > 0) {
      const p = panes[idx - 1].rect
      top = Math.max(top, (p.y + p.h + r.y) / 2)
    }
    if (idx >= 0 && idx < panes.length - 1) {
      const p = panes[idx + 1].rect
      bottom = Math.min(bottom, (r.y + r.h + p.y) / 2)
    }
  }
  clipRect(c, r.x - R, top, r.w + 2 * R, bottom - top)
}

function clipTo(c, r) {
  clipRect(c, r.x, r.y, r.w, r.h)
}

function clipRect(c, x, y, w, h) {
  c.beginPath()
  c.rect(x, y, w, h)
  c.clip()
}

/** Reused ScreenAnchor objects, one per point, created once per slot (or on a point-count change). */
function anchorsFor(slot, n) {
  let a = slot.anchors
  if (!a || a.length !== n) {
    a = slot.anchors = []
    for (let k = 0; k < n; k++) a.push({ x: 0, y: 0, u: 0, time: 0, price: 0, approx: false })
  }
  return a
}

function geomOf(slot) {
  return slot.geom || (slot.geom = { bbox: { x0: 0, y0: 0, x1: 0, y1: 0 }, infinite: false, clip: 'pane' })
}

/**
 * The clock time an offset point stands for: its bar time plus its bar
 * count, extrapolated at the current timeframe. Labels and spans read this,
 * so "10 bars past the close" is labelled with the time it will be.
 */
function timeOf(ctx, u, stored) {
  if (typeof ctx.timeAt !== 'function') return stored
  const t = ctx.timeAt(u)
  return t == null || !Number.isFinite(t) ? stored : t
}

function bleedOf(slot, ctx) {
  if (typeof slot.tool.bleed !== 'function') return DEFAULT_BLEED
  try {
    const b = slot.tool.bleed(slot.d, slot.geom, ctx)
    return b >= 0 ? b : DEFAULT_BLEED
  } catch (err) {
    slot.broken = slot.d
    reportOnce(ctx.host, slot, err, 'bleed')
    return Infinity
  }
}

function textWidth(ctx, c, font, text) {
  if (typeof ctx.textWidth === 'function') {
    const w = ctx.textWidth(font, text)
    if (w >= 0) return w
  }
  const m = c.measureText(text)
  return m && m.width >= 0 ? m.width : 0
}

/**
 * Report a drawing's failure through the chart's 'error' event, once per
 * drawing identity. The slot is already marked broken, so it is skipped
 * until an edit replaces the drawing; this also stops a failure that recurs
 * in several passes from being reported several times.
 */
function reportOnce(host, slot, err, phase) {
  if (REPORTED.get(slot) === slot.d) return
  REPORTED.set(slot, slot.d)
  const type = slot.tool && slot.tool.type ? slot.tool.type : slot.d && slot.d.type
  try {
    if (host && typeof host.reportError === 'function') host.reportError(err, phase + ' ' + type)
  } catch {
    // A throwing reporter must not take the rest of the scene down with it.
  }
}
