/**
 * VolumeProfile: the controller createVolumeProfile() returns, and the plugin
 * the chart draws.
 *
 * One object is both, the way Drawings is: the chart calls the hooks (attach,
 * detach, tick, draw, hover), the host application calls the rest. It paints
 * on the `below` layer, under the candles, and it never claims a gesture: it
 * has no pointerDown, so pan, zoom, drawings, markers and the crosshair behave
 * exactly as they do without it.
 */
import { DASH } from '../chart/index.js'
import { normalizeData, normalizeSession, upsert } from './data.js'
import { DEFAULTS, mergeOptions } from './options.js'
import { profileColors } from './theme.js'
import { spanLeft, spanRight, barLength, binAt, drawBins, drawBin, firstTouch } from './render.js'
import { valueAreaBins } from './valueArea.js'

/**
 * Past this many bins the visible profile is not built. Sessions that share a
 * step but sit millions of steps apart are bad data, not a profile, and one
 * array sized to span them would be the only large allocation in the entry.
 */
const MAX_AGG_BINS = 1e6

const fail = (msg) => { throw new Error(`emberwick/profiles: ${msg}`) }

export class VolumeProfile {
  /**
   * @param {object} chart an Emberwick Chart
   * @param {object} [options] see createVolumeProfile
   */
  constructor(chart, options) {
    if (!chart || typeof chart.addPlugin !== 'function') fail('createVolumeProfile needs an Emberwick chart')
    /** Read once by chart.addPlugin: this plugin paints under the candles. */
    this.layer = 'below'
    this.chart = chart
    /** Vue's ReactiveFlags.SKIP, as on the Chart: never deep-proxy a controller that repaints. */
    this.__v_skip = true
    this._host = null
    this._destroyed = false
    this._listeners = { hover: new Set() }
    // Options and data are validated BEFORE the plugin is attached, so a
    // throw here leaves the chart exactly as it was: no layer, no plugin.
    this._opts = mergeOptions(DEFAULTS, options)
    this._data = normalizeData(options ? options.data : null)
    /** Bumped by everything that changes what is drawn; caches key on it. */
    this._rev = 0

    // ---- frame state: plain fields, reused every frame, nothing allocated ----
    /** What the bar array looked like when sessions were last resolved to indices. */
    this._bk = { rp: undefined, n: -1, tf: 0, gen: -1, t0: 0, tN: 0 }
    /** A session arrived (setData / upsertSession) that has no index range yet. */
    this._unresolved = true
    /** Revealed bar count last frame: a replay stepping BACK un-touches a naked POC. */
    this._revealN = 0
    /** Sessions ending at or after this time are unfinished under replay, and hidden. */
    this._cut = Infinity
    this._from = 0
    this._to = 0
    /** drawBins' memo of the context's fillStyle. */
    this._st = { fill: null }
    this._tag = { color: '', pane: null }
    this._colors = null
    this._colorsOf = null
    this._colorsOpt = undefined
    this._capText = ''
    this._capFont = ''
    this._capW = 0
    /**
     * The visible-range profile: the sum of the sessions on screen, shaped
     * like a session so the same renderer and hit test draw it. `a`, `b`,
     * `count` and `rev` are what it was built from; while they hold, a frame
     * only re-projects it.
     */
    this._agg = {
      raw: null, lo: 0, bins: new Float64Array(0), n: 0, max: 0, total: 0,
      poc: null, pocBin: -1, vah: null, val: null, vaFrom: -1, vaTo: -1,
      a: -1, b: -1, count: 0, rev: -1,
    }
    /** How many times the visible profile was summed. Read by tests: a zoom must not move it. */
    this._aggBuilds = 0

    // ---- hover: the bin under the pointer, as (session, bin index) ----
    this._hasPtr = false
    this._px = 0
    this._py = 0
    this._hovS = null
    this._hovI = -1
    this._hovPrice = 0
    this._hitS = null
    this._hitI = -1
    /** A hover change found during a frame, announced from afterFrame. */
    this._pending = false
    this._retest = false
    // Throws on a destroyed chart; attach() has not run then, so nothing leaks.
    chart.addPlugin(this)
    // attach() declines a host that lacks what 0.13 added. It cannot throw
    // from there (the chart isolates hook errors), so the refusal lands here.
    if (!this._host) {
      chart.removePlugin(this)
      fail('this chart is an older Emberwick core; emberwick/profiles needs 0.13 or newer')
    }
  }

  // ================================================================ public API

