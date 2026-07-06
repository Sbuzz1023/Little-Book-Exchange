import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { MOCK_PROFILE, MOCK_LISTINGS, MOCK_USER_ID, MOCK_CONVERSATIONS } from '@/lib/mock-data'
import { updateProfile, updateListingStatus, notifyPickedUp, confirmExchange } from './actions'

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string }
}) {
  const cookieStore = cookies()
  const demo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
    !!cookieStore.get('lbe_demo_user')

  let profile: any = null
  let listings: any[] = []
  let exchanges: any[] = []

  if (demo) {
    profile = MOCK_PROFILE
    listings = MOCK_LISTINGS.filter(l => l.user_id === MOCK_USER_ID)

    const pendingId = cookieStore.get('lbe_demo_pending')?.value
    exchanges = [...MOCK_CONVERSATIONS]

    if (pendingId) {
      const pl = MOCK_LISTINGS.find(l => l.id === pendingId && l.user_id !== MOCK_USER_ID) as any
      const alreadyIn = exchanges.some(c => c.listing_id === pendingId && c.buyer_id === MOCK_USER_ID)
      if (pl && !alreadyIn) {
        exchanges = [
          {
            id: `demo-pending-${pendingId}`,
            listing_id: pendingId,
            buyer_id: MOCK_USER_ID,
            seller_id: pl.user_id,
            exchange_status: 'requested',
            listings: {
              title: pl.title,
              author: pl.author,
              photo_url: pl.photo_url ?? null,
              city: pl.city ?? null,
              state: pl.state ?? null,
            },
            buyer: { username: 'demouser', name: 'Demo User', city: 'Chicago', state: 'IL', phone: '(312) 555-0100' },
            seller: {
              username: pl.profiles?.username ?? pl.profiles?.name ?? 'neighbor',
              name: pl.profiles?.name ?? 'Neighbor',
              city: pl.city ?? null,
              state: pl.state ?? null,
              phone: null,
            },
            messages: [],
          },
          ...exchanges,
        ]
      }
    }
  } else {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) redirect('/auth/signin?redirect=/profile')

      const [{ data: p }, { data: l }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).single(),
        supabase.from('listings').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ])
      profile = p
      listings = l ?? []

      try {
        const { data: c } = await supabase
          .from('conversations')
          .select('*, listings(title, author, photo_url, city, state), buyer:profiles!conversations_buyer_id_fkey(username, city, state, phone), seller:profiles!conversations_seller_id_fkey(username, city, state, phone)')
          .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
        exchanges = c ?? []
      } catch {
        try {
          const { data: c2 } = await supabase
            .from('conversations').select('*')
            .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
            .order('created_at', { ascending: false })
          exchanges = (c2 ?? []).map((row: any) => ({
            ...row,
            listings: { title: 'Unknown', author: '', photo_url: null, city: null, state: null },
            buyer:    { username: null, name: null, city: null, state: null, phone: null },
            seller:   { username: null, name: null, city: null, state: null, phone: null },
          }))
        } catch { exchanges = [] }
      }
    } catch {
      profile = MOCK_PROFILE
      listings = MOCK_LISTINGS.filter(l => l.user_id === MOCK_USER_ID)
      exchanges = MOCK_CONVERSATIONS
    }
  }

  return (
    <DashboardClient
      profile={profile}
      listings={listings}
      exchanges={exchanges}
      updateAction={updateProfile}
      updateListingStatus={updateListingStatus}
      notifyPickedUp={notifyPickedUp}
      confirmExchange={confirmExchange}
      success={!!searchParams.success}
    />
  )
}
