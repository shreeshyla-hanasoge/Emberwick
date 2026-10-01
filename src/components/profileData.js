/**
 * Demo code: what a HOST does before it hands Emberwick a volume profile.
 *
 * This file is part of the demo site, not of the library, and it is here on
 * purpose. `emberwick/profiles` draws profiles; it never computes one. The
 * chart's own bars are often 5-minute bars or longer and may carry no real
 * volume at all (an index has none), so a profile binned from them would be
 * wrong, and the library would have no way to know. A real host computes
 * profiles where the fine data lives, usually on a server from 1-minute bars
 * or ticks, and sends the result in the ProfileData contract.
 *
 * So the demos do the same, in the open: they keep 1-minute bars, bin THOSE
 * into the contract here, and hand the chart the contract. Nothing in this
 * file is imported by src/profiles, and the package-boundary tests keep it
 * that way.
 */

const MIN = 60_000

/** 1, 2, 2.5 or 5 times a power of ten, at or above `raw`: a bin width a person would pick. */
export function niceStep(raw) {
  if (!(raw > 0)) return 1
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / mag
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  // Trim float dust (0.05 * 10 is 0.5000000000000001) so `lo + i * step` prints cleanly.
  return +(nice * mag).toPrecision(12)
}

/**
 * Bin fine bars into one ProfileSession.
 *
 * Each bar's volume is spread evenly over the prices it traded through, from
 * its low to its high, which is the usual approximation when all you have is
 * OHLCV. A bar that never moved puts all of its volume in one bin.
 *
 * @param {Array<{time:number,high:number,low:number,volume?:number}>} bars one session's bars, ascending
 * @param {number} step bin width
 * @returns {{start:number,end:number,lo:number,bins:number[]}|null}
 */
export function binBars(bars, step) {
  if (!bars.length) return null
  let min = Infinity
  let max = -Infinity
  for (const b of bars) {
    if (b.low < min) min = b.low
    if (b.high > max) max = b.high
  }
  const lo = +(Math.floor(min / step) * step).toPrecision(12)
  const n = Math.max(1, Math.ceil((max - lo) / step - 1e-9))
  const bins = new Array(n).fill(0)
  for (const b of bars) {
    const v = b.volume > 0 ? b.volume : 0
    if (!v) continue
    const a = Math.min(n - 1, Math.max(0, Math.floor((b.low - lo) / step)))
    const z = Math.min(n - 1, Math.max(a, Math.floor((b.high - lo) / step - 1e-9)))
    const span = b.high - b.low
    if (z === a || !(span > 0)) { bins[a] += v; continue }
    for (let i = a; i <= z; i++) {
      const from = Math.max(b.low, lo + i * step)
      const to = Math.min(b.high, lo + (i + 1) * step)
      if (to > from) bins[i] += (v * (to - from)) / span
    }
  }
  return {
    start: bars[0].time,
    end: bars[bars.length - 1].time,
    lo,
    bins: bins.map((v) => Math.round(v)),
  }
}

/**
 * Split ascending bars into sessions by `sessionOf(bar.time)`, a key that is
 * the same for every bar of one session. Returns arrays of bars, in order.
 */
export function splitSessions(bars, sessionOf) {
  const out = []
  let key = null
  for (const b of bars) {
    const k = sessionOf(b.time)
    if (k !== key) { out.push([]); key = k }
    out[out.length - 1].push(b)
  }
  return out
}

/**
 * A bin width that gives a QUIET session about `target` bins. Sized from the
 * lower quartile of the sessions' ranges, not the middle: the step is one
 * number for every session, and a step sized for the wild ones would leave a
 * quiet session with four fat bins and no shape.
 */
export function stepFor(sessions, target = 36) {
  const ranges = sessions
    .map((s) => Math.max(...s.map((b) => b.high)) - Math.min(...s.map((b) => b.low)))
    .filter((r) => r > 0)
    .sort((a, b) => a - b)
  if (!ranges.length) return 1
  return niceStep(ranges[ranges.length >> 2] / target)
}

/**
 * The whole contract for a run of fine bars.
 *
 * @param {Array} bars fine bars (1-minute, say), ascending
 * @param {object} o
 * @param {(time:number)=>number|string} o.sessionOf session key of a time
 * @param {number} [o.step] bin width; picked from the data when absent
 * @param {string} [o.source] caption text
 * @param {boolean} [o.developing] mark the last session as still forming
 * @returns {{version:1, source?:string, step:number, sessions:object[]}}
 */
export function buildProfiles(bars, { sessionOf, step, source, developing = false }) {
  const groups = splitSessions(bars, sessionOf)
  const width = step > 0 ? step : stepFor(groups)
  const sessions = groups.map((g) => binBars(g, width)).filter(Boolean)
  if (developing && sessions.length) sessions[sessions.length - 1].developing = true
  const data = { version: 1, step: width, sessions }
  if (source) data.source = source
  return data
}

/**
 * Sessions that are clock hours, in the browser's own zone: what the
 * playground's round-the-clock tape is cut into. Local, because the chart's
 * axis is: a session that began at :30 in a half-hour zone would look wrong.
 */
export const hourOf = (time) => Math.floor((time - new Date(time).getTimezoneOffset() * MIN) / (60 * MIN))

/**
 * Coarsen fine bars into `tf`-wide candles, each session's first candle
 * starting at the session's first bar. This is the other half of what a host
 * does: it keeps the fine bars for the profile and draws the coarse ones.
 *
 * @param {Array} bars one session's fine bars, ascending
 * @param {number} tf candle width in ms
 */
export function aggregate(bars, tf) {
  const out = []
  if (!bars.length) return out
  const t0 = bars[0].time
  let cur = null
  for (const b of bars) {
    const slot = t0 + Math.floor((b.time - t0) / tf) * tf
    if (!cur || cur.time !== slot) {
      cur = { time: slot, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 }
      out.push(cur)
    } else {
      if (b.high > cur.high) cur.high = b.high
      if (b.low < cur.low) cur.low = b.low
      cur.close = b.close
      cur.volume += b.volume || 0
    }
  }
  return out
}
