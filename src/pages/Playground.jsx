import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, RandomFeed, defaultTheme, lightTheme, mulberry32 } from '../chart/index.js'
import { enableDrawings } from '../drawings/index.js'
import { createVolumeProfile } from '../profiles/index.js'
import BrandLogo from '../components/BrandLogo.jsx'
import { Icon } from '../components/Icons.jsx'
import ToolRail from '../components/ToolRail.jsx'
import SelectionToolbar from '../components/SelectionToolbar.jsx'
import DrawingMenu from '../components/DrawingMenu.jsx'
import EventDock from '../components/EventDock.jsx'
import { useDrawings } from '../components/useDrawings.js'
import { starterDrawings } from '../components/starterDrawings.js'
import { buildProfiles, binBars, hourOf } from '../components/profileData.js'

const fmt = (v, d = 2) => (typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '—')

const fmtClock = (t) =>
  typeof t === 'number'
    ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '—'

const SPEEDS = [1, 4, 20, 100]

/**
 * A demo annotation set derived from whatever bars are loaded: a run of
 * alternating trades, two events stacked on one bar (to show collision
 * handling), a target/stop pair and a value-area band.
 */
function demoAnnotations(bars) {
  const empty = { markers: [], priceLines: [], zones: [] }
  const n = bars.length
  if (n < 40) return empty

  const markers = []
  for (let k = 0; k < 6; k++) {
    const i = n - 1 - Math.round((k + 1) * (n / 9))
    if (i < 1) continue
    const b = bars[i]
    const buy = k % 2 === 0
    markers.push({
      id: `t${k}`,
      time: b.time,
      shape: buy ? 'arrowUp' : 'arrowDown',
      text: buy ? 'BUY' : 'SELL',
      data: { side: buy ? 'buy' : 'sell', qty: 100 * (k + 1), price: b.close },
    })
  }

  // two markers on the SAME bar — they should stack, not overlap
  const ev = bars[n - 1 - Math.round(n / 3)]
  if (ev) {
    markers.push({ id: 'e1', time: ev.time, shape: 'flag', color: '#f5a524', text: 'Earnings' })
    markers.push({ id: 'e2', time: ev.time, shape: 'label', color: '#8b5cf6', text: 'Guidance' })
  }

  const last = bars[n - 1]
  return {
    markers,
    priceLines: [
      { price: last.close * 1.02, color: '#26a69a', title: 'Target', lineStyle: 'dashed' },
      { price: last.close * 0.985, color: '#ef5350', title: 'Stop', lineStyle: 'dotted' },
    ],
    zones: [
      {
        from: last.close * 0.995,
        to: last.close * 1.008,
        color: 'rgba(139,92,246,0.10)',
        // Not "Value area": the profile panel draws real ones now.
        label: 'Demand zone',
      },
    ],
  }
}

const PROFILE_MODES = [
  { id: 'session', label: 'Session', tip: 'One profile per session (here, per clock hour of the tape)' },
  { id: 'visible', label: 'Visible', tip: 'One profile for every session on screen, summed' },
  { id: 'both', label: 'Both', tip: 'Session profiles, with the visible-range profile on top' },
]

/** label, option key, tooltip: every boolean option of createVolumeProfile. */
const PROFILE_FLAGS = [
  ['Value area', 'valueArea', 'Tint the value-area bins and draw VAH and VAL'],
  ['POC', 'poc', 'Draw the point-of-control line'],
  ['Extend POC', 'extendPoc', 'Carry each POC right until a later bar trades through it'],
  ['Tags', 'tags', 'POC, VAH and VAL tags on the price axis'],
  ['Caption', 'label', 'The "Vol: …" caption naming the volume source'],
  ['Hide future', 'hideFutureInReplay', 'Under replay, hide sessions the last revealed bar has not finished'],
]

const PROFILE_DEFAULTS = { valueArea: true, poc: true, extendPoc: false, tags: true, label: true, hideFutureInReplay: true }
const PROFILE_SOURCE = 'EMBR 1-minute tape'

const fmtVol = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v).toLocaleString() : '—')

/** The 'hover' payload as one line: price range, volume, share, value-area flag. */
function describeBin(h) {
  return `${fmt(h.binLow)}–${fmt(h.binHigh)} · ${fmtVol(h.volume)} · ${fmt(h.pct, 1)}%${h.inValueArea ? ' · VA' : ''}${h.session ? '' : ' · visible range'}`
}

/**
 * What the profile panel's developing session is built from: the bars of the
 * newest clock hour. Returns where that hour starts in `bars`.
 */
function lastHourStart(bars) {
  let i = bars.length - 1
  const key = hourOf(bars[i].time)
  while (i > 0 && hourOf(bars[i - 1].time) === key) i--
  return i
}

const MAGNETS = [
  { id: 'inherit', label: 'Follow chart', tip: "Follows the header's Magnet button, as the crosshair does" },
  { id: 'off', label: 'Off', tip: 'Snap to bars, levels and other anchors only' },
  { id: 'weak', label: 'Weak', tip: 'Snap to a candle’s O/H/L/C when within reach' },
  { id: 'strong', label: 'Strong', tip: 'Always snap to the nearest O/H/L/C' },
]

const STORE_KEY = 'emberwick.playground.drawings'
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || '')
const MOD = MAC ? '⌘' : 'Ctrl'

