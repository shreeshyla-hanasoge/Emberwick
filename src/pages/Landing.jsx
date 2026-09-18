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
  { t: 'Replay scrubber', d: 'Step history bar-by-bar at 1×–500× — backtesting playback, built on the motion engine.', next: true },
  { t: 'Indicators & panes', d: 'SMA, EMA, VWAP, RSI, MACD in resizable sub-panes, plus a plugin hook for your own.' },
  { t: 'Drawing tools', d: 'Trendlines, Fibonacci, position tool — with hit-testing, undo/redo and serialisable state.' },
  { t: 'Chart-type morphing', d: 'Animate candlestick → Heikin-Ashi → line as an eased transition rather than a redraw.' },
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
          <span className="lp-pulse" /> new in v{version} — annotations &amp; range events
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

      {/* ---- annotations ---- */}
      <section className="lp-section" id="annotations">
        <span className="lp-tag">new in v{version}</span>
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
      <section className="lp-section" id="range">
        <span className="lp-tag">new in v{version}</span>
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
          v{version} adds the annotation layer and range events on top of the
          rendering and motion core. Honest about what isn't there yet — here's
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