  /**
   * Replace every session. `null` (or an empty `sessions`) draws nothing.
   * Throws on a bad `step` or session, leaving the previous data in place.
   * @param {object|null} data ProfileData
   * @returns {this}
   */
  setData(data) {
    this._data = normalizeData(data)
    return this._changed()
  }

  /**
   * Add one session, or replace the session with the same `start`: how a live
   * host feeds the developing session, once per update. Only that session is
   * re-read. Needs setData() first, because the bin `step` belongs to the data.
   * @param {object} session ProfileSession
   * @returns {this}
   */
  upsertSession(session) {
    const d = this._data
    if (!(d.step > 0)) fail('upsertSession() needs setData() first: the bin step comes from the data')
    upsert(d.sessions, normalizeSession(session, d.step))
    return this._changed()
  }

  /**
   * Change any option except `data`. Throws on a bad value before applying
   * anything.
   * @param {object} partial
   * @returns {this}
   */
  setOptions(partial) {
    this._opts = mergeOptions(this._opts, partial)
    return this._changed()
  }

  /**
   * Listen for an event. The only one is 'hover': the bin under the pointer,
   * or null when it is over none.
   * @param {'hover'} event
   * @param {(payload: object|null) => void} fn
   * @returns {this}
   */
  on(event, fn) {
    this._set(event).add(fn)
    return this
  }

  /** Stop listening. @returns {this} */
  off(event, fn) {
    this._set(event).delete(fn)
    return this
  }

  /** Detach from the chart for good. Idempotent, and safe after chart.destroy(). */
  destroy() {
    if (this._destroyed) return
    // removePlugin calls detach(), which is what marks this destroyed: the
    // same path chart.destroy() takes, so there is one way out, not two.
    this.chart.removePlugin(this)
    this._destroyed = true
  }

  // ============================================================== plugin hooks

  attach(host) {
    // A core older than 0.13 has no `below` layer and would paint this over
    // the candles without a word. Leave _host unset; the constructor reports it.
    if (typeof host.timeToIndex !== 'function' || typeof host.drawPriceTag !== 'function') return
    this._host = host
  }

  detach() {
    this._host = null
    this._destroyed = true
    this._hasPtr = false
    this._hovS = null
    for (const set of Object.values(this._listeners)) set.clear()
  }

  /**
   * Nothing animates, so this never asks for another frame: an idle chart
   * with a profile on it still drops to zero CPU. All it does is keep the
   * hovered bin honest when the view moved, or the data changed, under a
   * pointer that did not.
   */
  tick(dt, info) {
    if (!this._host || !this._hasPtr || !(info.full || this._retest)) return
    this._retest = false
    if (this._test(this._px, this._py)) this._pending = true
  }

  /**
   * Paint. Per frame this is projection and fillRect only: every sum, maximum
   * and value area was computed when the data arrived.
   */
  draw(ctx, info) {
    const host = this._host
    if (!host) return
    const d = this._data
    const sessions = d.sessions
    if (!sessions.length) return
    const pane = host.paneById('price')
    // An unprimed scale is still at its 0..1 defaults: there is no price axis to draw against.
    if (!pane || !pane.ps.primed) return
    this._sync(host)

    const o = this._opts
    const ts = host.ts
    const ps = pane.ps
    const r = pane.rect
    const colors = this._palette(host)
    const top = r.y
    const bottom = this._clipBottom(host, r)
    const right = r.x + r.w
    const st = this._st
    st.fill = null

    // The price pane only, and above the volume strip: never an oscillator
    // pane, the axes, or the strip's own bars.
    ctx.save()
    ctx.beginPath()
    ctx.rect(r.x, top, r.w, bottom - top)
    ctx.clip()

    if (o.mode !== 'visible') {
      for (let k = 0; k < sessions.length; k++) {
        const s = sessions[k]
        s.vis = false
        if (!s.on || s.end >= this._cut) continue
        s.xl = spanLeft(ts, s.u0)
        s.xr = spanRight(ts, s.u1)
        if (s.xr < r.x || s.xl > right) continue
        s.vis = true
        drawBins(ctx, ps, s, d.step, Math.round(s.xl), 1, o.width * (s.xr - s.xl), top, bottom, colors, o.valueArea, st)
      }
      if (o.valueArea) {
        ctx.strokeStyle = colors.vaLine
        ctx.lineWidth = 1
        ctx.setLineDash(DASH.dashed)
        ctx.beginPath()
        for (let k = 0; k < sessions.length; k++) {
          const s = sessions[k]
          if (!s.vis || s.vah === null) continue
          const yh = Math.round(ps.y(s.vah)) + 0.5
          const yl = Math.round(ps.y(s.val)) + 0.5
          ctx.moveTo(s.xl, yh)
          ctx.lineTo(s.xr, yh)
          ctx.moveTo(s.xl, yl)
          ctx.lineTo(s.xr, yl)
        }
        ctx.stroke()
        ctx.setLineDash(DASH.solid)
      }
      if (o.poc) {
        ctx.strokeStyle = colors.poc
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let k = 0; k < sessions.length; k++) {
          const s = sessions[k]
          if (!s.vis || s.poc === null) continue
          const y = Math.round(ps.y(s.poc))
          ctx.moveTo(s.xl, y)
          ctx.lineTo(s.xr, y)
        }
        ctx.stroke()
        if (o.extendPoc) this._drawExtensions(ctx, host, ps, r)
      }
    }

