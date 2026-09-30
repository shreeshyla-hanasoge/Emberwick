/**
 * Mutants for the drawings controller (unit F): src/drawings/Drawings.js.
 *
 * Each entry reverts one decision the controller makes on purpose, and names
 * the regression a reader or a host would see. The `find` lines are the ones
 * §9.4 prescribes; where the code nests a prescribed line one level deeper,
 * the find is still a substring of exactly one line. Re-anchor a mutant that
 * reports ANCHOR NOT FOUND; never delete it.
 */
const F = 'src/drawings/Drawings.js'

export const MUTANTS = [
  {
    name: 'change fires on every drag frame',
    file: F,
    find: "    if (eff.type === 'dragTo') { this._draft(eff); return }",
    replace: "    if (eff.type === 'dragTo') { this._draft(eff); this._emitChange('user', 'move', [], [], []); return }",
  },
  {
    name: 'A load emits change',
    file: F,
    find: "    // a load is not an edit: no 'change'",
    replace: "    this._emitChange('api', 'set', this._store.list, [], [])",
  },
  {
    name: 'A no-op update pushes history and fires events',
    file: F,
    find: '    if (sameDrawing(prev, next)) return false',
    replace: '',
  },
  {
    name: 'getDrawings hands out the live frozen drawings',
    file: F,
    find: '    return this._store.list.map(toJSON)',
    replace: '    return this._store.list',
  },
  {
    name: 'Replay resolves anchors against the prefix',
    file: F,
    find: '    const src = h.source',
    replace: '    const src = h.bars',
  },
  {
    name: 'The cache key ignores the bar generation',
    file: F,
    find: '      s.gen !== h.barGen ||',
    replace: '',
  },
  {
    name: 'A pointer event after an async prepend reads stale indices',
    file: F,
    find: '    this._ensureResolved(slot)\n    return slot.anchors',
    replace: '    return slot.anchors',
  },
  {
    name: 'A body drag jumps k bars on a history prepend',
    file: F,
    find: '    const uGrab = pointIndex(h.source, g.grabPoint, h.timeframeMs)',
    replace: '    const uGrab = g.uGrab0',
  },
  {
    name: 'A held handle drifts off a still pointer while the view eases',
    file: F,
    find: "    if (info.full && this._ptr) this._dispatch({ type: 'rederive' })",
    replace: '',
  },
  {
    name: 'Releasing Shift keeps the 45° constraint until the mouse moves',
    file: F,
    find: "    this._onKeyUp = (e) => { this._setMods(e); this._dispatch({ type: 'rederive' }) }",
    replace: '    this._onKeyUp = () => {}',
  },
  {
    // §9.4 prescribes `return this._motion.tick(...)` as the replacement, but
    // Motion.tick() returns exactly `motion.active` after its step, so that
    // form is an equivalent mutant. The regression it names — motion stepped
    // BEFORE the re-derive that seeds it, so the seed is not counted — is
    // this reorder.
    name: 'Motion seeded by a re-derive is not counted this frame',
    file: F,
    find: '    this._frameInput(info)\n    const busy = this._motion.tick(dt, this._view)\n    return busy || this._motion.active',
    replace: '    const busy = this._motion.tick(dt, this._view)\n    this._frameInput(info)\n    return busy',
  },
  {
    // Re-anchored when the glide moved into _snapGlide: without the engaged
    // guard a handle sliding along a rail re-seeds the glide on every frame.
    name: 'Bar-slot changes glide (drag lag)',
    file: F,
    find: '      if (snap && engaged) this._snapGlide(g, id, ctx, snap, next.points)',
    replace: '      if (snap) this._snapGlide(g, id, ctx, snap, next.points)',
  },
  {
    name: 'A view jump under a held handle becomes a glide (measured across frames)',
    file: F,
    find: '      if (snap && engaged) this._snapGlide(g, id, ctx, snap, next.points)',
    replace: "      if (snap && engaged) for (let k = 0; k < next.points.length; k++) this._glidePoint(id, k, before.points[k], next.points[k], g.pane, 'snapGlide')",
  },
  {
    name: 'A view jump during placement becomes a glide (measured across frames)',
    file: F,
    find: "      if (k >= 0 && flat && d.points[k]) this._glidePoint(DRAFT_ID, k, flat.point, d.points[k], pane, 'snapGlide')",
    replace: "      if (k >= 0 && flat && d.points[k]) this._glidePoint(DRAFT_ID, k, prevD.points[k], d.points[k], pane, 'snapGlide')",
  },
  {
    name: 'The hover crosshair drops its tags flag (two tags on one point)',
    file: F,
    find: '        ? (eff.tags === false',
    replace: '        ? (false',
  },
  {
    name: 'Hover highlight sticks to a line that slid away',
    file: F,
    find: '    if (info.full && this._lastHover && !this._gestureActive()) this._retestHover()',
    replace: '',
  },
  {
    name: 'A fill hides the trade marker under it',
    file: F,
    find: "    if (hit && hit.part === 'fill' && this.chart.markerAt(x, y)) return null",
    replace: '',
  },
  {
    name: 'An orphaned drawing falls onto the price pane',
    file: F,
    find: '      if (!pane) { s.pane = null; continue }',
    replace: '      if (!pane) pane = h.panes[0]',
  },
  {
    name: 'Garbage prices are stored on an unprimed pane',
    file: F,
    find: '    if (!pane || !pane.ps.primed || !h.bars.length) return null',
    replace: '    if (!pane || !h.bars.length) return null',
  },
  {
    name: 'A stale exact crosshair outlives the gesture',
    file: F,
    find: "    if (eff.type === 'crosshairRaw') { this._host.setCrosshair({ x: eff.x, y: eff.y }); return }",
    replace: "    if (eff.type === 'crosshairRaw') return",
  },
  {
    name: 'A released gesture keeps routing moves to an idle plugin',
    file: F,
    find: "    if (eff.type === 'release') { this._host.release(); this._host.setCursor(null); return }",
    replace: "    if (eff.type === 'release') return",
  },
  {
    name: 'The floating toolbar detaches during an autoscale ease',
    file: F,
    find: "    if (boxMoved(this._lastBox, box)) this._emitState('box', { id, box })",
    replace: '',
  },
  {
    name: 'A throwing batch leaves half its edits',
    file: F,
    find: '      this._store.replaceAll(snapshot)',
    replace: '',
  },
  {
    name: 'add() silently overwrites another drawing',
    file: F,
    find: '    if (this._store.has(id)) throw new Error(`duplicate id "${id}"`)',
    replace: '',
  },
  {
    name: "clear() deletes a newer build's drawings",
    file: F,
    find: '    const ids = this._store.list.filter((e) => !e.inert).map((e) => e.id)',
    replace: '    const ids = this._store.list.map((e) => e.id)',
  },
  {
    name: 'The WeakMap keeps a destroyed controller',
    file: F,
    find: '    ENABLED.delete(this.chart)',
    replace: '',
  },

  // ---- beyond §9.4: decisions this implementation added, each defended.
  {
    // The pointerDown result is read AFTER the flush: a host 'select'
    // listener that removes the drawing must leave no owner behind.
    name: 'pointerDown reports a claim a select listener already aborted',
    file: F,
    find: '    return !!r.result && ownsPress(this._state)',
    replace: '    return !!r.result',
  },
  {
    // A re-derive under a still pointer lands where the last step did; it
    // must not count as a changed draft on every full frame.
    name: 'The drawing stream fires on frames where nothing moved',
    file: F,
    find: '    if (sameDrawing(before, next)) return',
    replace: '',
  },
  {
    // Hit tests on a view-moving frame must read THIS frame's projection.
    name: 'A hover re-test reads the previous frame\'s geometry',
    file: F,
    find: '      if (info.full && (this._ptr || this._lastHover)) projectSlots(this._slots, this._ctxFor, this._motion, false)',
    replace: '',
  },
  {
    // The second click of a click-click creation is the browser's dblclick.
    name: 'A click-click creation opens its drawing for editing',
    file: F,
    find: '    if (this._justCreated) { this._justCreated = false; return true }',
    replace: '',
  },
  {
    // D25: an empty (or blank) commit of a text draft stores nothing.
    name: 'A blank text draft is created',
    file: F,
    find: '      if (text === null || !text.trim()) return',
    replace: '      if (text === null) return',
  },
  {
    // An API edit of another drawing must leave a drag alone (§7.3).
    name: 'Any API edit aborts the gesture in progress',
    file: F,
    find: '      if (held !== id) return',
    replace: '',
  },
  {
    // Nudges of one selection coalesce into one undo entry (§5.7).
    name: 'Every nudge is its own undo step',
    file: F,
    find: "    this._apply(next, 'nudge', 'user', { coalesce: 'nudge:' + [...next.keys()].join(',') })",
    replace: "    this._apply(next, 'nudge', 'user', {})",
  },
  {
    // A batch's throw must restore the selection it started with.
    name: 'A throwing batch keeps the selection it changed',
    file: F,
    find: '        this._setSelection(selBefore)',
    replace: '',
  },
  {
    // The native context menu is prevented only for a host that shows its own.
    name: 'A right-click on a drawing always swallows the browser menu',
    file: F,
    find: '      if (!this._listeners.contextmenu.size || !d) return false',
    replace: '      if (!d) return false',
  },
  {
    // The container's selection styles are the host page's: put them back.
    name: 'destroy leaves the container unselectable',
    file: F,
    find: '      el.style.userSelect = this._styleSaved.userSelect',
    replace: '',
  },

  // ---- F2: what the touch, anchors and replay tests defend (test/drawings-{touch,anchors,replay}.test.mjs).
  {
    name: 'A history page leaves the drawings on the old bars until the next pointer event',
    file: F,
    find: '      this._syncTheme()\n      this._resolveAll()\n      this._resolveDrafts()',
    replace: '      this._syncTheme()\n      this._resolveDrafts()',
  },
  {
    name: 'A dragged draft keeps reading the bars it had before a history page',
    file: F,
    find: '      this._resolveAll()\n      this._resolveDrafts()',
    replace: '      this._resolveAll()',
  },
  {
    // With no replay in the key, every scrub bumps barGen and every drawing re-resolves.
    name: 'A replay seek re-resolves every drawing',
    file: F,
    find: '    const rp = h.replay || null',
    replace: '    const rp = null',
  },
  {
    name: 'The text editor lags the zoom under it',
    file: F,
    find: '    if (this._editor && this._fullFrame) {',
    replace: '    if (this._editor && false) {',
  },
  {
    name: 'A finger gets the mouse-sized chrome',
    file: F,
    find: "    this._touch = e.pointerType === 'touch'\n",
    replace: '    this._touch = false\n',
  },
]
