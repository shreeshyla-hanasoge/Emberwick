/**
 * A seeded random walk over everything a reader and a data feed can do to a
 * chart with drawings on it, checking after every frame the things that must
 * hold whatever happened before.
 *
 * The scripted tests elsewhere each prove one promise on a fixture somebody
 * thought of. This one is for the interleavings nobody did: a wheel zoom in the
 * middle of a handle drag, a history page landing between the two clicks of a
 * trend line, `setData` with a different symbol's bars under a selected
 * drawing, a pane removed while a drawing on it is held, a replay cursor
 * walking under a position, a second finger arriving after an undo. It found
 * the unbounded-coordinate bugs in the axis bands and the alignment guides
 * (test/drawings-anchors.test.mjs, "far-off anchors"), which no scripted test
 * had reason to look for.
 *
 * Deterministic: mulberry32 from the seed, no clock, no real timers. A failure
 * prints the seed, the step and the last actions, and `SEEDS=… STEPS=…` lets a
 * run be widened locally (the defaults are what CI pays for).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { installDom, makeContainer, frame, settle, clearOps, deferredFeed, setDevicePixelRatio } from './dom-stub.mjs'

let restoreDom
before(() => { restoreDom = installDom() })
after(() => restoreDom())

const { createChart } = await import('../src/chart/index.js')
const { enableDrawings, TOOL_PRESETS } = await import('../src/drawings/index.js')
const { pointIndex } = await import('../src/drawings/model/time.js')
const { ownsPress } = await import('../src/drawings/interaction/machine.js')

const T0 = 1_700_000_000_000
const MIN = 60_000
const DAY = 86_400_000

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const wavy = (n, t0 = T0, tf = MIN) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 5 * Math.sin(i / 7)
  return { time: t0 + i * tf, open: c - 0.5, high: c + 1 + (i % 3) * 0.3, low: c - 1 - (i % 4) * 0.2, close: c + 0.3, volume: 10 + i }
})

/** States in which a pointer is held on the plugin's behalf. */
const HELD = new Set(['PRESSED', 'DRAG_HANDLE', 'DRAG_BODY', 'PRESS_CREATE', 'CREATE_DRAG', 'QM_DRAG'])
/** Actions that finish the gesture they start: nothing may still be held after them. */
const COMPLETE = new Set(['click', 'drag', 'dragMod', 'tap', 'swipe', 'pinch'])
const GEOMETRY_OPS = new Set(['moveTo', 'lineTo', 'rect', 'fillRect', 'strokeRect', 'arc', 'quadraticCurveTo', 'fillText'])

