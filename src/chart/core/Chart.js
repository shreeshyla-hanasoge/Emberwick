import { Layers } from './Layers.js'
import { Loop } from './Loop.js'
import { TimeScale } from './TimeScale.js'
import { PriceScale } from './PriceScale.js'
import { defaultTheme } from './palette.js'
import { LiveCandle } from '../motion/LiveCandle.js'
import { Inertia } from '../motion/Inertia.js'
import { drawGrid } from '../render/grid.js'
import { drawCandles } from '../render/candles.js'
import { drawCrosshair } from '../render/crosshair.js'
import { drawZones, drawPriceLines, drawMarkers } from '../render/annotations.js'
import { normalizeMarkers, resolveMarkers, layoutMarkers } from '../overlays/annotations.js'

/**
 * Chart — the orchestrator. Owns the bar store, the scales, the input
 * handling and the frame composition. Framework-free by design: this file
 * touches nothing but DOM and Canvas, which is what lets the same core ship
 * as a React component, a Web Component, or a plain script tag.
 */
export class Chart {
  constructor(container, options = {}) {
    if (!container) throw new Error('Chart: container element is required')

    this.container = container
    this.theme = { ...defaultTheme, ...(options.theme || {}) }
    this.options = {
      volumeRatio: 0.18,
      magnet: true,
      animate: true,
      ...options,
    }

    this.bars = []
    this.feed = null
    this._unsub = null
    this._loadingHistory = false
    this._exhausted = false
    this._listeners = {
      crosshair: new Set(),
      visibleRange: new Set(),
      markerClick: new Set(),
      markerHover: new Set(),
    }

    // ---- annotations --------------------------------------------------
    // Markers carry a `time`; the renderer needs an index. Resolving is a
    // binary search per marker, so it is redone only when the bar array
    // actually shifts (a prepended history page moves every index).
    this._markers = normalizeMarkers(options.markers)
    this.priceLines = Array.isArray(options.priceLines) ? options.priceLines.slice() : []
    this.zones = Array.isArray(options.zones) ? options.zones.slice() : []
    this._markerHits = []
    this._hoverMarkerId = null
    this._resolveKey = ''

    this.layers = new Layers(container, ['base', 'main', 'overlay'])
    this.ts = new TimeScale(options.timeScale)
    this.ps = new PriceScale(options.priceScale)
    this.live = new LiveCandle()
    this.live.enabled = this.options.animate !== false
    this.inertia = new Inertia()

    this.cursor = null
    this.plot = { x: 0, y: 0, w: 1, h: 1 }

    this.loop = new Loop((dirty, dt) => this._frame(dirty, dt))
    this.layers.onResize = () => {
      this._layout()
      this.loop.invalidate('all')
    }

    this._layout()
    this._bindEvents()
    this.loop.start()
  }

  // ---------------------------------------------------------------- layout --
  _layout() {
    const { width, height } = this.layers
    const w = Math.max(1, width - this.theme.priceAxisWidth)
    const h = Math.max(1, height - this.theme.timeAxisHeight)
    this.plot = { x: 0, y: 0, w, h }
    this.ts.resize(w)
    this.ps.layout(0, h)
  }

  // ------------------------------------------------------------------ data --
  setData(bars) {
    this.bars = Array.isArray(bars) ? bars.slice() : []
    this._exhausted = false
    if (this.bars.length > 1) {
      this.ts.timeframeMs = this.bars[1].time - this.bars[0].time
    }
    this.ts.setBarCount(this.bars.length)
    this.ts.snapToRealtime()
    this.live.reset()
    this.ps._primed = false
    this.loop.invalidate('all')
  }

  /** Merge a tick into the forming candle (animated). */
  update(bar) {
    if (!bar) return
    const n = this.bars.length
    if (n && this.bars[n - 1].time === bar.time) {
      this.bars[n - 1] = bar
    } else {
      this.append(bar)
      return
    }
    this.live.setTarget(bar)
    this.loop.invalidate('main')
  }

  /** Open a new candle; the previous one is now closed. */
  append(bar) {
    if (!bar) return
    const n = this.bars.length
    if (n && bar.time <= this.bars[n - 1].time) {
      this.bars[n - 1] = bar
    } else {
      this.bars.push(bar)
      this.ts.setBarCount(this.bars.length)
    }
    this.live.setTarget(bar)
    this.loop.invalidate('main')
  }

  async setFeed(feed) {
    this.detachFeed()
    this.feed = feed
    if (!feed) return
    this.ts.timeframeMs = feed.timeframe || this.ts.timeframeMs
    const bars = await feed.getBars({
      symbol: feed.symbol,
      timeframe: feed.timeframe,
      to: null,
      limit: this.options.initialBars || 1500,
    })
    this.setData(bars)
    if (typeof feed.prime === 'function') feed.prime(bars[bars.length - 1])
    this._unsub = feed.subscribe((msg) => {
      if (!msg || !msg.bar) return
      if (msg.type === 'append') this.append(msg.bar)
      else this.update(msg.bar)
    })
  }