/**
 * The shortcut strip is a function of what the reader is doing, so it always
 * lists the keys that would work right now and nothing else.
 */
function keyHints({ tool, selected }) {
  if (tool) {
    const h = [
      ['click', 'or drag to place'],
      ['Shift', '45° angle'],
      ['Alt', 'free, no snap'],
      [MOD, 'invert magnet'],
      ['Esc', 'cancel'],
    ]
    if (tool === 'long' || tool === 'short') h[0] = ['click', 'for a bracket, drag to size it']
    return h
  }
  if (selected) {
    const h = [
      ['Del', 'remove'],
      [`${MOD} D`, 'duplicate'],
      ['←↑↓→', 'nudge'],
      ['Shift', '×10'],
      [`${MOD} Z`, 'undo'],
      ['Esc', 'deselect'],
    ]
    if (selected.type === 'text') h.splice(1, 0, ['Enter', 'edit'])
    return h
  }
  return [
    ['drag', 'pan'],
    ['wheel', 'zoom'],
    ['Shift', '+ drag measures'],
    ['right-click', 'a drawing for its menu'],
    ['dbl-click', 'reset the view'],
  ]
}

/** A lot of drawings, spread over the loaded data, to put a number on "500". */
function stressSet(bars, count) {
  const n = bars.length
  if (n < 80) return []
  const rnd = mulberry32(500)
  const span = Math.min(n - 1, 600)
  const pt = (i) => {
    const b = bars[i]
    return { time: b.time, price: Number((b.low + (b.high - b.low) * rnd()).toFixed(2)) }
  }
  const out = []
  for (let k = 0; k < count; k++) {
    const i0 = n - 1 - Math.floor(rnd() * (span - 30))
    const i1 = Math.min(n - 1, i0 + 5 + Math.floor(rnd() * 25))
    const kind = k % 5
    if (kind === 0) out.push({ type: 'trendLine', points: [pt(i0), pt(i1)] })
    else if (kind === 1) out.push({ type: 'rectangle', points: [pt(i0), pt(i1)] })
    else if (kind === 2) out.push({ type: 'horizontalLine', points: [pt(i0)] })
    else if (kind === 3) out.push({ type: 'fibRetracement', points: [pt(i0), pt(i1)] })
    else out.push({ type: 'verticalLine', points: [pt(i0)] })
  }
  return out
}

/**
 * A document written to be awkward: a duplicate id, a type this build has never
 * heard of, a row from a newer schema, and one that is simply broken. Loading
 * it shows what the load report says and what "carried" means; the Document
 * tab then shows the carried rows coming back out untouched.
 */
function hostileDoc(bars) {
  const n = bars.length
  if (n < 20) return []
  const a = bars[n - 30]
  const b = bars[n - 12]
  return [
    { id: 'level', type: 'horizontalLine', points: [{ time: a.time, price: a.close }] },
    { id: 'level', type: 'trendLine', points: [{ time: a.time, price: a.low }, { time: b.time, price: b.high }] },
    { id: 'fork', type: 'pitchfork', v: 1, points: [{ time: a.time, price: a.close }], hue: 210 },
    { id: 'shiny', type: 'rectangle', v: 2, points: [{ time: a.time, price: a.high }, { time: b.time, price: b.low }], gloss: true },
    { id: 'broken', type: 'trendLine', points: [{ time: 'yesterday', price: 'high' }] },
  ]
}

/** How many bars the reader can see, so a starter set lands on screen. */
function onScreen(chart) {
  const r = chart.visibleRange()
  return r ? Math.max(60, r.to - r.from - 8) : 120
}

function describeReport(r) {
  const bits = [`${r.loaded} loaded`]
  if (r.carried.length) bits.push(`${r.carried.length} carried`)
  if (r.rejected.length) bits.push(`${r.rejected.length} rejected`)
  if (r.renamed.length) bits.push(`${r.renamed.length} renamed`)
  if (r.truncated.length) bits.push(`${r.truncated.length} trimmed`)
  if (r.orphaned.length) bits.push(`${r.orphaned.length} orphaned`)
  return bits.join(' · ')
}

