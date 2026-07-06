import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { MOCK_PROFILE, MOCK_LISTINGS, MOCK_USER_ID, MOCK_CONVERSATIONS } from '@/lib/mock-data'
import { updateProfile, updateListingStatus, notifyPickedUp, confirmExchange } from './actions'

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string; demo_pending?: string }
}) {
  const cookieStore = cookies()
  const demo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
    !!cookieStore.get('lbe_demo_user')

  let profile: any = null
  let listings: any[] = []
  let exchanges: any[] = []
  let queryError: string | null = null

  if (demo) {
    profile = MOCK_PROFILE
    listings = MOCK_LISTINGS.filter(l => l.user_id === MOCK_USER_ID)

    // URL param takes priority, cookie is fallback
    const pendingId = searchParams.demo_pending ?? cookieStore.get('lbe_demo_pending')?.value
    exchanges = [...MOCK_CONVERSATIONS]

    if (pendingId) {
      const pl = MOCK_LISTINGS.find(l => l.id === pendingId && l.user_id !== MOCK_USER_ID) as any
      const alreadyIn = exchanges.some((c: any) => c.listing_id === pendingId && c.buyer_id === MOCK_USER_ID)
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
            buyer:  { username: 'demouser', name: 'Demo User', city: 'Chicago', state: 'IL', phone: '(312) 555-0100' },
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

      // Fetch conversations with NO joins — joins can silently fail due to RLS
      const [{ data: asBuyer, error: buyerErr }, { data: asSeller, error: sellerErr }] =
       await Promise.all([
        supabase.from('conversations').select('*').eq('buyer_id', user.id).order('created_at', { ascending: false }),
        supabase.from('conversations').select('*').eq('seller_id', user.id).order('created_at', { ascending: false }),
      ])

      // Merge and deduplicate
      const merged: any[] = []
      const seen = new Set<string>()
      for (const row of [...(asBuyer ?? []), ...(asSeller ?? [])]) {
        if (!seen.has(row.id)) { seen.add(row.id); merged.push(row) }
      }

      if (merged.length > 0) {
        // Fetch listings separately
        const listingIds = [...new Set(merged.map((r: any) => r.listing_id).filter(Boolean))]
        const { data: listingRows } = await supabase
          .from('listings').select('id, title, author, photo_url, city, state').in('id', listingIds)
        const lm: Record<string, any> = {}
        for (const l of listingRows ?? []) lm[l.id] = l

        // Fetch profiles separately
        const profileIds = [...new Set(merged.flatMap((r: any) => [r.buyer_id, r.seller_id]).filter(Boolean))]
        const { data: profileRows } = await supabase
          .from('profiles').select('id, username, city, state, phone').in('id', profileIds)
        const pm: Record<string, any> = {}
        for (const p of profileRows ?? []) pm[p.id] = p

        exchanges = merged.map((row: any) => ({
          ...row,
          exchange_status: row.exchange_status ?? 'none',
          listings: lm[row.listing_id] ?? { title: 'Unknown', author: '', photo_url: null, city: null, state: null },
          buyer:    pm[row.buyer_id]   ?? { username: null, city: null, state: null, phone: null },
          seller:   pm[row.seller_id]  ?? { username: null, city: null, state: null, phone: null },
        }))
      } else {
        queryError = buyerErr?.message || sellerErr?.message || null
        exchanges = []
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
      defaultTab={searchParams.demo_pending ? 'exchanges' : 'listings'}
      queryError={queryError}
    />
  )
}
