'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import ProfileCard from './ProfileCard'
import MessagesTab from './MessagesTab'
import HistorySection, { type HistoryExchange } from './HistorySection'
import { createClient } from '@/lib/supabase/client'

type Tab = 'listings' | 'exchanges' | 'tbr' | 'saved' | 'wallet' | 'account' | 'messages'

type Listing = {
  id: string
  title: string
  author: string
  price?: number | null
  condition: string
  status: string
  photo_url?: string | null
}

type SavedListing = {
  id: string
  title: string
  author: string
  photo_url?: string | null
  condition: string
  price?: number | null
  status: string
}

type TbrEntry = {
  id: string
  title: string
  author: string
  city: string
  state: string
  match: { id: string; title: string } | null
}

type Exchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  created_at: string
  exchange_status: 'none' | 'requested' | 'confirmed' | 'completed' | 'declined'
  completed_at: string | null
  buyer_hidden: boolean
  seller_hidden: boolean
  sellerRating: { average: number; count: number } | null
  reviewed: boolean
  listings: {
    title: string
    author: string
    photo_url?: string | null
    city?: string | null
    state?: string | null
    pickup_description?: string | null
  }
  buyer: {
    username?: string | null
    name?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
  }
  seller: {
    username?: string | null
    name?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    address?: string | null
    address_unit?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
  }
  messages: { id: string; body: string; sender_id: string; created_at: string }[]
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
    address?: string | null
    address_unit?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
    created_at?: string | null
    credits?: number | null
    email_verified?: boolean | null
    phone_verified?: boolean | null
    onboarding_bonus_claimed?: boolean | null
  } | null
  listings: Listing[]
  exchanges: Exchange[]
  savedListings: SavedListing[]
  tbrEntries: TbrEntry[]
  transactions: { id: string; amount: number; reason: string; created_at: string }[]
  updateAction: (formData: FormData) => Promise<void>
  updateListingStatus: (formData: FormData) => Promise<void>
  completeExchange: (formData: FormData) => Promise<void>
  hideExchangeHistory: (formData: FormData) => Promise<void>
  submitReview: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  confirmExchange: (formData: FormData) => Promise<void>
  cancelPurchase: (formData: FormData) => Promise<void>
  denyPurchase: (formData: FormData) => Promise<void>
  removeSavedListing: (formData: FormData) => Promise<void>
  addTbrEntry: (formData: FormData) => Promise<void>
  removeTbrEntry: (formData: FormData) => Promise<void>
  success?: boolean
  defaultTab?: Tab
  queryError?: string | null
  tbrError?: string | null
  isDemo: boolean
  initialConversationId?: string | null
  unreadCounts: { total: number; exchanges: number; tbr: number; messages: number }
  unreadEntityIds: { message: string[]; decisionOrPickup: string[]; tbrMatch: string[] }
  resendEmailConfirmation: () => Promise<{ ok: boolean; error?: string }>
}