const fmtSpan = (ms) => {
  if (!Number.isFinite(ms)) return null
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/**
 * The `drawing` stream, live: what a reader sees while placing or dragging.
 * It owns its state so a 60 Hz stream re-renders this one span, not the page.
 */
function LiveReadout({ dc }) {
  const [e, setE] = useState(null)
  useEffect(() => {
    if (!dc) return undefined
    let quiet = 0
    const off = dc.subscribe('drawing', (p) => {
      setE(p)
      clearTimeout(quiet)
      quiet = setTimeout(() => setE(null), 1200)
    })
    return () => { off(); clearTimeout(quiet) }
  }, [dc])

  if (!e) return <span className="live live-idle">live readout · subscribe(&apos;drawing&apos;)</span>
  const st = e.stats
  const up = st.change >= 0
  const span = fmtSpan(st.durationMs)
  return (
    <span className="live">
      <b className="live-phase">{e.phase}</b>
      <span className={up ? 'up' : 'down'}>
        {up ? '+' : ''}{fmt(st.change)}
        {st.changePct != null ? ` (${up ? '+' : ''}${fmt(st.changePct)}%)` : ''}
      </span>
      {st.bars != null && <span>{Math.round(st.bars)} bars{span ? ` · ${span}` : ''}{st.approx ? ' ≈' : ''}</span>}
      {e.snap && <span className="live-snap">snap {e.snap.tag || e.snap.kind}</span>}
    </span>
  )
}

export default function Playground() {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const feedRef = useRef(null)
  const areaRef = useRef(null)
  const dcRef = useRef(null)
  const vpRef = useRef(null)
  /** Re-bin the whole tape into profiles; set by the chart effect, called by the controls. */
  const rebuildRef = useRef(() => {})
  /** What the live profile feed needs between ticks: the bin step, and the oldest bar it was built from. */
  const pState = useRef({ step: 0, first: 0, on: true })
  const seeded = useRef(false)
  const stressIds = useRef(null)
  const logState = useRef({ n: 0, t0: 0 })

  const [ready, setReady] = useState(false)
  const [fps, setFps] = useState(0)
  const [legend, setLegend] = useState(null)
  const [range, setRange] = useState(null)
  const [rp, setRp] = useState(null)
  const [hovering, setHovering] = useState(false)
  const [paused, setPaused] = useState(false)
  const [dark, setDark] = useState(true)
  const [logScale, setLogScale] = useState(false)
  const [animate, setAnimate] = useState(true)
  const [magnet, setMagnet] = useState(true)
  const [showMarkers, setShowMarkers] = useState(true)
  const [clicked, setClicked] = useState(null)
  const [tps, setTps] = useState(8)
  const [speed, setSpeed] = useState(60)

  // ---- drawings ------------------------------------------------------------
  const [dc, setDc] = useState(null)
  const { tool, history, selected } = useDrawings(dc)
  const [sticky, setSticky] = useState(false)
  const [snapMode, setSnapMode] = useState('inherit')
  const [hideAll, setHideAll] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)
  const [dockOpen, setDockOpen] = useState(false)
  const [log, setLog] = useState([])
  const [docRev, setDocRev] = useState(0)
  const [menu, setMenu] = useState(null)
  const [notice, setNotice] = useState(null)
  const [stressed, setStressed] = useState(false)

  // ---- volume profiles -----------------------------------------------------
  const [pOn, setPOn] = useState(true)
  const [pMode, setPMode] = useState('session')
  const [pSide, setPSide] = useState('right')
  const [pWidth, setPWidth] = useState(30)
  const [pFlags, setPFlags] = useState(PROFILE_DEFAULTS)
  const [pColors, setPColors] = useState({})
  const [pHover, setPHover] = useState(null)
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)')
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // ref mirror of hover state, so the fps/legend poller never clobbers the
  // bar the user is actually pointing at
  const hoverRef = useRef(false)
  useEffect(() => { hoverRef.current = hovering }, [hovering])

  // ---- create the chart once ----------------------------------------------
  useEffect(() => {
    let disposed = false
    const chart = createChart(hostRef.current, {
      theme: defaultTheme,
      initialBars: 1500,
    })
    chartRef.current = chart

    // Enabled synchronously, right after the chart, and destroyed BEFORE it in
    // the cleanup: StrictMode runs this effect twice, and a second enable on a
    // chart whose first controller was never destroyed throws by design.
    const dc = enableDrawings(chart)
    dcRef.current = dc
    setDc(dc)

    // Volume profiles go on the layer UNDER the candles; drawings stay above
    // and still get every press first. No data yet: it arrives with the tape.
    const vp = createVolumeProfile(chart)
    vpRef.current = vp

    const feed = new RandomFeed({
      symbol: 'EMBR',
      timeframe: 60000,
      seed: 20260916,
      start: 184.25,
      ticksPerSecond: 8,
      speed: 60, // one candle per second, so the flow is visible immediately
    })
    feedRef.current = feed

    /**
     * The demo plays the HOST here. Emberwick draws profiles and never
     * computes them, so this page bins its own 1-minute tape (the finest data
     * it has) into the ProfileData contract, one session per clock hour, and
     * hands that over. See components/profileData.js.
     */
    const rebuildProfiles = () => {
      const bars = chart.replay ? chart.replay.source : chart.bars
      if (!bars.length) return
      const data = buildProfiles(bars, { sessionOf: hourOf, source: PROFILE_SOURCE, step: pState.current.step, developing: !chart.replay })
      pState.current.step = data.step
      pState.current.first = bars[0].time
      vp.setData(data)
    }
    rebuildRef.current = rebuildProfiles
    let offFeed = () => {}

    chart.setFeed(feed).then(() => {
      if (disposed) return
      setReady(true)
      rebuildProfiles()
      // Subscribed AFTER the chart, so chart.bars already holds this tick.
      offFeed = feed.subscribe((msg) => {
        const bars = chart.bars
        const st = pState.current
        if (!st.on || chart.replay || !bars.length || !st.step) return
        // A lazily loaded history page landed in front: bin the new hours too.
        if (bars[0].time !== st.first) { rebuildProfiles(); return }
        const i = lastHourStart(bars)
        // Every tick: the forming hour, re-binned and upserted by its start.
        vp.upsertSession({ ...binBars(bars.slice(i), st.step), developing: true })
        // The first bar of a new hour closes the hour before it: send that
        // session once more, final, without the developing flag.
        if (msg.type === 'append' && i === bars.length - 1 && i > 0) {
          const prev = bars.slice(0, i)
          vp.upsertSession(binBars(prev.slice(lastHourStart(prev)), st.step))
        }
      })
    })

    const off = chart.subscribe('crosshair', (payload) => {
      setHovering(!!payload)
      if (payload) setLegend(payload.bar)
    })
    const offClick = chart.subscribe('markerClick', (m) => setClicked(m))
    // No polling and no debounce: the event fires on subscribe with the
    // current window, then only when that window actually changes.
    const offRange = chart.subscribe('visibleRange', setRange)
    // Same contract for playback: the transport below renders straight from
    // this payload, so it never has to guess at the cursor.
    const offReplay = chart.subscribe('replay', setRp)

    // The event log. A state event delivers once on subscribe with the current
    // value; that is not something that happened, so it is not logged.
    const say = (name, text) => {
      const L = logState.current
      if (!L.t0) L.t0 = performance.now()
      const t = `${((performance.now() - L.t0) / 1000).toFixed(1)}s`
      setLog((prev) => [{ n: ++L.n, t, name, text }, ...prev].slice(0, 80))
    }
    const hear = (name, fn) => {
      let initial = true
      const off = dc.subscribe(name, (p) => { if (!initial) fn(p) })
      initial = false
      return off
    }
    const countHidden = () => setHiddenCount(dc.getDrawings().filter((d) => d.visible === false).length)
    const offs = [
      dc.subscribe('change', (p) => {
        say('change', `${p.source} \u00b7 ${p.reason} \u00b7 +${p.created.length} ~${p.updated.length} \u2212${p.removed.length}`)
        setDocRev((r) => r + 1)
        countHidden()
      }),
      hear('select', (p) => say('select', p.ids.length ? `${p.drawings[0].type} ${p.ids[0]}` : 'none')),
      hear('tool', (p) => say('tool', p.tool ? `${p.tool}${p.sticky ? ' (sticky)' : ''}` : 'none')),
      hear('history', (p) => say('history', `undo ${p.undoSize} \u00b7 redo ${p.redoSize}`)),
      dc.subscribe('edit', (p) => say('edit', `${p.drawing.type} ${p.id}`)),
      dc.subscribe('contextmenu', (p) => {
        say('contextmenu', `${p.drawing.type} \u00b7 ${p.part}`)
        setMenu({ x: p.x, y: p.y, id: p.id, part: p.part, drawing: p.drawing })
      }),
    ]
    // The profile's one event. It fires once per bin, and null when the
    // pointer is over none, so logging it is not a firehose.
    vp.on('hover', (h) => {
      setPHover(h)
      if (h) say('hover', describeBin(h))
    })

    const id = setInterval(() => {
      setFps(chart.fps)
      const n = chart.bars.length
      if (n) setLegend((prev) => (hoverRef.current ? prev : chart.bars[n - 1]))
    }, 250)

    return () => {
      disposed = true
      clearInterval(id)
      off()
      offClick()
      offRange()
      offReplay()
      offs.forEach((off) => off())
      offFeed()
      rebuildRef.current = () => {}
      vp.destroy()
      vpRef.current = null
      dc.destroy()
      dcRef.current = null
      seeded.current = false
      stressIds.current = null
      feed.destroy()
      chart.destroy()
      chartRef.current = null
      feedRef.current = null
    }
  }, [])

  // ---- control wiring ------------------------------------------------------
  const toggle = useCallback((fn) => () => { if (chartRef.current) fn(chartRef.current, feedRef.current) }, [])

  const replaying = !!(rp && rp.active)

  useEffect(() => { chartRef.current?.setTheme(dark ? defaultTheme : lightTheme) }, [dark])
  useEffect(() => { chartRef.current?.setPriceMode(logScale ? 'log' : 'linear') }, [logScale])
  useEffect(() => { chartRef.current?.setAnimate(animate) }, [animate])
  useEffect(() => { chartRef.current?.setMagnet(magnet) }, [magnet])
  useEffect(() => { feedRef.current?.setTicksPerSecond(tps) }, [tps])
  useEffect(() => { feedRef.current?.setSpeed(speed) }, [speed])
  // The chart ignores feed ticks while replaying; stopping the generator too
  // keeps the dataset you return to identical to the one you left.
  useEffect(() => { feedRef.current?.setPaused(paused || replaying) }, [paused, replaying])

  useEffect(() => {
    const c = chartRef.current
    if (!c || !ready) return
    if (showMarkers) {
      const a = demoAnnotations(c.bars)
      c.setMarkers(a.markers)
      c.setPriceLines(a.priceLines)
      c.setZones(a.zones)
    } else {
      c.clearMarkers()
      c.setPriceLines([])
      c.setZones([])
      setClicked(null)
    }
  }, [showMarkers, ready])

  // ---- profile wiring ------------------------------------------------------
  // Every option of createVolumeProfile is a control, and every control is one
  // setOptions() call: nothing here re-creates the profile.
  useEffect(() => {
    vpRef.current?.setOptions({
      mode: pMode,
      side: pSide,
      width: pWidth / 100,
      ...pFlags,
      colors: Object.keys(pColors).length ? pColors : null,
    })
  }, [pMode, pSide, pWidth, pFlags, pColors])

  useEffect(() => {
    const vp = vpRef.current
    pState.current.on = pOn
    if (!vp || !ready) return
    if (pOn) rebuildRef.current()
    else { vp.setData(null); setPHover(null) }
  }, [pOn, ready])

  // Entering or leaving replay changes which bars are "all of them", and
  // whether the last session is still forming.
  useEffect(() => {
    if (ready && pState.current.on) rebuildRef.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replaying])

  // ---- drawings wiring -----------------------------------------------------
  useEffect(() => { dc?.setMagnet(snapMode) }, [dc, snapMode])
  useEffect(() => { dc?.setHidden(hideAll) }, [dc, hideAll])

  // A starter set once there is a tape to draw on. It goes in as a LOAD, so it
  // is not on the undo stack: Undo on a fresh page has nothing to take back.
  useEffect(() => {
    const c = chartRef.current
    const d = dcRef.current
    if (!c || !d || !ready || seeded.current) return
    seeded.current = true
    d.setDrawings(starterDrawings(c.bars, { note: true, window: onScreen(c) }))
    setDocRev((r) => r + 1)
  }, [ready])

  useEffect(() => {
    if (!notice || notice.sticky) return undefined
    const t = setTimeout(() => setNotice(null), 4600)
    return () => clearTimeout(t)
  }, [notice])

  const closeMenu = useCallback(() => setMenu(null), [])
  const flash = (text) => setNotice({ text, k: Date.now() })
  const refreshDoc = () => {
    const d = dcRef.current
    setDocRev((r) => r + 1)
    if (d) setHiddenCount(d.getDrawings().filter((x) => x.visible === false).length)
  }
  const report = (r, what) => {
    refreshDoc()
    setNotice({
      text: `${what}: ${describeReport(r)}`,
      report: r,
      sticky: !!(r.rejected.length || r.carried.length || r.renamed.length),
      k: Date.now(),
    })
  }

  const chooseSticky = () => {
    const next = !sticky
    setSticky(next)
    if (dc && tool.tool) dc.setTool(tool.tool, { sticky: next })
  }

  const doSave = () => {
    if (!dc) return
    try {
      const rows = dc.getDrawings()
      localStorage.setItem(STORE_KEY, JSON.stringify(rows))
      flash(`Saved ${rows.length} drawing${rows.length === 1 ? '' : 's'} to this browser.`)
    } catch (_) {
      flash('Could not save: browser storage is not available here.')
    }
  }

  const doLoad = () => {
    if (!dc) return
    let raw = null
    try { raw = localStorage.getItem(STORE_KEY) } catch (_) { raw = null }
    if (!raw) { flash('Nothing saved yet. Draw something and press Save.'); return }
    try {
      report(dc.setDrawings(raw), 'Loaded')
    } catch (err) {
      // A document that does not parse throws and applies NOTHING.
      flash(`That save could not be read (${err.message}). Nothing was changed.`)
    }
  }

  const doHostile = () => {
    const c = chartRef.current
    if (!dc || !c) return
    report(dc.setDrawings(hostileDoc(c.bars)), 'Loaded a hostile document')
  }

  const doStarter = () => {
    const c = chartRef.current
    if (!dc || !c) return
    const set = starterDrawings(c.bars, { note: true, window: onScreen(c) })
    // The page already seeded one on load: replace it rather than stack a
    // second copy (two positions, two fibs) over the first.
    const stale = dc.getDrawings().filter((d) => d.meta && d.meta.starter).map((d) => d.id)
    dc.batch(() => {
      if (stale.length) dc.remove(stale)
      for (const d of set) dc.add(d, { animate: true })
    })
    flash(stale.length ? 'Replaced the starter set. It is one undo step.' : 'Added a starter set. It is one undo step.')
  }

  const doClear = () => {
    if (!dc) return
    const n = dc.clear()
    flash(n ? `Cleared ${n} drawing${n === 1 ? '' : 's'}. Undo brings them back.` : 'Nothing to clear.')
  }

  const doShowHidden = () => {
    if (!dc) return
    const ids = dc.getDrawings().filter((d) => d.visible === false && typeof d.id === 'string').map((d) => d.id)
    dc.batch(() => { for (const id of ids) dc.setVisible(id, true) })
  }

  // The same bars, replaced. Anchors are stored as times, not indices, so a
  // reload that re-fetches history must not move a single drawing.
  const doReload = () => {
    const c = chartRef.current
    if (!c || !c.bars.length || c.replay) return
    const r = c.visibleRange()
    c.setData(c.bars.map((b) => ({ ...b })))
    if (r && r.to < r.barCount - 1) c.setVisibleRange({ from: r.from, to: r.to })
    flash('setData() with a fresh copy of the bars. Every anchor re-resolved by time; nothing moved.')
  }

  const doStress = () => {
    const c = chartRef.current
    if (!dc || !c) return
    if (stressIds.current) {
      const n = dc.remove(stressIds.current)
      stressIds.current = null
      setStressed(false)
      flash(`Removed ${n} drawings.`)
      return
    }
    const ids = []
    dc.batch(() => { for (const d of stressSet(c.bars, 500)) ids.push(dc.add(d)) })
    stressIds.current = ids
    setStressed(true)
    flash(`Added ${ids.length} drawings in one batch. Reading the frame rate…`)
    setTimeout(() => {
      const f = chartRef.current && chartRef.current.fps
      if (f && stressIds.current) {
        setNotice({ text: `${ids.length} drawings on the chart · ${f} fps. Pan and zoom: only what is on screen is stroked.`, k: Date.now() })
      }
    }, 1800)
  }

  // Focus stays on the chart when a rail or toolbar button is pressed, so
  // Delete, arrows and Ctrl/Cmd+Z keep working straight after a click.
  const keepFocus = (e) => { if (e.target.closest('button')) e.preventDefault() }

  const hints = keyHints({ tool: tool.tool, selected })

  // ---- replay transport ----------------------------------------------------
  const onReplay = (fn) => () => {
    const r = chartRef.current?.replay
    if (r) fn(r)
  }

  const toggleReplay = () => {
    const c = chartRef.current
    if (!c) return
    if (c.replay) {
      c.stopReplay()
    } else {
      // Halfway through the loaded history, paused: the user picks the moment
      // to press play rather than being dropped into a running tape.
      c.startReplay({ speed: 4, baseInterval: 1000 })
    }
  }

  const up = legend ? legend.close >= legend.open : true
  const chg = legend ? ((legend.close - legend.open) / legend.open) * 100 : 0

  return (
    <div className={`app ${dark ? 'dark' : 'light'}`}>
      <header className="bar">
        <div className="brand">
          <a className="logo-link" href="#/" aria-label="Back to Emberwick home">
            <BrandLogo className="logo" />
          </a>
          <div>
            <p>smooth flowing candles · pluggable feeds · drawing tools · volume profiles</p>
          </div>
        </div>

        <div className="controls">
          <button className={paused ? 'btn' : 'btn on'} onClick={() => setPaused((p) => !p)} disabled={replaying}>
            {paused ? '▶ Resume' : '❚❚ Pause'}
          </button>
          <button className={replaying ? 'btn on' : 'btn'} onClick={toggleReplay}>⏱ Replay</button>
          <button className="btn" onClick={toggle((c) => c.snapToRealtime())}>⇥ Realtime</button>
          <button className={animate ? 'btn on' : 'btn'} onClick={() => setAnimate((v) => !v)}>Flow</button>
          <button className={showMarkers ? 'btn on' : 'btn'} onClick={() => setShowMarkers((v) => !v)}>Markers</button>
          <button
            className={magnet ? 'btn on' : 'btn'}
            title="Crosshair magnet. Drawings follow it while Snap is set to Follow chart."
            onClick={() => setMagnet((v) => !v)}
          >
            Magnet
          </button>
          <button className={logScale ? 'btn on' : 'btn'} onClick={() => setLogScale((v) => !v)}>Log</button>
          <button className="btn" onClick={() => setDark((v) => !v)}>{dark ? '☾' : '☀'}</button>
          <a className="btn" href="#/">← Home</a>
        </div>
      </header>

      <div className="legend">
        <span className="sym">EMBR · 1m</span>
        <span>O <b>{fmt(legend?.open)}</b></span>
        <span>H <b>{fmt(legend?.high)}</b></span>
        <span>L <b>{fmt(legend?.low)}</b></span>
        <span>C <b className={up ? 'up' : 'down'}>{fmt(legend?.close)}</b></span>
        <span className={up ? 'up' : 'down'}>{chg >= 0 ? '+' : ''}{fmt(chg)}%</span>
        {clicked && (
          <span className="mk-chip">
            {clicked.text || clicked.shape}
            {clicked.data?.qty ? ` · ${clicked.data.qty} @ ${fmt(clicked.data.price)}` : ''}
          </span>
        )}
        <span className="spacer" />
        <span className={`fps ${fps >= 55 ? 'good' : fps >= 30 ? 'ok' : 'bad'}`}>{fps} fps</span>
        <span className="count" title="live from subscribe('visibleRange')">
          {range
            ? `bars ${range.from}–${range.to} of ${range.barCount} · ${fmt(range.spacing, 1)}px`
            : '—'}
          {range && !range.settled && <i className="moving" />}
        </span>
      </div>

      <div className="dbar" onMouseDown={keepFocus}>
        <div className="dgrp">
          <button
            type="button"
            className="btn ibtn"
            disabled={!history.canUndo}
            onClick={() => dc?.undo()}
            title={`Undo (${MOD} Z) \u00b7 ${history.undoSize} step${history.undoSize === 1 ? '' : 's'}`}
            aria-label="Undo"
          >
            <Icon name="undo" size={15} />
            <span className="ibtn-n">{history.undoSize || ''}</span>
          </button>
          <button
            type="button"
            className="btn ibtn"
            disabled={!history.canRedo}
            onClick={() => dc?.redo()}
            title={`Redo (${MOD} Shift Z) \u00b7 ${history.redoSize} step${history.redoSize === 1 ? '' : 's'}`}
            aria-label="Redo"
          >
            <Icon name="redo" size={15} />
            <span className="ibtn-n">{history.redoSize || ''}</span>
          </button>
        </div>

        <div className="dgrp">
          <button
            type="button"
            className={sticky ? 'btn ibtn on' : 'btn ibtn'}
            aria-pressed={sticky}
            onClick={chooseSticky}
            title="Stay in drawing mode: the tool stays armed after each drawing"
          >
            <Icon name="pin" size={14} />&nbsp;Stay
          </button>
          <button
            type="button"
            className={hideAll ? 'btn ibtn on' : 'btn ibtn'}
            aria-pressed={hideAll}
            onClick={() => setHideAll((v) => !v)}
            title="Hide every drawing (a view setting, not a change to the document)"
          >
            <Icon name={hideAll ? 'eyeOff' : 'eye'} size={14} />&nbsp;{hideAll ? 'Hidden' : 'Hide'}
          </button>
          <button type="button" className="btn ibtn" onClick={doClear} title="Remove every drawing. One undo step brings them back.">
            <Icon name="trash" size={14} />&nbsp;Clear
          </button>
        </div>

        <div className="dgrp" role="radiogroup" aria-label="Snap">
          <span className="dlabel"><Icon name="magnet" size={13} /> Snap</span>
          <div className="seg">
            {MAGNETS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={snapMode === m.id}
                className={snapMode === m.id ? 'on' : ''}
                title={m.tip}
                onClick={() => setSnapMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {hiddenCount > 0 && (
          <button type="button" className="btn chip-pop" onClick={doShowHidden}>
            <Icon name="eye" size={14} />&nbsp;{hiddenCount} hidden · Show
          </button>
        )}

        <LiveReadout dc={dc} />

        <span className="spacer" />

        <div className="dgrp">
          <button type="button" className="btn" onClick={doSave} title="Save getDrawings() to this browser (localStorage). The demo tape restarts from the current time on every visit, so an older save can sit off screen; real data does not.">
            <Icon name="save" size={14} />&nbsp;Save
          </button>
          <button type="button" className="btn" onClick={doLoad} title="setDrawings() from the saved document: a load, so no change event and no undo entry">
            <Icon name="load" size={14} />&nbsp;Load
          </button>
          <button type="button" className="btn" onClick={doStarter} title="Add a trend line, fib, long position and a note, found in the bars on screen">
            Starter set
          </button>
          <button type="button" className="btn" onClick={doHostile} title="Load a document with a duplicate id, an unknown type, a newer schema and a broken row, and read the report">
            Hostile doc
          </button>
          <button type="button" className="btn" onClick={doReload} disabled={replaying} title="setData() with the same bars: the drawings must not move">
            <Icon name="refresh" size={14} />&nbsp;Reload data
          </button>
          <button type="button" className={stressed ? 'btn on' : 'btn'} onClick={doStress} title="Add 500 drawings in one batch and read the frame rate">
            <Icon name="bolt" size={14} />&nbsp;{stressed ? 'Remove 500' : '\u00d7500'}
          </button>
          <button type="button" className={dockOpen ? 'btn on' : 'btn'} onClick={() => setDockOpen((v) => !v)} title="Selected drawing, the document and the event log">
            <Icon name="inspect" size={14} />&nbsp;Inspect
          </button>
        </div>
      </div>

      <div className="dbar pbar" onMouseDown={keepFocus}>
        <div className="dgrp">
          <button
            type="button"
            className={pOn ? 'btn ibtn on' : 'btn ibtn'}
            aria-pressed={pOn}
            onClick={() => setPOn((v) => !v)}
            title="createVolumeProfile(chart, { data }): drawn under the candles, from data this page bins out of its own 1-minute tape"
          >
            Volume profile
          </button>
        </div>

        <div className="dgrp" role="radiogroup" aria-label="Profile mode">
          <span className="dlabel">Mode</span>
          <div className="seg">
            {PROFILE_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={pMode === m.id}
                className={pMode === m.id ? 'on' : ''}
                title={m.tip}
                disabled={!pOn}
                onClick={() => setPMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="dgrp" role="radiogroup" aria-label="Visible profile side">
          <span className="dlabel">Side</span>
          <div className="seg">
            {['left', 'right'].map((side) => (
              <button
                key={side}
                type="button"
                role="radio"
                aria-checked={pSide === side}
                className={pSide === side ? 'on' : ''}
                title="Which edge of the price pane the visible-range profile grows from"
                disabled={!pOn || pMode === 'session'}
                onClick={() => setPSide(side)}
              >
                {side === 'left' ? 'Left' : 'Right'}
              </button>
            ))}
          </div>
        </div>

        <label className="prange" title="width: the longest bar, as a share of the session's span (or of the pane, for the visible profile)">
          <span className="dlabel">Width</span>
          <input type="range" min="5" max="100" step="5" value={pWidth} disabled={!pOn} onChange={(e) => setPWidth(+e.target.value)} />
          <b>{pWidth}%</b>
        </label>

        <div className="dgrp">
          {PROFILE_FLAGS.map(([label, key, tip]) => (
            <button
              key={key}
              type="button"
              className={pFlags[key] ? 'btn ibtn on' : 'btn ibtn'}
              aria-pressed={pFlags[key]}
              title={`${key}: ${tip}`}
              disabled={!pOn}
              onClick={() => setPFlags((f) => ({ ...f, [key]: !f[key] }))}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="dgrp" title="colors: overrides the theme. Reset hands the colours back to it.">
          <span className="dlabel">Colours</span>
          <label className="pcolor">
            <input
              type="color"
              value={pColors.poc || (dark ? '#ff9f43' : '#c2570c')}
              disabled={!pOn}
              onChange={(e) => setPColors((c) => ({ ...c, poc: e.target.value }))}
              aria-label="POC colour"
            />
            POC
          </label>
          <label className="pcolor">
            <input
              type="color"
              value={pColors.valueArea ? pColors.valueArea.slice(0, 7) : (dark ? '#e2e8f4' : '#1f2937')}
              disabled={!pOn}
              // A solid colour would hide the grid, so the picked hue is applied at the default strengths.
              onChange={(e) => setPColors((c) => ({ ...c, fill: `${e.target.value}30`, valueArea: `${e.target.value}58`, hover: `${e.target.value}90` }))}
              aria-label="Bin colour"
            />
            Bins
          </label>
          <button type="button" className="btn ibtn" disabled={!pOn || !Object.keys(pColors).length} onClick={() => setPColors({})}>Reset</button>
        </div>

        <span className={`pread${pHover ? '' : ' live-idle'}`} aria-live="off">
          {pHover ? describeBin(pHover) : "hover a bin · on('hover')"}
        </span>
      </div>

      <div className="stage">
        <div onMouseDown={keepFocus} className="rail-wrap">
          <ToolRail dc={dc} tool={tool} sticky={sticky} orientation={narrow ? 'horizontal' : 'vertical'} />
        </div>

        <div className="chart-area" ref={areaRef}>
          <div className="chart-host" ref={hostRef}>
            {!ready && <div className="loading">generating market…</div>}
          </div>
          <SelectionToolbar dc={dc} drawing={selected} areaRef={areaRef} />
          <DrawingMenu dc={dc} menu={menu} areaRef={areaRef} onClose={closeMenu} />
          {notice && (
            <div className={`notice${notice.report ? ' notice-report' : ''}`} role="status" key={notice.k}>
              <div className="notice-row">
                <span>{notice.text}</span>
                <button type="button" className="dock-x" aria-label="Dismiss" onClick={() => setNotice(null)}>
                  <Icon name="close" size={14} />
                </button>
              </div>
              {notice.report && (
                <ul className="notice-list">
                  {notice.report.renamed.map((r) => (
                    <li key={`r${r.index}`}><b>renamed</b> row {r.index}: {r.from == null ? 'an unusable id' : `"${r.from}"`} became "{r.to}"</li>
                  ))}
                  {notice.report.carried.map((id) => (
                    <li key={`c${id}`}><b>carried</b> &quot;{id}&quot;: unknown type or newer schema, kept untouched and written back by getDrawings()</li>
                  ))}
                  {notice.report.rejected.map((r) => (
                    <li key={`x${r.index}`}><b className="bad">rejected</b> row {r.index}: {r.reason}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <EventDock
          dc={dc}
          open={dockOpen}
          selected={selected}
          log={log}
          profile={pHover}
          docRev={docRev}
          onClear={() => setLog([])}
          onClose={() => setDockOpen(false)}
        />
      </div>

      {replaying && (
        <div className="replaybar">
          <span className="rp-label">Replay</span>

          <div className="rp-transport">
            <button className="btn" title="To start" onClick={onReplay((r) => r.toStart())}>⏮</button>
            <button className="btn" title="Back one bar" onClick={onReplay((r) => r.step(-1))}>◀</button>
            <button
              className={rp.playing ? 'btn on' : 'btn'}
              title={rp.playing ? 'Pause' : 'Play'}
              onClick={onReplay((r) => r.toggle())}
            >
              {rp.playing ? '❚❚' : '▶'}
            </button>
            <button className="btn" title="Forward one bar" onClick={onReplay((r) => r.step(1))}>▶|</button>
            <button className="btn" title="To end" onClick={onReplay((r) => r.toEnd())}>⏭</button>
            <button
              className={rp.looping ? 'btn on' : 'btn'}
              title="Loop"
              onClick={onReplay((r) => r.setLoop(!r.looping))}
            >
              ↻
            </button>
          </div>

          <div className="rp-scrub">
            <input
              type="range"
              min="1"
              max={Math.max(1, rp.length - 1)}
              value={rp.index}
              onChange={(e) => onReplay((r) => r.seek(+e.target.value))()}
            />
          </div>

          <div className="rp-speeds">
            {SPEEDS.map((s) => (
              <button
                key={s}
                className={rp.speed === s ? 'btn on' : 'btn'}
                onClick={onReplay((r) => r.setSpeed(s))}
              >
                {s}×
              </button>
            ))}
          </div>

          <span className="rp-read">
            bar <b>{rp.index + 1}</b>/{rp.length} · <span className="rp-time">{fmtClock(rp.time)}</span>
          </span>

          <button className="btn" onClick={toggleReplay}>✕ Exit</button>
        </div>
      )}

      <div className="sliders">
        <label>
          Ticks/sec <b>{tps}</b>
          <input type="range" min="1" max="60" value={tps} onChange={(e) => setTps(+e.target.value)} />
        </label>
        <label>
          Candle speed <b>{speed}×</b>
          <input type="range" min="1" max="240" value={speed} onChange={(e) => setSpeed(+e.target.value)} />
        </label>
        <div className="kbds" aria-live="polite">
          {replaying ? (
            <span className="kbd-note">replaying history · scrub or step bar-by-bar · drawings stay where you put them</span>
          ) : (
            <>
              {tool.tool && !paused && (
                <button type="button" className="btn kbd-btn" onClick={() => setPaused(true)} title="The demo tape ticks every second and scrolls what you are drawing on">
                  ❚❚ Pause the tape
                </button>
              )}
              {hints.map(([k, t]) => (
                <span className="kbd-h" key={k}>
                  <kbd>{k}</kbd> {t}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
