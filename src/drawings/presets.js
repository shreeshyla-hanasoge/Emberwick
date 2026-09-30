/**
 * The tool rail: 14 presets over 9 stored types (§4.1).
 *
 * A preset is a stored TYPE plus the options it starts with. Variants share
 * a type on purpose: a ray is a trendline whose `extend` is 'right', so a
 * reader can turn a ray back into a segment after drawing it, and a host
 * stores one kind of row for both. Nothing here is ever written into a
 * drawing except through its options, so renaming a label or regrouping the
 * rail never touches saved data.
 *
 * `label` and `group` exist for host toolbars (the Playground's rail reads
 * them); the controller only reads `type` and `options`.
 */
const preset = (type, label, group, options) =>
  Object.freeze(options ? { type, options: Object.freeze(options), label, group } : { type, label, group })

export const TOOL_PRESETS = Object.freeze({
  trendLine: preset('trendLine', 'Trend line', 'lines'),
  ray: preset('trendLine', 'Ray', 'lines', { extend: 'right' }),
  extendedLine: preset('trendLine', 'Extended line', 'lines', { extend: 'both' }),
  arrow: preset('trendLine', 'Arrow', 'lines', { endCap: 'arrow' }),
  horizontalLine: preset('horizontalLine', 'Horizontal line', 'lines'),
  horizontalRay: preset('horizontalLine', 'Horizontal ray', 'lines', { extend: 'right' }),
  verticalLine: preset('verticalLine', 'Vertical line', 'lines'),
  rectangle: preset('rectangle', 'Rectangle', 'shapes'),
  parallelChannel: preset('parallelChannel', 'Parallel channel', 'shapes'),
  fibRetracement: preset('fibRetracement', 'Fib retracement', 'fibonacci'),
  measure: preset('measure', 'Measure', 'measure'),
  long: preset('position', 'Long position', 'measure', { side: 'long' }),
  short: preset('position', 'Short position', 'measure', { side: 'short' }),
  text: preset('text', 'Text', 'annotation'),
})

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * Resolve what setTool() was given — a preset name, or the type of any
 * registered tool (a custom ToolDef has no preset) — to `{ type, preset,
 * options }`, or null when it names nothing this controller can draw. A
 * preset whose type is not registered (createDrawings with a subset of the
 * tools) resolves to null too: arming a tool that cannot create would leave
 * the reader clicking at nothing.
 */
export function resolvePreset(name, registry) {
  if (typeof name !== 'string' || !name) return null
  if (own(TOOL_PRESETS, name)) {
    const p = TOOL_PRESETS[name]
    if (!registry.has(p.type)) return null
    return { type: p.type, preset: name, options: p.options ? Object.assign({}, p.options) : {} }
  }
  if (registry.has(name)) return { type: name, preset: name, options: {} }
  return null
}
