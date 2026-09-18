/**
 * DataFeed — THE seam of this library.
 *
 * The chart core never knows where bars come from. Anything that implements
 * this interface can drive it: a REST endpoint, a WebSocket, a Lambda behind
 * API Gateway, a CSV in memory, or the bundled RandomFeed.
 *
 * Bar shape (the only contract that matters):
 *   { time: number (ms epoch), open, high, low, close, volume }
 *   Bars MUST be ascending by time and de-duplicated by the feed.
 *
 * Implement:
 *   getBars({ symbol, timeframe, to, limit }) -> Promise<Bar[]>
 *       Historical bars ENDING at `to` (exclusive). Return [] when exhausted;
 *       the chart stops asking for more history once it sees an empty page.
 *   subscribe(handler) -> unsubscribe fn
 *       handler({ type: 'update'|'append', bar }) where
 *         'update' = the forming candle changed (animates)
 *         'append' = a new candle opened (previous one is now closed)
 */
export class DataFeed {
  constructor({ symbol = 'DEMO', timeframe = 60000 } = {}) {
    this.symbol = symbol
    this.timeframe = timeframe
  }

  // eslint-disable-next-line no-unused-vars
  async getBars({ symbol, timeframe, to, limit }) {
    throw new Error('DataFeed.getBars() not implemented')
  }

  // eslint-disable-next-line no-unused-vars
  subscribe(handler) {
    return () => {}
  }

  destroy() {}
}

/** Deterministic PRNG so a given seed always renders the same chart. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