  detachFeed() {
    if (this._unsub) this._unsub()
    this._unsub = null
    this.feed = null
  }

  async _maybeLoadHistory() {
    if (this._loadingHistory || this._exhausted || !this.feed) return
    const { from } = this.ts.visibleRange()
    if (from > 80 || !this.bars.length) return

    this._loadingHistory = true
    try {
      const oldest = this.bars[0].time
      const older = await this.feed.getBars({
        symbol: this.feed.symbol,
        timeframe: this.feed.timeframe,
        to: oldest,
        limit: 1000,
      })
      if (!older || !older.length) {
        this._exhausted = true
      } else {
        const added = older.filter((b) => b.time < oldest)
        if (!added.length) {
          this._exhausted = true
        } else {
          this.bars = added.concat(this.bars)
          // keep the view pinned to the same bars: indices all shifted right
          const wasFollowing = this.ts.follow
          this.ts.barCount = this.bars.length
          this.ts._right.jump(this.ts._right.value + added.length)
          this.ts._right.set(this.ts._right.target + added.length)
          this.ts.follow = wasFollowing
          this.loop.invalidate('all')
        }
      }
    } catch (e) {
      console.error('[Emberwick] history load failed', e)
      this._exhausted = true
    } finally {
      this._loadingHistory = false
    }
  }

  // ---------------------------------------------------------------- events --
  _bindEvents() {
    const el = this.container
    el.style.touchAction = 'none'
    el.style.cursor = 'crosshair'

    let dragging = false
    let mode = null
    let lastX = 0
    let lastY = 0
    let lastT = 0
    let moved = false
    const pointers = new Map()
    let pinchDist = 0

    const localPos = (e) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    this._onDown = (e) => {
      pointers.set(e.pointerId, localPos(e))
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        dragging = false
        return
      }
      const p = localPos(e)
      dragging = true
      moved = false
      mode = p.x > this.plot.w ? 'price' : p.y > this.plot.h ? 'time' : 'pan'
      lastX = p.x
      lastY = p.y
      lastT = performance.now()
      this.inertia.stop()
      el.setPointerCapture(e.pointerId)
    }