const TABS = [
  { id: 'listings' as Tab,   icon: '📋', label: 'My Listings',  desc: 'Books you posted',   color: '#f97316', bg: '#fff7ed', border: '#fed7aa', shadow: '#fdba74' },
  { id: 'exchanges' as Tab,  icon: '📦', label: 'Exchanges',    desc: 'Pending handoffs',   color: '#0d9488', bg: '#f0fdfa', border: '#99f6e4', shadow: '#6ee7b7' },
  { id: 'tbr' as Tab,        icon: '📚', label: 'To Be Read',   desc: 'Your wishlist',      color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', shadow: '#c4b5fd' },
  { id: 'saved' as Tab,      icon: '❤️',  label: 'Saved Books',  desc: 'Books you hearted',  color: '#e11d48', bg: '#fff1f2', border: '#fecdd3', shadow: '#fda4af' },
  { id: 'wallet' as Tab,     icon: '💳', label: 'Wallet',       desc: 'Credits & history',  color: '#059669', bg: '#ecfdf5', border: '#a7f3d0', shadow: '#6ee7b7' },
  { id: 'account' as Tab,    icon: '👤', label: 'Profile',      desc: 'Your profile',       color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', shadow: '#93c5fd' },
  { id: 'messages' as Tab,   icon: '💬', label: 'Messages',     desc: 'Chat with neighbors', color: '#0ea5e9', bg: '#f0f9ff', border: '#bae6fd', shadow: '#7dd3fc' },
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

function coverGradient(id: string | null | undefined) {
  if (!id) return COVER_GRADIENTS[0]
  const sum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return COVER_GRADIENTS[sum % COVER_GRADIENTS.length]
}

function statusStyle(status: string) {
  if (status === 'sold')    return { background: '#dbeafe', color: '#1d4ed8' }
  if (status === 'given')   return { background: '#f3e8ff', color: '#6b21a8' }
  if (status === 'pending') return { background: '#fffbeb', color: '#92400e' }
  if (status === 'paused')  return { background: '#f3f4f6', color: '#4b5563' }
  return { background: '#dcfce7', color: '#166534' }
}

function statusLabel(status: string) {
  if (status === 'sold')    return 'Sold'
  if (status === 'given')   return 'Given Away'
  if (status === 'pending') return 'Pending'
  if (status === 'paused')  return 'Paused'
  return 'Active'
}

export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, transactions, updateAction, updateListingStatus, completeExchange, hideExchangeHistory, submitReview, confirmExchange, denyPurchase, cancelPurchase, removeSavedListing, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError, isDemo, initialConversationId, unreadCounts, unreadEntityIds, resendEmailConfirmation }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab ?? 'listings')
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId ?? null)
  const booksPosted = listings.reduce((sum, l: any) => sum + (l.book_count ?? 1), 0)

  async function markTabRead(tabId: Tab) {
    if (isDemo || !profile?.id) return
    if (tabId === 'exchanges' && unreadEntityIds.decisionOrPickup.length > 0) {
      const supabase = createClient()
      await supabase.from('notifications').update({ read: true })
        .eq('user_id', profile.id).in('type', ['purchase_decision', 'pickup'])
    } else if (tabId === 'tbr' && unreadEntityIds.tbrMatch.length > 0) {
      const supabase = createClient()
      await supabase.from('notifications').update({ read: true })
        .eq('user_id', profile.id).eq('type', 'tbr_match')
    }
  }

  function tabBadgeCount(id: Tab): number {
    if (id === 'exchanges') return unreadCounts.exchanges
    if (id === 'tbr') return unreadCounts.tbr
    if (id === 'messages') return unreadCounts.messages
    return 0
  }

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
      <div className="grid grid-cols-4 md:grid-cols-7 gap-3">
        {TABS.map(t => {
          const isActive = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => { setActiveTab(t.id); if (t.id === 'messages') setSelectedConversationId(null); markTabRead(t.id) }}
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
                position: 'relative',
              }}
            >
              {tabBadgeCount(t.id) > 0 && (
                <span
                  data-testid="tab-badge"
                  style={{
                    position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff',
                    fontSize: 10, fontWeight: 900, borderRadius: 999, padding: '2px 6px', minWidth: 18,
                    textAlign: 'center', boxShadow: '0 2px 0 #b91c1c',
                  }}
                >
                  {tabBadgeCount(t.id)}
                </span>
              )}
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
      {activeTab === 'listings' && (() => {
        const active = listings.filter(l => l.status === 'active')
        const paused = listings.filter(l => l.status === 'paused')

        const ListingRow = ({ l, action }: { l: Listing; action: 'pause' | 'resume' }) => (
          <div className="flex items-center gap-3" style={{ padding: '12px 0', borderBottom: '2px solid #f3f4f6' }}>
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
            <Link href={`/listings/${l.id}/edit`}
              className="font-extrabold text-[11px] hover:opacity-80 shrink-0"
              style={{ color: '#888' }}>
              Edit
            </Link>
            <form action={updateListingStatus} className="flex gap-2 shrink-0">
              <input type="hidden" name="id" value={l.id} />
              {action === 'pause' ? (
                <button name="status" value="paused"
                  className="font-extrabold text-[11px] hover:opacity-80"
                  style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', padding: 0 }}>
                  Pause
                </button>
              ) : (
                <button name="status" value="active"
                  className="font-extrabold text-[11px] hover:opacity-80"
                  style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer', padding: 0 }}>
                  Resume
                </button>
              )}
              <button name="status" value="delete"
                className="font-extrabold text-[11px] hover:opacity-80"
                style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>
                Delete
              </button>
            </form>
          </div>
        )

        return (
          <div className="flex flex-col" style={{ gap: 16 }}>
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
              ) : active.length === 0 ? (
                <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
                  No active listings.{' '}
                  <Link href="/post" className="text-bk-orange font-extrabold hover:underline">Post a book!</Link>
                </div>
              ) : (
                <div>
                  {active.map(l => <ListingRow key={l.id} l={l} action="pause" />)}
                </div>
              )}
            </div>

            {paused.length > 0 && (
              <div style={cardStyle}>
                <div className="font-extrabold text-[11px] mb-4"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.8px', padding: '7px 12px', borderRadius: 10, background: '#f3f4f6', color: '#4b5563', display: 'inline-block' }}>
                  ⏸️ Paused ({paused.length})
                </div>
                <div>
                  {paused.map(l => <ListingRow key={l.id} l={l} action="resume" />)}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── EXCHANGES ── */}
      {activeTab === 'exchanges' && (() => {
        const userId = profile?.id ?? ''
        const sold   = exchanges.filter(e => e.seller_id === userId && e.exchange_status !== 'completed' && e.exchange_status !== 'declined' && e.exchange_status !== 'none')
        const bought = exchanges.filter(e => e.buyer_id  === userId && e.exchange_status !== 'completed' && e.exchange_status !== 'declined' && e.exchange_status !== 'none')

        const ExchangeRow = ({ ex, role }: { ex: Exchange; role: 'seller' | 'buyer' }) => {
          const other     = role === 'seller' ? (ex.buyer ?? {}) : (ex.seller ?? {})
          const otherName = (other as any).name || (other as any).username || 'Neighbor'
          const status    = ex.exchange_status ?? 'none'
          const location  = ex.listings?.city
            ? `${ex.listings.city}${ex.listings.state ? ', ' + ex.listings.state : ''}`
            : null

          // Status badge — role-aware
          const statusBadge =
            status === 'requested' && role === 'buyer'
              ? { bg: '#fffbeb', border: '#fcd34d', color: '#92400e', label: '⏳ Pending Seller' }
            : status === 'requested' && role === 'seller'
              ? { bg: '#fff7ed', border: '#fdba74', color: '#c2410c', label: '🔔 Needs Your OK' }
            : status === 'confirmed'
              ? { bg: '#f0fdf4', border: '#86efac', color: '#166534', label: '✅ Ready for Pick Up' }
            : { bg: '#f3f4f6', border: '#e5e7eb', color: '#888', label: '💬 Chatting' }

          const isPendingSellerAction = role === 'seller' && status === 'requested'
          const isUnreadDecisionOrPickup = unreadEntityIds.decisionOrPickup.includes(ex.id)
          const highlighted = isPendingSellerAction || isUnreadDecisionOrPickup

          return (
            <div
              data-testid={highlighted ? 'exchange-row-highlighted' : undefined}
              style={{
                padding: '16px 0 16px 12px', borderBottom: '2px solid #f3f4f6',
                ...(highlighted ? { background: '#fff7ed', borderRadius: 12, boxShadow: 'inset 3px 0 0 #f97316' } : {}),
              }}
            >
              <div className="flex gap-3 items-start">
                {/* Book thumbnail */}
                <div className="relative shrink-0 overflow-hidden"
                  style={{ width: 46, height: 58, borderRadius: 8, background: coverGradient(ex.listing_id) }}>
                  {ex.listings?.photo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ex.listings.photo_url} alt={ex.listings.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full text-[22px]">📚</span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <p className="font-black text-[13px] truncate">{ex.listings?.title ?? 'Unknown'}</p>
                    <span className="font-extrabold text-[10px] whitespace-nowrap shrink-0"
                      style={{ padding: '2px 8px', borderRadius: 999, background: statusBadge.bg, border: `1.5px solid ${statusBadge.border}`, color: statusBadge.color }}>
                      {statusBadge.label}
                    </span>
                  </div>
                  <p className="font-semibold text-[11px]" style={{ color: '#aaa' }}>{ex.listings?.author ?? ''}</p>

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
                      Waiting for <strong>{otherName}</strong> to approve your request
                    </p>
                  )}
                  {role === 'buyer' && status === 'confirmed' && (
                    <div className="mt-2 rounded-[10px] px-3 py-2" style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0' }}>
                      <p className="font-extrabold text-[12px]" style={{ color: '#166534' }}>📍 Ready for Pick Up!</p>
                      {location && <p className="font-semibold text-[11px] mt-0.5" style={{ color: '#166534' }}>📌 {location}</p>}
                      {ex.seller?.phone && (
                        <p className="font-semibold text-[11px]" style={{ color: '#166534' }}>📞 {ex.seller.phone}</p>
                      )}
                      {ex.seller?.share_address && (ex.seller?.address || ex.seller?.address_unit) && (
                        <p className="font-semibold text-[11px]" style={{ color: '#166534' }}>
                          🏠 {[ex.seller.address, ex.seller.address_unit].filter(Boolean).join(' ')}
                        </p>
                      )}
                      {ex.seller?.share_pickup && (() => {
                        const pickup = ex.listings?.pickup_description || ex.seller?.pickup_description
                        return pickup
                          ? <p className="font-semibold text-[11px]" style={{ color: '#166534' }}>📦 Pickup: {pickup}</p>
                          : null
                      })()}
                      <p className="font-semibold text-[11px]" style={{ color: '#166534' }}>Contact: <strong>{otherName}</strong></p>
                    </div>
                  )}
                  {role === 'buyer' && status === 'none' && (
                    <p className="font-semibold text-[12px] mt-1" style={{ color: '#aaa' }}>
                      from <strong style={{ color: '#555' }}>{otherName}</strong>{location ? ` · ${location}` : ''}
                    </p>
                  )}
                </div>

                {/* Message button always visible */}
                <button
                  type="button"
                  onClick={() => { setActiveTab('messages'); setSelectedConversationId(ex.id) }}
                  className="font-extrabold text-[11px] text-white whitespace-nowrap shrink-0"
                  style={{ background: '#0d9488', padding: '6px 12px', borderRadius: 999, boxShadow: '0 2px 0 #0f766e', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  💬 Message
                </button>
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

                {/* Seller: deny a purchase request */}
                {role === 'seller' && status === 'requested' && (
                  <form action={denyPurchase} onSubmit={e => { if (!confirm('Deny this purchase request?')) e.preventDefault() }}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] hover:opacity-80"
                      style={{ background: '#fff1f2', border: '1.5px solid #fca5a5', color: '#dc2626', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                      ✕ Deny
                    </button>
                  </form>
                )}

                {/* Seller: mark picked up after confirmed */}
                {role === 'seller' && status === 'confirmed' && (
                  <form action={completeExchange}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] hover:opacity-80"
                      style={{ background: '#fff7ed', border: '1.5px solid #fed7aa', color: '#f97316', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                      📦 Mark Picked Up
                    </button>
                  </form>
                )}

                {/* Buyer: cancel before seller confirms */}
                {role === 'buyer' && status === 'requested' && (
                  <form action={cancelPurchase} onSubmit={e => { if (!confirm('Cancel this purchase request?')) e.preventDefault() }}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] hover:opacity-80"
                      style={{ background: '#fff1f2', border: '1.5px solid #fca5a5', color: '#dc2626', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                      ✕ Cancel Request
                    </button>
                  </form>
                )}

                {/* Buyer: "I got it" after confirmed */}
                {role === 'buyer' && status === 'confirmed' && (
                  <form action={completeExchange}>
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

            {/* History */}
            <HistorySection
              exchanges={exchanges as HistoryExchange[]}
              userId={userId}
              hideExchangeHistory={hideExchangeHistory}
              submitReview={submitReview}
            />
          </div>
        )
      })()}

      {/* ── TO BE READ ── */}
      {activeTab === 'tbr' && (
        <div style={cardStyle}>
          <p className="font-bold text-[13px] mb-5" style={{ color: '#aaa' }}>
            Add books you want to read — we'll show you when one is listed nearby.
          </p>

          {tbrError && (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
              {tbrError}
            </div>
          )}

          <form action={addTbrEntry} className="flex gap-2 mb-4 flex-wrap">
            <input name="title" placeholder="Book title..."
              className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
              style={{ padding: '9px 12px', minWidth: 120 }} />
            <input name="author" placeholder="Author (optional)..."
              className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
              style={{ padding: '9px 12px', minWidth: 120 }} />
            <input name="city" placeholder="City (optional)..."
              className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
              style={{ padding: '9px 12px', minWidth: 100 }} />
            <input name="state" placeholder="State (optional)..."
              className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
              style={{ padding: '9px 12px', minWidth: 100 }} />
            <button type="submit" className="text-white font-extrabold text-[13px]"
              style={{ background: '#7c3aed', padding: '9px 18px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              + Add
            </button>
          </form>

          {tbrEntries.length === 0 ? (
            <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
              No books on your TBR yet.
            </div>
          ) : (
            <>
              {/* Desktop: table with column headers */}
              <div className="hidden md:block">
                <div className="grid gap-3 px-1 pb-2" style={{ gridTemplateColumns: '2fr 1.5fr 1fr 70px 150px', borderBottom: '2px solid #f3f4f6' }}>
                  {['Title', 'Author', 'City', 'State', ''].map(h => (
                    <span key={h} className="font-black text-[11px]" style={{ textTransform: 'uppercase', letterSpacing: '0.6px', color: '#aaa' }}>
                      {h}
                    </span>
                  ))}
                </div>
                {tbrEntries.map(entry => {
                  const isUnread = unreadEntityIds.tbrMatch.includes(entry.id)
                  return (
                  <div key={entry.id} className="grid gap-3 items-center px-1"
                    style={{ gridTemplateColumns: '2fr 1.5fr 1fr 70px 150px', padding: '12px 4px', borderBottom: '2px solid #f3f4f6', ...(isUnread ? { background: '#f5f3ff', borderRadius: 10 } : {}) }}>
                    <span className="font-black text-[14px] truncate">{entry.title || '—'}</span>
                    <span className="font-semibold text-[13px] truncate" style={{ color: entry.author ? '#555' : '#ccc' }}>{entry.author || '—'}</span>
                    <span className="font-semibold text-[13px] truncate" style={{ color: entry.city ? '#555' : '#ccc' }}>{entry.city || '—'}</span>
                    <span className="font-semibold text-[13px]" style={{ color: entry.state ? '#555' : '#ccc' }}>{entry.state || '—'}</span>
                    <div className="flex items-center justify-end gap-3">
                      {entry.match && (
                        <Link href={`/listings/${entry.match.id}`}
                          className="font-extrabold text-[11px] text-white whitespace-nowrap"
                          style={{ background: '#7c3aed', padding: '5px 10px', borderRadius: 999, boxShadow: '0 2px 0 #5b21b6' }}>
                          📖 Avail
                        </Link>
                      )}
                      <form action={removeTbrEntry}>
                        <input type="hidden" name="id" value={entry.id} />
                        <button className="font-extrabold text-[15px] hover:opacity-70" aria-label="Delete"
                          style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>
                          ✕
                        </button>
                      </form>
                    </div>
                  </div>
                  )
                })}
              </div>

              {/* Mobile: stacked cards */}
              <div className="md:hidden">
                {tbrEntries.map(entry => {
                  const isUnread = unreadEntityIds.tbrMatch.includes(entry.id)
                  return (
                  <div key={entry.id} style={{ padding: '12px 0', borderBottom: '2px solid #f3f4f6', ...(isUnread ? { background: '#f5f3ff', borderRadius: 10 } : {}) }}>
                    <p className="font-black text-[14px] truncate">
                      {entry.title || `by ${entry.author}`}
                    </p>
                    <p className="font-semibold text-[12px] mb-2" style={{ color: '#aaa' }}>
                      {[entry.title && entry.author ? `by ${entry.author}` : null, entry.city, entry.state]
                        .filter(Boolean).join(' · ')}
                    </p>
                    <div className="flex items-center gap-3 flex-wrap">
                      {entry.match && (
                        <Link href={`/listings/${entry.match.id}`}
                          className="font-extrabold text-[12px] text-white whitespace-nowrap"
                          style={{ background: '#7c3aed', padding: '6px 14px', borderRadius: 999, boxShadow: '0 2px 0 #5b21b6' }}>
                          📖 Available!
                        </Link>
                      )}
                      <form action={removeTbrEntry}>
                        <input type="hidden" name="id" value={entry.id} />
                        <button className="font-extrabold text-[11px] hover:opacity-80"
                          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', padding: 0 }}>
                          ✕ Delete
                        </button>
                      </form>
                    </div>
                  </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── SAVED BOOKS ── */}
      {activeTab === 'saved' && (
        <div style={cardStyle}>
          {savedListings.length === 0 ? (
            <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
              No saved books yet.{' '}
              <Link href="/listings" className="font-extrabold hover:underline" style={{ color: '#e11d48' }}>Browse listings</Link>
              {' '}and tap the ♡ to save!
            </div>
          ) : (
            <div>
              {savedListings.map(l => (
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
                      {l.author} · {l.condition}
                    </p>
                  </div>
                  <form action={removeSavedListing} className="shrink-0">
                    <input type="hidden" name="listing_id" value={l.id} />
                    <button className="font-extrabold text-[11px] hover:opacity-80"
                      style={{ background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer', padding: 0 }}>
                      💔 Unsave
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── WALLET ── */}
      {activeTab === 'wallet' && (
        <div className="flex flex-col" style={{ gap: 16 }}>

          {!profile?.onboarding_bonus_claimed && (
            <div style={{ ...cardStyle, border: '2px solid #a7f3d0' }}>
              <h3 className="font-display text-[16px] mb-3" style={{ color: '#059669' }}><span aria-hidden="true">🎯</span> Earn Your First Credit</h3>
              <div className="flex flex-col" style={{ gap: 10 }}>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[13px]">{profile?.email_verified ? '✅' : '☐'} Verify email</span>
                  {!profile?.email_verified && (
                    <button
                      type="button"
                      onClick={() => resendEmailConfirmation()}
                      className="font-extrabold text-[12px]"
                      style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
                    >
                      Resend confirmation email
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[13px]">{profile?.phone_verified ? '✅' : '☐'} Verify phone</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[13px]">{booksPosted >= 3 ? '✅' : '☐'} Books posted</span>
                  <span className="font-extrabold text-[12px]" style={{ color: '#aaa' }}>{Math.min(booksPosted, 3)}/3</span>
                </div>
              </div>
            </div>
          )}
          {profile?.onboarding_bonus_claimed && (
            <div style={{ ...cardStyle, border: '2px solid #a7f3d0', textAlign: 'center' }}>
              <p className="font-black text-[14px]" style={{ color: '#059669' }}>🎉 Bonus earned — you got 1 free credit!</p>
            </div>
          )}

          {/* Balance card */}
          <div style={{ ...cardStyle, background: 'linear-gradient(135deg, #064e3b, #065f46)', border: '2px solid #059669', boxShadow: '0 6px 0 #047857' }}>
            <p className="font-extrabold text-[11px] mb-1" style={{ color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Available Balance
            </p>
            <div className="flex items-end gap-3 mb-2">
              <span className="font-display text-[48px] text-white leading-none">{profile?.credits ?? 0}</span>
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
              disabled
              className="font-extrabold text-[14px] w-full"
              style={{
                background: '#9ca3af',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                padding: '13px',
                cursor: 'not-allowed',
                fontFamily: 'inherit',
                boxShadow: '0 3px 0 #6b7280',
              }}
            >
              💳 Buy Credits — Coming soon
            </button>
          </div>

          {/* Transaction history */}
          <div style={cardStyle}>
            <h3 className="font-display text-[18px] mb-4" style={{ color: '#059669' }}>Transaction History</h3>
            {transactions.length === 0 ? (
              <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
                No transactions yet.
              </div>
            ) : (
              <div>
                {transactions.map((tx, i) => {
                  const label =
                    tx.reason === 'purchase_spent' ? `Spent ${Math.abs(tx.amount)} credit${Math.abs(tx.amount) === 1 ? '' : 's'}` :
                    tx.reason === 'sale_earned'    ? `Earned ${tx.amount} credit${tx.amount === 1 ? '' : 's'} from a sale` :
                    tx.reason === 'onboarding_bonus' ? 'Welcome bonus' :
                    'Admin adjustment'
                  const icon = tx.reason === 'purchase_spent' ? '💳' : tx.reason === 'sale_earned' ? '🤝' : '🎁'
                  const color = tx.amount >= 0 ? '#059669' : '#e11d48'
                  return (
                    <div key={tx.id} className="flex items-center gap-3"
                      style={{ padding: '12px 0', borderBottom: i < transactions.length - 1 ? '2px solid #f3f4f6' : 'none' }}>
                      <div className="flex items-center justify-center shrink-0"
                        style={{ width: 38, height: 38, borderRadius: 10, background: color + '18', fontSize: 18 }}>
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-[13px] truncate">{label}</p>
                        <p className="font-semibold text-[11px]" style={{ color: '#aaa' }}>
                          {new Date(tx.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </p>
                      </div>
                      <span className="font-black text-[15px] shrink-0" style={{ color }}>
                        {tx.amount >= 0 ? '+' : ''}{tx.amount}
                      </span>
                    </div>
                  )
                })}
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

      {/* ── MESSAGES — always mounted (not conditionally rendered like the other tabs) so
          MessagesTab's local message state and realtime subscription survive tab switches ── */}
      <div hidden={activeTab !== 'messages'}>
        <MessagesTab
          exchanges={exchanges}
          userId={profile?.id ?? ''}
          isDemo={isDemo}
          selectedId={selectedConversationId}
          onSelectId={setSelectedConversationId}
          unreadConversationIds={unreadEntityIds.message}
        />
      </div>

    </div>
  )
}
