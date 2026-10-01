import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createChart, defaultTheme, lightTheme } from '../chart/index.js'
import { createVolumeProfile } from '../profiles/index.js'
import { Icon } from './Icons.jsx'
import { aggregate, binBars, buildProfiles, splitSessions } from './profileData.js'
import { createTape, sessionOf, SESSION_MINUTES } from './profileTape.js'

/**
 * The landing page's volume-profile demo: a real chart, the real controller,
 * and a short showreel that is nothing but calls to the public API.
 *
 * What is on show, and how each part is made true rather than mocked:
 *
 *  - The page plays the HOST. Emberwick draws profiles and never computes
 *    them, so this demo keeps a 1-minute tape (profileTape.js), draws it as
 *    5-minute candles, bins the 1-minute bars into the ProfileData contract
 *    (profileData.js) and hands the chart the contract. The binning lives in
 *    the demo because that is where it lives in real life: hosts compute
 *    profiles from finer data than they draw. The second tab shows the session
 *    object exactly as it was sent.
 *  - The developing session is live. A new minute arrives twice a second, the
 *    forming 5-minute candle is updated, the day's minutes are re-binned and
 *    sent again with `upsertSession`. When the day closes it is sent once more,
 *    final, and the next one opens.
 *  - The showreel switches modes with `setOptions` and runs the chart's own
 *    replay, so sessions appear when their last bar is revealed. It stops the
 *    moment the reader touches the demo, never runs off screen, and is skipped
 *    under prefers-reduced-motion.
 *  - The readout under the chart is the `hover` event's payload, and nothing
 *    else: move over a bin and it is what your listener would be told.
 *
 * Off screen the live timer is stopped, so the chart's loop idles at zero CPU.
 */

const MIN = 60_000
const FIVE = 5 * MIN
const BARS_PER_SESSION = SESSION_MINUTES / 5
/** A new 1-minute bar this often: a day in under four minutes. */
const TICK_MS = 520
const SOURCE = 'EMBR 1-minute volume'
const DARK = { ...defaultTheme, background: '#0a0d15' }

