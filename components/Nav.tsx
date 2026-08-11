'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { avatarInitials } from '@/lib/avatarInitials'

function readDemoUser(): string | null {
  if (typeof document === 'undefined') return null
  // Check cookie first
  const match = document.cookie.match(/(?:^|; )lbe_demo_user=([^;]*)/)
  const cookieVal = match ? decodeURIComponent(match[1]) : null
  if (cookieVal) {
    // Sync to localStorage as backup in case cookie gets cleared
    try { localStorage.setItem('lbe_demo_user', cookieVal) } catch {}
    return cookieVal
  }
  // Fallback to localStorage
  try { return localStorage.getItem('lbe_demo_user') } catch { return null }
}

function clearDemoUser() {
  try { localStorage.removeItem('lbe_demo_user') } catch {}
}

function DashboardBadge({ count }: { count?: number }) {
  if (!count) return null
  return (
    <span
      data-testid="dashboard-badge"
      style={{
        marginLeft: 6, background: '#ef4444', color: '#fff', fontSize: 10, fontWeight: 900,
        borderRadius: 999, padding: '2px 6px', minWidth: 16, textAlign: 'center', display: 'inline-block',
        boxShadow: '0 2px 0 #b91c1c',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  )
}

export default function Nav({ userName: serverUserName, isAdmin, unreadCount }: { userName?: string | null; isAdmin?: boolean; unreadCount?: number }) {
  const pathname = usePathname()
  const isHome = pathname === '/'
  const [mobileOpen, setMobileOpen] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement>(null)

  const [userName, setUserName] = useState<string | null>(serverUserName ?? null)
  useEffect(() => {
    const demoUser = readDemoUser()
    setUserName(demoUser ?? serverUserName ?? null)
  }, [pathname, serverUserName])

  // Close both menus on route change
  useEffect(() => {
    setMobileOpen(false)
    if (detailsRef.current) detailsRef.current.open = false
  }, [pathname])

  return (
    <>
      <nav
        className="relative bg-white z-50 flex items-center justify-between px-5 md:px-8"
        style={{
          height: 68,
          borderBottom: isHome ? 'none' : '4px solid #f97316',
        }}
      >
        {/* Logo */}
        <Link href="/" className="font-display text-[20px] md:text-[22px] text-bk-orange flex items-center gap-2 shrink-0">
          <span className="bg-bk-orange rounded-full w-9 h-9 flex items-center justify-center text-lg shrink-0">🏡</span>
          <span className="hidden sm:inline">LittleBookExchange</span>
          <span className="sm:hidden">LBE</span>
        </Link>

        {/* Desktop links */}
        <div className="hidden md:flex items-center gap-[22px]">
          <Link href="/listings" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Browse</Link>
          <span className="w-px h-5 bg-gray-200" />
          <Link href="/post" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Post a Book</Link>

          {userName ? (
            <>
              <span className="w-px h-5 bg-gray-200" />
              <Link href="/locations" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Libraries</Link>
              <span className="w-px h-5 bg-gray-200" />
              <Link href="/profile" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors flex items-center">Dashboard<DashboardBadge count={unreadCount} /></Link>
              <span className="w-px h-5 bg-gray-200" />

              {/* Avatar dropdown — uses native <details> toggle, no JS state needed */}
              <details ref={detailsRef} style={{ position: 'relative' }}>
                <summary style={{
                  listStyle: 'none',
                  width: 38, height: 38,
                  background: '#f97316',
                  borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  fontWeight: 900, fontSize: 13, color: '#fff',
                  letterSpacing: '0.5px',
                  boxShadow: '0 3px 0 #c2410c',
                  userSelect: 'none',
                }}>
                  {avatarInitials(userName)}
                </summary>
                <div style={{
                  position: 'fixed',
                  top: 76,
                  right: 16,
                  minWidth: 180,
                  background: '#fff',
                  border: '2px solid #f3f4f6',
                  borderRadius: 16,
                  overflow: 'hidden',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.14)',
                  zIndex: 99999,
                }}>
                  <div className="px-4 py-3 font-black text-[13px] border-b-2 border-gray-100" style={{ color: '#aaa' }}>{userName}</div>
                  {isAdmin && (
                    <Link href="/admin" className="flex items-center gap-2.5 px-4 py-3 font-bold text-[14px] text-[#2d2d2d] hover:bg-[#fff7ed] hover:text-bk-orange transition-colors">🔐 Admin Panel</Link>
                  )}
                  <div style={{ borderTop: '2px solid #f3f4f6' }}>
                    <a href="/auth/signout" onClick={clearDemoUser} className="flex items-center gap-2.5 px-4 py-3 font-bold text-[14px] text-[#888] hover:bg-red-50 hover:text-red-500 transition-colors">🚪 Sign Out</a>
                  </div>
                </div>
              </details>
            </>
          ) : (
            <>
              <Link href="/auth/signin" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Sign In</Link>
              <span className="w-px h-5 bg-gray-200" />
              <Link href="/auth/signup" className="bg-bk-orange text-white px-[22px] py-[9px] rounded-full font-extrabold text-[15px] hover:bg-bk-orange-dark transition-colors">Sign Up</Link>
            </>
          )}
        </div>

        {/* Mobile right side */}
        <div className="flex md:hidden items-center gap-3">
          {userName && (
            <div
              className="flex items-center justify-center font-black text-[13px] text-white rounded-full"
              style={{ width: 34, height: 34, background: '#f97316', boxShadow: '0 2px 0 #c2410c', letterSpacing: '0.5px' }}
            >
              {avatarInitials(userName)}
            </div>
          )}
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="flex flex-col justify-center items-center gap-[5px] p-2"
            aria-label="Menu"
          >
            <span style={{ display: 'block', width: 22, height: 2.5, background: mobileOpen ? '#f97316' : '#2d2d2d', borderRadius: 2, transition: 'all 0.2s', transform: mobileOpen ? 'rotate(45deg) translate(5px, 5px)' : 'none' }} />
            <span style={{ display: 'block', width: 22, height: 2.5, background: '#2d2d2d', borderRadius: 2, transition: 'all 0.2s', opacity: mobileOpen ? 0 : 1 }} />
            <span style={{ display: 'block', width: 22, height: 2.5, background: mobileOpen ? '#f97316' : '#2d2d2d', borderRadius: 2, transition: 'all 0.2s', transform: mobileOpen ? 'rotate(-45deg) translate(5px, -5px)' : 'none' }} />
          </button>
        </div>

        {isHome && (
          <div
            className="absolute left-0 right-0"
            style={{
              bottom: -12, height: 12, zIndex: 10,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 12'%3E%3Cpath d='M0,6 Q15,0 30,6 Q45,12 60,6 Q75,0 90,6 Q105,12 120,6 L120,12 L0,12Z' fill='%23f97316'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'repeat-x',
              backgroundSize: '120px 12px',
            }}
          />
        )}
      </nav>

      {/* Mobile menu dropdown */}
      {mobileOpen && (
        <div
          data-testid="mobile-menu"
          className="md:hidden bg-white border-b-4 border-bk-orange z-40"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
        >
          {userName && (
            <div className="px-5 py-3 border-b-2 border-gray-100 font-black text-[13px]" style={{ color: '#aaa' }}>
              Signed in as {userName}
            </div>
          )}
          <Link href="/listings" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors">
            🔍 Browse
          </Link>
          <Link href="/post" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors">
            📚 Post a Book
          </Link>
          {userName ? (
            <>
              <Link href="/locations" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors">
                🗺️ Libraries
              </Link>
              <Link href="/profile" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors md:hidden">
                📊 Dashboard<DashboardBadge count={unreadCount} />
              </Link>
              {isAdmin && (
                <Link href="/admin" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors">
                  🔐 Admin Panel
                </Link>
              )}
              <a href="/auth/signout" onClick={clearDemoUser} className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-red-400 hover:bg-red-50 transition-colors">
                🚪 Sign Out
              </a>
            </>
          ) : (
            <>
              <Link href="/auth/signin" className="flex items-center gap-3 px-5 py-4 font-bold text-[15px] text-[#2d2d2d] border-b border-gray-100 hover:bg-[#fff7ed] hover:text-bk-orange transition-colors">
                Sign In
              </Link>
              <div className="px-5 py-4">
                <Link href="/auth/signup" className="block text-center bg-bk-orange text-white px-6 py-3 rounded-full font-extrabold text-[15px]">
                  Sign Up
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )
}