    // The visible-range profile, after the sessions so it sits on top of them.
    const g = o.mode !== 'session' ? this._aggregate() : null
    const gx = o.side === 'left' ? r.x : right
    const gdir = o.side === 'left' ? 1 : -1
    if (g && g.max > 0) {
      drawBins(ctx, ps, g, d.step, gx, gdir, o.width * r.w, top, bottom, colors, o.valueArea, st)
      if (o.valueArea) {
        const yh = Math.round(ps.y(g.vah)) + 0.5
        const yl = Math.round(ps.y(g.val)) + 0.5
        ctx.strokeStyle = colors.vaLine
        ctx.lineWidth = 1
        ctx.setLineDash(DASH.dashed)
        ctx.beginPath()
        ctx.moveTo(r.x, yh)
        ctx.lineTo(right, yh)
        ctx.moveTo(r.x, yl)
        ctx.lineTo(right, yl)
        ctx.stroke()
        ctx.setLineDash(DASH.solid)
      }
      if (o.poc) {
        const y = Math.round(ps.y(g.poc))
        ctx.strokeStyle = colors.poc
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(r.x, y)
        ctx.lineTo(right, y)
        ctx.stroke()
      }
    }

    if (!info.exporting && this._hovS) {
      const s = this._hovS
      if (s === g) drawBin(ctx, ps, g, d.step, this._hovI, gx, gdir, o.width * r.w, colors.hover)
      else if (s.vis) drawBin(ctx, ps, s, d.step, this._hovI, Math.round(s.xl), 1, o.width * (s.xr - s.xl), colors.hover)
    }
    if (o.label && d.source) this._caption(ctx, host, r, d.source)
    ctx.restore()

