'use client'

import { useState } from 'react'
import { saveListing, unsaveListing } from '@/lib/actions/savedListings'

export default function HeartButton({
  listingId,
  isLoggedIn,
  initialSaved,
}: {
  listingId: string
  isLoggedIn: boolean
  initialSaved: boolean
}) {
  const [saved, setSaved] = useState(initialSaved)

  return (
    <button
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        if (!isLoggedIn) {
          window.location.href = '/auth/signin?redirect=' + window.location.pathname
          return
        }
        const next = !saved
        setSaved(next)
        const action = next
          ? saveListing(listingId, window.location.pathname)
          : unsaveListing(listingId, window.location.pathname)
        action.catch(() => setSaved(!next))
      }}
      className="absolute flex items-center justify-center transition-transform hover:scale-110"
      style={{
        top: 8, left: 8,
        width: 28, height: 28,
        borderRadius: '50%',
        border: 'none',
        background: saved ? '#fff0f3' : 'rgba(255,255,255,0.92)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        cursor: 'pointer',
        zIndex: 2,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={saved ? '#f87171' : 'none'} stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  )
}