const MODES = [
  { id: 'session', label: 'Session' },
  { id: 'visible', label: 'Visible' },
  { id: 'both', label: 'Both' },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const price = (v) => (typeof v === 'number' && isFinite(v) ? v.toFixed(2) : '—')
const count = (v) => Math.round(v).toLocaleString()

/** Every session's minutes as 5-minute candles, each session starting on its own open. */
const candlesOf = (minutes) => splitSessions(minutes, sessionOf).flatMap((s) => aggregate(s, FIVE))

/** A session object as text: one key per line, the bins wrapped like a table of numbers. */
function sessionText(s, step, source) {
  if (!s) return '// waiting for the first session'
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  const rows = []
  for (let i = 0; i < s.bins.length; i += 8) rows.push('    ' + s.bins.slice(i, i + 8).join(', '))
  return [
    '{',
    '  version: 1,',
    `  source: ${JSON.stringify(source)},`,
    `  step: ${step},`,
    '  sessions: [',
    '    /* …the finished sessions… */',
    '    {',
    `      start: ${s.start},   // ${clock(s.start)}`,
    `      end: ${s.end},     // ${clock(s.end)}`,
    `      lo: ${s.lo},`,
    `      bins: [   // ${s.bins.length} bins of ${step}`,
    rows.map((r) => '    ' + r).join(',\n'),
    '      ],',
    s.developing ? '      developing: true,' : null,
    '    },',
    '  ],',
    '}',
  ].filter((x) => x !== null).join('\n')
}

const SETUP_CODE = `import { createChart } from 'emberwick'
import { createVolumeProfile } from 'emberwick/profiles'

const chart = createChart(el)
chart.setData(fiveMinuteBars)

// profiles YOU computed, from finer data
const profile = createVolumeProfile(chart, {
  data,            // { version: 1, step, sessions }
  mode: 'both',    // 'session' | 'visible' | 'both'
})

// live: send the forming session again,
// keyed by its start
everyMinute(() => profile.upsertSession({
  start, end, lo, bins, developing: true,
}))

// the bin under the pointer, or null
profile.on('hover', (bin) => readout(bin))`

export default function ProfilesShowcase() {
  const hostRef = useRef(null)
  const rootRef = useRef(null)
  const chartRef = useRef(null)
  const vpRef = useRef(null)
  /** The host's side: the tape, every minute so far, and where today starts in it. */
  const hostData = useRef({ tape: null, minutes: [], dayAt: 0, dayKey: 0, step: 0 })
  const runRef = useRef(null)
  const inViewRef = useRef(false)
  const phaseRef = useRef('loading')
  const lastCoach = useRef(null)

  const [ready, setReady] = useState(false)
  const [inView, setInView] = useState(false)
  const [phase, setPhaseState] = useState('loading') // loading | idle | playing | done | taken
  const [caption, setCaption] = useState(null)
  const [mode, setMode] = useState('session')
  const [valueArea, setValueArea] = useState(true)
  const [extendPoc, setExtendPoc] = useState(false)
  const [light, setLight] = useState(false)
  const [live, setLive] = useState(() => !reducedMotion())
  const [replaying, setReplaying] = useState(false)
  const [hover, setHover] = useState(null)
  const [sent, setSent] = useState(null)
  const [tab, setTab] = useState('setup')

  const setPhase = (p) => {
    phaseRef.current = p
    setPhaseState(p)
  }

  /* ------------------------------------------------------------ the chart -- */
  useEffect(() => {
    const host = hostRef.current
    const w = host.clientWidth || 900
    // About two and a half sessions across the plot, but never candles too
    // thin to have a body: on a phone that is a little over one session.
    const spacing = Math.max(3.3, Math.min(7, (w - 68) / (BARS_PER_SESSION * 2.55)))

    const chart = createChart(host, {
      theme: DARK,
      timeScale: { spacing, rightOffset: 5 },
      priceScale: { marginTop: 0.14, marginBottom: 0.26 },
    })
    chartRef.current = chart
    // Created right after the chart, destroyed before it: see Playground.
    const vp = createVolumeProfile(chart, { mode: 'session' })
    vpRef.current = vp
    vp.on('hover', setHover)

    // Four finished sessions and the first part of a fifth, as 1-minute bars.
    const h = hostData.current
    h.tape = createTape()
    h.minutes = []
    for (let i = 0; i < SESSION_MINUTES * 4 + 140; i++) h.minutes.push(h.tape.next())
    const data = buildProfiles(h.minutes, { sessionOf, source: SOURCE, developing: true })
    h.step = data.step
    h.dayKey = sessionOf(h.minutes[h.minutes.length - 1].time)
    h.dayAt = h.minutes.findIndex((b) => sessionOf(b.time) === h.dayKey)

    chart.setData(candlesOf(h.minutes))
    vp.setData(data)
    setSent(data.sessions[data.sessions.length - 1])
    setReady(true)
    setPhase('idle')

    return () => {
      if (runRef.current) runRef.current.stop = true
      vp.destroy()
      chart.destroy()
      chartRef.current = null
      vpRef.current = null
    }
  }, [])

  /* ---------------------------------------------- options are setOptions -- */
  useEffect(() => { vpRef.current?.setOptions({ mode, valueArea, extendPoc }) }, [mode, valueArea, extendPoc])
  // The profile's colours derive from the chart theme: this one call recolours both.
  useEffect(() => { chartRef.current?.setTheme(light ? lightTheme : DARK) }, [light])

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
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  /* ------------------------------------------------------------- live feed -- */
  // One more minute: the forming candle, then the forming session, re-binned
  // from this day's 1-minute bars and upserted by its start.
  const advance = useCallback(() => {
    const chart = chartRef.current
    const vp = vpRef.current
    const h = hostData.current
    if (!chart || !vp || chart.replay) return
    const m = h.tape.next()
    h.minutes.push(m)
    const key = sessionOf(m.time)
    if (key !== h.dayKey) {
      // The first minute of a new day closes the one before it: send that
      // session once more, final.
      vp.upsertSession(binBars(h.minutes.slice(h.dayAt, h.minutes.length - 1), h.step))
      h.dayAt = h.minutes.length - 1
      h.dayKey = key
    }
    const day = h.minutes.slice(h.dayAt)
    const candles = aggregate(day, FIVE)
    const candle = candles[candles.length - 1]
    const last = chart.bars[chart.bars.length - 1]
    if (last && last.time === candle.time) chart.update(candle)
    else chart.append(candle)
    const session = { ...binBars(day, h.step), developing: true }
    vp.upsertSession(session)
    setSent(session)
  }, [])

  // Only while it is on screen and the tab is showing: off screen nothing
  // ticks, so the chart's own loop idles at zero CPU.
  useEffect(() => {
    if (!ready || !live || !inView || replaying) return undefined
    const id = setInterval(() => { if (!document.hidden) advance() }, TICK_MS)
    return () => clearInterval(id)
  }, [ready, live, inView, replaying, advance])

  /* ----------------------------------------------------------------- replay -- */
  /**
   * Play the chart's own replay across the two sessions before today, so each
   * one's profile appears on the step that reveals its last bar. Returns when
   * the playback reaches the end, or the run is stopped.
   */
  const replaySessions = useCallback(async (token) => {
    const chart = chartRef.current
    if (!chart || chart.replay) return
    const bars = chart.bars
    const n = bars.length
    const today = sessionOf(bars[n - 1].time)
    const firstToday = bars.findIndex((b) => sessionOf(b.time) === today)
    // From the middle of the session before last, to a little way into today.
    const from = Math.max(2, firstToday - BARS_PER_SESSION * 2 + Math.round(BARS_PER_SESSION * 0.45))
    const to = Math.min(n - 1, firstToday + 6)
    setReplaying(true)
    const replay = chart.startReplay({ from, speed: 28, baseInterval: 1000 })
    if (!replay) { setReplaying(false); return }
    await new Promise((resolve) => {
      let off = () => {}
      const stop = () => { off(); clearInterval(watch); resolve() }
      off = chart.subscribe('replay', (s) => { if (!s.active || s.index >= to || s.atEnd) stop() })
      // The reader took over, or the section left the screen: stop where it is.
      const watch = setInterval(() => {
        if (token && token.stop) stop()
        else if (!inViewRef.current) replay.pause()
        else if (!replay.playing) replay.play()
      }, 120)
      replay.play()
    })
    if (chartRef.current === chart && chart.replay) chart.stopReplay()
    setReplaying(false)
  }, [])

  /* -------------------------------------------------------------- showreel -- */
  const stopShow = useCallback(() => {
    if (runRef.current) runRef.current.stop = true
  }, [])

  const play = useCallback(async () => {
    const chart = chartRef.current
    if (!chart) return
    const token = { stop: false }
    if (runRef.current) runRef.current.stop = true
    runRef.current = token
    const alive = () => !token.stop && chartRef.current === chart

    // Waits, but not while the section is off screen: the script holds its
    // place and carries on when it comes back into view.
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
    const steps = [
      { say: 'One profile per session, under the candles', run: () => { setMode('session'); setExtendPoc(false); setValueArea(true) }, ms: 2600 },
      { say: 'Visible range: the sessions on screen, summed', run: () => setMode('visible'), ms: 2600 },
      { say: 'Both: the sum sits on top', run: () => setMode('both'), ms: 2400 },
      { say: 'Naked POCs run on until price trades through them', run: () => { setMode('session'); setExtendPoc(true) }, ms: 2800 },
      { say: 'Replay: a profile appears when its session has finished', run: () => replaySessions(token), ms: 700 },
      { say: 'Live: the forming session grows minute by minute', run: () => { setExtendPoc(false); setMode('both') }, ms: 3000 },
    ]
    for (const st of steps) {
      if (!alive()) break
      setCaption(st.say)
      try { await st.run() } catch (e) { /* the chart went away mid-step */ }
      if (!(await hold(st.ms))) break
    }
    if (chartRef.current === chart && chart.replay) chart.stopReplay()
    setReplaying(false)
    if (runRef.current === token) setCaption(null)
    if (token.stop) return
    setPhase('done')
  }, [replaySessions])

  // Start the first time it is on screen with the data in; never while off screen.
  useEffect(() => {
    if (phase !== 'idle' || !ready || !inView) return
    if (reducedMotion()) {
      // No show: the finished picture at once, and a feed that waits to be asked.
      setMode('both')
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
      if (p === 'playing' || p === 'idle' || p === 'done') {
        setCaption(null)
        setPhase('taken')
      }
    }
    const evs = ['pointerdown', 'keydown', 'wheel']
    evs.forEach((n) => el.addEventListener(n, take, { capture: true, passive: true }))
    return () => evs.forEach((n) => el.removeEventListener(n, take, { capture: true }))
  }, [stopShow])

  const watch = () => {
    stopShow()
    play()
  }

  /* --------------------------------------------------------------- render -- */
  const coach = caption
    ? { k: 'show', text: caption }
    : phase === 'done'
      ? { k: 'turn', text: 'Your turn: hover a bin, switch the mode, drag to pan' }
      : null
  // The words stay while the pill fades out, or it empties before it is gone.
  if (coach) lastCoach.current = coach
  const said = coach || lastCoach.current

  const h = hostData.current
  return (
    <div className="lp-profdemo" ref={rootRef}>
      <div className="lp-chartwrap lp-profwrap">
        <div className="lp-chartbar lp-profbar">
          <span className="lp-dot lp-dot-a" />
          <span className="lp-dot lp-dot-b" />
          <span className="lp-dot lp-dot-c" />
          <span className="lp-chartbar-title">EMBR · 5m candles · profiles from 1m volume</span>
          <span className="lp-profctl">
            <span className="lp-profseg" role="radiogroup" aria-label="Profile mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  className={mode === m.id ? 'on' : ''}
                  onClick={() => setMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </span>
            <button type="button" className={`lp-proftog ${valueArea ? 'on' : ''}`} aria-pressed={valueArea} onClick={() => setValueArea((v) => !v)}>
              Value area
            </button>
            <button type="button" className={`lp-proftog ${extendPoc ? 'on' : ''}`} aria-pressed={extendPoc} onClick={() => setExtendPoc((v) => !v)}>
              Extend POC
            </button>
            <button
              type="button"
              className={`lp-showbtn ${phase === 'playing' ? 'is-on' : ''}`}
              onClick={watch}
              disabled={!ready}
              title={phase === 'playing' ? 'Click anywhere on the demo to take over' : 'Cycles the modes, then replays two sessions'}
            >
              {phase === 'playing' ? <><span className="lp-rdot lp-rdot-live" /> Showing itself</> : <><Icon name="bolt" size={12} /> Watch it run</>}
            </button>
          </span>
        </div>
        <div className="lp-plotwrap">
          <div className="lp-chart lp-chart-prof" ref={hostRef}>
            {!ready && <div className="lp-chart-loading">binning the tape…</div>}
          </div>
          <div className={`lp-coach ${coach ? 'is-on' : ''} ${said ? `lp-coach-${said.k}` : ''}`} aria-hidden="true">
            <span className="lp-coach-dot" />
            <span key={said ? said.text : 'none'} className="lp-coach-t">{said ? said.text : ''}</span>
          </div>
        </div>
      </div>

      <div className="lp-profgrid">
        <div className="lp-profside">
          <div className="lp-serieslegend lp-drawctl">
            <button type="button" className="lp-serieschip is-on" onClick={() => setLive((v) => !v)} disabled={!ready || replaying} aria-pressed={live}>
              <span className={`lp-rdot ${live && !replaying ? 'lp-rdot-live' : ''}`} /> {live ? 'Live: pause the feed' : 'Start the live feed'}
            </button>
            <button type="button" className="lp-serieschip is-on" onClick={() => { stopShow(); replaySessions(null) }} disabled={!ready || replaying}>
              <Icon name="refresh" size={13} /> Replay two sessions
            </button>
            <span className="lp-ctl-sep" aria-hidden="true" />
            <button type="button" className="lp-serieschip is-on" onClick={() => setLight((v) => !v)} disabled={!ready} aria-pressed={light}>
              {light ? '☀ Light theme' : '☾ Dark theme'}
            </button>
          </div>

          <div className={`lp-annoread ${hover ? 'is-on' : ''}`}>
            {hover ? (
              <>
                <span className="lp-annoread-t lp-profread">
                  {price(hover.binLow)} – {price(hover.binHigh)}
                  <b>{count(hover.volume)}</b>
                  <i>{hover.pct.toFixed(1)}% of {hover.session ? 'the session' : 'the visible range'}</i>
                </span>
                <span className="lp-annoread-s">
                  {hover.inValueArea ? 'In the value area.' : 'Outside the value area.'}{' '}
                  {hover.session
                    ? <>This is the <code>hover</code> payload, and <code>session</code> is the object this page sent.</>
                    : <>This is the <code>hover</code> payload; <code>session</code> is <code>null</code> for the summed profile.</>}
                </span>
              </>
            ) : (
              <>
                <span className="lp-annoread-t">hover a bin</span>
                <span className="lp-annoread-s">
                  Its price range, volume, share of the session and whether it is in the value area arrive in
                  the <code>hover</code> event. The cursor, the crosshair and panning are untouched: try dragging.
                </span>
              </>
            )}
          </div>
        </div>

        <div className="lp-code lp-annocode lp-profcode">
          <div className="lp-codehead lp-codetabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'setup'} className={tab === 'setup' ? 'on' : ''} onClick={() => setTab('setup')}>
              Drawing profiles
            </button>
            <button type="button" role="tab" aria-selected={tab === 'data'} className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>
              The data this page sends
            </button>
          </div>
          {tab === 'setup' ? (
            <pre>{SETUP_CODE}</pre>
          ) : (
            <>
              <p className="lp-codenote">
                The forming session, exactly as the last <code>upsertSession()</code> sent it. This page bins it from
                its own 1-minute bars; the chart only draws it.
              </p>
              <pre>{sessionText(sent, h.step, SOURCE)}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
