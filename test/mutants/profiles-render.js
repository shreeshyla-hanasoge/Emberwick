/**
 * Mutants for profile rendering: the geometry functions (render.js), the
 * theme (theme.js) and the controller's frame, cache, replay and hover paths
 * (VolumeProfile.js). Tested by profiles-session.test.mjs and
 * profiles-live.test.mjs. Aggregated by test/mutants.js; `file` is
 * repo-relative.
 */
const RENDER = 'src/profiles/render.js'
const THEME = 'src/profiles/theme.js'
const VP = 'src/profiles/VolumeProfile.js'

export const MUTANTS = [
  // ------------------------------------------------------------- geometry --
  {
    name: 'A session starts at the centre of its first bar, not at its edge',
    file: RENDER,
    find: '  return ts.x(u0) - ts.barWidth() / 2',
    replace: '  return ts.x(u0)',
  },
  {
    name: 'A session ends at the centre of its last bar, not at its edge',
    file: RENDER,
    find: '  return ts.x(u1) + ts.barWidth() / 2',
    replace: '  return ts.x(u1)',
  },
  {
    name: 'A bin too small for a pixel is not drawn',
    file: RENDER,
    find: '  return Math.max(1, Math.round((v / max) * maxLen))',
    replace: '  return Math.round((v / max) * maxLen)',
  },
  {
    name: 'Bar lengths are fractional pixels',
    file: RENDER,
    find: '  return Math.max(1, Math.round((v / max) * maxLen))',
    replace: '  return Math.max(1, (v / max) * maxLen)',
  },
  {
    name: 'binAt answers an index outside the profile',
    file: RENDER,
    find: '  return i >= 0 && i < n ? i : -1',
    replace: '  return i',
  },
  {
    name: 'Bins below the pane are drawn and left to the clip',
    file: RENDER,
    find: '  let i0 = Math.floor((ps.price(bottom) - lo) / step)',
    replace: '  let i0 = 0',
  },
  {
    name: 'Bins above the pane are drawn and left to the clip',
    file: RENDER,
    find: '  let i1 = Math.floor((ps.price(top) - lo) / step)',
    replace: '  let i1 = n - 1',
  },
  {
    name: 'Sub-pixel bins are drawn one rect each instead of merged',
    file: RENDER,
    find: '    if (yb - yt < 1 && i < i1) continue\n',
    replace: '',
  },
  {
    name: 'A merged run is as long as its LAST bin, not its longest',
    file: RENDER,
    find: '    if (v > run) {\n      run = v',
    replace: '    if (true) {\n      run = v',
  },
  {
    name: 'Every bin is tinted as value area',
    file: RENDER,
    find: '      runVa = tint && i >= s.vaFrom && i <= s.vaTo',
    replace: '      runVa = tint',
  },
  {
    name: 'The value area tint stops one bin short at the top',
    file: RENDER,
    find: '      runVa = tint && i >= s.vaFrom && i <= s.vaTo',
    replace: '      runVa = tint && i >= s.vaFrom && i < s.vaTo',
  },
  {
    name: 'Tall bins touch, with no row between them',
    file: RENDER,
    find: '      else ctx.fillRect(dir > 0 ? x0 : x0 - len, yt, len, h >= 3 ? h - 1 : h)\n      drawn++',
    replace: '      else ctx.fillRect(dir > 0 ? x0 : x0 - len, yt, len, h)\n      drawn++',
  },
  {
    name: 'A trailing sub-pixel run is stacked on the rect below it',
    file: RENDER,
    find: '      if (h < 1) ctx.fillRect(dir > 0 ? x0 : x0 - len, yt - 1, len, 1)\n      else ctx.fillRect(dir > 0 ? x0 : x0 - len, yt, len, h >= 3 ? h - 1 : h)\n      drawn++',
    replace: '      if (h < 1) ctx.fillRect(dir > 0 ? x0 : x0 - len, yt, len, 1)\n      else ctx.fillRect(dir > 0 ? x0 : x0 - len, yt, len, h >= 3 ? h - 1 : h)\n      drawn++',
  },
  {
    name: 'The fill style is assigned for every bin',
    file: RENDER,
    find: '      if (st.fill !== fill) ctx.fillStyle = st.fill = fill',
    replace: '      ctx.fillStyle = st.fill = fill',
  },
  {
    name: 'The hover highlight is a different rect from the bin it highlights',
    file: RENDER,
    find: '  else ctx.fillRect(dir > 0 ? x0 : x0 - len, yt, len, h >= 3 ? h - 1 : h)\n}',
    replace: '  else ctx.fillRect(dir > 0 ? x0 : x0 - len, yt, len, h)\n}',
  },
  {
    name: 'A bar wholly above a POC counts as trading through it',
    file: RENDER,
    find: '    if (+b.low <= price && +b.high >= price) return k',
    replace: '    if (+b.high >= price) return k',
  },
  {
    name: 'A bar wholly below a POC counts as trading through it',
    file: RENDER,
    find: '    if (+b.low <= price && +b.high >= price) return k',
    replace: '    if (+b.low <= price) return k',
  },
  // ---------------------------------------------------------------- theme --
  {
    name: 'A light theme gets the dark theme\'s profile colours',
    file: THEME,
    find: '  const light = isLight(t.background)',
    replace: '  const light = false',
  },
  {
    name: 'The theme\'s POC colour beats the colors option',
    file: THEME,
    find: "    poc: o.poc || t.profilePoc || (light ? '#c2570c' : '#ff9f43'),",
    replace: "    poc: t.profilePoc || o.poc || (light ? '#c2570c' : '#ff9f43'),",
  },
  {
    name: 'The theme\'s profileFill key is ignored',
    file: THEME,
    find: '    fill: o.fill || t.profileFill || `rgba(${rgb},0.18)`,',
    replace: '    fill: o.fill || `rgba(${rgb},0.18)`,',
  },
  {
    name: 'The value-area lines ignore the theme\'s text colour',
    file: THEME,
    find: '    vaLine: o.vaLine || t.profileVaLine || t.text,',
    replace: "    vaLine: o.vaLine || t.profileVaLine || '#888888',",
  },
  // ---------------------------------------------------------------- frame --
  {
    name: 'The profile is clipped to the whole pane and overprints the volume strip',
    file: VP,
    find: '    ctx.rect(r.x, top, r.w, bottom - top)',
    replace: '    ctx.rect(r.x, top, r.w, r.h)',
  },
  {
    name: 'A chart with no volume on screen still loses the strip\'s share of the pane',
    file: VP,
    find: '        if (bars[i] && bars[i].volume > 0) return r.y + r.h - r.h * ratio\n      }\n    }\n    return r.y + r.h',
    replace: '        if (bars[i] && bars[i].volume > 0) return r.y + r.h - r.h * ratio\n      }\n    }\n    return r.y + r.h - r.h * ratio',
  },
  {
    name: 'The fill-style memo survives into the next frame, whose context has been reset',
    file: VP,
    find: '    const st = this._st\n    st.fill = null\n',
    replace: '    const st = this._st\n',
  },
  {
    name: 'Session profiles are drawn in visible mode',
    file: VP,
    find: "    if (o.mode !== 'visible') {\n      for (let k = 0; k < sessions.length; k++) {",
    replace: '    if (true) {\n      for (let k = 0; k < sessions.length; k++) {',
  },
  {
    name: 'The dash is left on after the value-area lines',
    file: VP,
    find: '        ctx.stroke()\n        ctx.setLineDash(DASH.solid)\n',
    replace: '        ctx.stroke()\n',
  },
  {
    name: 'The value-area lines are drawn with valueArea off',
    file: VP,
    find: '      if (o.valueArea) {\n        ctx.strokeStyle = colors.vaLine',
    replace: '      if (true) {\n        ctx.strokeStyle = colors.vaLine',
  },
  {
    name: 'The POC line is drawn with poc off',
    file: VP,
    find: '      if (o.poc) {\n        ctx.strokeStyle = colors.poc',
    replace: '      if (true) {\n        ctx.strokeStyle = colors.poc',
  },
  {
    name: 'The hover highlight is painted into an export',
    file: VP,
    find: '    if (!info.exporting && this._hovS) {',
    replace: '    if (this._hovS) {',
  },
  {
    name: 'The caption is drawn with label off',
    file: VP,
    find: '    if (o.label && d.source) this._caption(ctx, host, r, d.source)',
    replace: '    if (d.source) this._caption(ctx, host, r, d.source)',
  },
  {
    name: 'The caption leaves the context translucent',
    file: VP,
    find: '    ctx.globalAlpha = 1\n',
    replace: '',
  },
  {
    name: 'Tags are drawn with tags off',
    file: VP,
    find: "    if (o.tags && o.mode !== 'visible') {\n      let last = null",
    replace: "    if (o.mode !== 'visible') {\n      let last = null",
  },
  {
    name: 'The FIRST session is tagged instead of the latest',
    file: VP,
    find: '      for (let k = sessions.length - 1; k >= 0 && !last; k--) {',
    replace: '      for (let k = 0; k < sessions.length && !last; k++) {',
  },
  {
    name: 'A session still in the future under replay is tagged',
    file: VP,
    find: '        if (sessions[k].on && sessions[k].end < this._cut) last = sessions[k]',
    replace: '        if (sessions[k].on) last = sessions[k]',
  },
  {
    name: 'Value-area tags are drawn with valueArea off',
    file: VP,
    find: '    if (o.valueArea && s.vah !== null) {\n      tag.color = colors.vaLine',
    replace: '    if (s.vah !== null) {\n      tag.color = colors.vaLine',
  },
  {
    name: 'The POC tag is drawn with poc off',
    file: VP,
    find: '    if (o.poc) {\n      tag.color = colors.poc',
    replace: '    if (true) {\n      tag.color = colors.poc',
  },
  {
    name: 'The palette is computed once and never follows setTheme or setOptions',
    file: VP,
    find: '    if (this._colorsOf !== host.theme || this._colorsOpt !== this._opts.colors) {',
    replace: '    if (!this._colors) {',
  },
  // ---------------------------------------------------------------- cache --
  {
    name: 'A history prepend or a new bar is not noticed, so sessions keep stale indices',
    file: VP,
    find: '    let stale = k.rp !== rp || k.n !== n || k.tf !== tf\n    if (!rp && (k.gen !== host.barGen || k.t0 !== t0 || k.tN !== tN)) stale = true',
    replace: '    let stale = k.rp !== rp || k.tf !== tf\n    if (!rp && k.gen !== host.barGen) stale = true',
  },
  {
    name: 'Every replay scrub re-resolves every session',
    file: VP,
    find: '    if (!rp && (k.gen !== host.barGen || k.t0 !== t0 || k.tN !== tN)) stale = true',
    replace: '    if (k.gen !== host.barGen || k.t0 !== t0 || k.tN !== tN) stale = true',
  },
  {
    name: 'upsertSession re-resolves every session, not the one it touched',
    file: VP,
    find: '        if (!stale && s.u0 === s.u0) continue\n',
    replace: '',
  },
  {
    name: 'A session that arrived since the last frame is never resolved',
    file: VP,
    find: '    this._rev++\n    this._unresolved = true\n',
    replace: '    this._rev++\n',
  },
  {
    name: 'A session outside the loaded bars is resolved and drawn anyway',
    file: VP,
    find: '        s.on = n > 0 && s.end >= t0 && s.start <= tN',
    replace: '        s.on = n > 0',
  },
  {
    name: 'A developing session runs past the newest bar',
    file: VP,
    find: '        s.u1 = s.on ? Math.min(host.timeToIndex(s.end), n - 1) : -1',
    replace: '        s.u1 = s.on ? host.timeToIndex(s.end) : -1',
  },
  // --------------------------------------------------------------- replay --
  {
    name: 'A session is hidden until the bar AFTER its last one is revealed',
    file: VP,
    find: '(m ? +bars[m - 1].time + tf : -Infinity)',
    replace: '(m ? +bars[m - 1].time : -Infinity)',
  },
  {
    name: 'A session one bar short of finished is shown under replay',
    file: VP,
    find: '        if (!s.on || s.end >= this._cut) continue\n        s.xl = spanLeft(ts, s.u0)',
    replace: '        if (!s.on || s.end > this._cut) continue\n        s.xl = spanLeft(ts, s.u0)',
  },
  {
    name: 'hideFutureInReplay:false still hides future sessions',
    file: VP,
    find: '    this._cut = rp && this._opts.hideFutureInReplay ? (',
    replace: '    this._cut = rp ? (',
  },
  // ------------------------------------------------------------ naked POC --
  {
    name: 'An extended POC ignores the bar that traded through it',
    file: VP,
    find: '      const to = t >= 0 ? ts.x(t) : right',
    replace: '      const to = right',
  },
  {
    name: 'An extended POC is checked against the future under replay',
    file: VP,
    find: '    const sessions = this._data.sessions\n    const bars = host.bars\n    const ts = host.ts\n    const right = r.x + r.w\n    ctx.lineWidth = 1',
    replace: '    const sessions = this._data.sessions\n    const bars = host.source\n    const ts = host.ts\n    const right = r.x + r.w\n    ctx.lineWidth = 1',
  },
  {
    name: 'A naked POC never re-checks the forming bar',
    file: VP,
    find: '      s.scan = Math.max(from, bars.length - 1)',
    replace: '      s.scan = Math.max(from, bars.length)',
  },
  {
    name: 'A replay scrubbed back keeps a POC touch from the future',
    file: VP,
    find: '    if (m < this._revealN) {',
    replace: '    if (false) {',
  },
  {
    name: 'A bar inside the session ends its own POC extension',
    file: VP,
    find: '        s.touch = -1\n        s.scan = Math.floor(s.u1) + 1\n      }\n      k.rp = rp',
    replace: '        s.touch = -1\n        s.scan = 0\n      }\n      k.rp = rp',
  },
  {
    name: 'A session scrolled off to the left loses its POC extension',
    file: VP,
    find: '      if (!s.on || s.end >= this._cut || s.poc === null) continue\n      const from = s.vis ? s.xr : spanRight(ts, s.u1)',
    replace: '      if (!s.vis || s.poc === null) continue\n      const from = s.vis ? s.xr : spanRight(ts, s.u1)',
  },
  // ---------------------------------------------------------------- hover --
  {
    name: 'Hovering a bin changes the cursor and occludes what is under the pointer',
    file: VP,
    find: '    if (this._test(e.x, e.y)) {\n      this._host.invalidate()\n      this._emitHover()\n    }\n    return null',
    replace: "    if (this._test(e.x, e.y)) {\n      this._host.invalidate()\n      this._emitHover()\n    }\n    return this._hovS ? { cursor: 'pointer' } : null",
  },
  {
    name: 'A newly hovered bin is not repainted',
    file: VP,
    find: '    if (this._test(e.x, e.y)) {\n      this._host.invalidate()\n',
    replace: '    if (this._test(e.x, e.y)) {\n',
  },
  {
    name: 'A pointer that left keeps its bin highlighted and unannounced',
    file: VP,
    find: '      if (this._hovS) {\n        this._hovS = null\n        this._host.invalidate()\n        this._emitHover()\n      }',
    replace: '',
  },
  {
    name: 'A hover found during a frame is announced before the candles are drawn',
    file: VP,
    find: '    if (this._test(this._px, this._py)) this._pending = true',
    replace: '    if (this._test(this._px, this._py)) this._emitHover()',
  },
  {
    name: 'The hovered bin is not re-tested when the data changes under a still pointer',
    file: VP,
    find: '    if (!this._host || !this._hasPtr || !(info.full || this._retest)) return',
    replace: '    if (!this._host || !this._hasPtr || !info.full) return',
  },
  {
    name: 'The hovered bin is not re-tested when the view moves under a still pointer',
    file: VP,
    find: '    if (!this._host || !this._hasPtr || !(info.full || this._retest)) return',
    replace: '    if (!this._host || !this._hasPtr || !this._retest) return',
  },
  {
    name: 'A point in the volume strip, under the clip, hits a bin',
    file: VP,
    find: '    if (y > this._clipBottom(host, r)) return\n',
    replace: '',
  },
  {
    name: 'A point past the end of a bar still hits its bin',
    file: VP,
    find: '      if (x > Math.round(xl) + barLength(s.bins[i], s.max, this._opts.width * (xr - xl))) continue\n',
    replace: '',
  },
  {
    name: 'A bin with no volume is reported as hovered',
    file: VP,
    find: '      if (i < 0 || !(s.bins[i] > 0)) continue',
    replace: '      if (i < 0) continue',
  },
  {
    name: 'Moving inside one bin fires hover again and again',
    file: VP,
    find: '    if (this._hitS === this._hovS && this._hitI === this._hovI) return false',
    replace: '    if (!this._hitS && !this._hovS) return false',
  },
  {
    name: 'pct is a fraction, not a percentage',
    file: VP,
    find: '        pct: s.total > 0 ? (s.bins[i] / s.total) * 100 : 0,',
    replace: '        pct: s.total > 0 ? s.bins[i] / s.total : 0,',
  },
  {
    name: 'Every hovered bin claims to be in the value area',
    file: VP,
    find: '        inValueArea: i >= s.vaFrom && i <= s.vaTo,',
    replace: '        inValueArea: true,',
  },
  {
    name: 'The hover payload hands back the internal session, not the host\'s',
    file: VP,
    find: '        session: s.raw,',
    replace: '        session: s,',
  },
  {
    name: 'A throwing hover listener stops the ones after it',
    file: VP,
    find: "      try { fn(payload) } catch (err) { if (this._host) this._host.reportError(err, 'hover listener') }",
    replace: '      fn(payload)',
  },
]
