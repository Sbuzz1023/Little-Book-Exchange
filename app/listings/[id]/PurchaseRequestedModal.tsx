'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

// Shown once, right after a purchase request goes through (?requested=1), so
// the buyer knows where the exchange lives from here: Dashboard → Exchanges.
export default function PurchaseRequestedModal({ sellerName }: { sellerName: string }) {
  const [open, setOpen] = useState(true)
  const primaryRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!open) return
    primaryRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="ld-modal-backdrop"
      data-testid="purchase-modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="ld-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-modal-title">
        <div className="ld-modal-icon" aria-hidden="true">📚</div>
        <h2 id="purchase-modal-title" className="ld-modal-title">Purchase request sent</h2>
        <p className="ld-modal-text">
          We&apos;ve let <strong>{sellerName}</strong> know. Your books are managed in your
          Dashboard&apos;s <strong>Exchanges tab</strong> — that&apos;s where you&apos;ll see when
          they confirm, arrange pickup, and confirm you got the book.
        </p>
        <div className="ld-modal-actions">
          <Link ref={primaryRef} href="/profile?tab=exchanges" className="btn btn-primary">Go to Exchanges</Link>
          <Link href="/listings" className="btn btn-outline">Back to Browse</Link>
        </div>
      </div>
    </div>
  )
}
