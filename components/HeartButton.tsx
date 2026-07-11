'use client'

import { useState } from 'react'

export default function HeartButton({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [saved, setSaved] = useState(false)

  return (
    <button
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        if (!isLoggedIn) {
          window.location.href = '/auth/signin?redirect=' + window.location.pathname
          return
        }
        setSaved(s => !s)
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
