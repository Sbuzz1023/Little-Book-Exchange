'use client'
import { useState } from 'react'

export default function SaveButton({ listingId, isLoggedIn }: { listingId: string; isLoggedIn: boolean }) {
  const [saved, setSaved] = useState(false)

  function toggle() {
    if (!isLoggedIn) {
      window.location.href = '/auth/signin?redirect=' + window.location.pathname
      return
    }
    setSaved(s => !s)
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 font-extrabold text-base transition-all"
      style={{
        padding: '14px 24px',
        borderRadius: 999,
        border: saved ? '2.5px solid #f43f5e' : '2.5px solid #fda4af',
        background: saved ? '#fff0f3' : '#fff',
        color: '#f43f5e',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={saved ? '#f43f5e' : 'none'}
        stroke="#f43f5e"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {saved ? 'Saved ✓' : 'Save'}
    </button>
  )
}
