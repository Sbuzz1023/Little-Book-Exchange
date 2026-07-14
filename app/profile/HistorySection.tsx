'use client'

import { useState } from 'react'
import { StarRatingBadge, StarRatingPicker } from '@/components/StarRating'

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

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export type HistoryExchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  exchange_status: string
  completed_at: string | null
  listings: { title: string; author: string; photo_url?: string | null }
  buyer: { username?: string | null; name?: string | null }
  seller: { username?: string | null; name?: string | null }
  buyer_hidden: boolean
  seller_hidden: boolean
  sellerRating: { average: number; count: number } | null
  reviewed: boolean
}

const cardStyle = {
  background: '#fff',
  borderRadius: 20,
  padding: 24,
  border: '2px solid #f3f4f6',
  boxShadow: '0 6px 0 #e5e7eb',
} as React.CSSProperties

export default function HistorySection({
  exchanges, userId, hideExchangeHistory, submitReview,
}: {
  exchanges: HistoryExchange[]
  userId: string
  hideExchangeHistory: (formData: FormData) => Promise<void>
  submitReview: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
}) {
  const [ratingTarget, setRatingTarget] = useState<HistoryExchange | null>(null)
  const [stars, setStars] = useState(5)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewedOverride, setReviewedOverride] = useState<Record<string, boolean>>({})

  const completed = exchanges
    .filter(e => {
      if (e.exchange_status !== 'completed') return false
      if (e.seller_id === userId) return !e.seller_hidden
      if (e.buyer_id === userId) return !e.buyer_hidden
      return false
    })
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  function openRating(ex: HistoryExchange) {
    setRatingTarget(ex)
    setStars(5)
    setText('')
    setError(null)
  }

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault()
    if (!ratingTarget) return
    setSubmitting(true)
    setError(null)
    const formData = new FormData()
    formData.set('conversation_id', ratingTarget.id)
    formData.set('seller_id', ratingTarget.seller_id)
    formData.set('rating', String(stars))
    formData.set('text', text)
    const result = await submitReview(formData)
    setSubmitting(false)
    if (result.ok) {
      setReviewedOverride(prev => ({ ...prev, [ratingTarget.id]: true }))
      setRatingTarget(null)
    } else {
      setError(result.error ?? 'Could not submit review.')
    }
  }

  return (
    <div style={cardStyle}>
      <div className="font-extrabold text-[11px] mb-4"
        style={{ textTransform: 'uppercase', letterSpacing: '0.8px', padding: '7px 12px', borderRadius: 10, background: '#f3f4f6', color: '#555', display: 'inline-block' }}>
        📜 History ({completed.length})
      </div>

      {completed.length === 0 ? (
        <div className="text-center py-6 font-bold text-[13px]" style={{ color: '#ccc' }}>No completed exchanges yet</div>
      ) : (
        completed.map(ex => {
          const role = ex.seller_id === userId ? 'seller' : 'buyer'
          const other = role === 'seller' ? ex.buyer : ex.seller
          const otherName = other?.name || other?.username || 'Neighbor'
          const reviewed = ex.reviewed || !!reviewedOverride[ex.id]

          return (
            <div key={ex.id} className="flex items-center gap-3" style={{ padding: '12px 0', borderBottom: '2px solid #f3f4f6' }}>
              <div className="relative shrink-0 overflow-hidden" style={{ width: 42, height: 42, borderRadius: 10, background: coverGradient(ex.listing_id) }}>
                {ex.listings?.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ex.listings.photo_url} alt={ex.listings.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span className="flex items-center justify-center w-full h-full text-[18px]">📚</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-black text-[13px] truncate">{ex.listings?.title ?? 'Unknown'}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-[12px]" style={{ color: '#aaa' }}>
                    {role === 'seller' ? 'Sold to' : 'Bought from'} <strong style={{ color: '#555' }}>{otherName}</strong>
                  </p>
                  {role === 'buyer' && <StarRatingBadge rating={ex.sellerRating} sellerId={ex.seller_id} />}
                </div>
                <p className="font-semibold text-[11px]" style={{ color: '#ccc' }}>{formatDate(ex.completed_at)}</p>
              </div>

              <span className="font-extrabold text-[10px] whitespace-nowrap shrink-0"
                style={{ padding: '3px 10px', borderRadius: 999, background: role === 'seller' ? '#fff7ed' : '#f0fdfa', color: role === 'seller' ? '#f97316' : '#0d9488' }}>
                {role === 'seller' ? 'Sold' : 'Bought'}
              </span>

              {role === 'buyer' && (
                reviewed ? (
                  <span className="font-bold text-[11px] shrink-0" style={{ color: '#aaa' }}>Rated</span>
                ) : (
                  <button type="button" onClick={() => openRating(ex)}
                    className="font-extrabold text-[11px] hover:opacity-80 shrink-0"
                    style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', padding: 0 }}>
                    ⭐ Rate Seller
                  </button>
                )
              )}

              <form action={hideExchangeHistory} className="shrink-0">
                <input type="hidden" name="conversation_id" value={ex.id} />
                <input type="hidden" name="role" value={role} />
                <button className="font-extrabold text-[11px] hover:opacity-80"
                  style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>
                  ✕
                </button>
              </form>
            </div>
          )
        })
      )}

      {ratingTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <form onSubmit={handleSubmitReview} style={{ background: '#fff', borderRadius: 20, padding: 24, width: 360, maxWidth: '90vw' }}>
            <h3 className="font-display text-[18px] mb-3">
              Rate {ratingTarget.seller?.name || ratingTarget.seller?.username || 'Seller'}
            </h3>
            <StarRatingPicker value={stars} onChange={setStars} />
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Optional comment..."
              className="w-full border-2 border-gray-100 rounded-xl font-semibold text-[13px] mt-3"
              style={{ padding: 10, minHeight: 70 }}
            />
            {error && <p className="font-bold text-[12px] mt-2" style={{ color: '#dc2626' }}>{error}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setRatingTarget(null)} className="font-extrabold text-[13px]"
                style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="font-extrabold text-[13px] text-white"
                style={{ background: '#f97316', padding: '9px 20px', borderRadius: 999, border: 'none', cursor: 'pointer' }}>
                {submitting ? 'Submitting...' : 'Submit Rating'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
