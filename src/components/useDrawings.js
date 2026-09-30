import { useEffect, useState } from 'react'

/**
 * The controller's four STATE events as React state.
 *
 * `tool`, `history`, `select` and `box` are state events: each one is
 * delivered once on subscribe with the current value and then only when it
 * changes, so nothing here polls and nothing can start out stale. That is the
 * whole reason the toolbar, the rail highlight and the undo buttons can be
 * plain renders of these values.
 *
 * `box` is deliberately NOT in this hook. It fires from the chart's own frame
 * whenever the selected drawing's painted box moves half a pixel, which during
 * a pan is every frame; going through setState would land the toolbar one
 * frame behind the drawing it follows. SelectionToolbar subscribes to it
 * directly and moves its own element in the same callback.
 *
 * The selected drawing is re-read on `change` as well as on `select`,
 * because a style edit changes the drawing without changing the selection.
 */
export function useDrawings(dc) {
  const [tool, setTool] = useState({ tool: null, sticky: false })
  const [history, setHistory] = useState({ canUndo: false, canRedo: false, undoSize: 0, redoSize: 0 })
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!dc) return undefined
    let selId = null
    const offs = [
      dc.subscribe('tool', setTool),
      dc.subscribe('history', setHistory),
      dc.subscribe('select', (p) => {
        selId = p.ids.length ? p.ids[0] : null
        setSelected(p.drawings.length ? p.drawings[0] : null)
      }),
      dc.subscribe('change', () => {
        if (selId) setSelected(dc.get(selId))
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [dc])

  return { tool, history, selected }
}
