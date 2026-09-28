'use client'
import { useEffect, useState } from 'react'

// True while the viewport matches `query`. Starts false (matching the
// server render) and updates after mount and on every viewport change.
export function useIsMobile(query = '(max-width: 899px)'): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(query)
    setMatches(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}
