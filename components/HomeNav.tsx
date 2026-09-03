'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { avatarInitials } from '@/lib/avatarInitials'

function LeafMark() {
  return (
    <svg className="mark" viewBox="0 0 34 34" fill="none" aria-hidden="true">
      <path d="M17 31 C17 21 17 15 17 6" stroke="#234A40" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M17 16 C11.5 16 7.5 12.5 6.5 6 C13 5 17 9.5 17 16 Z" fill="#6E7B3E" />
      <path d="M17 21 C22.5 21 26.5 17.5 27.5 11 C21 10 17 14.5 17 21 Z" fill="#234A40" />
      <path d="M17 11.5 C20.5 11.5 23 9.5 24 5 C19.5 4.3 17 7 17 11.5 Z" fill="#E4B04A" />
    </svg>
  )
}

export default function HomeNav({
  userName,
  isAdmin,
  unreadCount = 0,
}: {
  userName?: string | null
  isAdmin?: boolean
  unreadCount?: number
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [pathname])

  const signedIn = !!userName

  const links = signedIn ? (
    <>
      <Link href="/listings">Browse</Link>
      <Link href="/post">Post a Book</Link>
      <Link href="/locations">Libraries</Link>
      <Link href="/profile">
        Dashboard
        {unreadCount > 0 && <span className="hnav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </Link>
    </>
  ) : (
    <>
      <Link href="/listings">Browse</Link>
      <Link href="/post">Post a Book</Link>
      <Link href="/auth/signin">Sign In</Link>
    </>
  )

  return (
    <header className={`hnav${open ? ' is-open' : ''}`}>
      <div className="hnav-inner">
        <Link href="/" className="hnav-brand" aria-label="Little Book Exchange home">
          <LeafMark />
          <span className="name">Little Book Exchange</span>
        </Link>

        <nav className="hnav-links">
          {links}
          {signedIn ? (
            <Link href="/profile" className="hnav-avatar" aria-label="Your dashboard">
              {avatarInitials(userName!)}
            </Link>
          ) : (
            <Link href="/auth/signup" className="hnav-cta">Sign Up</Link>
          )}
        </nav>

        <button
          className="hnav-toggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          <span /><span /><span />
        </button>
      </div>

      <div className="hnav-mobile">
        <Link href="/listings">Browse</Link>
        <Link href="/post">Post a Book</Link>
        {signedIn ? (
          <>
            <Link href="/locations">Libraries</Link>
            <Link href="/profile">Dashboard</Link>
            {isAdmin && <Link href="/admin">Admin Panel</Link>}
            <a href="/auth/signout" onClick={() => { try { localStorage.removeItem('lbe_demo_user') } catch {} }}>Sign Out</a>
          </>
        ) : (
          <>
            <Link href="/auth/signin">Sign In</Link>
            <Link href="/auth/signup">Sign Up</Link>
          </>
        )}
      </div>
    </header>
  )
}
