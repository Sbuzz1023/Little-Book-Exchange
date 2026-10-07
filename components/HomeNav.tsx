'use client'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { avatarInitials } from '@/lib/avatarInitials'
import CreditCoinShow from './CreditCoinShow'
import { planCreditShow, demoUnseenCredits, type UnseenCredit } from '@/lib/creditShow'

function clearDemoUser() {
  try { localStorage.removeItem('lbe_demo_user') } catch {}
}

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

// Mobile bottom tab bar icons (24×24 line icons, stroked in currentColor).
const TAB_ICONS = {
  browse: <><path d="M2 5h6.5A3.5 3.5 0 0 1 12 8.5V20a2.5 2.5 0 0 0-2.5-2.5H2z" /><path d="M22 5h-6.5A3.5 3.5 0 0 0 12 8.5V20a2.5 2.5 0 0 1 2.5-2.5H22z" /></>,
  post: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  trail: <><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" /></>,
  signin: <><path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" /><path d="M10 16l4-4-4-4M14 12H4" /></>,
}

// Shows that have started this page session, by plan.seenUpTo. Module-level
// because HomeNav unmounts on classic-nav pages (admin, seller reviews) while
// the root layout — and so unseenCredits — isn't re-rendered on client-side
// navigation; without this, coming back would replay the show.
const startedCreditShows = new Set<string>()

export default function HomeNav({
  userName,
  isAdmin,
  unreadCount = 0,
  credits,
  unseenCredits,
}: {
  userName?: string | null
  isAdmin?: boolean
  unreadCount?: number
  credits?: number | null
  unseenCredits?: UnseenCredit[]
}) {
  const pathname = usePathname()
  const avatarRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (avatarRef.current) avatarRef.current.open = false
  }, [pathname])

  const signedIn = !!userName

  // Demo mode has no ledger; ?coin_demo=earn|spend|both|bundle previews the
  // show, and a demo pickup adds coin_demo_at so each press is a new show.
  // Read during render (not in an effect) so the pill starts on the show's
  // starting balance with no flash of the final one.
  const searchParams = useSearchParams()
  const coinDemo = searchParams?.get('coin_demo') ?? null
  const coinDemoAt = Number(searchParams?.get('coin_demo_at')) || undefined
  const coinDemoTitle = searchParams?.get('coin_demo_title') ?? undefined
  const demoCredits = useMemo(
    () => (process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ? [] : demoUnseenCredits(coinDemo, coinDemoAt, coinDemoTitle)),
    [coinDemo, coinDemoAt, coinDemoTitle],
  )
  const isDemo = demoCredits.length > 0
  const rows = isDemo ? demoCredits : unseenCredits

  // The coin show for credits the user hasn't seen yet. Keyed by seenUpTo so
  // the same rows arriving again (another render, router.refresh) don't
  // restart a show that already played or was skipped.
  const plan = useMemo(
    () => (signedIn && credits != null && rows?.length ? planCreditShow(rows, credits) : null),
    [signedIn, credits, rows],
  )
  const [doneKey, setDoneKey] = useState<string | null>(null)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [shownBalance, setShownBalance] = useState<number | null>(null)
  const showing = !!plan && doneKey !== plan.seenUpTo
    && (activeKey === plan.seenUpTo || !startedCreditShows.has(plan.seenUpTo))
  useEffect(() => {
    if (!showing || activeKey === plan!.seenUpTo) return
    startedCreditShows.add(plan!.seenUpTo)
    setActiveKey(plan!.seenUpTo)
  }, [showing, activeKey, plan])
  const pillBalance = showing ? (shownBalance ?? plan!.startBalance) : credits
  const badge = unreadCount > 0 && <span className="hnav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>

  const links = signedIn ? (
    <>
      <Link href="/listings">Browse</Link>
      <Link href="/post">Post a Book</Link>
      <Link href="/locations">Reading Trail</Link>
      <Link href="/profile">
        Dashboard
        {badge}
      </Link>
    </>
  ) : (
    <>
      <Link href="/listings">Browse</Link>
      <Link href="/post">Post a Book</Link>
      <Link href="/auth/signin">Sign In</Link>
    </>
  )

  const tabs: { href: string; label: string; icon: keyof typeof TAB_ICONS; section: string }[] = [
    { href: '/listings', label: 'Browse', icon: 'browse', section: '/listings' },
    { href: '/post', label: 'Post', icon: 'post', section: '/post' },
    { href: '/locations', label: 'Trail', icon: 'trail', section: '/locations' },
    signedIn
      ? { href: '/profile', label: 'Dashboard', icon: 'dashboard', section: '/profile' }
      : { href: '/auth/signin', label: 'Sign In', icon: 'signin', section: '/auth' },
  ]
  const isCurrent = (section: string) => pathname === section || !!pathname?.startsWith(section + '/')

  return (
    <>
      <header className="hnav">
        <div className="hnav-inner">
          <Link href="/" className="hnav-brand" aria-label="Little Book Exchange home">
            <LeafMark />
            <span className="name">Little Book Exchange</span>
          </Link>

          {/* On mobile only the account control (avatar / Sign Up) stays up
              here; the page links move to the bottom tab bar. */}
          <nav className="hnav-links">
            {links}
            {signedIn && credits != null && (
              <Link
                href="/profile?tab=wallet"
                className="hnav-credits"
                aria-label={`${pillBalance} ${pillBalance === 1 ? 'credit' : 'credits'}`}
                title="Your credits"
              >
                <img className="hnav-coin" src="/home/credit-coin-small.png" alt="" width={18} height={18} />
                {pillBalance}
              </Link>
            )}
            {signedIn ? (
              <details ref={avatarRef} className="hnav-avatar-menu">
                <summary className="hnav-avatar" aria-label="Account menu">
                  {avatarInitials(userName!)}
                </summary>
                <div className="hnav-avatar-panel">
                  <div className="hnav-avatar-name">{userName}</div>
                  {isAdmin && <Link href="/admin">Admin Panel</Link>}
                  <a href="/auth/signout" onClick={clearDemoUser}>Sign Out</a>
                </div>
              </details>
            ) : (
              <Link href="/auth/signup" className="hnav-cta">Sign Up</Link>
            )}
          </nav>
        </div>
      </header>

      {/* Mobile bottom tab bar (hidden on desktop via CSS). Rendered outside
          <header> because the header's backdrop-filter would otherwise make
          it the containing block for position:fixed. */}
      <nav className="hnav-tabs" aria-label="Tabs">
        {tabs.map(t => (
          <Link key={t.href} href={t.href} aria-current={isCurrent(t.section) ? 'page' : undefined}>
            <span className="hnav-tab-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">{TAB_ICONS[t.icon]}</svg>
              {t.icon === 'dashboard' && badge}
            </span>
            {t.label}
          </Link>
        ))}
      </nav>

      {showing && (
        <CreditCoinShow
          key={plan!.seenUpTo}
          plan={plan!}
          persist={!isDemo}
          onBalance={setShownBalance}
          onDone={() => { setDoneKey(plan!.seenUpTo); setShownBalance(null) }}
        />
      )}
    </>
  )
}
