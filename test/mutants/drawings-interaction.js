/**
 * Mutants for unit C, the drawing interaction layer (spec §9.4).
 *
 * Each one is a single, plausible regression — the kind of one-line "cleanup"
 * that reads fine in review and breaks a real gesture. The suite must fail on
 * every one of them. `find` must occur exactly once in `file`; `file` is
 * repo-relative. Tests may read only files under src/ and test/.
 *
 * Re-anchored against the spec's table (same text, different indent), because
 * the code around them nests one level less than the spec assumed:
 *   - "Quick measure enters the document" (6-space indent);
 *   - "A text draft is committed before it has text" (2-space indent).
 */
export const MUTANTS = [
  {
    name: 'A finger drags a drawing it never selected',
    file: 'src/drawings/interaction/machine.js',
    find: '    if (touch && !selected) return unclaimed(s)',
    replace: '',
  },
  {
    name: 'A finger inside a selected box drags it instead of panning',
    file: 'src/drawings/interaction/machine.js',
    find: "    if (touch && hit.part === 'fill') return unclaimed(s)",
    replace: '',
  },
  {
    name: 'A locked drawing becomes a dead zone for the mouse',
    file: 'src/drawings/interaction/machine.js',
    find: '    if (hit.locked) return unclaimed(s)',
    replace: '',
  },
  {
    name: 'A deselect tap drops a crosshair on touch',
    file: 'src/drawings/interaction/machine.js',
    find: '    return { state: s1, effects, result: touch }',
    replace: '    return { state: s1, effects, result: false }',
  },
  {
    name: 'Esc during a drag keeps the half-dragged points',
    file: 'src/drawings/interaction/machine.js',
    find: "      effects.push({ type: 'revert' })",
    replace: '',
  },
  {
    name: 'An aborted drag keeps its press',
    file: 'src/drawings/interaction/machine.js',
    find: "      effects.push({ type: 'release' })",
    replace: '',
  },
  {
    name: 'Undo during a drag pops history',
    file: 'src/drawings/interaction/machine.js',
    find: '    if (isDragging(s)) return cancelGesture(s)',
    replace: '',
  },
  {
    name: 'Quick measure enters the document',
    file: 'src/drawings/interaction/machine.js',
    find: '      ephemeral: true,',
    replace: '      ephemeral: false,',
  },
  {
    name: 'Quick measure vanishes when the mouse leaves',
    file: 'src/drawings/interaction/machine.js',
    find: "    if (ev.reason !== 'pan') return same(s)",
    replace: '',
  },
  {
    name: 'Every pinch while armed flashes a ripple',
    file: 'src/drawings/interaction/machine.js',
    find: "    latent: e.pointerType === 'touch',",
    replace: '    latent: false,',
  },
  {
    name: 'A sticky double-click makes two drawings',
    file: 'src/drawings/interaction/machine.js',
    find: '    if (isRepeatPress(s.lastCreate, e, env)) return claimedNoop(s)',
    replace: '',
  },
  {
    name: 'A text draft is committed before it has text',
    file: 'src/drawings/interaction/machine.js',
    find: "  if (spec.type === 'text' && env.textEditor) return openDraft(s, spec, points)",
    replace: '',
  },
  {
    name: 'A press on another drawing is lost while editing',
    file: 'src/drawings/interaction/machine.js',
    find: '    if (isEditing(s)) return redispatch(commitEditor(s), ev, env)',
    replace: '',
  },
  {
    name: 'The preview drifts off a still mouse while the view eases',
    file: 'src/drawings/interaction/machine.js',
    find: "    if (s.name === 'ARMED' && s.ptr) return hoverFrom(s, s.ptr, env)",
    replace: '',
  },
  {
    name: 'The 0° constraint round-trips the price through y',
    file: 'src/drawings/interaction/snap.js',
    find: '      price = origin.price',
    replace: '      price = input.pane.ps.price(y)',
  },
  {
    name: 'Snapping to an anchor copies it approximately',
    file: 'src/drawings/interaction/snap.js',
    find: '    return exactCopy(hit.point)',
    replace: '    return pointFromIndex(env.host.source, Math.round(hit.u), hit.point.price, env.ctx.tf)',
  },
  {
    name: 'The magnet reads a bar the replay has not revealed',
    file: 'src/drawings/interaction/snap.js',
    find: '  if (slot < 0 || slot > env.host.bars.length - 1) return null',
    replace: '',
  },
  {
    name: 'Snap hysteresis removed',
    file: 'src/drawings/interaction/snap.js',
    find: '  const r = prev && prev.kind === kind ? radius * 1.5 : radius',
    replace: '  const r = radius',
  },
  {
    name: 'Touch uses the mouse hit radius',
    file: 'src/drawings/interaction/tolerance.js',
    find: '  touch: { line: 14, handle: 22,',
    replace: '  touch: { line: 5, handle: 8,',
  },
  {
    name: 'Hidden drawings are hittable',
    file: 'src/drawings/interaction/hit.js',
    find: '    if (!s.d.visible || !s.pane || s.inert) continue',
    replace: '    if (s.inert) continue',
  },
  {
    name: 'A translucent box hides the line under it',
    file: 'src/drawings/interaction/hit.js',
    find: "    if (best && best.part === 'fill' && h.part !== 'fill') best = null",
    replace: '',
  },
  {
    name: 'A far-off anchor hands the canvas an unbounded coordinate',
    file: 'src/drawings/interaction/hit.js',
    find: '  if (t0 > t1) return false',
    replace: '  if (false) return false',
  },
  {
    name: 'IME composition commits text',
    file: 'src/drawings/interaction/textEditor.js',
    find: "      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {",
    replace: "      if (e.key === 'Enter' && !e.shiftKey) {",
  },
  {
    name: 'The iPhone keyboard never opens',
    file: 'src/drawings/interaction/textEditor.js',
    find: '  ta.focus()',
    replace: '  setTimeout(() => ta.focus(), 0)',
  },
  {
    name: 'The followed point gets a second axis tag while placing',
    file: 'src/drawings/interaction/machine.js',
    find: "    effects: [previewFx(s1, s.points.concat([sn.point]), sn), { type: 'crosshair', s: sn, tags: false }, { type: 'cursor', css: 'crosshair' }],",
    replace: "    effects: [previewFx(s1, s.points.concat([sn.point]), sn), { type: 'crosshair', s: sn }, { type: 'cursor', css: 'crosshair' }],",
  },
  {
    name: 'The first press of a drawing gets a second axis tag',
    file: 'src/drawings/interaction/machine.js',
    find: "  const s2 = placed(s1, sn)\n  return consumed(s2, [\n    { type: 'claim' },\n    previewFx(s2, s2.points, sn),\n    { type: 'crosshair', s: sn, tags: false },",
    replace: "  const s2 = placed(s1, sn)\n  return consumed(s2, [\n    { type: 'claim' },\n    previewFx(s2, s2.points, sn),\n    { type: 'crosshair', s: sn },",
  },
  {
    name: 'The second click of a drawing gets a second axis tag',
    file: 'src/drawings/interaction/machine.js',
    find: "  const s2 = placed(beginPress(s, e, s.paneId, true), sn)\n  return consumed(s2, [\n    { type: 'claim' },\n    previewFx(s2, s2.points, sn),\n    { type: 'crosshair', s: sn, tags: false },",
    replace: "  const s2 = placed(beginPress(s, e, s.paneId, true), sn)\n  return consumed(s2, [\n    { type: 'claim' },\n    previewFx(s2, s2.points, sn),\n    { type: 'crosshair', s: sn },",
  },
  {
    name: "A channel's baseline end gets a second axis tag",
    file: 'src/drawings/interaction/machine.js',
    find: "  if (e.pointerType !== 'touch') effects.push({ type: 'crosshair', s: sn, tags: false })",
    replace: "  if (e.pointerType !== 'touch') effects.push({ type: 'crosshair', s: sn })",
  },
  {
    name: 'A snap does not report its unsnapped end (a glide falls back to across frames)',
    file: 'src/drawings/interaction/snap.js',
    find: '    u0: free ? ts.index(x) : slot, price0: ps.price(y),',
    replace: '    u0: u, price0: price,',
  },
]
