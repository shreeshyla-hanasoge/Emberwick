/**
 * Mutants for the core plugin seam (unit A) and the two-finger pan that
 * shipped ahead of it (A0). Aggregated by test/mutants.js; `file` is
 * repo-relative.
 */
export const MUTANTS = [
  // ---------------------------------------------------------------- A0 ----
  {
    name: 'Two fingers zoom but no longer pan',
    file: 'src/chart/core/Chart.js',
    find: '          this.ts.panBy(mid - pinchMid)\n',
    replace: '',
  },
  {
    name: 'A third finger freezes the pinch',
    file: 'src/chart/core/Chart.js',
    find: '      if (pointers.size >= 2) {\n        // The first two',
    replace: '      if (pointers.size === 2) {\n        // The first two',
  },
  {
    name: 'A third finger starts its own gesture',
    file: 'src/chart/core/Chart.js',
    find: '      if (pointers.size > 2) return\n',
    replace: '',
  },
  {
    name: 'A finger left by a pinch drags a crosshair',
    file: 'src/chart/core/Chart.js',
    find: "          touchMode = 'pan'\n          moved = true",
    replace: '          moved = true',
  },
  {
    name: 'A pinch zoom eases, so the next move drops its right edge and the pinch slides off the fingers',
    file: 'src/chart/core/Chart.js',
    find: '          this.ts._spacing.jump(this.ts._spacing.target)\n          this.ts._right.jump(this.ts._right.target)\n',
    replace: '',
  },

  // ------------------------------------------------------------ Loop wake --
  {
    name: 'The first frame after idle takes 63% of an ease',
    file: 'src/chart/core/Loop.js',
    find: '    const dt = this._woke ? 16.667 : Math.min(Math.max(now - this._last, 1), 64)',
    replace: '    const dt = Math.min(Math.max(now - this._last, 1), 64)',
  },
  {
    name: 'A restarted loop treats its first frame as a wake from idle',
    file: 'src/chart/core/Loop.js',
    find: '    this._last = performance.now()\n    this._woke = false\n',
    replace: '    this._last = performance.now()\n',
  },
  // --------------------------------------------------------- settle frame --
  {
    name: 'The settle frame is not redrawn, so drawings drift from their candles',
    file: 'src/chart/motion/Tween.js',
    find: '      return moved',
    replace: '      return false',
  },
  {
    name: 'A NaN target never stops reporting motion',
    file: 'src/chart/motion/Tween.js',
    find: '      const moved = !Object.is(this.value, this.target)',
    replace: '      const moved = this.value !== this.target',
  },
  // ----------------------------------------------------------- setAnimate --
  {
    name: 'setAnimate(false) never reaches plugins',
    file: 'src/chart/core/Chart.js',
    find: '    this.options.animate = !!on',
    replace: '',
  },
  // --------------------------------------------------------------- Layers --
  {
    name: 'A late layer stays 0x0',
    file: 'src/chart/core/Layers.js',
    find: '    this._size(name)\n    return this.ctx[name]',
    replace: '    return this.ctx[name]',
  },
  {
    name: 'The plugins layer stacks above the crosshair',
    file: 'src/chart/core/Layers.js',
    find: '    this._create(name, i < 0 ? this.names.length : i)',
    replace: '    this._create(name, this.names.length)',
  },
  {
    name: 'Removing a layer leaves a gap in the stacking order',
    file: 'src/chart/core/Layers.js',
    find: "    this.names.splice(this.names.indexOf(name), 1)\n    this.names.forEach((n, i) => { this.canvas[n].style.zIndex = String(i + 1) })",
    replace: '    this.names.splice(this.names.indexOf(name), 1)',
  },
  {
    name: 'An export pass lands on top of the crosshair instead of between the layers',
    file: 'src/chart/core/Layers.js',
    find: '      if (between) between(c, n)',
    replace: '    }\n    for (const n of names) {\n      if (between) between(c, n)',
  },
  // ----------------------------------------------------------------- seam --
  {
    name: "A claim falls through into the core's own press handling (hold timer, `dragging` left true)",
    file: 'src/chart/core/Chart.js',
    find: "          el.setPointerCapture(e.pointerId)\n          return\n        }\n      }\n      dragging = true",
    replace: "          el.setPointerCapture(e.pointerId)\n        }\n      }\n      dragging = true",
  },
  {
    name: "A claimed gesture never reaches its owner",
    file: 'src/chart/core/Chart.js',
    find: "          this._owner = { rec, pointerId: e.pointerId }",
    replace: "",
  },
  {
    name: "Owned moves also drive the raw crosshair",
    file: 'src/chart/core/Chart.js',
    find: "          this._call(this._owner.rec, 'pointerMove', this._pointer(e, p))\n        }\n        return\n      }",
    replace: "          this._call(this._owner.rec, 'pointerMove', this._pointer(e, p))\n        }\n      }",
  },
  {
    name: "A claim does not stop the chart coasting",
    file: 'src/chart/core/Chart.js',
    find: "          clearHold()\n          this.inertia.stop()\n          if (e.pointerType === 'touch') dismissCrosshair()",
    replace: "          clearHold()\n          if (e.pointerType === 'touch') dismissCrosshair()",
  },
  {
    name: "A second finger leaves a half-dragged handle behind",
    file: 'src/chart/core/Chart.js',
    find: "        this._cancelOwner()\n        swallowId = null\n        const [a, b]",
    replace: "        swallowId = null\n        const [a, b]",
  },
  {
    name: "A re-entrant down lands in the middle of a drag",
    file: 'src/chart/core/Chart.js',
    find: "      if (this._owner) this._cancelOwner()\n      swallowId = null",
    replace: "      swallowId = null",
  },
  {
    name: "A lost up leaves the drawing following the mouse",
    file: 'src/chart/core/Chart.js',
    find: "      if (e.pointerType !== 'touch' && e.buttons === 0 && pointers.has(e.pointerId) && (dragging || this._owner || e.pointerId === swallowId)) {",
    replace: "      if (false) {",
  },
  {
    name: "A released press whose up is lost swallows every later hover",
    file: 'src/chart/core/Chart.js',
    find: " && (dragging || this._owner || e.pointerId === swallowId)) {",
    replace: " && (dragging || this._owner)) {",
  },
  {
    name: "Lost pointer capture never ends the gesture",
    file: 'src/chart/core/Chart.js',
    find: "      if (this._owner && e.pointerId === this._owner.pointerId) this._onCancel(e)",
    replace: "",
  },
  {
    name: "A context menu mid-drag leaves the owner stuck",
    file: 'src/chart/core/Chart.js',
    find: "      if (this._owner) {\n        this._cancelOwner()\n        e.preventDefault()",
    replace: "      if (false) {\n        this._cancelOwner()\n        e.preventDefault()",
  },
  {
    name: "A pointercancel is offered as a tap",
    file: 'src/chart/core/Chart.js',
    find: "      const isTap = !cancelling && dragging",
    replace: "      const isTap = dragging",
  },
  {
    name: "A slow pan is offered as a tap",
    file: 'src/chart/core/Chart.js',
    find: "        travel < (downType === 'touch' ? TOUCH_SLOP : 3)",
    replace: "        !moved",
  },
  {
    name: "A right-click is offered as a tap",
    file: 'src/chart/core/Chart.js',
    find: "      const isTap = !cancelling && dragging && downButton === 0 &&",
    replace: "      const isTap = !cancelling && dragging &&",
  },
  {
    name: "A released press pans the chart",
    file: 'src/chart/core/Chart.js',
    find: "      if (e.pointerId === swallowId) {\n        // A press the plugin handed back",
    replace: "      if (false) {\n        // A press the plugin handed back",
  },
  {
    name: "A released press keeps the hover cursor it began with",
    file: 'src/chart/core/Chart.js',
    find: "      // the rest of this press is the raw crosshair's, with no hover.\n      this._pluginHit = null\n",
    replace: "      // the rest of this press is the raw crosshair's, with no hover.\n",
  },
  {
    name: "A double-tap is hit-tested as a mouse",
    file: 'src/chart/core/Chart.js',
    find: "this._offer('doubleClick', this._pointer(e, p, lastType))",
    replace: "this._offer('doubleClick', this._pointer(e, p))",
  },
  {
    name: "A consumed tap still drops a crosshair",
    file: 'src/chart/core/Chart.js',
    find: "          claimed = true\n          touchMode = null",
    replace: "          claimed = true",
  },
  {
    name: "A drag over a marker fires markerClick",
    file: 'src/chart/core/Chart.js',
    find: "      if (moved || claimed) return",
    replace: "      if (moved) return",
  },
  {
    name: "Double-clicking after a claimed click resets the view",
    file: 'src/chart/core/Chart.js',
    find: "      if (prevClaimed || claimed) return",
    replace: "",
  },
  {
    name: "A consumed double-click still resets the view",
    file: 'src/chart/core/Chart.js',
    find: "        if (this._plugins.length && this._offer('doubleClick', this._pointer(e, p, lastType))) return",
    replace: "",
  },
  {
    name: "Arrows pan while a plugin consumes them",
    file: 'src/chart/core/Chart.js',
    find: "      if (this._plugins.length && this._offer('keyDown', e)) { e.preventDefault(); return }",
    replace: "",
  },
  {
    name: "A marker under a drawing still hovers",
    file: 'src/chart/core/Chart.js',
    find: "    const hit = p && !this._owner && !this._pluginHit ? this.markerAt(p.x, p.y) : null",
    replace: "    const hit = p ? this.markerAt(p.x, p.y) : null",
  },
  {
    name: "Plugins force a full redraw (a hover fade repaints the candles)",
    file: 'src/chart/core/Chart.js',
    find: "    const redrawAll = animating || dirty.has('all') || dirty.has('base') || dirty.has('main')",
    replace: "    const redrawAll = animating || this._plugins.length > 0 || dirty.has('all') || dirty.has('base') || dirty.has('main')",
  },
  {
    name: "Plugin keep-alive cannot keep the loop awake",
    file: 'src/chart/core/Chart.js',
    find: "    return animating || pluginsBusy",
    replace: "    return animating",
  },
  {
    name: "Crosshair listeners run inside the frame, before drawing",
    file: 'src/chart/core/Chart.js',
    find: "        if (chart._inFrame) chart._crosshairPending = true\n        else chart._emitCrosshair(chart.cursor)",
    replace: "        chart._emitCrosshair(chart.cursor)",
  },
  {
    name: "A throwing crosshair listener is blamed on the plugin",
    file: 'src/chart/core/Chart.js',
    find: "    try { fn(payload) } catch (e) { console.error(`[Emberwick] '${event}' listener threw`, e) }",
    replace: "    fn(payload)",
  },
  {
    name: "A throwing plugin can stop the chart",
    file: 'src/chart/core/Chart.js',
    find: "try { if (rec.plugin.tick(dt, info) === true) busy = true } catch (err) { rec.failed = true; this._emitError(err, 'plugin tick') }",
    replace: "if (rec.plugin.tick(dt, info) === true) busy = true",
  },
  {
    name: "A failing plugin is never removed",
    file: 'src/chart/core/Chart.js',
    find: "      if (rec.errors >= 10) {",
    replace: "      if (rec.errors >= Infinity) {",
  },
  {
    name: "A frame that paints nothing resets a failing draw's count",
    file: 'src/chart/core/Chart.js',
    find: "      else if (paint || !rec.plugin.draw) rec.errors = 0",
    replace: "      else rec.errors = 0",
  },
  {
    name: "One plugin's canvas state leaks into the next",
    file: 'src/chart/core/Chart.js',
    find: "      ctx.save()\n      try { rec.plugin.draw",
    replace: "      try { rec.plugin.draw",
  },
  {
    name: "A hook that detaches its own plugin is still handed the gesture",
    file: 'src/chart/core/Chart.js',
    find: " && this._plugins.indexOf(rec) >= 0) return rec",
    replace: ") return rec",
  },
  {
    name: "toImage exports selection chrome",
    file: 'src/chart/core/Chart.js',
    find: "      info.exporting = true",
    replace: "",
  },
  {
    name: "toImage exports drawings over stale candles",
    file: 'src/chart/core/Chart.js',
    find: "      try { this._frame(new Set(['all']), 0) } catch (err) { this._emitError(err, 'toImage') }",
    replace: "",
  },
  {
    name: "destroy leaves plugins attached",
    file: 'src/chart/core/Chart.js',
    find: "    for (let i = this._plugins.length - 1; i >= 0; i--) this.removePlugin(this._plugins[i].plugin)",
    replace: "",
  },
  {
    name: "The plugins layer is created eagerly",
    file: 'src/chart/core/Chart.js',
    find: "    this.layers = new Layers(container, ['base', 'main', 'overlay'])",
    replace: "    this.layers = new Layers(container, ['base', 'main', 'plugins', 'overlay'])",
  },
  {
    name: "The plugins layer outlives its last plugin",
    file: 'src/chart/core/Chart.js',
    find: "    else this.layers.remove('plugins')",
    replace: "",
  },
  // ------------------------------------------------------ exact crosshair --
  {
    name: 'An exact crosshair is re-snapped by the 22px magnet',
    file: 'src/chart/render/crosshair.js',
    find: '  if (bar && !cursor.exact) {\n    x = ts.x(i) // snap to the bar slot',
    replace: '  if (bar) {\n    x = ts.x(i) // snap to the bar slot',
  },
  {
    name: 'Two tags describe one dragged point',
    file: 'src/chart/render/crosshair.js',
    find: '  if (cursor.exact && cursor.tags === false) return',
    replace: '',
  },
  {
    name: "The crosshair tag re-reads an exact point's price from its y",
    file: 'src/chart/render/crosshair.js',
    find: '(cursor.exact && Number.isFinite(cursor.price) ? cursor.price : ps.price(y))',
    replace: '(ps.price(y))',
  },
  {
    name: 'An exact point with a null price reaches toFixed()',
    file: 'src/chart/render/crosshair.js',
    find: '(cursor.exact && Number.isFinite(cursor.price) ? cursor.price : ps.price(y))',
    replace: '(cursor.exact && isFinite(cursor.price) ? cursor.price : ps.price(y))',
  },
  {
    name: 'The crosshair event reports a y round-trip instead of the snapped price',
    file: 'src/chart/core/Chart.js',
    find: 'const price = p.exact && Number.isFinite(p.price) ? p.price : pane.ps.price(p.y)',
    replace: 'const price = pane.ps.price(p.y)',
  },
]
