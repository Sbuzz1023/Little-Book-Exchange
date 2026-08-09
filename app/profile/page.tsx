import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import DashboardClient from './DashboardClient'
import { MOCK_PROFILE, MOCK_LISTINGS, MOCK_USER_ID, MOCK_CONVERSATIONS } from '@/lib/mock-data'
import { updateProfile, updateListingStatus, completeExchange, hideExchangeHistory, confirmExchange, denyPurchase, cancelPurchase } from './actions'
import { submitReview } from '@/lib/actions/reviews'
import { averageRating } from '@/lib/reviewAverages'
import { removeSavedListing } from '@/lib/actions/savedListings'
import { addTbrEntry, removeTbrEntry } from '@/lib/actions/tbrEntries'
import { tbrMatchPattern, buildTbrMatchStrategy } from '@/lib/tbrMatch'
import { unreadCounts as computeUnreadCounts, unreadEntityIds as computeUnreadEntityIds, type NotificationRow } from '@/lib/notifications'
import { resendEmailConfirmation, sendPhoneOtp, verifyPhoneOtp } from '@/lib/actions/verification'

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: { success?: string; error?: string; demo_pending?: string; tbr_error?: string; tab?: string; conversation?: string }
}) {
  const cookieStore = cookies()
  const demo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
    !!cookieStore.get('lbe_demo_user')

  let profile: any = null
  let listings: any[] = []
  let exchanges: any[] = []
  let savedListings: any[] = []
  let tbrEntries: any[] = []
  let transactions: any[] = []
  let queryError: string | null = null
  let unreadCounts = { total: 0, exchanges: 0, tbr: 0, messages: 0 }
  let unreadEntityIds = { message: [] as string[], decisionOrPickup: [] as string[], tbrMatch: [] as string[] }

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

      const { data: txRows } = await supabase
        .from('credit_transactions').select('id, amount, reason, created_at')
        .eq('user_id', user.id).order('created_at', { ascending: false })
      transactions = txRows ?? []

      const { data: savedRows } = await supabase
        .from('saved_listings').select('listing_id').eq('user_id', user.id)
      const savedIds = (savedRows ?? []).map((r: any) => r.listing_id)
      if (savedIds.length > 0) {
        const { data: sl } = await supabase
          .from('listings').select('id, title, author, photo_url, condition, price, status').in('id', savedIds)
        savedListings = sl ?? []
      }

      const { data: tbr } = await supabase
        .from('tbr_entries').select('*').eq('user_id', user.id).order('created_at', { ascending: false })
      tbrEntries = await Promise.all((tbr ?? []).map(async (entry: any) => {
        const strategy = buildTbrMatchStrategy(entry)

        if (strategy.mode === 'exact') {
          // Standalone listings for this exact book.
          let directQuery = supabase
            .from('listings')
            .select('id, title, city, profiles!inner(state)')
            .eq('status', 'active')
            .neq('user_id', user.id)
            .eq('ol_work_key', strategy.workKey)
          if (entry.city) directQuery = directQuery.regexIMatch('city', tbrMatchPattern(entry.city))
          if (entry.state) directQuery = directQuery.eq('profiles.state', entry.state)
          const { data: direct } = await directQuery.limit(1).maybeSingle()
          if (direct) return { ...entry, match: { id: direct.id, title: direct.title } }

          // Bundles containing this exact book, via listing_books.
          const { data: bundleRows } = await supabase
            .from('listing_books').select('listing_id').eq('ol_work_key', strategy.workKey)
          const bundleListingIds = [...new Set((bundleRows ?? []).map((r: any) => r.listing_id))]
          if (bundleListingIds.length === 0) return { ...entry, match: null }

          let bundleQuery = supabase
            .from('listings')
            .select('id, title, city, profiles!inner(state)')
            .in('id', bundleListingIds)
            .eq('status', 'active')
            .neq('user_id', user.id)
          if (entry.city) bundleQuery = bundleQuery.regexIMatch('city', tbrMatchPattern(entry.city))
          if (entry.state) bundleQuery = bundleQuery.eq('profiles.state', entry.state)
          const { data: bundleMatch } = await bundleQuery.limit(1).maybeSingle()
          return { ...entry, match: bundleMatch ? { id: bundleMatch.id, title: bundleMatch.title } : null }
        }

        // Text fallback (mode 'text') or no usable title/author (mode 'none') — either way,
        // still worth a city-only query when entry.city is set, matching the original
        // pre-existing skip condition (title AND author AND city all unusable → skip).
        if (strategy.mode === 'none' && !entry.city) {
          return { ...entry, match: null }
        }
        let query = supabase
          .from('listings')
          .select('id, title, author, city, profiles!inner(state)')
          .eq('status', 'active')
          .neq('user_id', user.id)
        if (strategy.mode === 'text' && strategy.titlePattern)  query = query.regexIMatch('title', strategy.titlePattern)
        if (strategy.mode === 'text' && strategy.authorPattern) query = query.regexIMatch('author', strategy.authorPattern)
        if (entry.city)  query = query.regexIMatch('city', tbrMatchPattern(entry.city))
        if (entry.state) query = query.eq('profiles.state', entry.state)
        const { data: match } = await query.limit(1).maybeSingle()
        return { ...entry, match: match ? { id: match.id, title: match.title } : null }
      }))

      const { data: notifRows } = await supabase
        .from('notifications').select('type, entity_id').eq('user_id', user.id).eq('read', false)
      const notifications: NotificationRow[] = (notifRows ?? []) as NotificationRow[]
      unreadCounts = computeUnreadCounts(notifications)
      unreadEntityIds = {
        message: computeUnreadEntityIds(notifications, ['message']),
        decisionOrPickup: computeUnreadEntityIds(notifications, ['purchase_decision', 'pickup']),
        tbrMatch: computeUnreadEntityIds(notifications, ['tbr_match']),
      }

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
        const { data: listingRows, error: listingsErr } = await supabase
          .from('listings').select('id, title, author, photo_url, city, pickup_description').in('id', listingIds)
        if (listingsErr) console.error('profile page: listings lookup failed', listingsErr)
        const lm: Record<string, any> = {}
        for (const l of listingRows ?? []) lm[l.id] = l

        // Fetch profiles separately
        const profileIds = [...new Set(merged.flatMap((r: any) => [r.buyer_id, r.seller_id]).filter(Boolean))]
        const { data: profileRows, error: profilesErr } = await supabase
          .from('profiles').select('id, username, city, state, phone, address, address_unit, share_address, pickup_description, share_pickup').in('id', profileIds)
        if (profilesErr) console.error('profile page: profiles lookup failed', profilesErr)
        const pm: Record<string, any> = {}
        for (const p of profileRows ?? []) pm[p.id] = p

        // Fetch messages separately (used by the Messages tab)
        const { data: messageRows, error: messagesErr } = await supabase
          .from('messages').select('id, conversation_id, body, sender_id, created_at')
          .in('conversation_id', merged.map((r: any) => r.id))
          .order('created_at', { ascending: true })
        if (messagesErr) console.error('profile page: messages lookup failed', messagesErr)
        const mm: Record<string, any[]> = {}
        for (const m of messageRows ?? []) (mm[m.conversation_id] ??= []).push(m)

        // Reviews: which completed exchanges already have a buyer review, and
        // each seller's aggregate rating across all their completed sales
        const completedIds = merged.filter((r: any) => r.exchange_status === 'completed').map((r: any) => r.id)
        const { data: reviewedRows } = completedIds.length > 0
          ? await supabase.from('reviews').select('conversation_id').in('conversation_id', completedIds)
          : { data: [] as any[] }
        const reviewedSet = new Set((reviewedRows ?? []).map((r: any) => r.conversation_id))

        const sellerIds = [...new Set(merged.map((r: any) => r.seller_id))]
        const { data: ratingRows } = await supabase.from('reviews').select('seller_id, rating').in('seller_id', sellerIds)
        const ratingsBySeller: Record<string, number[]> = {}
        for (const r of ratingRows ?? []) (ratingsBySeller[r.seller_id] ??= []).push(r.rating)

        exchanges = merged.map((row: any) => {
          const sellerData = pm[row.seller_id] ?? { username: null, city: null, state: null, phone: null }
          const isConfirmed = (row.exchange_status ?? 'none') === 'confirmed'
          return {
            ...row,
            exchange_status: row.exchange_status ?? 'none',
            listings: lm[row.listing_id] ?? { title: 'Unknown', author: '', photo_url: null, city: null, state: null },
            buyer:    pm[row.buyer_id]   ?? { username: null, city: null, state: null, phone: null },
            seller: {
              ...sellerData,
              address:            isConfirmed ? sellerData.address            : null,
              address_unit:       isConfirmed ? sellerData.address_unit       : null,
              pickup_description: isConfirmed ? sellerData.pickup_description : null,
            },
            messages: mm[row.id] ?? [],
            sellerRating: averageRating(ratingsBySeller[row.seller_id] ?? []),
            reviewed: reviewedSet.has(row.id),
          }
        })
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
      savedListings={savedListings}
      tbrEntries={tbrEntries}
      transactions={transactions}
      updateAction={updateProfile}
      updateListingStatus={updateListingStatus}
      completeExchange={completeExchange}
      hideExchangeHistory={hideExchangeHistory}
      submitReview={submitReview}
      confirmExchange={confirmExchange}
      denyPurchase={denyPurchase}
      cancelPurchase={cancelPurchase}
      removeSavedListing={removeSavedListing}
      addTbrEntry={addTbrEntry}
      removeTbrEntry={removeTbrEntry}
      success={!!searchParams.success}
      defaultTab={searchParams.tab === 'messages' ? 'messages' : searchParams.tab === 'tbr' ? 'tbr' : (searchParams.demo_pending ? 'exchanges' : 'listings')}
      queryError={queryError}
      tbrError={searchParams.tbr_error ?? null}
      unreadCounts={unreadCounts}
      unreadEntityIds={unreadEntityIds}
      resendEmailConfirmation={resendEmailConfirmation}
      sendPhoneOtp={sendPhoneOtp}
      verifyPhoneOtp={verifyPhoneOtp}
      isDemo={demo}
      initialConversationId={searchParams.conversation ?? null}
    />
  )
}
