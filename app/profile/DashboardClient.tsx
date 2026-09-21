'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import ProfileCard from './ProfileCard'
import MessagesTab from './MessagesTab'
import HistorySection, { type HistoryExchange } from './HistorySection'
import TbrAddForm from './TbrAddForm'
import PhoneVerify from '@/components/PhoneVerify'
import StateSelect from '@/components/StateSelect'
import { createClient } from '@/lib/supabase/client'
import { pickupState, formatDeadline } from '@/lib/pickupStatus'
import { buildDirectionsUrl } from '@/lib/mapsLink'
import { formatPickupAvailability } from '@/lib/formatPickupAvailability'
import '../home.css'
import './dashboard.css'

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
  ol_work_key?: string | null
  cover_url?: string | null
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
  confirmed_address?: string | null
  confirmed_address_unit?: string | null
  confirmed_pickup?: string | null
  confirmed_pickup_mode?: 'window' | 'after' | 'anytime' | null
  confirmed_pickup_date?: string | null
  confirmed_pickup_time_start?: string | null
  confirmed_pickup_time_end?: string | null
  seller_picked_up_at?: string | null
  buyer_picked_up_at?: string | null
  completion_type?: string | null
  hasOpenDispute?: boolean
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
  }
  seller: {
    username?: string | null
    name?: string | null
    city?: string | null
    state?: string | null
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
  markPickedUp: (formData: FormData) => Promise<void>
  fileDispute: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  hideExchangeHistory: (formData: FormData) => Promise<void>
  submitReview: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  confirmExchange: (formData: FormData) => Promise<void>
  cancelPurchase: (formData: FormData) => Promise<void>
  denyPurchase: (formData: FormData) => Promise<void>
  removeSavedListing: (formData: FormData) => Promise<void>
  moveSavedListingToTbr: (formData: FormData) => Promise<void>
  addTbrEntry: (formData: FormData) => Promise<void>
  removeTbrEntry: (formData: FormData) => Promise<void>
  success?: boolean
  defaultTab?: Tab
  queryError?: string | null
  tbrError?: string | null
  error?: string | null
  isDemo: boolean
  initialConversationId?: string | null
  unreadCounts: { total: number; exchanges: number; tbr: number; messages: number }
  unreadEntityIds: { message: string[]; decisionOrPickup: string[]; tbrMatch: string[] }
  resendEmailConfirmation: () => Promise<{ ok: boolean; error?: string }>
  sendPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  verifyPhoneOtp: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
}

const TABS = [
  { id: 'listings' as Tab,  label: 'My Listings',     desc: 'Books you posted',     icon: '/home/dashboard-icon-listings.png' },
  { id: 'exchanges' as Tab, label: 'Exchanges',       desc: 'Pending handoffs',     icon: '/home/dashboard-icon-exchanges.png' },
  { id: 'tbr' as Tab,       label: 'To Be Read',      desc: 'Your wishlist',        icon: '/home/dashboard-icon-tbr.png' },
  { id: 'saved' as Tab,     label: 'Saved Listings',  desc: 'Listings you hearted', icon: '/home/dashboard-icon-saved.png' },
  { id: 'wallet' as Tab,    label: 'Wallet',          desc: 'Credits & history',    icon: '/home/dashboard-icon-wallet.png' },
  { id: 'account' as Tab,   label: 'Profile',         desc: 'Your profile',         icon: '/home/dashboard-icon-profile.png' },
  { id: 'messages' as Tab,  label: 'Messages',        desc: 'Chat with neighbors',  icon: '/home/dashboard-icon-messages.png' },
]

const COVER_GRADIENTS = [
  'linear-gradient(145deg, #F4E3D5, #E4B04A)',
  'linear-gradient(145deg, #EAF1EA, #6E7B3E)',
  'linear-gradient(145deg, #F5D9D2, #E07A5F)',
  'linear-gradient(145deg, #DDE7DF, #234A40)',
  'linear-gradient(145deg, #E4B04A, #B5462F)',
  'linear-gradient(145deg, #6E7B3E, #234A40)',
  'linear-gradient(145deg, #F4E3D5, #E07A5F)',
  'linear-gradient(145deg, #EAF1EA, #E4B04A)',
]

function coverGradient(id: string | null | undefined) {
  if (!id) return COVER_GRADIENTS[0]
  const sum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return COVER_GRADIENTS[sum % COVER_GRADIENTS.length]
}

function statusStyle(status: string) {
  if (status === 'sold')    return { background: '#F4E3D5', color: '#B5462F' }
  if (status === 'given')   return { background: '#EFEAF7', color: '#5B4B8A' }
  if (status === 'pending') return { background: '#FBF3DA', color: '#8A5A12' }
  if (status === 'paused')  return { background: '#F1EDE6', color: '#8A8178' }
  return { background: '#EAF1EA', color: '#234A40' }
}

function statusLabel(status: string) {
  if (status === 'sold')    return 'Sold'
  if (status === 'given')   return 'Given Away'
  if (status === 'pending') return 'Pending'
  if (status === 'paused')  return 'Paused'
  return 'Active'
}

function LeafGlyph() {
  return (
    <svg viewBox="0 0 34 34" width="24" height="24" aria-hidden="true">
      <path d="M17 31 C17 21 17 15 17 6" stroke="#234A40" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M17 16 C11.5 16 7.5 12.5 6.5 6 C13 5 17 9.5 17 16 Z" fill="#6E7B3E" />
      <path d="M17 21 C22.5 21 26.5 17.5 27.5 11 C21 10 17 14.5 17 21 Z" fill="#234A40" />
      <path d="M17 11.5 C20.5 11.5 23 9.5 24 5 C19.5 4.3 17 7 17 11.5 Z" fill="#E4B04A" />
    </svg>
  )
}