    this._onMove = (e) => {
      const p = localPos(e)
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p)

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (pinchDist > 0 && d > 0) {
          const mid = (a.x + b.x) / 2
          this.ts.zoomAt(mid, d / pinchDist)
          this.loop.invalidate('all')
        }
        pinchDist = d
        return
      }

      this.cursor = p
      this._emitCrosshair(p)
      this.loop.invalidate('overlay')

      if (!dragging) return
      const now = performance.now()
      const dt = now - lastT
      const dx = p.x - lastX
      const dy = p.y - lastY
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true

      if (mode === 'pan') {
        this.ts.panBy(dx)
        this.inertia.sample(dx, dt)
        this.loop.invalidate('all')
        this._maybeLoadHistory()
      } else if (mode === 'price') {
        this.ps.scaleBy(1 + dy / 220)
        this.loop.invalidate('all')
      } else if (mode === 'time') {
        this.ts.zoomAt(this.plot.w, 1 - dx / 260)
        this.loop.invalidate('all')
      }

      lastX = p.x
      lastY = p.y
      lastT = now
    }

    this._onUp = (e) => {
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchDist = 0
      if (dragging && mode === 'pan' && moved) {
        this.inertia.release()
        this.loop.invalidate('all')
      }
      dragging = false
      mode = null
      try { el.releasePointerCapture(e.pointerId) } catch (_) {}
    }

    this._onLeave = () => {
      this.cursor = null
      this._emitCrosshair(null)
      this.loop.invalidate('overlay')
    }

    this._onWheel = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const x = e.clientX - r.left
      const factor = Math.pow(0.999, e.deltaY)
      this.ts.zoomAt(x, factor)
      this.loop.invalidate('all')
      this._maybeLoadHistory()
    }

    this._onDbl = () => {
      this.ts.reset()
      this.ps.resetAuto()
      this.loop.invalidate('all')
    }

    this._onKey = (e) => {
      const step = e.shiftKey ? 120 : 40
      if (e.key === 'ArrowLeft') { this.ts.panBy(step); this.loop.invalidate('all'); this._maybeLoadHistory() }
      else if (e.key === 'ArrowRight') { this.ts.panBy(-step); this.loop.invalidate('all') }
      else if (e.key === '+' || e.key === '=') { this.ts.zoomAt(this.plot.w / 2, 1.2); this.loop.invalidate('all') }
      else if (e.key === '-' || e.key === '_') { this.ts.zoomAt(this.plot.w / 2, 0.8); this.loop.invalidate('all') }
      else return
      e.preventDefault()
    }

    this._onClick = (e) => {
      // `moved` is still set from the gesture that just ended — a pan that
      // happens to finish over a marker must not read as a click on it.
      if (moved) return
      if (!this._listeners.markerClick.size) return
      const p = localPos(e)
      const hit = this.markerAt(p.x, p.y)
      if (hit) for (const fn of this._listeners.markerClick) fn(hit)
    }

    el.addEventListener('click', this._onClick)
    el.addEventListener('pointerdown', this._onDown)
    el.addEventListener('pointermove', this._onMove)
    el.addEventListener('pointerup', this._onUp)
    el.addEventListener('pointercancel', this._onUp)
    el.addEventListener('pointerleave', this._onLeave)
    el.addEventListener('wheel', this._onWheel, { passive: false })
    el.addEventListener('dblclick', this._onDbl)
    el.addEventListener('keydown', this._onKey)
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0')
  }

  _emitCrosshair(p) {
    if (this._listeners.crosshair.size) {
      let payload = null
      if (p && this.bars.length && p.x <= this.plot.w && p.y <= this.plot.h) {
        const i = Math.round(this.ts.index(p.x))
        const bar = this.bars[i]
        if (bar) payload = { index: i, bar, price: this.ps.price(p.y) }
      }
      for (const fn of this._listeners.crosshair) fn(payload)
    }
    this._updateHover(p)
  }

  /**
   * Topmost marker whose hit circle contains the point, else null.
   * Hit circles come from the last render, so this costs nothing but a loop.
   */
  markerAt(x, y) {
    const hits = this._markerHits
    for (let i = hits.length - 1; i >= 0; i--) {
      const h = hits[i]
      const dx = x - h.x
      const dy = y - h.y
      if (dx * dx + dy * dy <= h.r * h.r) return h.marker
    }
    return null
  }

  _updateHover(p) {
    const hit = p ? this.markerAt(p.x, p.y) : null
    const id = hit ? hit.id : null
    if (id === this._hoverMarkerId) return
    this._hoverMarkerId = id
    this.container.style.cursor = hit ? 'pointer' : 'crosshair'
    // the hover ring is drawn with the markers, so that layer must repaint
    this.loop.invalidate('main')
    for (const fn of this._listeners.markerHover) fn(hit)
  }

  subscribe(event, fn) {
    const set = this._listeners[event]
    if (!set) throw new Error(`Chart: unknown event "${event}"`)
    set.add(fn)
    // 'visibleRange' is a state event, not a notification: a new subscriber is
    // told the CURRENT window straight away, so it never has to wait for the
    // user to pan before it knows what is on screen.
    if (event === 'visibleRange') {
      const payload = this.visibleRange()
      this._rangeKey = this._rangeIdentity(payload)
      fn(payload)
    }
    return () => set.delete(fn)
  }

  // ------------------------------------------------------------------ range --
  /**
   * The window currently on screen. Cheap enough to poll, though
   * subscribe('visibleRange', fn) is the better way to track it.
   */
  visibleRange() {
    const { from, to } = this.ts.visibleRange()
    return this._rangePayload(from, to)
  }

  _rangePayload(from, to) {
    const n = this.bars.length
    return {
      from,
      to,
      fromTime: n ? this.bars[from].time : null,
      toTime: n ? this.bars[to].time : null,
      barCount: n,
      spacing: this.ts.spacing,
      settled: this.ts.settled,
    }
  }

  _rangeIdentity(p) {
    return `${p.from}:${p.to}:${p.fromTime}:${p.toTime}:${p.settled ? 1 : 0}`
  }

  /**
   * Fires only when the window actually changed, so a consumer can hang a
   * fetch off it without debouncing. Two deliberate choices:
   *
   * - `spacing` is NOT part of the identity. It is a float that moves on every
   *   frame of an eased zoom, so keying on it would make this a 60/sec
   *   firehose. It is still reported, for level-of-detail decisions.
   * - `settled` IS part of the identity, so the final event of a gesture
   *   always arrives with settled:true. Without it, code that defers expensive
   *   work until the view stops moving would wait forever.
   */
  _emitVisibleRange(from, to) {
    const set = this._listeners.visibleRange
    if (!set.size) return
    const payload = this._rangePayload(from, to)
    const key = this._rangeIdentity(payload)
    if (key === this._rangeKey) return // undefined on the first frame, so it emits
    this._rangeKey = key
    for (const fn of set) fn(payload)
  }

  // ----------------------------------------------------------- annotations --
  /** Replace every marker. Each `time` is resolved to its nearest bar. */
  setMarkers(markers) {
    this._markers = normalizeMarkers(markers)
    this._resolveKey = '' // force re-resolution on the next frame
    this.loop.invalidate('main')
  }

  /** The current markers, normalised, each with its resolved bar index. */
  getMarkers() {
    return this._markers.slice()
  }

  addMarker(marker) {
    this.setMarkers(this._markers.concat([marker]))
  }

  removeMarker(id) {
    const key = String(id)
    this.setMarkers(this._markers.filter((m) => m.id !== key))
  }

  clearMarkers() {
    this.setMarkers([])
  }

  /** Horizontal lines — entries, stops, targets, alerts. */
  setPriceLines(lines) {
    this.priceLines = Array.isArray(lines) ? lines.slice() : []
    this.loop.invalidate('main')
  }

  /** Shaded regions: a price band ({from,to}) or a time band ({fromTime,toTime}). */
  setZones(zones) {
    this.zones = Array.isArray(zones) ? zones.slice() : []
    this.loop.invalidate('all')
  }

  // ----------------------------------------------------------------- frame --
  _frame(dirty, dt) {
    let animating = false

    if (this.ts.tick(dt)) animating = true

    const dx = this.inertia.tick(dt)
    if (dx) {
      this.ts.panBy(dx)
      animating = true
      this._maybeLoadHistory()
    }

    if (this.live.tick(dt)) animating = true

    const { from, to } = this.ts.visibleRange()
    const lastIdx = this.bars.length - 1
    const liveBar = this.bars.length ? this.live.read(this.bars[lastIdx]) : null
    const liveVisible = liveBar && to >= lastIdx ? liveBar : null

    this.ps.fit(this.bars, from, to, liveVisible)
    if (this.ps.tick(dt)) animating = true

    const redrawAll = animating || dirty.has('all') || dirty.has('base') || dirty.has('main')
    const state = {
      theme: this.theme,
      ts: this.ts,
      ps: this.ps,
      plot: this.plot,
      bars: this.bars,
      width: this.layers.width,
      height: this.layers.height,
      live: liveVisible,
      volumeRatio: this.options.volumeRatio,
      cursor: this.cursor,
      magnet: this.options.magnet,
      priceLines: this.priceLines,
      zones: this.zones,
    }

    // Marker indices only go stale when the bar array shifts: a prepended
    // history page renumbers every bar, an append does not.
    if (this._markers.length) {
      const key = this.bars.length + ':' + (this.bars.length ? this.bars[0].time : 0)
      if (key !== this._resolveKey) {
        resolveMarkers(this._markers, this.bars)
        this._resolveKey = key
      }
    }

    if (redrawAll) {
      drawGrid(this.layers.ctx.base, state)
      drawZones(this.layers.ctx.base, state)
      drawCandles(this.layers.ctx.main, state)
      drawPriceLines(this.layers.ctx.main, state)
      this._markerHits = drawMarkers(
        this.layers.ctx.main,
        state,
        layoutMarkers(this._markers, state),
        this._hoverMarkerId,
      )
    }
    if (redrawAll || dirty.has('overlay')) {
      drawCrosshair(this.layers.ctx.overlay, state)
    }

    // Emitted after drawing, deliberately: a handler is free to call
    // setData() or setMarkers(), and by this point the renderers have
    // finished reading the state it would mutate.
    this._emitVisibleRange(from, to)

    return animating
  }

  // ------------------------------------------------------------------- api --
  get fps() { return this.loop.fps }

  setTheme(theme) {
    this.theme = { ...this.theme, ...theme }
    this._layout()
    this.loop.invalidate('all')
  }

  setPriceMode(mode) {
    this.ps.setMode(mode)
    this.loop.invalidate('all')
  }

  setAnimate(on) {
    this.live.enabled = !!on
    this.loop.invalidate('all')
  }

  setMagnet(on) {
    this.options.magnet = !!on
    this.loop.invalidate('overlay')
  }

  snapToRealtime() {
    this.ts.snapToRealtime()
    this.ps.resetAuto()
    this.loop.invalidate('all')
  }

  toImage() {
    return this.layers.composite().toDataURL('image/png')
  }

  destroy() {
    const el = this.container
    el.removeEventListener('pointerdown', this._onDown)
    el.removeEventListener('pointermove', this._onMove)
    el.removeEventListener('pointerup', this._onUp)
    el.removeEventListener('pointercancel', this._onUp)
    el.removeEventListener('pointerleave', this._onLeave)
    el.removeEventListener('wheel', this._onWheel)
    el.removeEventListener('dblclick', this._onDbl)
    el.removeEventListener('keydown', this._onKey)
    el.removeEventListener('click', this._onClick)
    this.detachFeed()
    this.loop.stop()
    this.layers.destroy()
    for (const set of Object.values(this._listeners)) set.clear()
    this._markers = []
    this._markerHits = []
    this.priceLines = []
    this.zones = []
    this.bars = []
  }
}

