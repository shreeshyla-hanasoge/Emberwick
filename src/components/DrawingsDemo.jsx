import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createChart, RandomFeed, defaultTheme } from '../chart/index.js'
import { enableDrawings, timeToIndex, TOOL_PRESETS } from '../drawings/index.js'
import { Icon } from './Icons.jsx'
import ToolRail from './ToolRail.jsx'
import { useDrawings } from './useDrawings.js'
import { pickScenes, riskReward } from './scenes.js'

/**
 * The landing page's drawings demo: a real chart, the real controller, and a
 * short "watch it draw" that is nothing but calls to the public API.
 *
 * What is on show, and how each part is made true rather than mocked:
 *
 *  - The showreel adds a trend line, a fibonacci and a long with
 *    `add(..., { animate: true })`, moves an anchor with `update(...,
 *    { animate: true })` and takes it back with `undo()`. Nothing is drawn by
 *    the page itself; the same call from your code looks the same.
 *  - Snapping is shown by the reader's own hand, not scripted: `add()` places
 *    exactly the point it is given, so only a gesture can snap. While one is in
 *    flight the readout under the chart reports the `drawing` stream's `snap`
 *    (which candle price it landed on) and its `stats`, as they arrive.
 *  - "Anchors hold" is measured. Prepend and Reload replace the bar array,
 *    then compare the painted box of a drawing before and after
 *    (`screenBox`). It is only claimed to be pixel-exact when the view sat at
 *    the newest bar, because that is the one case where this page can put the
 *    view back exactly; anywhere else it puts the same candles back on screen
 *    to within a bar and says nothing about pixels.
 *  - The right-hand panel is `drawings.get(id)` of the selected drawing: the
 *    row you would store, not a description of it.
 *
 * The chart has a feed attached and paused. Its live ticks are off so a line
 * does not scroll away while it is being placed, and it is attached at all so
 * that panning left pages older history in through the chart's own lazy loader,
 * which is the real history prepend the drawings must survive.
 */

const RAIL = ['trendLine', 'fibRetracement', 'long', 'measure', 'rectangle', 'text']
const SHORT = { cursor: 'Select', trendLine: 'Trend', fibRetracement: 'Fib', long: 'Long', measure: 'Measure', rectangle: 'Box', text: 'Text' }
const TYPE_LABEL = {
  trendLine: 'Trend line',
  horizontalLine: 'Horizontal line',
  verticalLine: 'Vertical line',
  rectangle: 'Rectangle',
  parallelChannel: 'Channel',
  fibRetracement: 'Fib retracement',
  measure: 'Measure',
  position: 'Position',
  text: 'Text',
}
const SNAP_WORD = { O: 'open', H: 'high', L: 'low', C: 'close' }
const PAGE = 120
const TF = 60000

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '')
const MOD = MAC ? '⌘' : 'Ctrl'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/**
 * Resolves true after `n` animation frames, or false if they do not come
 * within a third of a second (a hidden tab runs none). The caller measures
 * paint, and a measurement made with no frame in between measures nothing.
 */
const frames = (n) =>
  new Promise((r) => {
    const t = setTimeout(() => r(false), 350 + n * 40)
    const go = () => {
      if (n-- <= 0) { clearTimeout(t); r(true) } else requestAnimationFrame(go)
    }
    go()
  })
const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** What the `snap` on a `drawing` stream event means, in words. */
function snapWords(snap) {
  if (!snap) return 'on the bar, no snap'
  switch (snap.kind) {
    case 'ohlc': return `snapped to the candle’s ${SNAP_WORD[snap.tag] || 'price'}`
    case 'anchor': return 'snapped to another drawing’s anchor'
    case 'level': return snap.tag ? `snapped to a level (${snap.tag})` : 'snapped to a level'
    case 'align': return 'aligned with another anchor'
    case 'angle': return 'angle held'
    case 'free': return 'free: no snap'
    case 'fit': return 'auto-fit to the extreme'
    case 'series': return 'snapped to the series'
    default: return 'on the bar, no snap'
  }
}

