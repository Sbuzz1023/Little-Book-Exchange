'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import ProfileCard from './ProfileCard'

type Tab = 'listings' | 'exchanges' | 'tbr' | 'saved' | 'wallet' | 'account'

type Listing = {
  id: string
  title: string
  author: string
  price?: number | null
  condition: string
  status: string
  photo_url?: string | null
}

type Exchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  exchange_status: 'none' | 'requested' | 'confirmed'
  listings: { title: string; author: string; photo_url?: string | null; city?: string | null; state?: string | null }
  buyer: { username?: string | null; name?: string | null; city?: string | null; state?: string | null; phone?: string | null }
  seller: { username?: string | null; name?: string | null; city?: string | null; state?: string | null; phone?: string | null }
}

type Props = {
  profile: {
    id?: string | null
    name?: string | null
    username?: string | null
    email?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    created_at?: string | null
  } | null
  listings: Listing[]
  exchanges: Exchange[]
  updateAction: (formData: FormData) => Promise<void>
  updateListingStatus: (formData: FormData) => Promise<void>
  notifyPickedUp: (formData: FormData) => Promise<void>
  confirmExchange: (formData: FormData) => Promise<void>
  success?: boolean
}

const TABS = [
  { id: 'listings' as Tab,   icon: '📋', label: 'My Listings',  desc: 'Books you posted',   color: '#f97316', bg: '#fff7ed', border: '#fed7aa', shadow: '#fdba74' },
  { id: 'exchanges' as Tab,  icon: '📦', label: 'Exchanges',    desc: 'Pending handoffs',   color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4', shadow: '#6ee7b7' },
  { id: 'tbr' as Tab,        icon: '📚', label: 'To Be Read',   desc: 'Your wishlist',      color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', shadow: '#c4b5fd' },
  { id: 'saved' as Tab,      icon: '❤️',  label: 'Saved Books',  desc: 'Books you hearted',  color: '#e11d48', bg: '#fff1f2', border: '#fecdd3', shadow: '#fda4af' },
  { id: 'wallet' as Tab,     icon: '💳', label: 'Wallet',       desc: 'Credits & history',  color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', shadow: '#6ee7b7' },
  { id: 'account' as Tab,    icon: '👤', label: 'Profile',      desc: 'Your profile',       color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', shadow: '#93c5fd' },
]

const COVER_GRADIENTS = [
  'linear-gradient(145deg, #fde68a, #fca5a5)',
  'linear-gradient(145deg, #99f6e4, #bfdbfe)',
  'linear-gradient(145deg, #fca5a5, #fda4af)',
  'linear-gradient(145deg, #c4b5fd, #93c5fd)',
  'linear-gradient(145deg, #6ee7b7, #fde68a)',
  'linear-gradient(145deg, #fdba74, #fb7185)',
  'linear-gradient(145deg, #a5f3fc, #6ee7b7)',
  'linear-gradient(145deg, #ddd6fe, #fca5a5)',
]

function coverGradient(id: string) {
  const sum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return COVER_GRADIENTS[sum % COVER_GRADIENTS.length]
}

function statusStyle(status: string) {
  if (status === 'sold')  return { background: '#dbeafe', color: '#1d4ed8' }
  if (status === 'given') return { background: '#f3e8ff', color: '#6b21a8' }
  return { background: '#dcfce7', color: '#166534' }
}

function statusLabel(status: string) {
  if (status === 'sold')  return 'Sold'
  if (status === 'given') return 'Given Away'
  return 'Active'
}

const MOCK_TRANSACTIONS = [
  { id: '1', type: 'purchase', desc: 'Bought 3 credits ($15.00)', amount: '+3', date: 'Jun 20, 2026', color: '#059669' },
  { id: '2', type: 'spend',    desc: 'Claimed Harry Potter',      amount: '−1', date: 'Jun 21, 2026', color: '#e11d48' },
  { id: '3', type: 'earn',     desc: 'Book claimed by neighbor',  amount: '+1', date: 'Jun 22, 2026', color: '#059669' },
]

export default function DashboardClient({ profile, listings, exchanges, updateAction, updateListingStatus, notifyPickedUp, confirmExchange, success }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('listings')

  const tab = TABS.find(t => t.id === activeTab)!

  const cardStyle = {
    background: '#fff',
    borderRadius: 20,
    padding: 24,
    border: '2px solid #f3f4f6',
    boxShadow: '0 6px 0 #e5e7eb',
  } as React.CSSProperties

  return (
    <div className="max-w-[720px] mx-auto px-4 py-10 flex flex-col" style={{ gap: 24 }}>

      {/* Page title */}
      <div>
        <h1 className="font-display text-[32px] text-bk-orange mb-1">Dashboard</h1>
        <p className="font-bold text-[14px]" style={{ color: '#aaa' }}>
          Manage your listings, track exchanges, and browse your saved books.
        </p>
      </div>

      {/* Tab nav — 3 cols mobile, 6 cols desktop */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {TABS.map(t => {
          const isActive = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className="flex flex-col items-center text-center transition-all duration-150 hover:-translate-y-1"
              style={{
                background: isActive ? t.color : t.bg,
                border: `2px solid ${isActive ? t.color : t.border}`,
                borderRadius: 16,
                boxShadow: isActive
                  ? `0 6px 0 ${t.shadow}, 0 8px 20px ${t.color}33`
                  : `0 4px 0 ${t.shadow}`,
                padding: '14px 8px 12px',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 26, marginBottom: 6, display: 'block' }}>{t.icon}</span>
              <span
                className="font-black leading-tight"
                style={{ fontSize: 11, color: isActive ? '#fff' : t.color, display: 'block' }}
              >
                {t.label}
              </span>
              <span
                className="font-semibold leading-tight mt-0.5"
                style={{ fontSize: 10, color: isActive ? 'rgba(255,255,255,0.75)' : '#aaa', display: 'block' }}
              >
                {t.desc}
              </span>
            </button>
          )
        })}
      </div>

      {/* Active section heading */}
      <div className="flex items-center gap-3">
        <span style={{ fontSize: 28 }}>{tab.icon}</span>
        <div>
          <h2 className="font-display text-[24px]" style={{ color: tab.color }}>{tab.label}</h2>
          <p className="font-semibold text-[13px]" style={{ color: '#aaa' }}>{tab.desc}</p>
        </div>
      </div>

      {/* ── MY LISTINGS ── */}
      {activeTab === 'listings' && (
        <div style={cardStyle}>
          <div className="flex items-center justify-between mb-4">
            <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>
              {listings.length} book{listings.length !== 1 ? 's' : ''} posted
            </p>
            <Link
              href="/post"
              className="text-white font-extrabold text-[13px] shadow-[0_3px_0_#0f766e]"
              style={{ background: '#0d9488', padding: '9px 20px', borderRadius: 999 }}
            >
              + Post a Book
            </Link>
          </div>

          {listings.length === 0 ? (
            <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
              No listings yet.{' '}
              <Link href="/post" className="text-bk-orange font-extrabold hover:underline">Post your first book!</Link>
            </div>
          ) : (
            <div>
              {listings.map(l => (
                <div key={l.id} className="flex items-center gap-3" style={{ padding: '12px 0', borderBottom: '2px solid #f3f4f6' }}>
                  <div className="relative shrink-0 overflow-hidden"
                    style={{ width: 42, height: 42, borderRadius: 10, background: coverGradient(l.id) }}>
                    {l.photo_url ? (
                      <Image src={l.photo_url} alt={l.title} fill className="object-cover" />
                    ) : (
                      <span className="flex items-center justify-center w-full h-full text-[20px]">📚</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/listings/${l.id}`} className="font-black text-[14px] truncate block hover:text-bk-orange transition-colors">
                      {l.title}
                    </Link>
                    <p className="font-semibold text-[12px]" style={{ color: '#aaa' }}>
                      {l.author} · 1 credit · {l.condition}
                    </p>
                  </div>
                  <span className="font-extrabold text-[11px] whitespace-nowrap shrink-0"
                    style={{ padding: '3px 10px', borderRadius: 999, ...statusStyle(l.status) }}>
                    {statusLabel(l.status)}
                  </span>
                  <form action={updateListingStatus} className="flex gap-2 shrink-0">
                    <input type="hidden" name="id" value={l.id} />
                    {l.status === 'active' ? (
                      <button name="status" value="sold"
                        className="font-extrabold text-[11px] hover:opacity-80"
                        style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0 }}>
                        Mark Sold
                      </button>
                    ) : (
                      <button name="status" value="active"
                        className="font-extrabold text-[11px] hover:opacity-80"
                        style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer', padding: 0 }}>
                        Re-list
                      </button>
                    )}
                    <button name="status" value="delete"
                      className="font-extrabold text-[11px] hover:opacity-80"
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>
                      Delete
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── EXCHANGES ── */}
      {activeTab === 'exchanges' && (() => {
        const userId = profile?.id ?? ''
        const sold   = exchanges.filter(e => e.seller_id === userId)
        const bought = exchanges.filter(e => e.buyer_id  === userId)

        const ExchangeRow = ({ ex, role }: { ex: Exchange; role: 'seller' | 'buyer' }) => {
          const other     = role === 'seller' ? ex.buyer : ex.seller
          const otherName = other.name || other.username || 'Neighbor'
          const status    = ex.exchange_status ?? 'none'
          const location  = ex.listings.city
            ? `${ex.listings.city}${ex.listings.state ? ', ' + ex.listings.state : ''}`
            : null

          // Status badge colours
          const statusBadge = status === 'requested'
            ? { bg: '#fffbeb', border: '#fcd34d', color: '#92400e', label: '⏳ Pending' }
            : status === 'confirmed'
            ? { bg: '#f0fdf4', border: '#86efac', color: '#166534', label: '✅ Confirmed' }
            : { bg: '#f3f4f6', border: '#e5e7eb', color: '#888', label: '💬 Chatting' }

          return (
            <div style={{ padding: '16px 0', borderBottom: '2px solid #f3f4f6' }}>
              <div className="flex gap-3 items-start">
                {/* Book thumbnail */}
                <div className="relative shrink-0 overflow-hidden"
                  style={{ width: 46, height: 58, borderRadius: 8, background: coverGradient(ex.listing_id) }}>
                  {ex.listings.photo_url ? (
                    <Image src={ex.listings.photo_url} alt={ex.listings.title} fill className="object-cover" />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full text-[22px]">📚</span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="font-black text-[13px] truncate">{ex.listings.title}</p>
                    <span className="font-extrabold text-[10px] whitespace-nowrap shrink-0"
                      style={{ padding: '2px 8px', borderRadius: 999, background: statusBadge.bg, border: `1.5px solid ${statusBadge.border}`, color: statusBadge.color }}>
                      {statusBadge.label}
                    </span>
                  </div>
                  <p className="font-semibold text-[11px]" style={{ color: '#aaa' }}>{ex.listings.author}</p>

                  {/* Status-specific context line */}
                  {role === 'seller' && status === 'requested' && (
                    <p className="font-bold text-[12px] mt-1" style={{ color: '#92400e' }}>
                      🔔 <strong>{otherName}</strong> wants to purchase this book!
                    </p>
                  )}
                  {role === 'seller' && status === 'confirmed' && (
                    <p className="font-bold text-[12px] mt-1" style={{ color: '#166534' }}>
                      Your contact info was sent to <strong>{otherName}</strong>.
                    </p>
                  )}
                  {role === 'seller' && status === 'none' && (
                    <p className="font-semibold text-[12px] mt-1" style={{ color: '#aaa' }}>
                      Messaging with <strong style={{ color: '#555' }}>{otherName}</strong>
                    </p>
                  )}
                  {role === 'buyer' && status === 'requested' && (
                    <p className="font-bold text-[12px] mt-1" style={{ color: '#92400e' }}>
                      ⏳ Waiting for <strong>{otherName}</strong> to confirm…
                    </p>
                  )}
                  {role === 'buyer' && status === 'confirmed' && location && (
                    <p className="font-bold text-[12px] mt-1" style={{ color: '#166534' }}>
                      📍 Pick up from <strong>{otherName}</strong> in {location}
                    </p>
                  )}
                  {role === 'buyer' && status === 'none' && (
                    <p className="font-semibold text-[12px] mt-1" style={{ color: '#aaa' }}>
                      from <strong style={{ color: '#555' }}>{otherName}</strong>{location ? ` · ${location}` : ''}
                    </p>
                  )}
                </div>

                {/* Message button always visible */}
                <Link href={`/messages/${ex.id}`}
                  className="font-extrabold text-[11px] text-white whitespace-nowrap shrink-0"
                  style={{ background: '#0d9488', padding: '6px 12px', borderRadius: 999, boxShadow: '0 2px 0 #0f766e' }}>
                  💬 Message
                </Link>
              </div>

              {/* Action row below — status-driven */}
              <div className="flex gap-2 mt-3 flex-wrap" style={{ paddingLeft: 58 }}>
                {/* Seller: confirm a purchase request */}
                {role === 'seller' && status === 'requested' && (
                  <form action={confirmExchange}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] text-white hover:opacity-90"
                      style={{ background: '#0d9488', border: 'none', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 0 #0f766e' }}>
                      ✅ Confirm — Send My Contact Info
                    </button>
                  </form>
                )}

                {/* Seller: mark picked up after confirmed */}
                {role === 'seller' && status === 'confirmed' && (
                  <form action={notifyPickedUp}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] hover:opacity-80"
                      style={{ background: '#fff7ed', border: '1.5px solid #fed7aa', color: '#f97316', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                      📦 Mark Picked Up
                    </button>
                  </form>
                )}

                {/* Buyer: "I got it" after confirmed */}
                {role === 'buyer' && status === 'confirmed' && (
                  <form action={notifyPickedUp}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] hover:opacity-80"
                      style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', color: '#166534', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                      📚 I Got It!
                    </button>
                  </form>
                )}
              </div>
            </div>
          )
        }

        return (
          <div className="flex flex-col" style={{ gap: 16 }}>
            {/* Going Out */}
            <div style={cardStyle}>
              <div className="font-extrabold text-[11px] mb-4"
                style={{ textTransform: 'uppercase', letterSpacing: '0.8px', padding: '7px 12px', borderRadius: 10, background: '#fff7ed', color: '#f97316', display: 'inline-block' }}>
                📤 Sold ({sold.length})
              </div>
              {sold.length === 0 ? (
                <div className="text-center py-6 font-bold text-[13px]" style={{ color: '#ccc' }}>No active sales</div>
              ) : (
                sold.map(ex => <ExchangeRow key={ex.id} ex={ex} role="seller" />)
              )}
            </div>

            {/* Coming In */}
            <div style={cardStyle}>
              <div className="font-extrabold text-[11px] mb-4"
                style={{ textTransform: 'uppercase', letterSpacing: '0.8px', padding: '7px 12px', borderRadius: 10, background: '#f0fdfa', color: '#0d9488', display: 'inline-block' }}>
                📥 Bought ({bought.length})
              </div>
              {bought.length === 0 ? (
                <div className="text-center py-6 font-bold text-[13px]" style={{ color: '#ccc' }}>No books on the way</div>
              ) : (
                bought.map(ex => <ExchangeRow key={ex.id} ex={ex} role="buyer" />)
              )}
            </div>
          </div>
        )
      })()}

      {/* ── TO BE READ ── */}
      {activeTab === 'tbr' && (
        <div style={cardStyle}>
          <p className="font-bold text-[13px] mb-5" style={{ color: '#aaa' }}>
            Add books you want to read — we'll alert you when one is listed nearby.
          </p>
          <div className="flex gap-2 mb-4 flex-wrap">
            <input placeholder="Book title..." disabled
              className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
              style={{ padding: '9px 12px', minWidth: 120 }} />
            <input placeholder="Author (optional)..." disabled
              className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
              style={{ padding: '9px 12px', minWidth: 120 }} />
            <button disabled className="text-white font-extrabold text-[13px] opacity-50"
              style={{ background: '#7c3aed', padding: '9px 18px', borderRadius: 12, border: 'none', cursor: 'not-allowed', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              + Add
            </button>
          </div>
          <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
            No books on your TBR yet.
          </div>
        </div>
      )}

      {/* ── SAVED BOOKS ── */}
      {activeTab === 'saved' && (
        <div style={cardStyle}>
          <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
            No saved books yet.{' '}
            <Link href="/listings" className="font-extrabold hover:underline" style={{ color: '#e11d48' }}>Browse listings</Link>
            {' '}and tap the ♡ to save!
          </div>
        </div>
      )}

      {/* ── WALLET ── */}
      {activeTab === 'wallet' && (
        <div className="flex flex-col" style={{ gap: 16 }}>

          {/* Balance card */}
          <div style={{ ...cardStyle, background: 'linear-gradient(135deg, #064e3b, #065f46)', border: '2px solid #059669', boxShadow: '0 6px 0 #047857' }}>
            <p className="font-extrabold text-[11px] mb-1" style={{ color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Available Balance
            </p>
            <div className="flex items-end gap-3 mb-2">
              <span className="font-display text-[48px] text-white leading-none">0</span>
              <span className="font-extrabold text-[18px] mb-1" style={{ color: 'rgba(255,255,255,0.7)' }}>credits</span>
            </div>
            <p className="font-semibold text-[12px] mb-5" style={{ color: 'rgba(255,255,255,0.5)' }}>
              1 credit = 1 book · $5 per credit
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 700 }}>$5.00 per credit</p>
              <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 700 }}>1 credit = 1 book</p>
            </div>
            <button
              className="font-extrabold text-[14px] w-full"
              style={{
                background: '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '13px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                boxShadow: '0 3px 0 #059669',
              }}
            >
              💳 Buy Credits — $5 each
            </button>
          </div>

          {/* Transaction history */}
          <div style={cardStyle}>
            <h3 className="font-display text-[18px] mb-4" style={{ color: '#059669' }}>Transaction History</h3>
            {MOCK_TRANSACTIONS.length === 0 ? (
              <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
                No transactions yet.
              </div>
            ) : (
              <div>
                {MOCK_TRANSACTIONS.map((tx, i) => (
                  <div key={tx.id} className="flex items-center gap-3"
                    style={{ padding: '12px 0', borderBottom: i < MOCK_TRANSACTIONS.length - 1 ? '2px solid #f3f4f6' : 'none' }}>
                    <div className="flex items-center justify-center shrink-0"
                      style={{ width: 38, height: 38, borderRadius: 10, background: tx.color + '18', fontSize: 18 }}>
                      {tx.type === 'purchase' ? '💳' : tx.type === 'earn' ? '🤝' : '⭐'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[13px] truncate">{tx.desc}</p>
                      <p className="font-semibold text-[11px]" style={{ color: '#aaa' }}>{tx.date}</p>
                    </div>
                    <span className="font-black text-[15px] shrink-0" style={{ color: tx.color }}>
                      {tx.amount}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* ── ACCOUNT ── */}
      {activeTab === 'account' && (
        <div className="flex flex-col" style={{ gap: 16 }}>
          <ProfileCard profile={profile} updateAction={updateAction} success={success} />
          <div style={{ borderTop: '2px dashed #e5e7eb', paddingTop: 16 }}>
            <form action="/auth/signout" method="post">
              <button className="font-bold text-sm hover:text-red-400 transition-colors"
                style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
                Sign Out
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
