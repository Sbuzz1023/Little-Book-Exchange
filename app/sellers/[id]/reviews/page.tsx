import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { averageRating } from '@/lib/reviewAverages'

export default async function SellerReviewsPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: seller } = await supabase
    .from('profiles').select('id, username, name').eq('id', params.id).single()
  if (!seller) notFound()

  const { data: reviewRows } = await supabase
    .from('reviews')
    .select('id, rating, text, created_at, reviewer_id')
    .eq('seller_id', params.id)
    .order('created_at', { ascending: false })

  const reviewerIds = [...new Set((reviewRows ?? []).map((r: any) => r.reviewer_id))]
  const { data: reviewerRows } = reviewerIds.length > 0
    ? await supabase.from('profiles').select('id, username, name').in('id', reviewerIds)
    : { data: [] as any[] }
  const reviewerMap: Record<string, string> = {}
  for (const p of reviewerRows ?? []) reviewerMap[p.id] = p.username || p.name || 'Neighbor'

  const summary = averageRating((reviewRows ?? []).map((r: any) => r.rating))

  return (
    <div className="max-w-[600px] mx-auto px-4 py-10">
      <Link href="/listings" className="text-bk-orange font-bold text-[14px] inline-block mb-6 hover:underline">
        ← Back to listings
      </Link>

      <h1 className="font-display text-[28px] mb-1" style={{ color: '#1a1a1a' }}>
        {seller.username || seller.name || 'Neighbor'}'s Reviews
      </h1>
      <p className="font-bold text-[14px] mb-8" style={{ color: '#aaa' }}>
        {summary ? `★ ${summary.average.toFixed(1)} average from ${summary.count} review${summary.count !== 1 ? 's' : ''}` : 'No reviews yet'}
      </p>

      {(reviewRows ?? []).length === 0 ? (
        <div className="text-center py-10 font-bold text-[14px]" style={{ color: '#aaa' }}>No reviews yet.</div>
      ) : (
        <div className="flex flex-col" style={{ gap: 16 }}>
          {(reviewRows ?? []).map((r: any) => (
            <div key={r.id} className="bg-white border-2 border-gray-100 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-black text-[13px]">{reviewerMap[r.reviewer_id] ?? 'Neighbor'}</span>
                <span className="font-semibold text-[11px]" style={{ color: '#ccc' }}>
                  {new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
              <div className="mb-2">
                {[1, 2, 3, 4, 5].map(s => (
                  <span key={s} style={{ color: s <= r.rating ? '#f59e0b' : '#e5e7eb', fontSize: 15 }}>★</span>
                ))}
              </div>
              {r.text && <p className="font-semibold text-[13px]" style={{ color: '#555' }}>{r.text}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
