// app/admin/DisputesAdminTab.tsx
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveDispute } from '@/lib/actions/admin'

type Dispute = {
  id: string
  conversation_id: string
  reporter_id: string
  message: string
  created_at: string
  bookTitle: string
  buyerName: string
  sellerName: string
}

export default function DisputesAdminTab({ onMessageReporter }: { onMessageReporter: (userId: string) => void }) {
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(true)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const supabase = createClient()

    const { data: rows } = await supabase
      .from('disputes').select('id, conversation_id, reporter_id, message, created_at')
      .eq('status', 'open')
      .order('created_at', { ascending: false })

    if (!rows || rows.length === 0) {
      setDisputes([])
      setLoading(false)
      return
    }

    const convoIds = Array.from(new Set(rows.map(r => r.conversation_id)))
    const { data: convos } = await supabase
      .from('conversations').select('id, listing_id, buyer_id, seller_id').in('id', convoIds)
    const convoMap: Record<string, any> = {}
    for (const c of convos ?? []) convoMap[c.id] = c

    const listingIds = Array.from(new Set((convos ?? []).map(c => c.listing_id).filter(Boolean)))
    const { data: listings } = await supabase.from('listings').select('id, title').in('id', listingIds)
    const listingMap: Record<string, string> = {}
    for (const l of listings ?? []) listingMap[l.id] = l.title

    const userIds = Array.from(new Set((convos ?? []).flatMap(c => [c.buyer_id, c.seller_id])))
    const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', userIds)
    const nameMap: Record<string, string> = {}
    for (const p of profiles ?? []) nameMap[p.id] = p.username || 'Unknown'

    setDisputes(rows.map(r => {
      const convo = convoMap[r.conversation_id]
      return {
        ...r,
        bookTitle: convo ? (listingMap[convo.listing_id] ?? 'Unknown book') : 'Unknown book',
        buyerName: convo ? (nameMap[convo.buyer_id] ?? 'Unknown') : 'Unknown',
        sellerName: convo ? (nameMap[convo.seller_id] ?? 'Unknown') : 'Unknown',
      }
    }))
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleResolve(id: string) {
    setResolvingId(id)
    await resolveDispute(id)
    await load()
    setResolvingId(null)
  }

  if (loading) return <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>Loading disputes...</p>

  if (disputes.length === 0) {
    return <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>No open disputes.</p>
  }

  return (
    <div className="flex flex-col" style={{ gap: 12 }}>
      {disputes.map(d => (
        <div key={d.id} style={{ background: '#fff', border: '2px solid #fecdd3', borderRadius: 16, padding: 16 }}>
          <p className="font-black text-[14px]">{d.bookTitle}</p>
          <p className="font-semibold text-[12px]" style={{ color: '#aaa' }}>
            Buyer: {d.buyerName} · Seller: {d.sellerName} · Filed {new Date(d.created_at).toLocaleDateString()}
          </p>
          <p className="font-semibold text-[13px] mt-2" style={{ color: '#444' }}>{d.message}</p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              disabled={resolvingId === d.id}
              onClick={() => handleResolve(d.id)}
              className="font-extrabold text-[12px] text-white"
              style={{ background: '#059669', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              {resolvingId === d.id ? 'Resolving...' : '✓ Resolve'}
            </button>
            <button
              type="button"
              onClick={() => onMessageReporter(d.reporter_id)}
              className="font-extrabold text-[12px] text-white"
              style={{ background: '#0ea5e9', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
              💬 Message
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
