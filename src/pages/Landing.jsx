import React, { useEffect, useRef, useState } from 'react'
import { createChart, RandomFeed, defaultTheme, version } from '../chart/index.js'

const NPM_URL = 'https://www.npmjs.com/package/emberwick'
const CDN_URL = 'https://unpkg.com/emberwick/umd/emberwick.umd.js'

/* ------------------------------------------------------------------ hero -- */
/**
 * The product demoing itself: a real chart instance, real feed, live.
 * Anything claimed in the copy below is visible right here.
 */
/** Wall-clock span between the first and last visible bar. */
function spanLabel(r) {
  if (r.fromTime == null || r.toTime == null) return null
  const mins = Math.round((r.toTime - r.fromTime) / 60000)
  if (mins < 60) return `${mins}m on screen`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return `${h}h ${String(m).padStart(2, '0')}m on screen`
}

function HeroChart() {
  const hostRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [range, setRange] = useState(null)

  useEffect(() => {
    let disposed = false
    const chart = createChart(hostRef.current, {
      theme: { ...defaultTheme, background: '#0a0d15' },
      initialBars: 600,
      timeScale: { spacing: 7, rightOffset: 14 },
    })
    const feed = new RandomFeed({
      symbol: 'EMBR',
      timeframe: 60000,
      seed: 4711,
      start: 128.4,
      ticksPerSecond: 10,
      speed: 40,
    })

    // The readout below is the 'visibleRange' event, unfiltered: it is called
    // once immediately with the current window and then only when that window
    // really changes, so no debouncing is needed to drive React with it.
    const offRange = chart.subscribe('visibleRange', (r) => {
      if (!disposed) setRange(r)
    })

    chart.setFeed(feed).then(() => { if (!disposed) setReady(true) })

    return () => {
      disposed = true
      offRange()
      feed.destroy()
      chart.destroy()
    }
  }, [])

  return (
    <div className="lp-chartwrap">
      <div className="lp-chartbar">
        <span className="lp-dot lp-dot-a" />
        <span className="lp-dot lp-dot-b" />
        <span className="lp-dot lp-dot-c" />
        <span className="lp-chartbar-title">EMBR · 1m · live</span>
      </div>
      <div className="lp-chart" ref={hostRef}>
        {!ready && <div className="lp-chart-loading">generating market…</div>}
      </div>
      <div className="lp-chartfoot">
        <p className="lp-chart-hint">
          drag to pan — throw it and it glides · wheel to zoom · double-click to reset
        </p>
        {range && range.barCount > 0 && (
          <span className="lp-rangeread" title="live payload from subscribe('visibleRange')">
            <span className={range.settled ? 'lp-rdot' : 'lp-rdot lp-rdot-live'} />
            bars {range.from}–{range.to} of {range.barCount}
            <em>{range.spacing.toFixed(1)}px</em>
            {spanLabel(range)}
          </span>
        )}
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- annotations -- */
/**
 * A deliberately STATIC chart: no live feed, so the annotations stay put and
 * can be hovered. Bars come from RandomFeed.getBars() without subscribing.
 *
 * Every price here is derived from the generated bars' own range, so the
 * lines and zone are guaranteed to land inside the visible scale whatever
 * the random walk does.
 */
function MarkersChart() {
  const hostRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [active, setActive] = useState(null)

  useEffect(() => {
    let disposed = false
    const chart = createChart(hostRef.current, {
      theme: { ...defaultTheme, background: '#0a0d15' },
      timeScale: { spacing: 12, rightOffset: 6 },
      priceScale: { marginTop: 0.2, marginBottom: 0.16 },
    })

    const feed = new RandomFeed({
      symbol: 'EMBR',
      timeframe: 60000,
      seed: 20260917,
      start: 142.5,
      volatility: 0.0026,
    })

    feed
      .getBars({ symbol: 'EMBR', timeframe: 60000, to: null, limit: 110 })
      .then((bars) => {
        if (disposed || !bars.length) return
        chart.setData(bars)

        const n = bars.length
        const at = (f) => bars[Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))))]

        let lo = Infinity
        let hi = -Infinity
        for (const b of bars) {
          if (b.low < lo) lo = b.low
          if (b.high > hi) hi = b.high
        }
        const span = hi - lo || 1
        const px = (v) => Number(v.toFixed(2))

        const entry = at(0.2)
        const addOn = at(0.45)
        const exit = at(0.78)

        chart.setMarkers([
          {
            id: 'buy',
            time: entry.time,
            shape: 'arrowUp',
            text: 'BUY 120',
            data: { title: 'Filled · 120 @ ' + px(entry.close), sub: 'order A-7741' },
          },
          {
            id: 'add',
            time: addOn.time,
            shape: 'arrowUp',
            text: 'ADD 40',
            data: { title: 'Filled · 40 @ ' + px(addOn.close), sub: 'order A-7788' },
          },
          {
            // same bar as ADD — this is the collision-stacking demo
            id: 'news',
            time: addOn.time,
            shape: 'flag',
            position: 'aboveBar',
            color: '#c084fc',
            text: 'Earnings',
            data: { title: 'Q3 earnings', sub: 'shares the bar with ADD 40 — stacked, not overlapped' },
          },
          {
            id: 'note',
            time: at(0.62).time,
            shape: 'label',
            position: 'aboveBar',
            color: '#38bdf8',
            text: 'gap fill',
            data: { title: 'Analyst note', sub: 'label markers draw their text in a pill' },
          },
          {
            id: 'sell',
            time: exit.time,
            shape: 'arrowDown',
            text: 'SELL 160',
            data: { title: 'Closed · 160 @ ' + px(exit.close), sub: 'order A-7902' },
          },
        ])

        chart.setPriceLines([
          { price: px(hi - span * 0.1), title: 'target', color: '#26a69a' },
          { price: px(entry.close), title: 'entry', color: '#8b93a7', lineStyle: 'solid' },
          { price: px(lo + span * 0.08), title: 'stop', color: '#ef5350', lineStyle: 'dotted' },
        ])

        chart.setZones([
          {
            from: px(lo + span * 0.36),
            to: px(lo + span * 0.56),
            label: 'value area',
          },
        ])

        setReady(true)
      })

    const offHover = chart.subscribe('markerHover', (m) => { if (!disposed) setActive(m) })
    const offClick = chart.subscribe('markerClick', (m) => { if (!disposed) setActive(m) })

    return () => {
      disposed = true
      offHover()
      offClick()
      feed.destroy()
      chart.destroy()
    }
  }, [])

  return (
    <div className="lp-annochart">
      <div className="lp-chartwrap">
        <div className="lp-chartbar">
          <span className="lp-dot lp-dot-a" />
          <span className="lp-dot lp-dot-b" />
          <span className="lp-dot lp-dot-c" />
          <span className="lp-chartbar-title">EMBR · 1m · annotated</span>
        </div>
        <div className="lp-chart lp-chart-sm" ref={hostRef}>
          {!ready && <div className="lp-chart-loading">placing annotations…</div>}
        </div>
      </div>

      <div className={`lp-annoread ${active ? 'is-on' : ''}`}>
        {active ? (
          <>
            <span className="lp-annoread-t">{active.data?.title || active.text}</span>
            <span className="lp-annoread-s">{active.data?.sub}</span>
          </>
        ) : (
          <span className="lp-annoread-s">
            hover or tap a marker — the payload you attached comes straight back
          </span>
        )}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- series -- */
/**
 * Two EMAs over the same random walk, drawn as series.
 *
 * The warm-up period is the point of this demo: an EMA has no value for its
 * first N bars, so those points carry no `value` and the line simply starts
 * where the data does. That is the gap rule doing its job — nothing is drawn
 * at zero, and nothing is interpolated across.
 *
 * The chips are wired to `setSeriesVisible`, which also drops the hidden
 * series out of autoscale — watch the price axis when you toggle one off.
 */
const SERIES_DEFS = [
  { id: 'ema9', label: 'EMA 9', period: 9, color: '#c084fc' },
  { id: 'ema21', label: 'EMA 21', period: 21, color: '#38bdf8' },
]

/** EMA seeded with the SMA of its first window. Warm-up bars return null. */
function emaSeries(bars, period) {
  const k = 2 / (period + 1)
  let prev
  return bars.map((b, i) => {
    if (i < period - 1) return { time: b.time } // no value yet — a gap
    if (prev === undefined) {
      let sum = 0
      for (let j = 0; j < period; j++) sum += bars[j].close
      prev = sum / period
    } else {
      prev = b.close * k + prev * (1 - k)
    }
    return { time: b.time, value: Number(prev.toFixed(2)) }
  })
}

function SeriesChart() {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [on, setOn] = useState(() => SERIES_DEFS.map(() => true))

  useEffect(() => {
    let disposed = false
    const chart = createChart(hostRef.current, {
      theme: { ...defaultTheme, background: '#0a0d15' },
      timeScale: { spacing: 9, rightOffset: 6 },
      priceScale: { marginTop: 0.18, marginBottom: 0.16 },
    })
    chartRef.current = chart

    const feed = new RandomFeed({
      symbol: 'EMBR',
      timeframe: 60000,
      seed: 20260920,
      start: 128.4,
      volatility: 0.0022,
    })

    feed
      .getBars({ symbol: 'EMBR', timeframe: 60000, to: null, limit: 160 })
      .then((bars) => {
        if (disposed || !bars.length) return
        chart.setData(bars)
        for (const d of SERIES_DEFS) {
          chart.setSeries(d.id, {
            data: emaSeries(bars, d.period),
            color: d.color,
            lineWidth: 1.6,
            title: d.label,
          })
        }
        setReady(true)
      })

    return () => {
      disposed = true
      feed.destroy()
      chart.destroy()
      chartRef.current = null
    }
  }, [])

  const toggle = (i) => {
    const next = on.slice()
    next[i] = !next[i]
    setOn(next)
    chartRef.current?.setSeriesVisible(SERIES_DEFS[i].id, next[i])
  }

  return (
    <div className="lp-annochart">
      <div className="lp-chartwrap">
        <div className="lp-chartbar">
          <span className="lp-dot lp-dot-a" />
          <span className="lp-dot lp-dot-b" />
          <span className="lp-dot lp-dot-c" />
          <span className="lp-chartbar-title">EMBR · 1m · two EMAs</span>
        </div>
        <div className="lp-chart lp-chart-sm" ref={hostRef}>
          {!ready && <div className="lp-chart-loading">computing averages…</div>}
        </div>
      </div>

      <div className="lp-serieslegend">
        {SERIES_DEFS.map((d, i) => (
          <button
            type="button"
            key={d.id}
            className={`lp-serieschip ${on[i] ? 'is-on' : ''}`}
            onClick={() => toggle(i)}
          >
            <span className="lp-serieswatch" style={{ background: d.color }} />
            {d.label}
          </button>
        ))}
        <span className="lp-serieshint">
          toggle one off — it leaves the price scale too
        </span>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- view -- */
/**
 * Three NSE sessions, 09:15 to 15:30, with the overnight closes between them.
 *
 * Two things are on show and they reinforce each other. `fitContent()` puts
 * all three days on screen at once; the time-zone chips relabel every tick
 * without touching the data. Read it in Kolkata and the sessions open at
 * 09:15; read it in New York and the same bars open at 23:45 the evening
 * before — which is exactly why a chart cannot just use the browser's zone.
 *
 * The date labels between sessions are the day-boundary rule: the old
 * behaviour printed a date only at local midnight, which intraday
 * instruments never trade through.
 */
const ZONES = [
  { id: 'Asia/Kolkata', label: 'Mumbai' },
  { id: 'UTC', label: 'UTC' },
  { id: 'America/New_York', label: 'New York' },
]
const SESSION_BARS = 240

/** Reshape a continuous walk into NSE sessions: 09:15 IST, three days. */
function sessionBars(walk) {
  const open = Date.UTC(2026, 8, 16, 3, 45) // 09:15 Asia/Kolkata
  return walk.slice(0, SESSION_BARS * 3).map((b, i) => ({
    ...b,
    time: open + Math.floor(i / SESSION_BARS) * 86400000 + (i % SESSION_BARS) * 60000,
  }))
}

function ViewChart() {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [zone, setZone] = useState(ZONES[0].id)
  const [fitted, setFitted] = useState(false)

  useEffect(() => {
    let disposed = false
    const chart = createChart(hostRef.current, {
      theme: { ...defaultTheme, background: '#0a0d15' },
      timeZone: ZONES[0].id,
      timeScale: { spacing: 9, rightOffset: 4 },
      priceScale: { marginTop: 0.16, marginBottom: 0.14 },
    })
    chartRef.current = chart

    const feed = new RandomFeed({
      symbol: 'NIFTY',
      timeframe: 60000,
      seed: 20260916,
      start: 24180,
      volatility: 0.0009,
    })

    feed
      .getBars({ symbol: 'NIFTY', timeframe: 60000, to: null, limit: SESSION_BARS * 3 })
      .then((bars) => {
        if (disposed || !bars.length) return
        chart.setData(sessionBars(bars))
        setReady(true)
      })

    return () => {
      disposed = true
      feed.destroy()
      chart.destroy()
      chartRef.current = null
    }
  }, [])

  const pickZone = (id) => {
    setZone(id)
    chartRef.current?.setTimeZone(id)
  }

  const fit = () => {
    if (chartRef.current?.fitContent()) setFitted(true)
  }

  return (
    <div className="lp-annochart">
      <div className="lp-chartwrap">
        <div className="lp-chartbar">
          <span className="lp-dot lp-dot-a" />
          <span className="lp-dot lp-dot-b" />
          <span className="lp-dot lp-dot-c" />
          <span className="lp-chartbar-title">NIFTY · 1m · three sessions</span>
        </div>
        <div className="lp-chart lp-chart-sm" ref={hostRef}>
          {!ready && <div className="lp-chart-loading">loading sessions…</div>}
        </div>
      </div>

      <div className="lp-serieslegend">
        <button
          type="button"
          className={`lp-serieschip ${fitted ? '' : 'is-on'}`}
          onClick={fit}
        >
          fitContent()
        </button>
        {ZONES.map((z) => (
          <button
            type="button"
            key={z.id}
            className={`lp-serieschip ${zone === z.id ? 'is-on' : ''}`}
            onClick={() => pickZone(z.id)}
          >
            {z.label}
          </button>
        ))}
        <span className="lp-serieshint">
          {fitted ? 'double-click the chart to reset the zoom' : 'fit all three days, then switch zones'}
        </span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- panes -- */
/**
 * The argument for panes, made by letting you break it.
 *
 * RSI lives on 0..100. The instrument here trades near 24,000. Put both on one
 * scale and the candles collapse into a flat line at the top while the
 * oscillator hugs the bottom — which is the whole reason a second scale has to
 * exist. The toggle moves the same series between its own pane and the price
 * pane, so the failure is one click away rather than a paragraph.
 */
function rsiSeries(bars, period = 14) {
  let avgGain = 0
  let avgLoss = 0
  return bars.map((b, i) => {
    if (i === 0) return { time: b.time } // no change yet — a gap
    const diff = b.close - bars[i - 1].close
    const gain = Math.max(0, diff)
    const loss = Math.max(0, -diff)
    if (i <= period) {
      avgGain += gain / period
      avgLoss += loss / period
      if (i < period) return { time: b.time } // warm-up
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period
      avgLoss = (avgLoss * (period - 1) + loss) / period
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    return { time: b.time, value: Number((100 - 100 / (1 + rs)).toFixed(2)) }
  })
}

function PanesChart() {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const dataRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [split, setSplit] = useState(true)

  useEffect(() => {
    let disposed = false
    const chart = createChart(hostRef.current, {
      theme: { ...defaultTheme, background: '#0a0d15' },
      timeScale: { spacing: 7, rightOffset: 4 },
      priceScale: { marginTop: 0.16, marginBottom: 0.14 },
    })
    chartRef.current = chart

    const feed = new RandomFeed({
      symbol: 'NIFTY',
      timeframe: 60000,
      seed: 20260921,
      start: 24180,
      volatility: 0.0011,
    })

    feed
      .getBars({ symbol: 'NIFTY', timeframe: 60000, to: null, limit: 260 })
      .then((bars) => {
        if (disposed || !bars.length) return
        dataRef.current = rsiSeries(bars)
        chart.setData(bars)
        chart.addPane('rsi', { weight: 1, title: 'RSI 14' })
        chart.setSeries('rsi14', { data: dataRef.current, pane: 'rsi', color: '#c084fc', lineWidth: 1.6 })
        chart.fitContent()
        setReady(true)
      })

    return () => {
      disposed = true
      feed.destroy()
      chart.destroy()
      chartRef.current = null
    }
  }, [])

  const place = (own) => {
    const chart = chartRef.current
    if (!chart || !dataRef.current) return
    setSplit(own)
    chart.removeSeries('rsi14')
    if (own) {
      if (!chart.pane('rsi')) chart.addPane('rsi', { weight: 1, title: 'RSI 14' })
    } else if (chart.pane('rsi')) {
      chart.removePane('rsi')
    }
    chart.setSeries('rsi14', {
      data: dataRef.current,
      pane: own ? 'rsi' : 'price',
      color: '#c084fc',
      lineWidth: 1.6,
    })
  }

  return (
    <div className="lp-annochart">
      <div className="lp-chartwrap">
        <div className="lp-chartbar">
          <span className="lp-dot lp-dot-a" />
          <span className="lp-dot lp-dot-b" />
          <span className="lp-dot lp-dot-c" />
          <span className="lp-chartbar-title">NIFTY · 1m · RSI 14</span>
        </div>
        <div className="lp-chart lp-chart-sm" ref={hostRef}>
          {!ready && <div className="lp-chart-loading">computing RSI…</div>}
        </div>
      </div>

      <div className="lp-serieslegend">
        <button type="button" className={`lp-serieschip ${split ? 'is-on' : ''}`} onClick={() => place(true)}>
          its own pane
        </button>
        <button type="button" className={`lp-serieschip ${split ? '' : 'is-on'}`} onClick={() => place(false)}>
          on the price scale
        </button>
        <span className="lp-serieshint">
          {split ? 'one scale each' : 'RSI 0–100 against a price near 24,000'}
        </span>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- replay -- */
/**
 * The scrubber demoing itself. A fixed 420-bar dataset is replayed from its
 * midpoint at 4×; every control below is wired straight to `chart.replay`,
 * and every number shown arrives on the 'replay' event — nothing polls.
 *
 * Markers are placed across the WHOLE dataset on purpose: the ones ahead of
 * the cursor stay hidden until playback reaches them.
 */
const REPLAY_SPEEDS = [1, 4, 20, 100]

function ReplayChart() {
  const hostRef = useRef(null)
  const chartRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [rp, setRp] = useState(null)

  useEffect(() => {
    let disposed = false
    let off = null
    const chart = createChart(hostRef.current, {
      theme: { ...defaultTheme, background: '#0a0d15' },
      timeScale: { spacing: 6, rightOffset: 8 },
    })
    chartRef.current = chart

    const feed = new RandomFeed({
      symbol: 'EMBR',
      timeframe: 60000,
      seed: 31337,
      start: 96.2,
      volatility: 0.0024,
    })

    feed
      .getBars({ symbol: 'EMBR', timeframe: 60000, to: null, limit: 420 })
      .then((bars) => {
        if (disposed || !bars.length) return
        chart.setData(bars)

        const n = bars.length
        const at = (f) => bars[Math.max(0, Math.min(n - 1, Math.round(f * (n - 1))))]
        chart.setMarkers([
          { id: 'r1', time: at(0.3).time, shape: 'arrowUp', text: 'BUY' },
          { id: 'r2', time: at(0.52).time, shape: 'flag', color: '#c084fc', text: 'News' },
          { id: 'r3', time: at(0.74).time, shape: 'arrowDown', text: 'SELL' },
          { id: 'r4', time: at(0.93).time, shape: 'arrowUp', text: 'BUY' },
        ])

        off = chart.subscribe('replay', (s) => { if (!disposed) setRp(s) })
        chart.startReplay({ from: Math.round(n * 0.45), speed: 4 })
        chart.replay.play()
        setReady(true)
      })

    return () => {
      disposed = true
      if (off) off()
      chart.destroy()
      chartRef.current = null
    }
  }, [])

  const on = (fn) => () => {
    const r = chartRef.current && chartRef.current.replay
    if (r) fn(r)
  }
  const active = !!(rp && rp.active)

  return (
    <div className="lp-replaychart">
      <div className="lp-chartwrap">
        <div className="lp-chartbar">
          <span className="lp-dot lp-dot-a" />
          <span className="lp-dot lp-dot-b" />
          <span className="lp-dot lp-dot-c" />
          <span className="lp-chartbar-title">EMBR · 1m · replaying 420 bars</span>
        </div>
        <div className="lp-chart lp-chart-sm" ref={hostRef}>
          {!ready && <div className="lp-chart-loading">loading the tape…</div>}
        </div>
      </div>

      <div className="lp-transport">
        <div className="lp-tbtns">
          <button className="lp-tbtn" title="To start" onClick={on((r) => r.toStart())}>⏮</button>
          <button className="lp-tbtn" title="Back one bar" onClick={on((r) => r.step(-1))}>◀</button>
          <button
            className={`lp-tbtn ${active && rp.playing ? 'is-on' : ''}`}
            title={active && rp.playing ? 'Pause' : 'Play'}
            onClick={on((r) => r.toggle())}
          >
            {active && rp.playing ? '❚❚' : '▶'}
          </button>
          <button className="lp-tbtn" title="Forward one bar" onClick={on((r) => r.step(1))}>▶|</button>
          <button className="lp-tbtn" title="To end" onClick={on((r) => r.toEnd())}>⏭</button>
        </div>

        <div className="lp-rpscrub">
          <input
            type="range"
            min="1"
            max={active ? Math.max(1, rp.length - 1) : 1}
            value={active ? rp.index : 1}
            onChange={(e) => on((r) => r.seek(+e.target.value))()}
            aria-label="Replay position"
          />
        </div>

        <div className="lp-tbtns">
          {REPLAY_SPEEDS.map((s) => (
            <button
              key={s}
              className={`lp-tbtn ${active && rp.speed === s ? 'is-on' : ''}`}
              onClick={on((r) => r.setSpeed(s))}
            >
              {s}×
            </button>
          ))}
        </div>

        <span className="lp-rpread">
          {active ? <>bar <b>{rp.index + 1}</b> / {rp.length}</> : 'idle'}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ copy -- */
function CopyLine({ text }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="lp-copyline">
      <code>{text}</code>
      <button onClick={copy} aria-label="Copy to clipboard">
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  )
}

const STATS = [
  { v: '8.3', u: 'KB', l: 'gzipped UMD core' },
  { v: '0', u: '', l: 'dependencies' },
  { v: '60', u: 'fps', l: 'with a live feed' },
  { v: 'MIT', u: '', l: 'licensed' },
]

const SHAPES = [
  'arrowUp', 'arrowDown', 'triangleUp', 'triangleDown',
  'circle', 'square', 'diamond', 'flag', 'label',
]

const FEATURES = [
  {
    t: 'Motion, not repaints',
    d: 'Every incoming tick eases into the forming candle over ~55ms. The price axis glides to new bounds instead of snapping. Zoom is cursor-anchored and eased; panning carries inertia and decays with friction.',
  },
  {
    t: 'Markers & annotations',
    d: 'Nine marker shapes, price lines and shaded zones. Markers sharing a bar stack instead of overlapping, dense sets thin out as you zoom away, and each one is hit-tested for hover and click with your own payload attached.',
  },
  {
    t: 'Replay built in',
    d: 'startReplay() turns any loaded dataset into a tape you can scrub, step and play at 0.25×–500×. Bars are revealed through the same animated path a live tick takes, so backtesting playback looks exactly like the market did.',
  },
  {
    t: 'Series, not just candles',
    d: 'setSeries() draws any y-value over the same time axis — a moving average, a VWAP, an equity curve. Keyed, so updating one leaves the rest alone, and a point with no value lifts the pen instead of pretending the line went to zero.',
  },
  {
    t: 'Built for finished datasets',
    d: 'fitContent() puts a whole backtest on screen in one call, and timeZone formats every label in the exchange\u2019s zone — so an NSE chart opens at 09:15 whoever is reading it, with the day boundaries marked.',
  },
  {
    t: 'Any data source',
    d: 'The DataFeed interface is the whole integration: implement getBars() and subscribe() and the chart works. REST, WebSocket, Lambda, a CSV in memory — the core never knows the difference.',
  },
  {
    t: 'Built for big history',
    d: 'One requestAnimationFrame loop driven by dirty flags, with visible-range culling. 500k bars loaded costs only the ~200 on screen, and an idle chart drops to zero CPU.',
  },
  {
    t: 'Framework-free core',
    d: 'Plain DOM and Canvas, zero dependencies. Ships as ESM, a React component, a <emberwick-chart> custom element, or a single UMD file from a CDN.',
  },
  {
    t: 'Crisp on every screen',
    d: 'Layered canvases pre-scaled by devicePixelRatio: the crosshair repaints without ever touching candle pixels, and a ResizeObserver keeps it sharp through any layout change.',
  },
  {
    t: 'Yours to theme',
    d: 'A flat 20-key theme object — colours, fonts, axis sizing — swappable at runtime. Dark and light presets included, plus toImage() for a PNG snapshot.',
  },
  {
    t: 'Range-aware',
    d: "subscribe('visibleRange') reports the window on screen — bar indices, timestamps and px-per-bar — the moment you subscribe and then only when it truly changes. Paginate history, sync a second chart, or switch timeframe off it, no debouncing required.",
  },
]

/* ---------------------------------------------------------------- range -- */
/**
 * visibleRange demo. The overview strip and the payload table are positioned
 * and filled from the event and nothing else — no polling, no debounce, no
 * rAF of our own.
 *
 * Static dataset on purpose: panning and zooming IS the story here, so a live
 * feed would only move the goalposts while the reader experiments.
 */
function RangeChart() {
  const hostRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [range, setRange] = useState(null)

  useEffect(() => {
    let disposed = false
    let off = null
    const chart = createChart(hostRef.current, {
      theme: { ...defaultTheme, background: '#0a0d15' },
      timeScale: { spacing: 3.2, rightOffset: 8 },
    })
    const feed = new RandomFeed({
      symbol: 'EMBR',
      timeframe: 60000,
      seed: 90210,
      start: 74.8,
      volatility: 0.0021,
    })

    feed
      .getBars({ symbol: 'EMBR', timeframe: 60000, to: null, limit: 900 })
      .then((bars) => {
        if (disposed || !bars.length) return
        chart.setData(bars)
        off = chart.subscribe('visibleRange', (r) => {
          if (!disposed) setRange(r)
        })
        setReady(true)
      })

    return () => {
      disposed = true
      if (off) off()
      chart.destroy()
    }
  }, [])

  // The whole overview strip is these two numbers.
  const win =
    range && range.barCount
      ? {
          left: (range.from / range.barCount) * 100,
          width: Math.max(1.2, ((range.to - range.from + 1) / range.barCount) * 100),
        }
      : null

  return (
    <>
      <div className="lp-rangechart">
        <div className="lp-chartwrap">
          <div className="lp-chartbar">
            <span className="lp-dot lp-dot-a" />
            <span className="lp-dot lp-dot-b" />
            <span className="lp-dot lp-dot-c" />
            <span className="lp-chartbar-title">EMBR · 1m · 900 bars loaded</span>
          </div>
          <div className="lp-chart lp-chart-sm" ref={hostRef}>
            {!ready && <div className="lp-chart-loading">generating market…</div>}
          </div>
          <div className="lp-chartfoot">
            <p className="lp-chart-hint">
              pan and zoom — the strip below is positioned from the payload, nothing else
            </p>
          </div>
        </div>

        <div className="lp-minimap" aria-hidden="true">
          <span className="lp-minimap-l">loaded history</span>
          {win && (
            <div
              className="lp-minimap-win"
              style={{ left: `${win.left}%`, width: `${win.width}%` }}
            />
          )}
        </div>
      </div>

      <div className="lp-payload">
        <div className="lp-codehead">subscribe('visibleRange') → payload</div>
        {range ? (
          <dl className="lp-payloadlist">
            <dt>from</dt>
            <dd><b>{range.from}</b></dd>
            <dt>to</dt>
            <dd><b>{range.to}</b></dd>
            <dt>fromTime</dt>
            <dd>{range.fromTime}</dd>
            <dt>toTime</dt>
            <dd>{range.toTime}</dd>
            <dt>barCount</dt>
            <dd>{range.barCount}</dd>
            <dt>spacing</dt>
            <dd>
              {range.spacing.toFixed(2)}
              <span className="lp-unit">px / bar</span>
            </dd>
            <dt>settled</dt>
            <dd>{String(range.settled)}</dd>
          </dl>
        ) : (
          <div className="lp-payloadwait">waiting for the first event…</div>
        )}
        <p className="lp-payloadnote">
          Fires once the moment you subscribe, then only when the window really
          changes. <code>settled</code> is <code>false</code> mid-glide and{' '}
          <code>true</code> on the last event of every gesture — so you can defer
          the expensive work without writing a debounce.
        </p>
      </div>
    </>
  )
}

const ROADMAP = [
  { t: 'Indicators & panes', d: 'SMA, EMA, VWAP, RSI, MACD in resizable sub-panes, plus a plugin hook for your own.', next: true },
  { t: 'Drawing tools', d: 'Trendlines, Fibonacci, position tool — with hit-testing, undo/redo and serialisable state.' },
  { t: 'Chart-type morphing', d: 'Animate candlestick → Heikin-Ashi → line as an eased transition rather than a redraw.' },
  { t: 'Session gaps', d: 'Collapse weekends and closed sessions instead of rendering them as ordinary bar steps.' },
]

/* --------------------------------------------------------------- landing -- */
export default function Landing() {
  return (
    <div className="lp">
      <div className="lp-glow" aria-hidden="true" />

      {/* ---- nav ---- */}
      <header className="lp-nav">
        <a className="lp-brand" href="#/">
          <span className="lp-mark" />
          <span className="lp-brandname">Emberwick</span>
          <span className="lp-ver">v{version}</span>
        </a>
        <nav className="lp-navlinks">
          <a href="#features">Features</a>
          <a href="#replay">Replay</a>
          <a href="#series">Series</a>
          <a href="#panes">Panes</a>
          <a href="#view">Sessions</a>
          <a href="#annotations">Annotations</a>
          <a href="#range">Range events</a>
          <a href="#usage">Usage</a>
          <a href="#roadmap">Roadmap</a>
          <a href={NPM_URL} target="_blank" rel="noreferrer">npm</a>
          <a className="lp-navcta" href="#/playground">Playground →</a>
        </nav>
      </header>

      {/* ---- hero ---- */}
      <section className="lp-hero">
        <span className="lp-pill">
          <span className="lp-pulse" /> new in v0.9.0 — indicator panes
        </span>
        <h1>
          Candlestick charts that
          <br />
          <em>actually flow.</em>
        </h1>
        <p className="lp-sub">
          A canvas charting core for financial frontends. Ticks ease in, axes glide,
          panning carries momentum — and the whole thing is 8.3&nbsp;KB gzipped with
          zero dependencies. Plug in your own data feed and drop it into any stack.
        </p>

        <div className="lp-cta">
          <CopyLine text="npm install emberwick" />
          <a className="lp-btn lp-btn-primary" href="#/playground">Open the playground</a>
        </div>

        <HeroChart />

        <div className="lp-stats">
          {STATS.map((s) => (
            <div className="lp-stat" key={s.l}>
              <span className="lp-statv">{s.v}<small>{s.u}</small></span>
              <span className="lp-statl">{s.l}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ---- features ---- */}
      <section className="lp-section" id="features">
        <h2>What it does</h2>
        <p className="lp-lede">
          Smooth motion is the point. Everything else is built so the motion stays
          smooth when the data gets big.
        </p>
        <div className="lp-grid">
          {FEATURES.map((f) => (
            <article className="lp-card" key={f.t}>
              <h3>{f.t}</h3>
              <p>{f.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---- replay ---- */}
      <section className="lp-section" id="replay">
        <span className="lp-tag">new in v0.4.0</span>
        <h2>Rewind the tape</h2>
        <p className="lp-lede">
          Turn any dataset the chart already holds into playback: scrub it, step it
          bar-by-bar, or run it at 100×. The transport under this chart is wired to
          nothing but the public API — press play, or drag the scrubber.
        </p>

        <div className="lp-replaygrid">
          <ReplayChart />

          <div className="lp-code lp-annocode">
            <div className="lp-codehead">Driving playback</div>
            <pre>{`// any dataset the chart already holds
chart.startReplay({ from: 180, speed: 4 })
chart.replay.play()

// a state event, like visibleRange: called on subscribe,
// then only when the cursor or transport actually moves
chart.subscribe('replay', (s) => {
  label.textContent = \`\${s.index + 1} / \${s.length}\`
  scrubber.value = s.index
  if (s.atEnd) stopwatch.stop()
})

scrubber.oninput = (e) => chart.replay.seek(+e.target.value)

chart.replay.step(-1)     // one bar back
chart.replay.setSpeed(20) // 0.25× – 500×
chart.stopReplay()        // back to the full dataset`}</pre>
          </div>
        </div>

        <div className="lp-annofacts">
          <div className="lp-annofact">
            <h3>Not a second chart</h3>
            <p>
              The chart is simply handed the revealed prefix of your data, so the
              scales, crosshair, annotations and <code>visibleRange</code> keep
              behaving exactly as they do live. There is no replay mode to
              special-case.
            </p>
          </div>
          <div className="lp-annofact">
            <h3>It plays, it doesn&rsquo;t flick</h3>
            <p>
              Each revealed bar takes the same animated path a live tick does —
              grow-from-centre, eased axis, gliding time scale. Scrubbing jumps
              instead, because easing a drag reads as lag.
            </p>
          </div>
          <div className="lp-annofact">
            <h3>The future stays hidden</h3>
            <p>
              Markers past the cursor are not drawn until playback reaches them,
              so a backtest never shows you the trade you haven&rsquo;t taken yet.
            </p>
          </div>
        </div>
      </section>

      {/* ---- annotations ---- */}
      <section className="lp-section" id="annotations">
        <span className="lp-tag">v0.3.0</span>
        <h2>Mark up the chart</h2>
        <p className="lp-lede">
          Trades, events, targets and bands — three calls, no extra layer to manage.
          Annotations move with the chart, survive pan and zoom, and hand you back
          whatever payload you attached.
        </p>

        <div className="lp-annogrid">
          <MarkersChart />

          <div className="lp-code lp-annocode">
            <div className="lp-codehead">Annotating a chart</div>
            <pre>{`chart.setMarkers([
  { time: 1717070400000, shape: 'arrowUp',   text: 'BUY 120',
    data: { orderId: 'A-7741' } },
  { time: 1717074000000, shape: 'flag',      text: 'Earnings',
    color: '#c084fc' },
  { time: 1717077600000, shape: 'arrowDown', text: 'SELL 160' },
])

chart.setPriceLines([
  { price: 148.20, title: 'target', color: '#26a69a' },
  { price: 141.05, title: 'stop', lineStyle: 'dotted' },
])

chart.setZones([
  { from: 143.5, to: 145.9, label: 'value area' },
])

chart.subscribe('markerClick', (m) => openTicket(m.data.orderId))`}</pre>
          </div>
        </div>

        <div className="lp-annofacts">
          <div className="lp-annofact">
            <h3>Stacks, never overlaps</h3>
            <p>
              Two markers on one bar are laid out one above the other. Zoom far
              enough out and dense runs thin to one per 4&nbsp;px, so a thousand
              trades stay legible and stay at 60&nbsp;fps.
            </p>
          </div>
          <div className="lp-annofact">
            <h3>Pinned to time, not pixels</h3>
            <p>
              Markers carry a timestamp and resolve to the nearest bar. Load an
              older page of history and every index is recalculated — nothing
              drifts off its candle.
            </p>
          </div>
          <div className="lp-annofact">
            <h3>Hit-tested, with your data</h3>
            <p>
              <code>markerHover</code> and <code>markerClick</code> hand back the
              marker, including the <code>data</code> object you attached. The
              cursor changes on its own.
            </p>
          </div>
        </div>

        <div className="lp-shapes">
          <span className="lp-shapes-l">shapes</span>
          {SHAPES.map((s) => <code key={s}>{s}</code>)}
        </div>
      </section>

      {/* ---- range events ---- */}
      <section className="lp-section" id="series">
        <span className="lp-tag">new in v0.7.0</span>
        <h2>Draw more than candles</h2>
        <p className="lp-lede">
          A series is any y-value over the same time axis — a moving average, a
          VWAP, an equity curve. Keyed, so updating one leaves the other eleven
          alone, and a point with no value lifts the pen instead of pretending
          the line went to zero.
        </p>

        <div className="lp-annogrid">
          <SeriesChart />

          <div className="lp-code lp-annocode">
            <div className="lp-codehead">Adding a series</div>
            <pre>{`chart.setSeries('ema20', {
  data: [{ time: 1717070400000, value: 148.2 }, ...],
  color: '#c084fc',
})

// keyed: this touches nothing else on the chart
chart.setSeriesData('ema20', nextPoints)
chart.setSeriesVisible('ema20', false)

// a point with no value BREAKS the line — it is not a zero
chart.setSeries('rsi', { data: [
  { time: t0, value: 55.2 },
  { time: t1 },            // warm-up: no value yet
  { time: t2, value: 61.8 },
]})`}</pre>
          </div>
        </div>
      </section>

      <section className="lp-section" id="panes">
        <span className="lp-tag">new in v0.9.0</span>
        <h2>A scale of its own</h2>
        <p className="lp-lede">
          RSI lives on 0–100. This instrument trades near 24,000. On one scale
          the candles flatten into a line and the oscillator hugs the floor — so
          a pane is a band of the plot with its own price scale, sharing the
          time axis. Toggle it onto the price scale and watch it break.
        </p>

        <div className="lp-annogrid">
          <PanesChart />

          <div className="lp-code lp-annocode">
            <div className="lp-codehead">Adding a pane</div>
            <pre>{`chart.addPane('rsi', { weight: 1 })

chart.setSeries('rsi14', {
  data: points,
  pane: 'rsi',
  color: '#c084fc',
})

// an unknown pane throws rather than quietly
// putting RSI-at-50 on a 24,000 scale
chart.paneScale('rsi').y(70)   // where 70 sits
chart.paneRect('rsi')          // { x, y, w, h }`}</pre>
          </div>
        </div>
      </section>

      <section className="lp-section" id="view">
        <span className="lp-tag">new in v0.8.0</span>
        <h2>Whose clock is it?</h2>
        <p className="lp-lede">
          A finished dataset wants the whole run on screen, and a session
          defined in Mumbai should read as 09:15 wherever it is opened. One
          call for each — and the dates between sessions appear because a day
          boundary is not midnight for anything that stops trading overnight.
        </p>

        <div className="lp-annogrid">
          <ViewChart />

          <div className="lp-code lp-annocode">
            <div className="lp-codehead">Framing a finished dataset</div>
            <pre>{`const chart = createChart(el, {
  timeZone: 'Asia/Kolkata',
})

chart.setData(bars)
chart.fitContent()        // the whole run, in one call

// display only — bar times, the crosshair payload
// and visibleRange() stay in the epochs you gave
chart.setTimeZone('UTC')`}</pre>
          </div>
        </div>
      </section>

      <section className="lp-section" id="range">
        <span className="lp-tag">v0.3.0</span>
        <h2>Know what&rsquo;s on screen</h2>
        <p className="lp-lede">
          One subscription reports the window the user is actually looking at —
          bar indices, timestamps and pixels per bar. Paginate history, sync a
          second chart, switch timeframe, or drive an overview strip like the
          one below.
        </p>

        <div className="lp-rangegrid">
          <RangeChart />
        </div>

        <div className="lp-annofacts">
          <div className="lp-annofact">
            <h3>Answers immediately</h3>
            <p>
              A state event, not a notification: your handler is called the
              moment you subscribe, with the window as it already stands.
              Nothing waits for the user to touch the chart first.
            </p>
          </div>
          <div className="lp-annofact">
            <h3>No debounce needed</h3>
            <p>
              Indices are integers, so a slow drag emits a handful of events
              rather than one per frame. <code>spacing</code> is reported but
              deliberately kept out of the change test — easing it would fire
              sixty times a second.
            </p>
          </div>
          <div className="lp-annofact">
            <h3>Survives new history</h3>
            <p>
              Timestamps are part of the identity, so prepending an older page
              re-emits even though <code>from</code> is still zero. A
              pagination guard cannot get itself stuck.
            </p>
          </div>
        </div>

        <div className="lp-code lp-rangecode">
          <div className="lp-codehead">Paginating on demand</div>
          <pre>{`// with a feed attached the chart paginates on its own —
// this is the manual path, for when you own the data
chart.subscribe('visibleRange', async (r) => {
  if (!r.settled || r.from > 50 || loading) return   // wait for the glide to stop

  loading = true
  const older = await api.candles({ to: r.fromTime, limit: 500 })
  chart.setData(older.concat(chart.bars))
  loading = false
})`}</pre>
        </div>
      </section>

      {/* ---- usage ---- */}
      <section className="lp-section" id="usage">
        <h2>Four lines to a live chart</h2>
        <p className="lp-lede">
          One core, four entry points. Import only the one your stack needs.
        </p>

        <div className="lp-codegrid">
          <div className="lp-code">
            <div className="lp-codehead">Vanilla ESM</div>
            <pre>{`import { createChart, RandomFeed } from 'emberwick'

const chart = createChart(document.getElementById('chart'))
await chart.setFeed(new RandomFeed({ timeframe: 60_000 }))`}</pre>
          </div>

          <div className="lp-code">
            <div className="lp-codehead">React</div>
            <pre>{`import { EmberwickChart } from 'emberwick/react'

<EmberwickChart
  feed={myFeed}
  style={{ height: 420 }}
/>`}</pre>
          </div>

          <div className="lp-code">
            <div className="lp-codehead">Web Component</div>
            <pre>{`import 'emberwick/webcomponent'

<emberwick-chart
  theme="dark"
  style="height:420px"
></emberwick-chart>`}</pre>
          </div>

          <div className="lp-code">
            <div className="lp-codehead">Script tag / CDN</div>
            <pre>{`<script src="${CDN_URL}"></script>
<script>
  const chart = Emberwick.createChart(el)
</script>`}</pre>
          </div>
        </div>

        <div className="lp-feedbox">
          <h3>Your data, your feed</h3>
          <p>
            The <code>DataFeed</code> interface is the only contract. Two methods and
            the chart is yours — history paginates backwards as the user pans, and
            live ticks animate into the forming candle.
          </p>
          <pre>{`import { DataFeed } from 'emberwick'

class MyFeed extends DataFeed {
  async getBars({ symbol, timeframe, to, limit }) {
    const r = await fetch(\`/api/candles?symbol=\${symbol}&to=\${to}\`)
    return r.json()          // [{ time, open, high, low, close, volume }]
  }

  subscribe(handler) {
    const ws = new WebSocket('wss://example.com/ticks')
    ws.onmessage = (e) => handler({ type: 'update', bar: JSON.parse(e.data) })
    return () => ws.close()
  }
}`}</pre>
        </div>
      </section>

      {/* ---- roadmap ---- */}
      <section className="lp-section" id="roadmap">
        <h2>Where it's going</h2>
        <p className="lp-lede">
          v0.9.0 adds indicator panes on top of line series, fit-to-content,
          time zones, replay, the annotation layer and the motion core. Honest about what isn't there yet — here's
          the order it's coming in.
        </p>
        <div className="lp-road">
          {ROADMAP.map((r) => (
            <div className={`lp-roadrow ${r.next ? 'is-next' : ''}`} key={r.t}>
              <span className="lp-roadtag">{r.next ? 'next' : 'planned'}</span>
              <div>
                <h3>{r.t}</h3>
                <p>{r.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- footer ---- */}
      <footer className="lp-footer">
        <div className="lp-footcta">
          <h2>Drop it in and see.</h2>
          <CopyLine text="npm install emberwick" />
          <div className="lp-footlinks">
            <a href={NPM_URL} target="_blank" rel="noreferrer">npm</a>
            <span>·</span>
            <a href={CDN_URL} target="_blank" rel="noreferrer">CDN build</a>
            <span>·</span>
            <a href="#/playground">Playground</a>
          </div>
        </div>
        <p className="lp-fine">
          Emberwick v{version} · MIT · named for the glowing end of a wick —
          small, warm, and the part that actually does the work.
        </p>
      </footer>
    </div>
  )
}