/** The live line for a draft: what it measures, in the units its tool shows. */
function liveStats(p) {
  const d = p.drawing
  if (d.type === 'position' && d.points.length === 3) {
    const rr = riskReward(d)
    return rr ? `R:R ${rr.toFixed(2)}` : 'R:R — (stop on the wrong side)'
  }
  const s = p.stats
  if (!s || d.points.length < 2) return TYPE_LABEL[d.type] || d.type
  const sign = s.change >= 0 ? '+' : '−'
  const pct = s.changePct == null ? '' : ` (${sign}${Math.abs(s.changePct).toFixed(2)}%)`
  const bars = s.bars == null ? '' : ` · ${s.bars} bars`
  return `${sign}${Math.abs(s.change).toFixed(2)}${pct}${bars}`
}

const CHANGE_NOTE = {
  undo: 'Undo is per drawing, and what it restores glides back instead of jumping.',
  redo: 'Undo is per drawing, and what it restores glides back instead of jumping.',
  clear: 'Clear is one undo step: press Undo and all of it comes back.',
  remove: 'One commit, one undo step.',
}

/** A row as text: objects one key per line, the small leaves on one line in the JSON5-ish `{ "k": v }` a person would write. */
function inline(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`
  const keys = Object.keys(v)
  return keys.length ? `{ ${keys.map((k) => `${JSON.stringify(k)}: ${inline(v[k])}`).join(', ')} }` : '{}'
}
function pretty(v, depth = 0) {
  const pad = '  '.repeat(depth)
  const inner = '  '.repeat(depth + 1)
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  const flat = inline(v)
  if (depth >= 2 || flat.length <= 60) return flat
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + pretty(x, depth + 1)).join(',\n')}\n${pad}]`
  const keys = Object.keys(v)
  return `{\n${keys.map((k) => `${inner}${JSON.stringify(k)}: ${pretty(v[k], depth + 1)}`).join(',\n')}\n${pad}}`
}

const SETUP_CODE = `import { createChart } from 'emberwick'
import { enableDrawings } from 'emberwick/drawings'

const chart = createChart(el)
const drawings = enableDrawings(chart)

// once per commit: never per drag frame,
// never for a load
drawings.subscribe('change', debounce(() =>
  save(drawings.getDrawings()), 400))

// a load, not an edit: no change event,
// no undo entry, and a report of what it kept
const report = drawings.setDrawings(await load())

// how the showreel above draws the fib
drawings.add(
  { type: 'fibRetracement', points: [low, high] },
  { animate: true },
)

drawings.setTool('fibRetracement')`

