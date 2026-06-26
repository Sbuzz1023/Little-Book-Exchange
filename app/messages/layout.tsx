import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { MOCK_CONVERSATIONS, MOCK_USER_ID } from '@/lib/mock-data'
import ConversationSidebar from './ConversationSidebar'
import LockScroll from './LockScroll'

function isDemo() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http')) return true
  return !!cookies().get('lbe_demo_user')
}

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  let conversations: any[] = []
  let userId = ''

  if (isDemo()) {
    conversations = MOCK_CONVERSATIONS as any[]
    userId = MOCK_USER_ID
  } else {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        userId = user.id
        const { data } = await supabase
          .from('conversations')
          .select(`
            *,
            listings(id, title, author, price),
            buyer:profiles!conversations_buyer_id_fkey(id, name),
            seller:profiles!conversations_seller_id_fkey(id, name),
            messages(body, created_at, sender_id)
          `)
          .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
        conversations = data ?? []
      }
    } catch {
      conversations = MOCK_CONVERSATIONS as any[]
      userId = MOCK_USER_ID
    }
  }

  return (
    <>
      <LockScroll />
      <div style={{
        position: 'fixed',
        top: 68,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        overflow: 'hidden',
        zIndex: 10,
      }}>
        <ConversationSidebar conversations={conversations} userId={userId} />
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </>
  )
}