    // Tags sit in the price-axis gutter, outside the clip. Only the latest
    // shown session gets them: twenty sessions' tags would bury the axis.
    if (o.tags && o.mode !== 'visible') {
      let last = null
      for (let k = sessions.length - 1; k >= 0 && !last; k--) {
        if (sessions[k].on && sessions[k].end < this._cut) last = sessions[k]
      }
      if (last && last.poc !== null) this._tags(ctx, host, pane, last, colors)
    }
    if (o.tags && g && g.max > 0) this._tags(ctx, host, pane, g, colors)
  }

  /** After the chart's own state events: the safe place to tell listeners. */
  afterFrame() {
    if (!this._pending) return
    this._pending = false
    this._emitHover()
  }

  /**
   * Mouse and pen hover. Always returns null: a profile is context behind the
   * price, so it never changes the cursor and never takes the crosshair. What
   * is under the pointer is reported through the 'hover' event instead.
   */
  hover(e) {
    if (!this._host) return null
    if (!e) {
      this._hasPtr = false
      if (this._hovS) {
        this._hovS = null
        this._host.invalidate()
        this._emitHover()
      }
      return null
    }
    this._hasPtr = true
    this._px = e.x
    this._py = e.y
    if (this._test(e.x, e.y)) {
      this._host.invalidate()
      this._emitHover()
    }
    return null
  }

  // ================================================================== internal

  _set(event) {
    const set = this._listeners[event]
    if (!set) fail(`unknown event "${String(event)}"`)
    return set
  }

  /** Something drawn changed: bump the revision and repaint this layer only. */
  _changed() {
    this._rev++
    this._unresolved = true
    // The bin under a still pointer may be a different bin now, or gone.
    this._retest = true
    if (this._host) this._host.invalidate()
    return this
  }

  /**
   * Bring every session's bar-index range up to date with the bar array.
   *
   * A session is stored against time and drawn against the index the
   * TimeScale lays out, so its range goes stale whenever the bars shift under
   * it. The key is the one the drawings use: the bar generation, the count,
   * and the first and last bar times. Two traps it is built around:
   * a history prepend replaces chart.bars WITHOUT bumping barGen (caught by
   * the count and the first bar's time), and under replay every scrub bumps
   * barGen while the dataset being resolved against never changes (so the
   * generation is left out of the key then, and the Replay object is in it).
   */
  _sync(host) {
    const src = host.source
    const n = src.length
    const rp = host.replay || null
    const tf = host.timeframeMs
    const t0 = n ? +src[0].time : 0
    const tN = n ? +src[n - 1].time : 0
    const k = this._bk
    let stale = k.rp !== rp || k.n !== n || k.tf !== tf
    if (!rp && (k.gen !== host.barGen || k.t0 !== t0 || k.tN !== tN)) stale = true
    const sessions = this._data.sessions
    if (stale || this._unresolved) {
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i]
        // Not stale: only the sessions that arrived since the last frame.
        if (!stale && s.u0 === s.u0) continue
        // A session outside the loaded bars is skipped, silently: on a live
        // chart that has scrolled its history away that is the normal case.
        s.on = n > 0 && s.end >= t0 && s.start <= tN
        s.u0 = s.on ? host.timeToIndex(s.start) : -1
        // A developing session may end inside the forming bar, or a minute or
        // two past the newest one: it is drawn up to that bar, not beyond it.
        s.u1 = s.on ? Math.min(host.timeToIndex(s.end), n - 1) : -1
        s.touch = -1
        s.scan = Math.floor(s.u1) + 1
      }
      k.rp = rp; k.n = n; k.tf = tf; k.gen = host.barGen; k.t0 = t0; k.tN = tN
      this._unresolved = false
    }

    // Replay: a session is finished once the last REVEALED bar has closed past
    // its end. host.bars is the revealed prefix; host.source is the future too.
    const bars = host.bars
    const m = bars.length
    this._cut = rp && this._opts.hideFutureInReplay ? (m ? +bars[m - 1].time + tf : -Infinity) : Infinity
    if (m < this._revealN) {
      for (let i = 0; i < sessions.length; i++) {
        sessions[i].touch = -1
        sessions[i].scan = Math.floor(sessions[i].u1) + 1
      }
    }
    this._revealN = m

    // The bar indices on screen, as TimeScale#visibleRange gives them, without the object.
    const last = m > 1 ? m - 1 : 0
    const a = Math.floor(host.ts.index(0)) - 1
    const b = Math.ceil(host.ts.index(host.ts.width)) + 1
    this._from = a < 0 ? 0 : a > last ? last : a
    this._to = b < 0 ? 0 : b > last ? last : b
  }

  _palette(host) {
    // setTheme() replaces the theme object and setOptions() the colours
    // object, so two identity checks are the whole cache.
    if (this._colorsOf !== host.theme || this._colorsOpt !== this._opts.colors) {
      this._colorsOf = host.theme
      this._colorsOpt = this._opts.colors
      this._colors = profileColors(host.theme, this._opts.colors)
    }
    return this._colors
  }

  /**
   * Whether `s` is part of the visible-range profile: loaded, finished (under
   * replay), and overlapping the bar indices on screen.
   */
  _summed(s) {
    return s.on && s.end < this._cut && s.u1 >= this._from && s.u0 <= this._to
  }

  /**
   * The visible-range profile: every shown session that overlaps the bars on
   * screen, summed bin by bin.
   *
   * The sessions share one `step`, so each is laid onto a common grid at
   * `round((s.lo - lowest lo) / step)`. It sums WHOLE sessions: a session
   * half on screen contributes all of its volume, because the host sent the
   * session's total per bin, not a bin per bar.
   *
   * It is rebuilt only when the set of overlapping sessions changes or the
   * data does. A zoom, a price-scale ease or a pan that keeps the same
   * sessions on screen leaves it alone, and the frame only re-projects.
   */
  _aggregate() {
    const g = this._agg
    const sessions = this._data.sessions
    const step = this._data.step
    let a = -1
    let b = -1
    let count = 0
    for (let k = 0; k < sessions.length; k++) {
      if (!this._summed(sessions[k])) continue
      if (a < 0) a = k
      b = k
      count++
    }
    if (a === g.a && b === g.b && count === g.count && g.rev === this._rev) return g
    g.a = a
    g.b = b
    g.count = count
    g.rev = this._rev
    g.n = 0
    g.max = 0
    g.total = 0
    g.poc = g.vah = g.val = null
    g.pocBin = g.vaFrom = g.vaTo = -1
    this._aggBuilds++

    let lo = Infinity
    let hi = -Infinity
    for (let k = a; k >= 0 && k <= b; k++) {
      const s = sessions[k]
      if (!s.n || !this._summed(s)) continue
      if (s.lo < lo) lo = s.lo
      if (s.lo + s.n * step > hi) hi = s.lo + s.n * step
    }
    const n = Math.round((hi - lo) / step)
    if (!(n > 0 && n <= MAX_AGG_BINS)) return g
    // Grown when needed and kept: the sum is not a per-frame allocation.
    if (g.bins.length < n) g.bins = new Float64Array(n)
    else g.bins.fill(0, 0, n)
    const bins = g.bins
    for (let k = a; k <= b; k++) {
      const s = sessions[k]
      if (!s.n || !this._summed(s)) continue
      const off = Math.round((s.lo - lo) / step)
      for (let i = 0; i < s.n; i++) bins[off + i] += s.bins[i]
      g.total += s.total
    }
    for (let i = 0; i < n; i++) if (bins[i] > g.max) g.max = bins[i]
    g.lo = lo
    g.n = n
    const va = valueAreaBins(g.bins.length === n ? bins : bins.subarray(0, n))
    if (va) {
      g.pocBin = va.poc
      g.vaFrom = va.from
      g.vaTo = va.to
      g.poc = lo + (va.poc + 0.5) * step
      g.vah = lo + (va.to + 1) * step
      g.val = lo + va.from * step
    }
    return g
  }

  /**
   * Where the profile's clip ends: the top of the volume strip when the chart
   * draws one, else the bottom of the pane.
   *
   * The strip is the bottom `volumeRatio` of the price pane, and the chart
   * draws it only when a visible bar carries volume. An instrument with no
   * volume of its own (an index) has no strip, and clipping to one anyway
   * would cut the lowest bins off its profile for nothing. Same bars, same
   * test as the candle renderer; on a chart with volume the loop ends at the
   * first bar.
   */
  _clipBottom(host, r) {
    const ratio = host.volumeRatio
    if (ratio > 0) {
      const bars = host.bars
      for (let i = this._from; i <= this._to; i++) {
        if (bars[i] && bars[i].volume > 0) return r.y + r.h - r.h * ratio
      }
    }
    return r.y + r.h
  }

  /**
   * The first revealed bar after `s` that trades through its POC, or -1 while
   * the POC is still naked. Incremental: bars already scanned are closed and
   * cannot change, so each frame re-checks only the newest bar, which a live
   * update() replaces in place.
   */
  _touch(s, bars) {
    if (s.touch < 0) {
      s.touch = firstTouch(bars, s.scan, s.poc)
      const from = Math.floor(s.u1) + 1
      s.scan = Math.max(from, bars.length - 1)
    }
    return s.touch
  }

  /**
   * extendPoc: carry each POC right until a later bar trades through it, or
   * to the edge of the pane. Thinner than the session's own POC, so the
   * session it belongs to still reads. A session scrolled off to the left
   * still owns a line that crosses the view, so this walks every shown
   * session, not only the visible ones.
   */
  _drawExtensions(ctx, host, ps, r) {
    const sessions = this._data.sessions
    const bars = host.bars
    const ts = host.ts
    const right = r.x + r.w
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let k = 0; k < sessions.length; k++) {
      const s = sessions[k]
      if (!s.on || s.end >= this._cut || s.poc === null) continue
      const from = s.vis ? s.xr : spanRight(ts, s.u1)
      if (from > right) continue
      const t = this._touch(s, bars)
      const to = t >= 0 ? ts.x(t) : right
      if (to <= from || to < r.x) continue
      const y = Math.round(ps.y(s.poc)) + 0.5
      ctx.moveTo(from < r.x ? r.x : from, y)
      ctx.lineTo(to > right ? right : to, y)
    }
    ctx.stroke()
  }

  /** POC, VAH and VAL of one profile as price-axis tags, the POC on top. */
  _tags(ctx, host, pane, s, colors) {
    const o = this._opts
    const tag = this._tag
    tag.pane = pane
    if (o.valueArea && s.vah !== null) {
      tag.color = colors.vaLine
      host.drawPriceTag(ctx, s.val, tag)
      host.drawPriceTag(ctx, s.vah, tag)
    }
    if (o.poc) {
      tag.color = colors.poc
      host.drawPriceTag(ctx, s.poc, tag)
    }
  }

  /**
   * "Vol: <source>" in the top-left corner of the price pane: which volume
   * this is, for an instrument whose profile is built from another one's.
   * Drawn as the theme's label pill, translucent, so candles under it show.
   *
   * It hangs from the top edge of the pane, fifteen pixels tall, because the
   * chart's own wordmark starts sixteen pixels down in the same corner and a
   * pill laid over its top edge reads as a rendering fault.
   */
  _caption(ctx, host, r, source) {
    const t = host.theme
    const text = 'Vol: ' + source
    ctx.font = t.font
    if (text !== this._capText || t.font !== this._capFont) {
      this._capText = text
      this._capFont = t.font
      this._capW = ctx.measureText(text).width
    }
    ctx.globalAlpha = 0.72
    ctx.fillStyle = t.labelBg
    ctx.fillRect(r.x + 8, r.y, this._capW + 12, 15)
    ctx.globalAlpha = 1
    ctx.fillStyle = t.labelText
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, r.x + 14, r.y + 8)
  }

  /**
   * Find the bin under (x, y) and record it in _hitS/_hitI. A hit is a point
   * on a DRAWN bar: inside the clip, inside a shown session's span, in a bin
   * that traded, and no further along than that bin's bar reaches.
   */
  _hit(x, y) {
    this._hitS = null
    this._hitI = -1
    const host = this._host
    const d = this._data
    if (!host || !d.sessions.length) return
    const pane = host.paneById('price')
    if (!pane || !pane.ps.primed) return
    const r = pane.rect
    if (!(x >= r.x && x <= r.x + r.w && y >= r.y)) return
    this._sync(host)
    if (y > this._clipBottom(host, r)) return
    const price = pane.ps.price(y)
    const ts = host.ts
    const o = this._opts
    // The visible profile first: it is drawn last, so it is what the pointer is on.
    if (o.mode !== 'session') {
      const g = this._aggregate()
      const i = g.max > 0 ? binAt(price, g.lo, d.step, g.n) : -1
      if (i >= 0 && g.bins[i] > 0) {
        const len = barLength(g.bins[i], g.max, o.width * r.w)
        if (o.side === 'left' ? x <= r.x + len : x >= r.x + r.w - len) {
          this._hitS = g
          this._hitI = i
          this._hovPrice = price
          return
        }
      }
      if (o.mode === 'visible') return
    }
    // Newest first: where two sessions' spans meet, the later one is on top.
    for (let k = d.sessions.length - 1; k >= 0; k--) {
      const s = d.sessions[k]
      if (!s.on || s.end >= this._cut || !(s.max > 0)) continue
      const xl = spanLeft(ts, s.u0)
      const xr = spanRight(ts, s.u1)
      if (x < xl || x > xr) continue
      const i = binAt(price, s.lo, d.step, s.n)
      if (i < 0 || !(s.bins[i] > 0)) continue
      if (x > Math.round(xl) + barLength(s.bins[i], s.max, this._opts.width * (xr - xl))) continue
      this._hitS = s
      this._hitI = i
      this._hovPrice = price
      return
    }
  }

  /** Re-test the point; true when the hovered bin changed. */
  _test(x, y) {
    this._hit(x, y)
    if (this._hitS === this._hovS && this._hitI === this._hovI) return false
    this._hovS = this._hitS
    this._hovI = this._hitI
    return true
  }

  /** Tell 'hover' listeners what is under the pointer now. A throwing listener is reported, not fatal. */
  _emitHover() {
    const set = this._listeners.hover
    if (!set.size) return
    const s = this._hovS
    const i = this._hovI
    const step = this._data.step
    const payload = s
      ? {
        session: s.raw,
        price: this._hovPrice,
        binLow: s.lo + i * step,
        binHigh: s.lo + (i + 1) * step,
        volume: s.bins[i],
        pct: s.total > 0 ? (s.bins[i] / s.total) * 100 : 0,
        inValueArea: i >= s.vaFrom && i <= s.vaTo,
      }
      : null
    for (const fn of set) {
      try { fn(payload) } catch (err) { if (this._host) this._host.reportError(err, 'hover listener') }
    }
  }
}
