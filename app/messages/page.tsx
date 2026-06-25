import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { timeAgo } from '@/lib/utils'

export default async function MessagesPage() {
  let conversations: any[] = []
  let userId = ''

  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin?redirect=/messages')
    userId = user.id

    const { data } = await supabase
      .from('conversations')
      .select(`
        *,
        listings(id, title, author, photo_url, price),
        buyer:profiles!conversations_buyer_id_fkey(id, name),
        seller:profiles!conversations_seller_id_fkey(id, name),
        messages(body, created_at, sender_id)
      `)
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order('created_at', { ascending: false })

    conversations = data ?? []
  } catch {
    redirect('/auth/signin?redirect=/messages')
  }

  return (
    <div className="max-w-2xl mx-auto px-8 py-10">
      <h1 className="font-display text-3xl text-bk-orange mb-6">Messages 💬</h1>

      {conversations.length > 0 ? (
        <div className="space-y-3">
          {conversations.map(convo => {
            const other = convo.buyer_id === userId ? convo.seller : convo.buyer
            const msgs = (convo.messages ?? []).slice().sort(
              (a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )
            const lastMsg = msgs[0]
            return (
              <Link
                key={convo.id}
                href={`/messages/${convo.id}`}
                className="block bg-white rounded-2xl p-5 border-2 border-gray-100 shadow-[0_4px_0_#e5e7eb] hover:-translate-y-0.5 transition-transform"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-gray-800 truncate">{convo.listings?.title}</p>
                    <p className="text-xs text-gray-400 font-semibold mb-1">with {other?.name}</p>
                    {lastMsg && (
                      <p className="text-sm text-gray-500 font-semibold truncate">{lastMsg.body}</p>
                    )}
                  </div>
                  {lastMsg && (
                    <span className="text-xs text-gray-300 font-bold whitespace-nowrap">
                      {timeAgo(lastMsg.created_at)}
                    </span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-20 text-gray-400 font-bold">
          <div className="text-5xl mb-4">💬</div>
          <p className="mb-2">No messages yet.</p>
          <p className="text-sm mb-6">Browse listings and message a seller to get started.</p>
          <Link href="/listings" className="bg-bk-orange text-white px-6 py-2.5 rounded-full font-extrabold text-sm shadow-[0_3px_0_#c2410c]">
            Browse Books →
          </Link>
        </div>
      )}
    </div>
  )
}