export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, transactions, updateAction, updateListingStatus, markPickedUp, fileDispute, hideExchangeHistory, submitReview, confirmExchange, denyPurchase, cancelPurchase, removeSavedListing, moveSavedListingToTbr, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError, error, isDemo, initialConversationId, unreadCounts, unreadEntityIds, resendEmailConfirmation, sendPhoneOtp, verifyPhoneOtp }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab ?? 'listings')
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId ?? null)
  const booksPosted = listings.reduce((sum, l: any) => sum + (l.book_count ?? 1), 0)
  const router = useRouter()
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone ?? '')
  const [emailResendMessage, setEmailResendMessage] = useState<string | null>(null)
  const [emailResendOk, setEmailResendOk] = useState(false)
  const [confirmModal, setConfirmModal] = useState<{
    conversationId: string
    title: string
    address: string
    addressUnit: string
    city: string
    state: string
    pickup: string
    pickupMode: '' | 'window' | 'after' | 'anytime'
    pickupDate: string
    pickupTimeStart: string
    pickupTimeEnd: string
  } | null>(null)
  const [disputeModal, setDisputeModal] = useState<{ conversationId: string; title: string } | null>(null)
  const [disputeMessage, setDisputeMessage] = useState('')
  const [disputeSubmitting, setDisputeSubmitting] = useState(false)
  const [disputeError, setDisputeError] = useState<string | null>(null)
  const [disputeSubmitted, setDisputeSubmitted] = useState(false)

  async function markTabRead(tabId: Tab) {
    if (isDemo || !profile?.id) return
    if (tabId === 'exchanges' && unreadEntityIds.decisionOrPickup.length > 0) {
      const supabase = createClient()
      await supabase.from('notifications').update({ read: true })
        .eq('user_id', profile.id).in('type', ['purchase_decision', 'pickup'])
      // Same reasoning as MessagesTab's selectConversation: the tab badges
      // (unreadCounts/unreadEntityIds) are server-rendered props from the
      // last page load, not live state — without this they'd stay stuck
      // showing unread until an unrelated navigation reloaded the page.
      router.refresh()
    } else if (tabId === 'tbr' && unreadEntityIds.tbrMatch.length > 0) {
      const supabase = createClient()
      await supabase.from('notifications').update({ read: true })
        .eq('user_id', profile.id).eq('type', 'tbr_match')
      router.refresh()
    }
  }

  function tabBadgeCount(id: Tab): number {
    if (id === 'exchanges') return unreadCounts.exchanges
    if (id === 'tbr') return unreadCounts.tbr
    if (id === 'messages') return unreadCounts.messages
    if (id === 'wallet') return !profile?.onboarding_bonus_claimed ? 1 : 0
    return 0
  }

  const tab = TABS.find(t => t.id === activeTab)!

  return (
    <div className="home-v2 dash-page">
      <div className="wrap dash-wrap">

        {/* Hero — the illustration is pulled toward the tab row below (dash-tabs has a
            negative top margin) so it appears to run slightly under the cards. */}
        <section className="hero dash-hero">
          <div className="hero-grid dash-hero-grid">
            <div>
              <h1>Your Book Nook</h1>
              <p className="sub">Manage your listings, track exchanges, and keep your reading journey going.</p>
            </div>
            <div className="hero-art dash-hero-art">
              <img src="/home/dashboard-hero.png" alt="A cozy reading nook with an armchair, coffee, and plants — a brighter community, one book at a time" />
            </div>
          </div>
        </section>

        {/* Tab nav — 4 cols mobile, 7 cols desktop */}
        <div className="dash-tabs">
          {TABS.map(t => {
            const isActive = activeTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => { setActiveTab(t.id); if (t.id === 'messages') setSelectedConversationId(null); markTabRead(t.id) }}
                className={`dash-tab${isActive ? ' is-active' : ''}`}
              >
                {tabBadgeCount(t.id) > 0 && (
                  <span data-testid="tab-badge" className="dash-tab-badge">
                    {tabBadgeCount(t.id)}
                  </span>
                )}
                <img src={t.icon} alt="" className="dash-tab-icon" />
                <span className="dash-tab-label">{t.label}</span>
                <span className="dash-tab-desc">{t.desc}</span>
              </button>
            )
          })}
        </div>

        {/* Narrower content column — room on both sides for the vine/sketch images */}
        <div className="dash-content">
          <img src="/home/dashboard-vine.png" alt="" className="dash-vine" aria-hidden="true" />
          <img src="/home/dashboard-sketch.png" alt="" className="dash-sketch" aria-hidden="true" />

        {/* Active section heading */}
        <div className="dash-section-head">
          <div className="dash-section-title">
            <LeafGlyph />
            <div>
              <h2>{tab.label}</h2>
              <p>{tab.desc}</p>
            </div>
          </div>
          {activeTab === 'listings' && (
            <Link href="/post" className="btn btn-primary">+ Post a Book</Link>
          )}
        </div>

        {/* ── MY LISTINGS ── */}
        {activeTab === 'listings' && (() => {
          const active = listings.filter(l => l.status === 'active')
          const paused = listings.filter(l => l.status === 'paused')

          const ListingRow = ({ l, action }: { l: Listing; action: 'pause' | 'resume' }) => (
            <div className="dash-row">
              <div className="relative shrink-0 overflow-hidden dash-row-thumb"
                style={{ background: coverGradient(l.id) }}>
                {l.photo_url ? (
                  <Image src={l.photo_url} alt={l.title} fill className="object-cover" style={{ borderRadius: 8 }} />
                ) : (
                  <span className="flex items-center justify-center w-full h-full text-[18px]">📚</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <Link href={`/listings/${l.id}`} className="dash-row-title truncate block">
                  {l.title}
                </Link>
                <p className="dash-row-meta">
                  {l.author} · 1 credit · {l.condition}
                </p>
              </div>
              <span className="dash-pill whitespace-nowrap shrink-0" style={statusStyle(l.status)}>
                {statusLabel(l.status)}
              </span>
              <Link href={`/listings/${l.id}/edit`} className="dash-link shrink-0">
                Edit
              </Link>
              <form action={updateListingStatus} className="flex gap-3 shrink-0">
                <input type="hidden" name="id" value={l.id} />
                {action === 'pause' ? (
                  <button name="status" value="paused" className="dash-link">
                    Pause
                  </button>
                ) : (
                  <button name="status" value="active" className="dash-link">
                    Resume
                  </button>
                )}
                <button name="status" value="delete" className="dash-link dash-link--danger">
                  Delete
                </button>
              </form>
            </div>
          )

          return (
            <>
              <div className="dash-card">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-bold text-[13.5px]" style={{ color: '#8A8178' }}>
                    {listings.length} book{listings.length !== 1 ? 's' : ''} posted
                  </p>
                  <span className="font-bold text-[13.5px]" style={{ color: '#4A4038' }}>Sort by: Newest ⌄</span>
                </div>

                {listings.length === 0 ? (
                  <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#8A8178' }}>
                    No listings yet.{' '}
                    <Link href="/post" className="font-extrabold hover:underline" style={{ color: '#234A40' }}>Post your first book!</Link>
                  </div>
                ) : active.length === 0 ? (
                  <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#8A8178' }}>
                    No active listings.{' '}
                    <Link href="/post" className="font-extrabold hover:underline" style={{ color: '#234A40' }}>Post a book!</Link>
                  </div>
                ) : (
                  <div>
                    {active.map(l => <ListingRow key={l.id} l={l} action="pause" />)}
                  </div>
                )}
              </div>

              {paused.length > 0 && (
                <div className="dash-card">
                  <div className="dash-badge-soft mb-2" style={{ background: '#F1EDE6', color: '#8A8178' }}>
                    Paused ({paused.length})
                  </div>
                  <div>
                    {paused.map(l => <ListingRow key={l.id} l={l} action="resume" />)}
                  </div>
                </div>
              )}
            </>
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
                ? { bg: '#FBF3DA', border: '#EBD9A0', color: '#8A5A12', label: '⏳ Pending Seller' }
              : status === 'requested' && role === 'seller'
                ? { bg: '#F4E3D5', border: '#E9C8AC', color: '#B5462F', label: '🔔 Needs Your OK' }
              : status === 'confirmed'
                ? { bg: '#EAF1EA', border: '#BFDBC7', color: '#234A40', label: '✅ Ready for Pick Up' }
              : { bg: '#F1EDE6', border: '#E7DCCB', color: '#8A8178', label: '💬 Chatting' }

            const isPendingSellerAction = role === 'seller' && status === 'requested'
            const isUnreadDecisionOrPickup = unreadEntityIds.decisionOrPickup.includes(ex.id)
            const highlighted = isPendingSellerAction || isUnreadDecisionOrPickup

            // Dual pickup confirmation state — computed once, used by both the header's
            // Dispute slot and the action row below. Safe to call for any status: it
            // returns 'not_yet' unless exchangeStatus is 'confirmed'.
            const pickup = pickupState({
              role,
              exchangeStatus: status,
              sellerPickedUpAt: ex.seller_picked_up_at ?? null,
              buyerPickedUpAt: ex.buyer_picked_up_at ?? null,
              hasOpenDispute: !!ex.hasOpenDispute,
            })

            // Buyer-only: a Directions link to the confirmed pickup address. Uses the
            // listing's city/state — the confirmed address itself has no city/state of
            // its own in the database — so this is null if there's no street address to
            // build from (e.g. the seller only gave a pickup description).
            const directionsUrl = buildDirectionsUrl({
              address: ex.confirmed_address ?? '',
              addressUnit: ex.confirmed_address_unit ?? '',
              city: ex.listings?.city ?? '',
              state: ex.listings?.state ?? '',
            })

            return (
              <div
                data-testid={highlighted ? 'exchange-row-highlighted' : undefined}
                style={{
                  padding: '16px 0 16px 12px', borderBottom: '1px solid #E7DCCB',
                  ...(highlighted ? { background: '#F4E3D5', borderRadius: 12, boxShadow: 'inset 3px 0 0 #B5462F' } : {}),
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
                      <span className="flex items-center justify-center w-full h-full text-[20px]">📚</span>
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
                    <p className="font-semibold text-[11px]" style={{ color: '#8A8178' }}>{ex.listings?.author ?? ''}</p>

                    {/* Status-specific context line */}
                    {role === 'seller' && status === 'requested' && (
                      <p className="font-bold text-[12px] mt-1" style={{ color: '#B5462F' }}>
                        🔔 <strong>{otherName}</strong> wants to purchase this book!
                      </p>
                    )}
                    {role === 'seller' && status === 'confirmed' && (
                      <p className="font-bold text-[12px] mt-1" style={{ color: '#234A40' }}>
                        Your contact info was sent to <strong>{otherName}</strong>.
                      </p>
                    )}
                    {role === 'seller' && status === 'none' && (
                      <p className="font-semibold text-[12px] mt-1" style={{ color: '#8A8178' }}>
                        Messaging with <strong style={{ color: '#4A4038' }}>{otherName}</strong>
                      </p>
                    )}
                    {role === 'buyer' && status === 'requested' && (
                      <p className="font-bold text-[12px] mt-1" style={{ color: '#8A5A12' }}>
                        Waiting for <strong>{otherName}</strong> to approve your request
                      </p>
                    )}
                    {role === 'buyer' && status === 'confirmed' && (
                      <div className="mt-2 rounded-[10px] px-3 py-2" style={{ background: '#EAF1EA', border: '1.5px solid #BFDBC7' }}>
                        <p className="font-extrabold text-[12px]" style={{ color: '#234A40' }}>📍 Ready for Pick Up!</p>
                        {location && <p className="font-semibold text-[11px] mt-0.5" style={{ color: '#234A40' }}>📌 {location}</p>}
                        {(ex.confirmed_address || ex.confirmed_address_unit) && (
                          <p className="font-semibold text-[11px] flex items-center gap-2 flex-wrap" style={{ color: '#234A40' }}>
                            🏠 {[ex.confirmed_address, ex.confirmed_address_unit].filter(Boolean).join(' ')}
                            {directionsUrl && (
                              <a href={directionsUrl} target="_blank" rel="noopener noreferrer"
                                className="font-extrabold hover:opacity-80"
                                style={{ color: '#234A40', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
                                🧭 Directions
                              </a>
                            )}
                          </p>
                        )}
                        {ex.confirmed_pickup && (
                          <p className="font-semibold text-[11px]" style={{ color: '#234A40' }}>📦 Pickup: {ex.confirmed_pickup}</p>
                        )}
                        {(() => {
                          const availability = formatPickupAvailability({
                            mode: ex.confirmed_pickup_mode,
                            date: ex.confirmed_pickup_date,
                            timeStart: ex.confirmed_pickup_time_start,
                            timeEnd: ex.confirmed_pickup_time_end,
                          })
                          return availability && (
                            <p className="font-semibold text-[11px]" style={{ color: '#234A40' }}>🕐 {availability}</p>
                          )
                        })()}
                        <p className="font-semibold text-[11px]" style={{ color: '#234A40' }}>Contact: <strong>{otherName}</strong></p>
                      </div>
                    )}
                    {role === 'buyer' && status === 'none' && (
                      <p className="font-semibold text-[12px] mt-1" style={{ color: '#8A8178' }}>
                        from <strong style={{ color: '#4A4038' }}>{otherName}</strong>{location ? ` · ${location}` : ''}
                      </p>
                    )}
                  </div>

                  {/* Header-right slot: Dispute, quiet and available (not something we want to invite) —
                      only shown while it's actually actionable (both sides confirmed, pickup pending). */}
                  <div data-testid="exchange-header-actions" className="shrink-0">
                    {pickup.kind === 'can_confirm' && (
                      <button
                        type="button"
                        onClick={() => {
                          setDisputeModal({ conversationId: ex.id, title: ex.listings?.title ?? 'this book' })
                          setDisputeMessage('')
                          setDisputeError(null)
                          setDisputeSubmitted(false)
                        }}
                        className="font-bold text-[10px] whitespace-nowrap hover:opacity-70"
                        style={{ background: 'transparent', border: '1px solid #E7DCCB', color: '#8A8178', padding: '4px 10px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}
                      >
                        🚩 Dispute
                      </button>
                    )}
                  </div>
                </div>

                {/* Action row below — status-driven */}
                <div data-testid="exchange-action-row" className="flex gap-2 mt-3 flex-wrap items-center" style={{ paddingLeft: 58 }}>
                  {/* Seller: confirm a purchase request */}
                  {role === 'seller' && status === 'requested' && (
                    <button
                      type="button"
                      onClick={() => setConfirmModal({
                        conversationId: ex.id,
                        title: ex.listings?.title ?? 'this book',
                        address: profile?.address ?? '',
                        addressUnit: profile?.address_unit ?? '',
                        city: profile?.city ?? '',
                        state: profile?.state ?? '',
                        pickup: ex.listings?.pickup_description || profile?.pickup_description || '',
                        pickupMode: '',
                        pickupDate: '',
                        pickupTimeStart: '',
                        pickupTimeEnd: '',
                      })}
                      className="font-extrabold text-[12px] text-white hover:opacity-90"
                      style={{ background: '#234A40', border: 'none', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                      ✅ Confirm — Send My Contact Info
                    </button>
                  )}

                  {/* Seller: deny a purchase request */}
                  {role === 'seller' && status === 'requested' && (
                    <form action={denyPurchase} onSubmit={e => { if (!confirm('Deny this purchase request?')) e.preventDefault() }}>
                      <input type="hidden" name="conversation_id" value={ex.id} />
                      <button className="font-extrabold text-[12px] hover:opacity-80 dash-btn-danger"
                        style={{ padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                        ✕ Deny
                      </button>
                    </form>
                  )}

                  {/* Both roles: dual pickup confirmation, once status is confirmed */}
                  {status === 'confirmed' && pickup.kind === 'disputed' && (
                    <span className="font-extrabold text-[12px]"
                      style={{ color: '#8A5A12', background: '#FBF3DA', border: '1.5px solid #EBD9A0', padding: '7px 18px', borderRadius: 999 }}>
                      ⚠️ Dispute pending review
                    </span>
                  )}

                  {status === 'confirmed' && pickup.kind === 'waiting' && (
                    <span className="font-extrabold text-[12px]"
                      style={{ color: '#234A40', background: '#EAF1EA', border: '1.5px solid #BFDBC7', padding: '7px 18px', borderRadius: 999 }}>
                      ✅ You confirmed — waiting for {otherName} (auto-completes {formatDeadline(pickup.deadline)})
                    </span>
                  )}

                  {status === 'confirmed' && pickup.kind === 'can_confirm' && (
                    <div className="flex flex-col items-start gap-1">
                      {role === 'buyer' && (
                        <p className="font-semibold text-[11px]" style={{ color: '#8A8178' }}>
                          🔍 Check the book's condition before confirming
                        </p>
                      )}
                      <form action={markPickedUp}>
                        <input type="hidden" name="conversation_id" value={ex.id} />
                        <button className="font-extrabold text-[12px] hover:opacity-80"
                          style={{ background: '#F4E3D5', border: '1.5px solid #E9C8AC', color: '#B5462F', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {role === 'seller' ? '📦 Mark Picked Up' : '📚 I Got It!'}
                        </button>
                      </form>
                    </div>
                  )}

                  {/* Buyer: cancel before seller confirms */}
                  {role === 'buyer' && status === 'requested' && (
                    <form action={cancelPurchase} onSubmit={e => { if (!confirm('Cancel this purchase request?')) e.preventDefault() }}>
                      <input type="hidden" name="conversation_id" value={ex.id} />
                      <button className="font-extrabold text-[12px] hover:opacity-80 dash-btn-danger"
                        style={{ padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                        ✕ Cancel Request
                      </button>
                    </form>
                  )}

                  {/* Message — always available, every status, now living here instead of the header */}
                  <button
                    type="button"
                    onClick={() => { setActiveTab('messages'); setSelectedConversationId(ex.id) }}
                    className="font-extrabold text-[12px] text-white whitespace-nowrap hover:opacity-90"
                    style={{ background: '#234A40', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    💬 Message
                  </button>

                </div>
              </div>
            )
          }

          return (
            <div className="flex flex-col" style={{ gap: 16 }}>
              {/* Going Out */}
              <div className="dash-card">
                <div className="dash-badge-soft mb-4" style={{ background: '#F4E3D5', color: '#B5462F' }}>
                  📤 Sold ({sold.length})
                </div>
                {sold.length === 0 ? (
                  <div className="text-center py-6 font-bold text-[13px]" style={{ color: '#B5AFA4' }}>No active sales</div>
                ) : (
                  sold.map(ex => <ExchangeRow key={ex.id} ex={ex} role="seller" />)
                )}
              </div>

              {/* Coming In */}
              <div className="dash-card">
                <div className="dash-badge-soft mb-4" style={{ background: '#EAF1EA', color: '#234A40' }}>
                  📥 Bought ({bought.length})
                </div>
                {bought.length === 0 ? (
                  <div className="text-center py-6 font-bold text-[13px]" style={{ color: '#B5AFA4' }}>No books on the way</div>
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
                unreadConversationIds={unreadEntityIds.decisionOrPickup}
              />

              {/* Confirm-and-review popup */}
              {confirmModal && (
                <div className="dash-modal-overlay">
                  <form
                    action={confirmExchange}
                    onSubmit={() => setConfirmModal(null)}
                    className="dash-modal"
                  >
                    <button
                      type="button"
                      onClick={() => setConfirmModal(null)}
                      aria-label="Close"
                      style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: '#8A8178', cursor: 'pointer', fontSize: 18, fontWeight: 900, lineHeight: 1 }}
                    >
                      ✕
                    </button>
                    <h3 className="mb-1">Confirm exchange</h3>
                    <p className="font-semibold text-[12px] mb-4" style={{ color: '#8A8178' }}>
                      Review the pickup info for <strong style={{ color: '#4A4038' }}>{confirmModal.title}</strong> before it's sent to the buyer.
                    </p>
                    <input type="hidden" name="conversation_id" value={confirmModal.conversationId} />

                    <label>Address</label>
                    <input
                      name="address"
                      value={confirmModal.address}
                      onChange={e => setConfirmModal({ ...confirmModal, address: e.target.value })}
                      placeholder="Street address"
                      className="mt-1 mb-3"
                    />

                    <label>Apt / Unit (optional)</label>
                    <input
                      name="address_unit"
                      value={confirmModal.addressUnit}
                      onChange={e => setConfirmModal({ ...confirmModal, addressUnit: e.target.value })}
                      placeholder="Apt, suite, unit"
                      className="mt-1 mb-3"
                    />

                    <div className="flex gap-2 mb-3">
                      <div className="flex-1">
                        <label>City</label>
                        <input
                          name="city"
                          value={confirmModal.city}
                          onChange={e => setConfirmModal({ ...confirmModal, city: e.target.value })}
                          placeholder="City"
                          className="mt-1"
                        />
                      </div>
                      <div style={{ width: 120 }}>
                        <label>State</label>
                        <StateSelect
                          name="state"
                          defaultValue={confirmModal.state}
                          placeholder="State"
                          className="mt-1"
                        />
                      </div>
                    </div>

                    <label>Pickup spot</label>
                    <textarea
                      name="pickup"
                      value={confirmModal.pickup}
                      onChange={e => setConfirmModal({ ...confirmModal, pickup: e.target.value })}
                      placeholder="e.g. front porch, behind the garden gnome"
                      className="mt-1 mb-3"
                      style={{ minHeight: 60 }}
                    />

                    <label>When are you available?</label>
                    <div className="flex gap-2 mt-1 mb-3 flex-wrap">
                      {([
                        ['window', '🕐 Time window'],
                        ['after', '⏰ After a time'],
                        ['anytime', '✅ Ready now'],
                      ] as const).map(([mode, label]) => (
                        <label
                          key={mode}
                          className="font-extrabold text-[12px]"
                          style={{
                            padding: '7px 12px', borderRadius: 999, cursor: 'pointer',
                            border: `1.5px solid ${confirmModal.pickupMode === mode ? '#234A40' : '#E7DCCB'}`,
                            background: confirmModal.pickupMode === mode ? '#EAF1EA' : '#fff',
                            color: confirmModal.pickupMode === mode ? '#234A40' : '#4A4038',
                          }}
                        >
                          <input
                            type="radio"
                            name="pickup_mode"
                            value={mode}
                            required
                            checked={confirmModal.pickupMode === mode}
                            onChange={() => setConfirmModal({ ...confirmModal, pickupMode: mode })}
                            style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    {(confirmModal.pickupMode === 'window' || confirmModal.pickupMode === 'after') && (
                      <div className="flex gap-2 mb-3">
                        <div className="flex-1">
                          <label htmlFor="pickup_date">Date</label>
                          <input
                            id="pickup_date"
                            name="pickup_date"
                            type="date"
                            required
                            value={confirmModal.pickupDate}
                            onChange={e => setConfirmModal({ ...confirmModal, pickupDate: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                        <div style={{ width: 110 }}>
                          <label htmlFor="pickup_time_start">Start time</label>
                          <input
                            id="pickup_time_start"
                            name="pickup_time_start"
                            type="time"
                            required
                            value={confirmModal.pickupTimeStart}
                            onChange={e => setConfirmModal({ ...confirmModal, pickupTimeStart: e.target.value })}
                            className="mt-1"
                          />
                        </div>
                        {confirmModal.pickupMode === 'window' && (
                          <div style={{ width: 110 }}>
                            <label htmlFor="pickup_time_end">End time</label>
                            <input
                              id="pickup_time_end"
                              name="pickup_time_end"
                              type="time"
                              required
                              value={confirmModal.pickupTimeEnd}
                              onChange={e => setConfirmModal({ ...confirmModal, pickupTimeEnd: e.target.value })}
                              className="mt-1"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex justify-end gap-2 mt-4">
                      <button type="button" onClick={() => setConfirmModal(null)} className="font-extrabold text-[13px]"
                        style={{ background: 'none', border: 'none', color: '#8A8178', cursor: 'pointer' }}>
                        Cancel
                      </button>
                      <button type="submit" className="font-extrabold text-[13px] text-white"
                        style={{ background: '#234A40', padding: '9px 20px', borderRadius: 999, border: 'none', cursor: 'pointer' }}>
                        ✅ Submit Confirmation
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Dispute popup */}
              {disputeModal && (
                <div className="dash-modal-overlay">
                  <div className="dash-modal">
                    <button
                      type="button"
                      onClick={() => setDisputeModal(null)}
                      aria-label="Close"
                      style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: '#8A8178', cursor: 'pointer', fontSize: 18, fontWeight: 900, lineHeight: 1 }}
                    >
                      ✕
                    </button>
                    <h3 className="mb-1">Report an issue</h3>
                    <p className="font-semibold text-[12px] mb-4" style={{ color: '#8A8178' }}>
                      Tell us what's wrong with <strong style={{ color: '#4A4038' }}>{disputeModal.title}</strong> — this pauses the exchange until an admin looks into it.
                    </p>

                    {disputeSubmitted ? (
                      <p className="font-bold text-[13px]" style={{ color: '#234A40' }}>
                        We've notified the admin team. This exchange is paused until it's resolved.
                      </p>
                    ) : (
                      <>
                        <textarea
                          value={disputeMessage}
                          onChange={e => setDisputeMessage(e.target.value)}
                          placeholder="Describe the issue..."
                          style={{ minHeight: 90 }}
                        />
                        {disputeError && <p className="font-bold text-[12px] mt-2" style={{ color: '#B5462F' }}>{disputeError}</p>}
                        <div className="flex justify-end gap-2 mt-4">
                          <button type="button" onClick={() => setDisputeModal(null)} className="font-extrabold text-[13px]"
                            style={{ background: 'none', border: 'none', color: '#8A8178', cursor: 'pointer' }}>
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={disputeSubmitting}
                            onClick={async () => {
                              if (!disputeMessage.trim()) { setDisputeError('Please describe the issue.'); return }
                              setDisputeSubmitting(true)
                              setDisputeError(null)
                              const fd = new FormData()
                              fd.set('conversation_id', disputeModal.conversationId)
                              fd.set('message', disputeMessage)
                              const result = await fileDispute(fd)
                              setDisputeSubmitting(false)
                              if (result.ok) { setDisputeSubmitted(true); router.refresh() }
                              else setDisputeError(result.error ?? 'Could not send this. Please try again.')
                            }}
                            className="font-extrabold text-[13px] text-white"
                            style={{ background: '#B5462F', padding: '9px 20px', borderRadius: 999, border: 'none', cursor: 'pointer' }}>
                            {disputeSubmitting ? 'Sending...' : 'Send to Admin'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── TO BE READ ── */}
        {activeTab === 'tbr' && (
          <div className="dash-card">
            <p className="font-bold text-[13px] mb-5" style={{ color: '#8A8178' }}>
              Add books you want to read — we'll show you when one is listed nearby.
            </p>

            {tbrError && (
              <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-red-700 font-bold text-sm mb-4">
                {tbrError}
              </div>
            )}

            <TbrAddForm addTbrEntry={addTbrEntry} />

            {tbrEntries.length === 0 ? (
              <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#8A8178' }}>
                No books on your TBR yet.
              </div>
            ) : (
              <>
                {/* Desktop: table with column headers */}
                <div className="hidden md:block">
                  <div className="grid gap-3 px-1 pb-2" style={{ gridTemplateColumns: '46px 2fr 1.5fr 1fr 70px 150px', borderBottom: '1px solid #E7DCCB' }}>
                    {['', 'Title', 'Author', 'City', 'State', ''].map(h => (
                      <span key={h} className="font-black text-[11px]" style={{ textTransform: 'uppercase', letterSpacing: '0.6px', color: '#8A8178' }}>
                        {h}
                      </span>
                    ))}
                  </div>
                  {tbrEntries.map(entry => {
                    const isUnread = unreadEntityIds.tbrMatch.includes(entry.id)
                    return (
                    <div key={entry.id} className="grid gap-3 items-center px-1"
                      style={{ gridTemplateColumns: '46px 2fr 1.5fr 1fr 70px 150px', padding: '12px 4px', borderBottom: '1px solid #E7DCCB', ...(isUnread ? { background: '#EFEAF7', borderRadius: 10 } : {}) }}>
                      {entry.cover_url ? (
                        <img src={entry.cover_url} alt="" style={{ width: 32, height: 46, objectFit: 'cover', borderRadius: 4 }} />
                      ) : (
                        <span style={{ width: 32, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📚</span>
                      )}
                      <span className="font-black text-[14px] truncate">{entry.title || '—'}</span>
                      <span className="font-semibold text-[13px] truncate" style={{ color: entry.author ? '#4A4038' : '#C7BFB2' }}>{entry.author || '—'}</span>
                      <span className="font-semibold text-[13px] truncate" style={{ color: entry.city ? '#4A4038' : '#C7BFB2' }}>{entry.city || '—'}</span>
                      <span className="font-semibold text-[13px]" style={{ color: entry.state ? '#4A4038' : '#C7BFB2' }}>{entry.state || '—'}</span>
                      <div className="flex items-center justify-end gap-3">
                        {entry.match && (
                          <Link href={`/listings/${entry.match.id}`}
                            className="font-extrabold text-[11px] text-white whitespace-nowrap"
                            style={{ background: '#5B4B8A', padding: '5px 10px', borderRadius: 999 }}>
                            📖 Avail
                          </Link>
                        )}
                        <form action={removeTbrEntry}>
                          <input type="hidden" name="id" value={entry.id} />
                          <button className="font-extrabold text-[15px] hover:opacity-70" aria-label="Delete"
                            style={{ background: 'none', border: 'none', color: '#C88', cursor: 'pointer', padding: 0 }}>
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
                    <div key={entry.id} style={{ padding: '12px 0', borderBottom: '1px solid #E7DCCB', display: 'flex', gap: 10, ...(isUnread ? { background: '#EFEAF7', borderRadius: 10 } : {}) }}>
                      {entry.cover_url ? (
                        <img src={entry.cover_url} alt="" style={{ width: 32, height: 46, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                      ) : (
                        <span style={{ width: 32, height: 46, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📚</span>
                      )}
                      <div style={{ flex: 1 }}>
                      <p className="font-black text-[14px] truncate">
                        {entry.title || `by ${entry.author}`}
                      </p>
                      <p className="font-semibold text-[12px] mb-2" style={{ color: '#8A8178' }}>
                        {[entry.title && entry.author ? `by ${entry.author}` : null, entry.city, entry.state]
                          .filter(Boolean).join(' · ')}
                      </p>
                      <div className="flex items-center gap-3 flex-wrap">
                        {entry.match && (
                          <Link href={`/listings/${entry.match.id}`}
                            className="font-extrabold text-[12px] text-white whitespace-nowrap"
                            style={{ background: '#5B4B8A', padding: '6px 14px', borderRadius: 999 }}>
                            📖 Available!
                          </Link>
                        )}
                        <form action={removeTbrEntry}>
                          <input type="hidden" name="id" value={entry.id} />
                          <button className="font-extrabold text-[11px] hover:opacity-80"
                            style={{ background: 'none', border: 'none', color: '#8A8178', cursor: 'pointer', padding: 0 }}>
                            ✕ Delete
                          </button>
                        </form>
                      </div>
                      </div>
                    </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── SAVED LISTINGS ── */}
        {activeTab === 'saved' && (
          <div className="dash-card">
            {savedListings.length === 0 ? (
              <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#8A8178' }}>
                No saved listings yet.{' '}
                <Link href="/listings" className="font-extrabold hover:underline" style={{ color: '#B5462F' }}>Browse listings</Link>
                {' '}and tap the ♡ to save!
              </div>
            ) : (
              <div>
                {savedListings.map(l => {
                  const sold = l.status !== 'active'
                  return (
                  <div key={l.id} className="dash-row" style={{ opacity: sold ? 0.6 : 1 }}>
                    <div className="relative shrink-0 overflow-hidden dash-row-thumb"
                      style={{ background: coverGradient(l.id) }}>
                      {l.photo_url ? (
                        <Image src={l.photo_url} alt={l.title} fill className="object-cover" style={{ borderRadius: 8 }} />
                      ) : (
                        <span className="flex items-center justify-center w-full h-full text-[18px]">📚</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link href={`/listings/${l.id}`} className="dash-row-title truncate">
                          {l.title}
                        </Link>
                        {sold && (
                          <span className="dash-pill" style={{ background: '#F1EDE6', color: '#8A8178' }}>
                            Sold
                          </span>
                        )}
                      </div>
                      <p className="dash-row-meta">
                        {l.author} · {l.condition}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {sold && (
                        <form action={moveSavedListingToTbr}>
                          <input type="hidden" name="listing_id" value={l.id} />
                          <button className="dash-link" style={{ color: '#5B4B8A', whiteSpace: 'nowrap' }}>
                            📖 Move to To Be Read
                          </button>
                        </form>
                      )}
                      <form action={removeSavedListing}>
                        <input type="hidden" name="listing_id" value={l.id} />
                        <button className="dash-link dash-link--danger" style={{ whiteSpace: 'nowrap' }}>
                          💔 Unsave
                        </button>
                      </form>
                    </div>
                  </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── WALLET ── */}
        {activeTab === 'wallet' && (
          <div className="flex flex-col" style={{ gap: 16 }}>

            {!profile?.onboarding_bonus_claimed && (
              <div className="dash-card dash-card--accent">
                <h3 style={{ color: '#234A40' }} className="mb-3"><span aria-hidden="true">🎯</span> Earn Your First Credit</h3>
                <div className="flex flex-col" style={{ gap: 10 }}>
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[13px]">{profile?.email_verified ? '✅' : '☐'} Verify email</span>
                      {!profile?.email_verified && (
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await resendEmailConfirmation()
                            setEmailResendOk(res.ok)
                            setEmailResendMessage(res.ok ? 'Confirmation email sent — check your inbox.' : (res.error ?? 'Failed to send confirmation email.'))
                          }}
                          className="font-extrabold text-[12px]"
                          style={{ background: 'none', border: 'none', color: '#234A40', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}
                        >
                          Resend confirmation email
                        </button>
                      )}
                    </div>
                    {emailResendMessage && (
                      <p className="font-bold text-[11px] mt-1" style={{ color: emailResendOk ? '#234A40' : '#B5462F' }}>{emailResendMessage}</p>
                    )}
                  </div>
                  <div>
                    <span className="font-bold text-[13px]">{profile?.phone_verified ? '✅' : '☐'} Verify phone</span>
                    <PhoneVerify
                      phone={phoneNumber}
                      onPhoneChange={setPhoneNumber}
                      phoneVerified={!!profile?.phone_verified}
                      sendPhoneOtp={sendPhoneOtp}
                      verifyPhoneOtp={verifyPhoneOtp}
                      onVerified={() => router.refresh()}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[13px]">{booksPosted >= 3 ? '✅' : '☐'} Books posted</span>
                    <span className="font-extrabold text-[12px]" style={{ color: '#8A8178' }}>{Math.min(booksPosted, 3)}/3</span>
                  </div>
                </div>
              </div>
            )}
            {profile?.onboarding_bonus_claimed && (
              <div className="dash-card dash-card--accent" style={{ textAlign: 'center' }}>
                <p className="font-black text-[14px]" style={{ color: '#234A40' }}>🎉 Bonus earned — you got 1 free credit!</p>
              </div>
            )}

            {/* Balance card */}
            <div className="dash-balance">
              <p className="font-extrabold text-[11px] mb-1" style={{ color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                Available Balance
              </p>
              <div className="flex items-end gap-3 mb-2">
                <span style={{ fontFamily: "'Newsreader', Georgia, serif", fontWeight: 600, fontSize: 48, color: '#fff', lineHeight: 1 }}>{profile?.credits ?? 0}</span>
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
                  background: 'rgba(255,255,255,0.25)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 12,
                  padding: '13px',
                  cursor: 'not-allowed',
                  fontFamily: 'inherit',
                }}
              >
                💳 Buy Credits — Coming soon
              </button>
            </div>

            {/* Transaction history */}
            <div className="dash-card">
              <h3 style={{ color: '#234A40' }} className="mb-4">Transaction History</h3>
              {transactions.length === 0 ? (
                <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#8A8178' }}>
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
                    const color = tx.amount >= 0 ? '#234A40' : '#B5462F'
                    return (
                      <div key={tx.id} className="flex items-center gap-3"
                        style={{ padding: '12px 0', borderBottom: i < transactions.length - 1 ? '1px solid #E7DCCB' : 'none' }}>
                        <div className="flex items-center justify-center shrink-0"
                          style={{ width: 38, height: 38, borderRadius: 10, background: color + '18', fontSize: 18 }}>
                          {icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-[13px] truncate">{label}</p>
                          <p className="font-semibold text-[11px]" style={{ color: '#8A8178' }}>
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
            <ProfileCard
              profile={profile}
              updateAction={updateAction}
              success={success}
              error={error}
              sendPhoneOtp={sendPhoneOtp}
              verifyPhoneOtp={verifyPhoneOtp}
              onPhoneVerified={() => router.refresh()}
            />
            <div style={{ borderTop: '1px dashed #E7DCCB', paddingTop: 16 }}>
              <form action="/auth/signout" method="post">
                <button className="font-bold text-sm hover:text-red-400 transition-colors"
                  style={{ background: 'none', border: 'none', color: '#8A8178', cursor: 'pointer' }}>
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

      </div>
    </div>
  )
}
