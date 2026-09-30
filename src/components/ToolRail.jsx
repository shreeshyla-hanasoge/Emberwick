import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { TOOL_PRESETS } from '../drawings/index.js'
import { Icon } from './Icons.jsx'

const GROUP_LABEL = {
  lines: 'Lines',
  shapes: 'Shapes',
  fibonacci: 'Fibonacci',
  measure: 'Measure and positions',
  annotation: 'Text',
}

/**
 * The tool rail. It is read off TOOL_PRESETS rather than written out, so it is
 * truthful by construction: a preset the library adds shows up here, a preset
 * it drops disappears, and the group and the label are the library's own.
 *
 * The highlight is the `tool` state event's payload (`tool.tool`), not a local
 * "which button did I press" flag, so it is right when the tool is disarmed by
 * Esc, by a finished non-sticky drawing, or by an API call. It is one pill that
 * slides between buttons instead of a background painted on each, because a
 * pill that travels reads as "the tool moved" and that is what actually
 * happened.
 *
 * `sticky` is the reader's preference, kept by the host: the `tool` event only
 * reports stickiness for an ARMED tool, so it cannot remember the choice across
 * a disarm. `names` narrows the rail (the landing page shows six).
 *
 * `labels` puts a word under each glyph: `true` uses the library's own preset
 * labels, an object maps a preset name to a shorter one (and 'cursor' too).
 * The pill measures the button it lands on instead of assuming a square, so
 * it fits either way, and it is re-measured when the rail resizes (a webfont
 * arriving, the labels being hidden at a narrow width).
 */
export default function ToolRail({ dc, tool, sticky = false, names, orientation = 'vertical', labels = false, className = '' }) {
  const active = tool.tool || 'cursor'
  const btn = useRef({})
  const pill = useRef(null)
  const inner_ = useRef(null)
  const [tip, setTip] = useState(null)

  const groups = useMemo(() => {
    const out = []
    for (const [name, p] of Object.entries(TOOL_PRESETS)) {
      if (names && !names.includes(name)) continue
      let g = out.length && out[out.length - 1].id === p.group ? out[out.length - 1] : null
      if (!g) out.push((g = { id: p.group, items: [] }))
      g.items.push({ name, label: p.label })
    }
    if (names) out.forEach((g) => g.items.sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name)))
    return out
  }, [names])

  const seat = useCallback(() => {
    const el = btn.current[active]
    const p = pill.current
    if (!p) return
    if (!el) { p.style.opacity = '0'; return }
    p.style.width = `${el.offsetWidth}px`
    p.style.height = `${el.offsetHeight}px`
    p.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`
    p.style.opacity = '1'
  }, [active])

  // Layout effect: the pill has to be at the new button before the browser
  // paints, or the first frame shows it on the old one and it slides from there.
  useLayoutEffect(seat, [seat, orientation, groups, labels])

  // Buttons change size without `active` changing (labels hide at a narrow
  // width, a font arrives), and the pill would be left at the old size.
  useEffect(() => {
    const inner = inner_.current
    if (!inner || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => seat())
    ro.observe(inner)
    return () => ro.disconnect()
  }, [seat])

  const pick = (name) => {
    if (!dc) return
    // A second press on the armed tool puts it down, as the cursor button does.
    dc.setTool(name === 'cursor' || name === active ? null : name, { sticky })
  }

  const showTip = (e, label) => {
    const r = e.currentTarget.getBoundingClientRect()
    setTip(
      orientation === 'vertical'
        ? { label, x: r.right + 10, y: r.top + r.height / 2, side: 'right' }
        : { label, x: r.left + r.width / 2, y: r.bottom + 8, side: 'below' },
    )
  }

  const word = (name, label) => (labels && typeof labels === 'object' && labels[name]) || label

  const button = (name, label, icon = name) => (
    <button
      key={name}
      type="button"
      ref={(el) => { btn.current[name] = el }}
      className={`rail-btn${active === name ? ' on' : ''}${active === name && tool.sticky && name !== 'cursor' ? ' sticky' : ''}`}
      aria-label={label}
      aria-pressed={active === name}
      onClick={() => pick(name)}
      onMouseEnter={(e) => showTip(e, label)}
      onMouseLeave={() => setTip(null)}
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && showTip(e, label)}
      onBlur={() => setTip(null)}
    >
      <Icon name={icon} size={19} />
      {labels && <span className="rail-lbl" aria-hidden="true">{word(name, name === 'cursor' ? 'Select' : label)}</span>}
    </button>
  )

  return (
    <nav
      className={`rail rail-${orientation}${labels ? ' rail-labeled' : ''}${className ? ` ${className}` : ''}`}
      aria-label="Drawing tools"
      onScroll={() => setTip(null)}
    >
      <div className="rail-inner" ref={inner_}>
        <span className="rail-pill" ref={pill} aria-hidden="true" />
        {button('cursor', 'Cursor: select and pan')}
        {groups.map((g) => (
          <React.Fragment key={g.id}>
            <span className="rail-sep" role="separator" aria-label={GROUP_LABEL[g.id] || g.id} />
            {g.items.map((it) => button(it.name, it.label))}
          </React.Fragment>
        ))}
      </div>
      {tip && (
        <span className={`rail-tip rail-tip-${tip.side}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
          {tip.label}
        </span>
      )}
    </nav>
  )
}