async function walk(seed, steps) {
  const rnd = mulberry32(seed)
  const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1))
  const pick = (a) => a[Math.floor(rnd() * a.length)]
  let clock = 1000

  const chart = createChart(makeContainer(), { touchCrosshairDelay: 0 })
  const feed = deferredFeed({ symbol: 'A', timeframe: MIN })
  const errors = []
  chart.subscribe('error', (e) => errors.push(e))
  const loading = chart.setFeed(feed)
  feed.release(0, wavy(200))
  await loading
  settle(chart); frame(chart)

  let ids = 0
  const magnet = pick(['off', 'weak', 'strong', 'inherit'])
  const dc = enableDrawings(chart, {
    idFactory: () => 'd' + (++ids), magnet, platform: 'other', prefersReducedMotion: () => false,
    motion: pick(['none', 'full', 'reduced', 'auto']), historyLimit: 100_000,
    stickyTools: rnd() < 0.3, quickMeasure: rnd() < 0.8, keyboard: rnd() < 0.9, textEditor: rnd() < 0.8, readOnly: rnd() < 0.1,
  })
  frame(chart)

  const ev = (type, id, x, y, o = {}) => ({
    pointerId: id, pointerType: type, clientX: x, clientY: y, button: 0, buttons: o.buttons === undefined ? 1 : o.buttons,
    timeStamp: (clock += 37), preventDefault() {}, stopPropagation() {}, ...o,
  })
  const W = () => chart.plot.w
  const H = () => chart.plot.h
  const source = () => (chart.replay ? chart.replay.source : chart.bars)
  const log = []
  const L = (s) => log.push(s)
  const finger = () => pick(['mouse', 'touch'])
  const idOf = (t) => (t === 'touch' ? 7 : 1)

  const actions = {
    frames() { const k = ri(1, 6); for (let i = 0; i < k; i++) frame(chart, pick([8, 16, 33, 64])); L('frames') },
    settle() {
      const n = settle(chart)
      L('settle ' + n)
      assert.ok(n < 590, 'the frame loop never settles')
      assert.equal(frame(chart), false, 'a settled chart is still animating')
    },
    wheel() { chart._onWheel({ clientX: ri(0, W()), clientY: ri(0, H()), deltaY: ri(-500, 500), preventDefault() {} }); L('wheel') },
    drag() {
      const x0 = ri(10, W() - 10), y0 = ri(10, H() - 10), x1 = ri(0, W()), y1 = ri(0, H())
      chart._onMove(ev('mouse', 1, x0, y0, { buttons: 0 })); chart._onDown(ev('mouse', 1, x0, y0))
      const st = ri(1, 8)
      for (let i = 1; i <= st; i++) { chart._onMove(ev('mouse', 1, x0 + ((x1 - x0) * i) / st, y0 + ((y1 - y0) * i) / st)); if (rnd() < 0.3) frame(chart, 16) }
      chart._onUp(ev('mouse', 1, x1, y1)); L(`drag ${x0 | 0},${y0 | 0}->${x1 | 0},${y1 | 0}`)
    },
    dragMod() {
      const mods = pick([{ shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true, altKey: true }])
      const type = pick(['mouse', 'pen'])
      const x0 = ri(10, W() - 10), y0 = ri(10, H() - 10), x1 = ri(0, W()), y1 = ri(0, H())
      chart._onMove(ev(type, 1, x0, y0, { buttons: 0, ...mods })); chart._onDown(ev(type, 1, x0, y0, mods))
      const st = ri(1, 8)
      for (let i = 1; i <= st; i++) { chart._onMove(ev(type, 1, x0 + ((x1 - x0) * i) / st, y0 + ((y1 - y0) * i) / st, mods)); if (rnd() < 0.3) frame(chart, 16) }
      chart._onUp(ev(type, 1, x1, y1, mods)); L('dragMod ' + JSON.stringify(mods))
    },
    click() { const x = ri(10, W() - 10), y = ri(10, H() - 10); chart._onMove(ev('mouse', 1, x, y, { buttons: 0 })); chart._onDown(ev('mouse', 1, x, y)); chart._onUp(ev('mouse', 1, x, y)); chart._onClick(ev('mouse', 1, x, y)); L(`click ${x},${y}`) },
    dbl() { const x = ri(10, W() - 10), y = ri(10, H() - 10); for (let i = 0; i < 2; i++) { chart._onDown(ev('mouse', 1, x, y)); chart._onUp(ev('mouse', 1, x, y)); chart._onClick(ev('mouse', 1, x, y)) } chart._onDbl({ clientX: x, clientY: y, preventDefault() {} }); L('dbl') },
    hover() { chart._onMove(ev('mouse', 1, ri(0, W()), ri(0, H()), { buttons: 0 })); L('hover') },
    leave() { chart._onLeave(); L('leave') },
    press() { const x = ri(10, W() - 10), y = ri(10, H() - 10); chart._onMove(ev('mouse', 1, x, y, { buttons: 0 })); chart._onDown(ev('mouse', 1, x, y)); L('press') },
    moveHeld() { chart._onMove(ev('mouse', 1, ri(0, W()), ri(0, H()))); L('moveHeld') },
    release() { const t = finger(); chart._onUp(ev(t, idOf(t), ri(0, W()), ri(0, H()))); L('release') },
    tap() { const x = ri(10, W() - 10), y = ri(10, H() - 10); chart._onDown(ev('touch', 7, x, y)); chart._onUp(ev('touch', 7, x, y)); L(`tap ${x},${y}`) },
    swipe() {
      const x0 = ri(10, W() - 10), y0 = ri(10, H() - 10), x1 = ri(0, W()), y1 = ri(0, H())
      chart._onDown(ev('touch', 7, x0, y0))
      const st = ri(2, 8)
      for (let i = 1; i <= st; i++) { chart._onMove(ev('touch', 7, x0 + ((x1 - x0) * i) / st, y0 + ((y1 - y0) * i) / st)); if (rnd() < 0.3) frame(chart, 16) }
      if (rnd() < 0.2) chart._onCancel(ev('touch', 7, x1, y1)); else chart._onUp(ev('touch', 7, x1, y1))
      L('swipe')
    },
    pinch() {
      const cx = ri(100, W() - 100), cy = ri(50, H() - 50), d0 = ri(40, 120), d1 = ri(30, 250)
      chart._onDown(ev('touch', 7, cx - d0 / 2, cy)); chart._onDown(ev('touch', 8, cx + d0 / 2, cy))
      const st = ri(1, 5)
      for (let i = 1; i <= st; i++) { const d = d0 + ((d1 - d0) * i) / st; chart._onMove(ev('touch', 7, cx - d / 2, cy)); chart._onMove(ev('touch', 8, cx + d / 2, cy)) }
      const first = rnd() < 0.5 ? [8, 7] : [7, 8]
      for (const id of first) chart._onUp(ev('touch', id, cx + (id === 8 ? d1 : -d1) / 2, cy))
      L(`pinch ${d0}->${d1}`)
    },
    grab() {
      // Press exactly on a handle of a drawing, so drags of handles are common rather than lucky.
      const all = dc.getDrawings().filter((d) => !d.locked && d.visible !== false)
      if (!all.length) return
      const d = pick(all)
      dc.select(d.id); frame(chart)
      const s = dc._slotById.get(d.id)
      if (!s || !s.anchors || !s.pane || !s.drawn) return
      const a = s.anchors[ri(0, s.anchors.length - 1)]
      if (!a || !Number.isFinite(a.x)) return
      const t = pick(['mouse', 'mouse', 'touch'])
      const id = idOf(t)
      chart._onMove(ev(t, id, a.x, a.y, { buttons: 0 })); chart._onDown(ev(t, id, a.x, a.y))
      for (let i = 1, n = ri(1, 4); i <= n; i++) chart._onMove(ev(t, id, a.x + i * ri(-12, 12), a.y + i * ri(-12, 12)))
      L('grab ' + d.type)
    },
    key() {
      const k = pick([{ key: 'Escape' }, { key: 'Delete' }, { key: 'Backspace' }, { key: 'z', ctrlKey: true }, { key: 'z', ctrlKey: true, shiftKey: true }, { key: 'y', ctrlKey: true },
        { key: 'ArrowLeft' }, { key: 'ArrowRight', shiftKey: true }, { key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'd', ctrlKey: true },
        { key: 'Shift', shiftKey: true }, { key: 'Alt', altKey: true }, { key: 'Enter' }])
      chart._onKey({ ...k, preventDefault() {} }); L('key ' + k.key)
    },
    keyup() { chart.container.dispatch('keyup', { key: 'Shift', shiftKey: false }); L('keyup') },
    blur() { chart.container.dispatch('blur', {}); L('blur') },
    contextMenu() { const x = ri(10, W() - 10), y = ri(10, H() - 10); chart._onMove(ev('mouse', 1, x, y, { buttons: 0 })); chart._onContextMenu({ clientX: x, clientY: y, pointerType: 'mouse', preventDefault() {} }); L('contextmenu') },
    lostCapture() { chart._onLostCapture({ pointerId: pick([1, 7]), pointerType: 'mouse' }); L('lostcapture') },
    cancelEvent() { const t = finger(); chart._onCancel(ev(t, idOf(t), 10, 10)); L('cancel') },
    setTool() { const t = pick([...Object.keys(TOOL_PRESETS), null, null]); dc.setTool(t, { sticky: rnd() < 0.3 }); L('setTool ' + t) },
    cancelTool() { dc.cancel(); L('esc') },
    add() {
      const bars = source()
      if (!bars.length) return
      const type = pick(['trendLine', 'horizontalLine', 'verticalLine', 'rectangle', 'fibRetracement', 'measure', 'position', 'parallelChannel', 'text'])
      const count = { trendLine: 2, horizontalLine: 1, verticalLine: 1, rectangle: 2, fibRetracement: 2, measure: 2, position: 3, parallelChannel: 3, text: 1 }[type]
      const pr = 100 + ri(-8, 8)
      const pt = (p) => ({ time: bars[ri(0, bars.length - 1)].time, price: p, ...(rnd() < 0.2 ? { offset: ri(-5, 8) } : {}) })
      const points = [pt(pr), pt(pr + ri(-6, 6)), pt(pr + ri(-6, 6))].slice(0, count)
      try {
        dc.add({ type, points, pane: rnd() < 0.15 ? 'rsi' : undefined, options: type === 'text' ? { text: 'hi' } : undefined }, { animate: rnd() < 0.5 })
      } catch (e) { if (!/unknown pane/.test(e.message)) throw e }
      L('add ' + type)
    },
    update() { const d = pick(dc.getDrawings().concat([null])); if (!d) return; try { dc.update(d.id, { points: d.points.map((p) => ({ ...p, price: p.price + ri(-3, 3) })) }) } catch (_) {} L('update') },
    remove() { const all = dc.getDrawings(); if (all.length) dc.remove(pick(all).id); L('remove') },
    undo() { dc.undo(); L('undo') },
    redo() { dc.redo(); L('redo') },
    select() { const all = dc.getDrawings(); dc.select(all.length && rnd() < 0.8 ? pick(all).id : null); L('select') },
    lock() { const all = dc.getDrawings(); if (all.length) dc.setLocked(pick(all).id, rnd() < 0.5); L('lock') },
    visible() { const all = dc.getDrawings(); if (all.length) dc.setVisible(pick(all).id, rnd() < 0.7); L('visible') },
    duplicate() { const all = dc.getDrawings(); if (all.length) dc.duplicate(pick(all).id); L('duplicate') },
    batch() { try { dc.batch(() => { dc.clear(); throw new Error('rolled back') }) } catch (_) {} L('batch') },
    hideAll() { dc.setHidden(rnd() < 0.3); L('hideAll') },
    listener() { const un = dc.subscribe(pick(['change', 'drawing', 'select', 'box', 'tool', 'history', 'edit', 'contextmenu']), () => { if (rnd() < 0.05) dc.undo() }); if (rnd() < 0.5) un(); L('listener') },
    editText() {
      const t = dc.getDrawings().find((d) => d.type === 'text')
      if (t) {
        dc.editText(t.id)
        const ta = chart.container.children.filter((c) => c.tagName === 'TEXTAREA').pop()
        if (ta && !ta.removed) { ta.value = pick(['a', '', ' x ']); ta.dispatch('keydown', { key: pick(['Enter', 'Escape']), stopPropagation() {}, preventDefault() {} }) }
      }
      L('editText')
    },
    // ---- the data and the chart under the drawings
    append() { if (chart.replay || !chart.bars.length) return; const b = chart.bars[chart.bars.length - 1]; chart.append({ time: b.time + MIN, open: b.close, high: b.close + ri(0, 3), low: b.close - ri(0, 3), close: b.close + ri(-2, 2), volume: 5 }); L('append') },
    updateBar() { if (chart.replay || !chart.bars.length) return; const b = chart.bars[chart.bars.length - 1]; chart.update({ ...b, high: b.high + ri(0, 4), low: b.low - ri(0, 4), close: b.close + ri(-2, 2) }); L('updateBar') },
    feedTick() { if (chart.replay || !chart.bars.length) return; const b = chart.bars[chart.bars.length - 1]; feed.tick(rnd() < 0.5 ? { type: 'append', bar: { time: b.time + MIN, open: b.close, high: b.close + 2, low: b.close - 2, close: b.close, volume: 3 } } : { type: 'update', bar: { ...b, high: b.high + ri(0, 3), close: b.close + ri(-2, 2) } }); L('feedTick') },
    setData() {
      if (chart.replay) return
      const kind = pick(['same', 'shift', 'fewer', 'more', 'tf5', 'empty', 'disjoint', 'past', 'gapped', 'one', 'two'])
      const cur = chart.bars
      let bars
      if (kind === 'same') bars = cur.map((b) => ({ ...b }))
      else if (kind === 'shift') bars = wavy(cur.length || 150, T0 + ri(-30, 30) * MIN)
      else if (kind === 'fewer') bars = cur.slice(ri(0, 40)).map((b) => ({ ...b }))
      else if (kind === 'more') bars = wavy(cur.length + ri(1, 50), T0 - ri(0, 20) * MIN)
      else if (kind === 'tf5') bars = wavy(60, T0, 5 * MIN)
      else if (kind === 'disjoint') bars = wavy(120, T0 + 400 * DAY)
      else if (kind === 'past') bars = wavy(120, T0 - 4000 * DAY)
      else if (kind === 'gapped') bars = wavy(200).map((b, i) => (i >= 100 ? { ...b, time: b.time + 2 * DAY } : b))
      else if (kind === 'one') bars = wavy(1)
      else if (kind === 'two') bars = wavy(2)
      else bars = []
      chart.setData(bars); L('setData ' + kind)
    },
    async prepend() {
      if (chart.replay || !chart.bars.length) return
      const k = ri(5, 40)
      const load = chart._maybeLoadHistory()
      if (feed.pendingCount > 0) feed.release(feed.pendingCount - 1, wavy(k, chart.bars[0].time - k * MIN))
      await load
      L('prepend ' + k)
    },
    priceMode() { chart.setPriceMode(pick(['log', 'linear'])); L('priceMode') },
    pane() {
      if (chart.pane('rsi')) { chart.removePane('rsi'); L('removePane'); return }
      chart.addPane('rsi')
      chart.setSeries('r', { pane: 'rsi', data: chart.bars.map((b, i) => ({ time: b.time, value: 50 + 20 * Math.sin(i / 5) })) })
      L('addPane')
    },
    series() {
      const k = pick(['data', 'remove', 'hide', 'clear'])
      try {
        if (k === 'data') chart.setSeriesData('r', chart.bars.map((b, i) => ({ time: b.time, value: 40 + 30 * Math.sin(i / (3 + ri(0, 5))) })))
        else if (k === 'remove') chart.removeSeries('r')
        else if (k === 'hide') chart.setSeriesVisible('r', rnd() < 0.5)
        else chart.clearSeries()
      } catch (_) {}
      L('series ' + k)
    },
    replay() {
      if (chart.replay) {
        const k = pick(['seek', 'stop', 'step'])
        if (k === 'seek') chart.replay.seek(ri(0, chart.replay.source.length - 1))
        else if (k === 'stop') chart.stopReplay()
        else chart.replay.step(ri(-3, 5))
        L('replay ' + k)
      } else if (chart.bars.length > 10) {
        chart.startReplay({ from: ri(3, chart.bars.length - 2) }); L('startReplay')
      }
    },
    view() {
      const k = pick(['fit', 'range', 'realtime', 'resume'])
      const n = chart.bars.length
      if (k === 'fit') chart.fitContent()
      else if (k === 'range') { if (n > 3) chart.setVisibleRange({ from: ri(0, n - 2), to: ri(1, n - 1) }) }
      else if (k === 'realtime') chart.snapToRealtime()
      else chart.resume()
      L('view ' + k)
    },
    resize() { const w = ri(300, 1000); const h = ri(250, 600); chart.container.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0 }); chart.resize(); L('resize') },
    dpr() { setDevicePixelRatio(pick([1, 2, 1.5])); L('dpr') },
    theme() { chart.setTheme(pick(['dark', 'light'])); L('theme') },
    animate() { chart.setAnimate(rnd() < 0.5); L('animate') },
    toImage() { chart.toImage(); L('toImage') },
    markers() { const n = chart.bars.length; if (!n) return; chart.setMarkers(rnd() < 0.2 ? [] : Array.from({ length: ri(1, 6) }, (_, i) => ({ id: 'm' + i, time: chart.bars[ri(0, n - 1)].time, price: 100, side: 'buy' }))); L('markers') },
    chrome() {
      const k = pick(['lines', 'zones', 'zone'])
      const n = chart.bars.length
      if (k === 'lines') chart.setPriceLines(rnd() < 0.3 ? [] : [{ price: 100 + ri(-5, 5), label: 'x' }])
      else if (k === 'zones') chart.setZones(n ? [{ from: chart.bars[0].time, to: chart.bars[n - 1].time }] : [])
      else chart.setTimeZone(pick(['UTC', 'Asia/Kolkata', 'America/New_York']))
      L('chrome ' + k)
    },
  }
  const names = Object.keys(actions)

  // ---- invariants, checked after every frame

  const geometryProblem = () => {
    for (const name of chart.layers.names) {
      for (const o of chart.layers.canvas[name].ops) {
        if (!o.args) continue
        for (const a of o.args) {
          if (typeof a === 'number' && !Number.isFinite(a)) return `non-finite argument in ${name}.${o.op}(${o.args})`
          // Only the plugins layer is ours. The canvas keeps 32-bit floats: nothing may be handed a coordinate the size of a country.
          if (name === 'plugins' && typeof a === 'number' && Math.abs(a) > 1e5 && GEOMETRY_OPS.has(o.op)) return `unbounded coordinate in plugins.${o.op}(${o.args})`
        }
      }
    }
    const ops = chart.layers.canvas.plugins ? chart.layers.canvas.plugins.ops : []
    const saves = ops.filter((o) => o.op === 'save').length
    const restores = ops.filter((o) => o.op === 'restore').length
    return saves === restores ? null : `unbalanced save/restore on the plugins canvas (${saves} vs ${restores})`
  }

  const stateProblem = (last) => {
    if (errors.length) return 'the chart reported an error: ' + (errors[0].error && errors[0].error.stack ? errors[0].error.stack : JSON.stringify(errors[0]))
    // The machine may let go of a press before the core does (Esc while a swallowed second click of a sticky tool is still down: the up
    // arrives, finds IDLE, and ends it). The reverse is the stuck state: a machine waiting for an up nobody will route to it.
    if (!chart._owner && ownsPress(dc._state)) return `the machine is ${dc._state.name} but the core has no owner`
    if (COMPLETE.has(last) && chart._owner) return `${last} finished but the core still has an owner`
    if (COMPLETE.has(last) && HELD.has(dc._state.name)) return `${last} left the machine in ${dc._state.name}`
    for (const d of dc.getDrawings()) for (const p of d.points) if (!Number.isFinite(p.time) || !Number.isFinite(p.price)) return 'a non-finite point was stored: ' + JSON.stringify(d)
    for (const id of dc.selection) if (!dc.get(id)) return 'the selection names a drawing that does not exist: ' + id
    return null
  }

  /** Every painted drawing is resolved against the data as it is NOW, and drawn on the candles' own x. */
  const anchorProblem = () => {
    const h = dc._host
    for (const s of dc._slots) {
      if (!s.pane || !s.drawn) continue
      for (let k = 0; k < s.d.points.length; k++) {
        const u = pointIndex(h.source, s.d.points[k], h.timeframeMs)
        if (!(Math.abs(u - s.u[k]) < 1e-9)) return `${s.d.type} ${s.id} point ${k} is resolved to bar ${s.u[k]} but its time is bar ${u}`
        const a = s.anchors && s.anchors[k]
        const glide = dc._motion.residual(s.id, k)
        if (a && !glide && !(dc._dragSlot && dc._dragSlot.id === s.id) && !(Math.abs(a.x - chart.ts.x(u)) < 1e-6)) return `${s.d.type} ${s.id} point ${k} is drawn at x=${a.x}, the candles put bar ${u} at ${chart.ts.x(u)}`
      }
    }
    return null
  }

  /** What is painted can be pointed at: the middle of every drawn, on-screen trend line hits SOMETHING (this line, or one above it). */
  const hitProblem = () => {
    for (const s of dc._slots) {
      if (!s.pane || !s.drawn || s.d.type !== 'trendLine' || s.d.visible === false || !s.anchors || s.anchors.length < 2) continue
      const [a, b] = s.anchors
      const mx = (a.x + b.x) / 2
      const my = (a.y + b.y) / 2
      const r = s.pane.rect
      if (!(mx > 2 && mx < r.w - 2 && my > r.y + 2 && my < r.y + r.h - 2)) continue
      if (dc._motion.residual(s.id, 0) || dc._motion.residual(s.id, 1)) continue
      if (dc._dragSlot && dc._dragSlot.id === s.id) continue
      if (!dc.drawingAt(mx, my)) return `trend line ${s.id} is painted through ${mx.toFixed(1)},${my.toFixed(1)} and nothing is there to hit`
    }
    return null
  }

  /** A handle keeps its grab offset from a STILL pointer through anything that moves the view. */
  let held = null
  const heldProblem = () => {
    const g = dc._drag
    const ptr = dc._ptr
    if (!g || !ptr || g.part !== 'handle' || dc._state.name !== 'DRAG_HANDLE' || !dc._dragSlot || !dc._dragSlot.anchors || !['trendLine', 'measure'].includes(g.d0.type)) { held = null; return null }
    const a = dc._dragSlot.anchors[g.index]
    // A pointer the plot has shrunk out from under (a resize) is clamped onto its edge: the offset is the clamp's, not a slide.
    const r = g.pane.rect
    if (!a || ptr.paneId !== g.pane.id || ptr.x < 0 || ptr.x > r.w || ptr.y < r.y || ptr.y > r.y + r.h) { held = null; return null }
    const cur = { g, px: ptr.x, py: ptr.y, dx: a.x - ptr.x, dy: a.y - ptr.y, shift: !!ptr.shiftKey, spacing: chart.ts.spacing }
    const prev = held
    held = cur
    // A glide (a snap that engaged as the view moved) and a strong magnet legitimately move it; a shift constraint too.
    const gliding = dc._motion.active || (dc._motion.residuals(g.id) || []).some(Boolean)
    if (!prev || gliding || magnet === 'strong' || prev.shift || cur.shift || prev.g !== g || prev.px !== cur.px || prev.py !== cur.py) return null
    // Snaps pull a point by at most a magnet radius, a slot by half a bar: never further.
    if (Math.abs(cur.dx - prev.dx) > Math.max(prev.spacing, cur.spacing) / 2 + 60 || Math.abs(cur.dy - prev.dy) > 60) {
      return `a held handle slid off a still pointer: its offset from it went from ${prev.dx.toFixed(1)},${prev.dy.toFixed(1)} to ${cur.dx.toFixed(1)},${cur.dy.toFixed(1)}`
    }
    return null
  }

  const fail = (step, action, problem) => assert.fail(`seed ${seed}, step ${step} (${action}): ${problem}\n  last actions: ${log.slice(-12).join(' | ')}`)

  let last = ''
  for (let i = 0; i < steps; i++) {
    last = pick(names)
    try {
      await actions[last]()
    } catch (e) {
      if (e && e.code === 'ERR_ASSERTION') fail(i, last, e.message)
      fail(i, last, e && e.stack ? e.stack : String(e))
    }
    if (rnd() < 0.7) {
      try { frame(chart, pick([16, 16, 16, 33])) } catch (e) { fail(i, last, 'frame threw: ' + (e && e.stack ? e.stack : e)) }
      const problem = geometryProblem() || stateProblem(last) || anchorProblem() || hitProblem() || heldProblem()
      clearOps(chart)
      if (problem) fail(i, last, problem)
    }
  }

  // ---- at the end: the document survives its own history and a round trip
  chart._onUp(ev('mouse', 1, 10, 10, { buttons: 0 })); dc.cancel(); dc.cancel(); dc.cancel(); dc.setTool(null)
  while (dc.canRedo) dc.redo()
  const doc = JSON.stringify(dc.getDrawings())
  while (dc.canUndo) dc.undo()
  assert.equal(JSON.stringify(dc.getDrawings()), '[]', `seed ${seed}: undoing everything must leave an empty document`)
  while (dc.canRedo) dc.redo()
  assert.equal(JSON.stringify(dc.getDrawings()), doc, `seed ${seed}: redoing everything must give the document back`)
  dc.setDrawings(dc.getDrawings())
  assert.equal(JSON.stringify(dc.getDrawings()), doc, `seed ${seed}: setDrawings(getDrawings()) must be the identity`)
  dc.destroy(); frame(chart); chart.destroy()
}

const SEEDS = Number(process.env.SEEDS) || 40
const STEPS = Number(process.env.STEPS) || 250
const FIRST = Number(process.env.FIRST_SEED) || 1

test(`a seeded walk over gestures, data events and API calls keeps every drawing on its candles (${SEEDS} seeds x ${STEPS} steps)`, async () => {
  for (let s = FIRST; s < FIRST + SEEDS; s++) await walk(s, STEPS)
})
