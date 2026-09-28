'use client'
import { useEffect } from 'react'

// Rendered only while the listing page is showing a purchase outcome
// (pending / not enough credits / failed). Brings that message into view:
// the redirect after tapping Purchase can land at the top of the page —
// the layout's ScrollToTop resets scroll on a fresh load, and server-action
// redirects drop any #hash — leaving the message below the fold. The
// timeout lets this run after ScrollToTop's own reset.
export default function ScrollToPurchaseStatus() {
  useEffect(() => {
    const t = setTimeout(() => {
      document.getElementById('purchase-status')?.scrollIntoView({ block: 'center' })
    }, 0)
    return () => clearTimeout(t)
  }, [])
  return null
}
