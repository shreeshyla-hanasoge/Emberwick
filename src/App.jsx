import React, { useEffect, useRef, useState } from 'react'
import Landing from './pages/Landing.jsx'
import Playground from './pages/Playground.jsx'

/**
 * Two views, switched on the hash — deliberately no router dependency.
 *
 *   #/            -> landing page (scrolls)
 *   #/playground  -> full-viewport chart demo (locked, no page scroll)
 *
 * The previous contents of this file are now src/pages/Playground.jsx.
 */
function currentView() {
  return window.location.hash.replace(/^#\/?/, '') === 'playground'
    ? 'playground'
    : 'landing'
}

export default function App() {
  const [view, setView] = useState(currentView)
  const viewRef = useRef(view)

  useEffect(() => {
    const onHash = () => {
      const next = currentView()
      // Only reset the scroll when the VIEW changes. Every in-page anchor —
      // #panes, #series, the whole nav — is also a hashchange, and resetting
      // on those meant the browser jumped to the section and this handler
      // immediately yanked it back to the top. The nav silently did nothing.
      if (next === viewRef.current) return
      viewRef.current = next
      setView(next)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // The playground fills the viewport and owns its own scrolling; the landing
  // page needs the document to scroll normally.
  useEffect(() => {
    document.body.classList.toggle('lock', view === 'playground')
    return () => document.body.classList.remove('lock')
  }, [view])

  return view === 'playground' ? <Playground /> : <Landing />
}
