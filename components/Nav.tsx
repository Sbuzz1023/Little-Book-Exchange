'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'

function initials(name: string) {
  const parts = name.split(/[\s._\-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function readDemoCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|; )lbe_demo_user=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

export default function Nav({ userName: serverUserName }: { userName?: string | null }) {
  const pathname = usePathname()
  const isHome = pathname === '/'
  const [open, setOpen] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-read cookie on every route change so sign-in/out updates instantly
  const [userName, setUserName] = useState<string | null>(serverUserName ?? null)
  useEffect(() => {
    setUserName(readDemoCookie())
  }, [pathname])

  function handleMouseEnter() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setOpen(true)
  }

  function handleMouseLeave() {
    timerRef.current = setTimeout(() => setOpen(false), 120)
  }

  return (
    <nav
      className="relative bg-white z-50 flex items-center justify-between px-8"
      style={{
        height: 68,
        borderBottom: isHome ? 'none' : '4px solid #f97316',
      }}
    >
      <Link href="/" className="font-display text-[22px] text-bk-orange flex items-center gap-2.5">
        <span className="bg-bk-orange rounded-full w-9 h-9 flex items-center justify-center text-lg shrink-0">🏡</span>
        LittleBookExchange
      </Link>

      <div className="flex items-center gap-[22px]">
        <Link href="/listings" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Browse</Link>
        <Link href="/post" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Post a Book</Link>

        {userName ? (
          <>
            <Link href="/profile" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Dashboard</Link>
            <Link href="/messages" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Messages</Link>

            {/* Avatar with hover dropdown */}
            <div
              className="relative"
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <button
                className="flex items-center justify-center font-black text-[13px] text-white rounded-full select-none"
                style={{
                  width: 38,
                  height: 38,
                  background: '#f97316',
                  boxShadow: '0 3px 0 #c2410c',
                  border: 'none',
                  cursor: 'pointer',
                  letterSpacing: '0.5px',
                }}
              >
                {initials(userName)}
              </button>

              {open && (
                <div
                  className="absolute right-0 bg-white border-2 border-gray-100 rounded-[16px] overflow-hidden"
                  style={{
                    top: 'calc(100% + 8px)',
                    minWidth: 160,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                    zIndex: 100,
                  }}
                >
                  <div
                    className="px-4 py-3 font-black text-[13px] border-b-2 border-gray-100"
                    style={{ color: '#aaa', letterSpacing: '0.3px' }}
                  >
                    {userName}
                  </div>
                  <Link
                    href="/profile"
                    className="flex items-center gap-2.5 px-4 py-3 font-bold text-[14px] text-[#2d2d2d] hover:bg-[#fff7ed] hover:text-bk-orange transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    📊 Dashboard
                  </Link>
                  <Link
                    href="/messages"
                    className="flex items-center gap-2.5 px-4 py-3 font-bold text-[14px] text-[#2d2d2d] hover:bg-[#fff7ed] hover:text-bk-orange transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    💬 Messages
                  </Link>
                  <div style={{ borderTop: '2px solid #f3f4f6' }}>
                    <Link
                      href="/auth/signout"
                      className="flex items-center gap-2.5 px-4 py-3 font-bold text-[14px] text-[#888] hover:bg-red-50 hover:text-red-500 transition-colors"
                    >
                      🚪 Sign Out
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <Link href="/auth/signin" className="font-bold text-[15px] text-[#2d2d2d] hover:text-bk-orange transition-colors">Sign In</Link>
            <Link href="/auth/signup" className="bg-bk-orange text-white px-[22px] py-[9px] rounded-full font-extrabold text-[15px] hover:bg-bk-orange-dark transition-colors">
              Join Free
            </Link>
          </>
        )}
      </div>

      {isHome && (
        <div
          className="absolute left-0 right-0"
          style={{
            bottom: -12,
            height: 12,
            zIndex: 10,
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 12'%3E%3Cpath d='M0,6 Q15,0 30,6 Q45,12 60,6 Q75,0 90,6 Q105,12 120,6 L120,12 L0,12Z' fill='%23f97316'/%3E%3C/svg%3E")`,
            backgroundRepeat: 'repeat-x',
            backgroundSize: '120px 12px',
          }}
        />
      )}
    </nav>
  )
}