export default function DrawingsShowcase() {
  const hostRef = useRef(null)
  const rootRef = useRef(null)
  const chartRef = useRef(null)
  const feedRef = useRef(null)
  const dcRef = useRef(null)
  const scenesRef = useRef(null)
  const runRef = useRef(null)
  const liveRef = useRef(null)
  const boxRef = useRef(null)
  const inViewRef = useRef(false)
  const phaseRef = useRef('loading')
  const lastCoach = useRef(null)

  const [dc, setDc] = useState(null)
  const [ready, setReady] = useState(false)
  const [inView, setInView] = useState(false)
  const [phase, setPhaseState] = useState('loading') // loading | idle | playing | done | taken
  const [caption, setCaption] = useState(null)
  const [note, setNote] = useState(null)
  const [tab, setTab] = useState('setup')
  const [rev, setRev] = useState(0)
  const [lastId, setLastId] = useState(null)
  const { tool, history, selected } = useDrawings(dc)

  const setPhase = (p) => {
    phaseRef.current = p
    setPhaseState(p)
  }

  /* ------------------------------------------------------------ the chart -- */
  useEffect(() => {
    let disposed = false
    const host = hostRef.current
    const w = host.clientWidth || 560
    // A window of about 70 bars on a laptop and 56 on a phone, whatever the
    // column width: enough candles to draw on and few enough to see each one.
    const want = w < 480 ? 56 : 70
    const spacing = Math.max(3.8, Math.min(9, (w - 72) / (want + 8)))
    // bars of data in view: the plot (minus the price axis) less the 8 empty bars on the right
    const fits = Math.floor((w - 72) / spacing) - 8

    const chart = createChart(host, {
      theme: { ...defaultTheme, background: '#0a0d15' },
      timeScale: { spacing, rightOffset: 8 },
      priceScale: { marginTop: 0.22, marginBottom: 0.14 },
    })
    chartRef.current = chart
    // Enabled right after the chart, destroyed before it: see Playground.
    const d = enableDrawings(chart)
    dcRef.current = d
    setDc(d)

    const feed = new RandomFeed({
      symbol: 'EMBR',
      timeframe: 60000,
      seed: 90210,
      start: 118.6,
      volatility: 0.0024,
      speed: 60,
    })
    feedRef.current = feed

    let quiet = 0
    const offs = [
      d.subscribe('change', (p) => {
        if (disposed) return
        setRev((r) => r + 1)
        if (p.created.length) setLastId(p.created[p.created.length - 1].id)
        setNote({
          t: `change · ${p.source} · ${p.reason}`,
          s: CHANGE_NOTE[p.reason] || 'Once per finished gesture, never per drag frame. This is where you save.',
        })
      }),
      // The stream is written straight to the DOM: it fires from the chart's
      // own frame, and React would re-render the whole demo sixty times a second.
      d.subscribe('drawing', (p) => {
        const live = liveRef.current
        const box = boxRef.current
        if (!live || !box) return
        live.firstChild.textContent = `${TYPE_LABEL[p.drawing.type] || p.drawing.type} · ${liveStats(p)}`
        live.lastChild.textContent = snapWords(p.snap)
        box.classList.add('has-live')
        clearTimeout(quiet)
        quiet = setTimeout(() => box.classList.remove('has-live'), 420)
      }),
    ]

    chart.setFeed(feed).then(() => {
      if (disposed) return
      // The tape is for drawing on, not watching.
      feed.setPaused(true)
      chart.snapToRealtime()
      // How many bars the plot holds is worked out from what this chart was
      // made with, not read back: straight after setFeed the view is still
      // easing in, and visibleRange() reports the window it has reached so far.
      scenesRef.current = pickScenes(chart.bars, { window: Math.max(30, Math.min(110, fits - 4)) })
      setReady(true)
      setPhase('idle')
    })

    return () => {
      disposed = true
      clearTimeout(quiet)
      if (runRef.current) runRef.current.stop = true
      offs.forEach((off) => off())
      d.destroy()
      feed.destroy()
      chart.destroy()
      chartRef.current = null
      feedRef.current = null
      dcRef.current = null
    }
  }, [])

  /* ------------------------------------------------ visible on screen or not -- */
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      inViewRef.current = true
      setInView(true)
      return undefined
    }
    const io = new IntersectionObserver(
      ([e]) => {
        inViewRef.current = e.isIntersecting
        setInView(e.isIntersecting)
      },
      { threshold: 0.45 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  /* ------------------------------------------------------- proof operations -- */
  // The view is put back on the same candles after the bar array was replaced.
  //
  // setData() re-anchors with an EASE (snapToRealtime), so on its own a
  // prepend would throw the view 120 bars back and glide it forward again.
  // setVisibleRange() jumps, so it is used to land on the same bars; it names
  // the newest bar as the right edge, which loses the empty bars after it, so
  // a view that was sitting at the newest bar gets them back with
  // snapToRealtime() (a short settle, not a jump). A reload of the same bars
  // at the newest bar needs none of it: setData's own re-anchor is the view it
  // already had, and that case alone is measured in pixels below.
  const replaceBars = async (run, shift) => {
    const c = chartRef.current
    const d = dcRef.current
    const r = c.visibleRange()
    const atEnd = !!r && r.to >= c.bars.length - 1
    const probe = ['show-fib', 'show-long', 'show-trend'].find((id) => d.get(id)) || (d.getDrawings()[0] || {}).id
    const before = probe ? d.screenBox(probe) : null
    const rowsBefore = JSON.stringify(d.getDrawings())
    const countBefore = c.bars.length
    const anchor = probe ? d.get(probe).points[0] : null
    const idxBefore = anchor ? timeToIndex(c.bars, anchor.time, TF) : null

    run()
    const exact = atEnd && shift === 0
    if (r && !exact) {
      c.setVisibleRange({ from: r.from + shift, to: r.to + shift })
      if (atEnd) c.snapToRealtime()
    }

    let painted = await frames(4)
    let moved = null
    if (exact) {
      // The box is the last PAINT's, and the first frames after the bar array
      // changed may paint nothing for it yet: give it a moment before reading.
      let after = probe ? d.screenBox(probe) : null
      for (let i = 0; i < 10 && painted && probe && !after; i++) {
        painted = await frames(3)
        after = d.screenBox(probe)
      }
      if (painted && before && after) {
        moved = Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y), Math.abs(after.w - before.w), Math.abs(after.h - before.h))
      }
    }
    const rows = d.getDrawings()
    const same = JSON.stringify(rows) === rowsBefore
    const idxAfter = anchor ? timeToIndex(c.bars, anchor.time, TF) : null
    return { countBefore, countAfter: c.bars.length, idxBefore, idxAfter, moved, probe, rows: rows.length, same }
  }

  const receipt = (head, res) => {
    const bits = [`bars ${res.countBefore} \u2192 ${res.countAfter}`]
    if (res.probe && res.idxBefore != null && Math.round(res.idxBefore) !== Math.round(res.idxAfter)) {
      bits.push(`an anchor was bar #${Math.round(res.idxBefore)}, now #${Math.round(res.idxAfter)}`)
    }
    if (res.probe) bits.push(res.same ? `${res.rows} stored row${res.rows === 1 ? '' : 's'} unchanged` : 'the stored rows changed')
    if (res.moved != null) bits.push(`painted ${res.moved < 0.5 ? 'exactly where it was' : `${res.moved.toFixed(1)} px off`}`)
    setNote({ t: head, s: res.probe ? bits.join(' \u00b7 ') : 'Draw something first, then do this again.' })
  }

  const reload = async () => {
    const c = chartRef.current
    if (!c || !c.bars.length) return
    const res = await replaceBars(() => c.setData(c.bars.map((b) => ({ ...b }))), 0)
    receipt('Reloaded: setData() with a fresh copy of the bars.', res)
  }

  const prepend = async () => {
    const c = chartRef.current
    const feed = feedRef.current
    if (!c || !feed || !c.bars.length) return
    const older = await feed.getBars({ symbol: 'EMBR', timeframe: 60000, to: c.bars[0].time, limit: PAGE })
    if (!chartRef.current || !older.length) return
    const k = older.length
    const res = await replaceBars(() => c.setData(older.concat(c.bars)), k)
    receipt(`${k} older bars in front. Every bar index shifted by ${k}; the drawings did not.`, res)
  }

  /* -------------------------------------------------------------- showreel -- */
  const stopShow = useCallback(() => {
    if (runRef.current) runRef.current.stop = true
  }, [])

  const install = () => {
    // Everything at once, unanimated: for a reader who got here first, and for
    // reduced motion. A load, so it is not undoable and fires no `change`.
    const d = dcRef.current
    const s = scenesRef.current
    if (!d || !s) return
    const narrow = chartRef.current.container.clientWidth < 480
    d.setDrawings([s.trend, s.fib, !narrow && s.long].filter(Boolean))
  }

  const play = useCallback(async () => {
    const c = chartRef.current
    const d = dcRef.current
    const s = scenesRef.current
    if (!c || !d || !s) return
    const token = { stop: false }
    if (runRef.current) runRef.current.stop = true
    runRef.current = token
    const alive = () => !token.stop && chartRef.current === c

    // Waits, but not while the section is off screen: the script simply holds
    // its place and carries on when it comes back into view.
    const hold = async (ms) => {
      let left = ms
      while (left > 0) {
        if (!alive()) return false
        if (!inViewRef.current) { await sleep(160); continue }
        const step = Math.min(left, 80)
        await sleep(step)
        left -= step
      }
      return alive()
    }

    setPhase('playing')
    d.setTool(null)
    d.select(null)
    d.clear({ history: false })
    d.clearHistory()
    setLastId(null)
    setNote(null)

    const add = (row) => { try { d.add(row, { history: false, animate: true }) } catch (e) { /* a leftover id: skip the scene */ } }
    const rr = s.long ? riskReward(s.long) : null
    const trendWord = s.trend && s.trend.points[0].price < s.trend.points[1].price ? 'lows' : 'highs'
    const fibP = s.fib ? s.fib.points : null
    // A 255px plot cannot hold three drawings and the labels of a position
    // without one lying on another; the Long tool is still on the rail.
    const narrow = c.container.clientWidth < 480

    const steps = [
      s.trend && { say: `Trend line through two swing ${trendWord}`, run: () => add(s.trend), ms: 1700 },
      s.fib && { say: 'Fib retracement: the levels stagger in', run: () => add(s.fib), ms: 2500 },
      s.long && !narrow && { say: rr ? `Long: R:R ${rr.toFixed(2)}, and it reads its own outcome` : 'Long: entry, target and stop', run: () => add(s.long), ms: 2600 },
      fibP && {
        say: 'Move an anchor and it glides',
        run: () => {
          const [p0, p1] = fibP
          const to = { time: p0.time, price: Number((p0.price + (p1.price - p0.price) * 0.28).toFixed(2)) }
          d.update(s.fib.id, { points: [to, p1] }, { animate: true, history: true })
        },
        ms: 2000,
      },
      fibP && { say: 'Undo glides it back', run: () => d.undo(), ms: 2000 },
      {
        say: `Prepend ${PAGE} bars: indices shift, drawings don\u2019t`,
        run: async () => { d.select(null); await prepend() },
        ms: 2600,
      },
      { say: 'Reload the bars: anchors re-resolve by time', run: async () => { await reload() }, ms: 2200 },
    ].filter(Boolean)

    for (const st of steps) {
      if (!alive()) break
      setCaption(st.say)
      try { await st.run() } catch (e) { /* the chart went away mid-step */ }
      if (!(await hold(st.ms))) break
    }

    if (token.stop) {
      // A reader took over. Leave the board exactly as it is.
      if (runRef.current === token) setCaption(null)
      return
    }
    d.select(null)
    d.clearHistory()
    setNote(null)
    setCaption(null)
    setPhase('done')
  }, [])

  // Start the first time it is on screen with the data in; never while off screen.
  useEffect(() => {
    if (phase !== 'idle' || !ready || !inView) return
    if (reducedMotion()) {
      install()
      setPhase('done')
      return
    }
    play()
  }, [phase, ready, inView, play])

  // Any real pointer, key or wheel input in the demo is the reader taking over.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const take = (e) => {
      if (!e.isTrusted) return
      const p = phaseRef.current
      if (p === 'playing') stopShow()
      else if (p === 'idle') install()
      if (p === 'playing' || p === 'idle' || p === 'done') {
        setCaption(null)
        setPhase('taken')
      }
    }
    const evs = ['pointerdown', 'keydown', 'wheel']
    evs.forEach((n) => el.addEventListener(n, take, { capture: true, passive: true }))
    return () => evs.forEach((n) => el.removeEventListener(n, take, { capture: true }))
  }, [stopShow])

  const replay = () => {
    stopShow()
    play()
  }

  /* --------------------------------------------------------------- render -- */
  const shown = useMemo(() => {
    if (!dc) return null
    if (selected) return dc.get(selected.id) || selected
    const last = lastId ? dc.get(lastId) : null
    if (last) return last
    const all = dc.getDrawings()
    return all.length ? all[all.length - 1] : null
    // rev: the drawings changed under the same selection
  }, [dc, selected, lastId, rev]) // eslint-disable-line react-hooks/exhaustive-deps

  const armed = tool.tool ? (TOOL_PRESETS[tool.tool] || {}).label || tool.tool : null
  const sel = selected ? TYPE_LABEL[selected.type] || selected.type : null

  const hint = armed ? (
    <>
      <span className="hint-m"><b>{armed}</b> armed: click and drag on the chart. <kbd>Shift</kbd> holds 45&deg;, <kbd>Alt</kbd> frees the point, <kbd>Esc</kbd> cancels.</span>
      <span className="hint-t"><b>{armed}</b> armed: <b>one finger draws</b>, <b>two fingers pan and pinch</b>.</span>
    </>
  ) : sel ? (
    <>
      <span className="hint-m"><b>{sel}</b> selected: drag a handle to reshape it, <kbd>Del</kbd> removes it, <kbd>{MOD}</kbd> <kbd>Z</kbd> undoes.</span>
      <span className="hint-t"><b>{sel}</b> selected: drag a handle to reshape it.</span>
    </>
  ) : (
    <>
      <span className="hint-m"><b>Pick a tool, then click and drag on the chart.</b> Or grab a drawing that is already there.</span>
      <span className="hint-t"><b>Pick a tool, then draw with one finger.</b> Two fingers pan and pinch.</span>
    </>
  )

  const coach = caption
    ? { k: 'show', text: caption }
    : phase === 'done' && !armed
      ? { k: 'turn', text: 'Your turn: pick a tool, drag on the chart' }
      : null
  // The words stay while the pill fades out, or it empties before it is gone.
  if (coach) lastCoach.current = coach
  const said = coach || lastCoach.current

  return (
    <div className="lp-annogrid">
      <div className="lp-annochart lp-drawdemo" ref={rootRef}>
        <div className="lp-chartwrap">
          <div className="lp-chartbar">
            <span className="lp-dot lp-dot-a" />
            <span className="lp-dot lp-dot-b" />
            <span className="lp-dot lp-dot-c" />
            <span className="lp-chartbar-title">EMBR · 1m · drawn on</span>
            <button
              type="button"
              className={`lp-showbtn ${phase === 'playing' ? 'is-on' : ''}`}
              onClick={replay}
              disabled={!ready}
              title={phase === 'playing' ? 'Click anywhere on the demo to take over' : 'Clears the board and draws it again'}
            >
              {phase === 'playing' ? <><span className="lp-rdot lp-rdot-live" /> Drawing itself</> : <><Icon name="bolt" size={12} /> Watch it draw</>}
            </button>
          </div>
          <div className="lp-drawstage">
            <ToolRail dc={dc} tool={tool} names={RAIL} orientation="horizontal" labels={SHORT} className={phase === 'done' ? 'rail-nudge' : ''} />
            <div className="lp-plotwrap">
              <div className="lp-chart lp-chart-draw" ref={hostRef}>
                {!ready && <div className="lp-chart-loading">finding the swings…</div>}
              </div>
              <div className={`lp-coach ${coach ? 'is-on' : ''} ${said ? `lp-coach-${said.k}` : ''}`} aria-hidden="true">
                <span className="lp-coach-dot" />
                <span key={said ? said.text : 'none'} className="lp-coach-t">{said ? said.text : ''}</span>
              </div>
            </div>
          </div>
          <div className="lp-chartfoot lp-drawhint">
            <p className="lp-chart-hint">{hint}</p>
          </div>
        </div>

        <div className="lp-serieslegend lp-drawctl">
          <button type="button" className="lp-serieschip is-on" onClick={() => { stopShow(); reload() }} disabled={!ready}>
            <Icon name="refresh" size={13} /> Reload data
          </button>
          <button type="button" className="lp-serieschip is-on" onClick={() => { stopShow(); prepend() }} disabled={!ready}>
            <Icon name="load" size={13} /> Prepend {PAGE} bars
          </button>
          <span className="lp-ctl-sep" aria-hidden="true" />
          <button type="button" className="lp-serieschip is-on" disabled={!history.canUndo} onClick={() => dc && dc.undo()}>
            <Icon name="undo" size={13} /> Undo
          </button>
          <button type="button" className="lp-serieschip is-on" disabled={!history.canRedo} onClick={() => dc && dc.redo()}>
            <Icon name="redo" size={13} /> Redo
          </button>
          <button type="button" className="lp-serieschip is-on" onClick={() => { stopShow(); if (dc) dc.clear() }} disabled={!shown}>
            <Icon name="trash" size={13} /> Clear
          </button>
        </div>

        <div ref={boxRef} className={`lp-annoread ${note ? 'is-on' : ''}`}>
          <span className="lp-annoread-t">{note ? note.t : 'nothing has changed yet'}</span>
          <span className="lp-annoread-s">
            {note ? note.s : 'Draw something, and this line reports the change event it fires.'}
          </span>
          {/* written to directly from the `drawing` stream, never through React */}
          <span className="lp-annoread-live" ref={liveRef}>
            <span className="lp-annoread-t" />
            <span className="lp-annoread-s" />
          </span>
        </div>
      </div>

      <div className="lp-code lp-annocode lp-drawcode">
        <div className="lp-codehead lp-codetabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'setup'} className={tab === 'setup' ? 'on' : ''} onClick={() => setTab('setup')}>
            Enabling drawings
          </button>
          <button type="button" role="tab" aria-selected={tab === 'data'} className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>
            Saved as data
          </button>
        </div>
        {tab === 'setup' ? (
          <pre>{SETUP_CODE}</pre>
        ) : (
          <>
            <p className="lp-codenote">
              {shown
                ? <>{selected ? 'The selected drawing' : 'The newest drawing'}, exactly as <code>drawings.get(id)</code> returns it. Click another on the chart.</>
                : <>Draw something and its stored row appears here.</>}
            </p>
            <pre>{shown ? pretty(shown) : '// nothing drawn yet'}</pre>
          </>
        )}
      </div>
    </div>
  )
}
