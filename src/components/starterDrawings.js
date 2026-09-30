/**
 * A believable set of drawings for whatever bars are loaded.
 *
 * The demo tapes are random walks anchored to the moment the page opened, so a
 * drawing with hard-coded prices would land in empty space. Every anchor here
 * is found IN the bars: a trend line through two real swing lows, a fib over
 * the real leg that follows, and a long position whose target the tape really
 * does reach before it touches the stop, so the outcome label reads
 * "Target hit" and not "Open".
 *
 * Nothing here is library API: it is the host's own seed data, written in the
 * public `{ time, price }` shape, and it goes in through `setDrawings` /
 * `add` like any document would.
 */

const argmin = (bars, from, to, key) => {
  let at = from
  for (let i = from + 1; i <= to; i++) if (bars[i][key] < bars[at][key]) at = i
  return at
}
const argmax = (bars, from, to, key) => {
  let at = from
  for (let i = from + 1; i <= to; i++) if (bars[i][key] > bars[at][key]) at = i
  return at
}
const px = (v) => Number(v.toFixed(2))

/** The first entry bar whose target is reached before its stop, or -1. */
function findWinner(bars, lo, hi, horizon) {
  const n = bars.length
  for (let e = lo; e <= hi && e < n - 3; e++) {
    const end = Math.min(n - 1, e + horizon)
    const entry = bars[e].close
    const gain = bars[argmax(bars, e + 1, end, 'high')].high - entry
    if (!(gain > 0)) continue
    const target = entry + gain * 0.7
    const stop = entry - gain * 0.35
    let hit = -1
    for (let i = e + 1; i <= end; i++) {
      if (bars[i].low <= stop) break
      if (bars[i].high >= target) { hit = i; break }
    }
    if (hit > 0) return { e, end: Math.min(end, hit + 6), entry, target, stop }
  }
  return null
}

/**
 * @param {Array} bars   ascending Bar[]
 * @param {object} [want]  { trend, fib, long, note } (all true by default except
 *                          note), and `window`: how many of the newest bars to
 *                          spread the drawings over (default 240)
 * @returns {Array} DrawingInput[] (never throws; [] with too few bars)
 */
export function starterDrawings(bars, want = {}) {
  const n = bars ? bars.length : 0
  if (n < 60) return []
  const W = Math.min(n, Math.max(60, Math.floor(want.window) || 240))
  const base = n - W
  const at = (f) => base + Math.floor(W * f)
  const out = []

  const l1 = argmin(bars, at(0.02), at(0.22), 'low')
  const l2 = argmin(bars, at(0.27), at(0.48), 'low')
  const hi = argmax(bars, l2 + 1, at(0.74), 'high')

  if (want.trend !== false) {
    out.push({
      type: 'trendLine',
      points: [{ time: bars[l1].time, price: px(bars[l1].low) }, { time: bars[l2].time, price: px(bars[l2].low) }],
      options: { extend: 'right' },
    })
  }
  if (want.fib !== false && hi > l2) {
    out.push({
      type: 'fibRetracement',
      points: [{ time: bars[l2].time, price: px(bars[l2].low) }, { time: bars[hi].time, price: px(bars[hi].high) }],
    })
  }
  if (want.long !== false) {
    const w = findWinner(bars, at(0.5), n - 10, 36)
    if (w) {
      out.push({
        type: 'position',
        points: [
          { time: bars[w.e].time, price: px(w.entry) },
          { time: bars[w.end].time, price: px(w.target) },
          { time: bars[w.end].time, price: px(w.stop) },
        ],
        options: { side: 'long' },
      })
    }
  }
  if (want.note) {
    out.push({
      type: 'text',
      points: [{ time: bars[l1].time, price: px(bars[l1].low - (bars[hi] ? (bars[hi].high - bars[l1].low) * 0.06 : 0.5)) }],
      options: { text: 'higher lows' },
    })
  }
  // Marked, so the host can tell its own seed from what the reader drew: the
  // page seeds one set on load, and a second click on "Starter set" must
  // replace it, not stack a second position (and its label pills) on the first.
  return out.map((d) => ({ ...d, meta: { starter: true } }))
}
