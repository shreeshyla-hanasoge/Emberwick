import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, RandomFeed, defaultTheme, lightTheme } from '../chart/index.js'

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
        label: 'Value area',
      },
    ],
  }
}

export default function Playground() {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const feedRef = useRef(null)

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

    const feed = new RandomFeed({
      symbol: 'EMBR',
      timeframe: 60000,
      seed: 20260916,
      start: 184.25,
      ticksPerSecond: 8,
      speed: 60, // one candle per second, so the flow is visible immediately
    })
    feedRef.current = feed

    chart.setFeed(feed).then(() => {
      if (!disposed) setReady(true)
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
            <span className="logo" />
          </a>
          <div>
            <h1>Emberwick</h1>
            <p>smooth flowing candles · pluggable feeds</p>
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
          <button className={magnet ? 'btn on' : 'btn'} onClick={() => setMagnet((v) => !v)}>Magnet</button>
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

      <div className="chart-host" ref={hostRef}>
        {!ready && <div className="loading">generating market…</div>}
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
        <p className="hint">
          {replaying
            ? 'replaying history · scrub or step bar-by-bar · markers appear as the cursor reaches them'
            : 'drag to pan (throw it — it glides) · wheel to zoom · drag the axes to scale · double-click to reset · click a marker · ← → + −'}
        </p>
      </div>
    </div>
  )
}
