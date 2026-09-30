import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import HeartButton from '@/components/HeartButton'
import PhotoGallery from './PhotoGallery'
import PurchaseRequestedModal from './PurchaseRequestedModal'
import { listingPhotos } from '@/lib/listingPhotos'
import ShortfallNote from './ShortfallNote'
import ScrollToPurchaseStatus from './ScrollToPurchaseStatus'
import { MOCK_LISTINGS, MOCK_CONVERSATIONS, MOCK_USER_ID } from '@/lib/mock-data'
import { averageRating } from '@/lib/reviewAverages'
import { StarRatingBadge } from '@/components/StarRating'
import { getListingAvailability } from '@/lib/listingAvailability'
import type { ListingStatus } from '@/lib/types'
import { addTbrEntry } from '@/lib/actions/tbrEntries'
import { saveListingAndGoToWallet } from '@/lib/actions/savedListings'
import { availableCredits, creditShortfall, type CreditShortfall, type OpenRequestRow } from '@/lib/creditCheck'
import '../../home.css'
import './detail.css'

function conditionLabel(c: string) {
  if (c === 'good') return 'Good'
  if (c === 'fair') return 'Fair'
  if (c === 'well-loved') return 'Well-Loved'
  return c
}

export default async function ListingDetailPage({ params, searchParams }: { params: { id: string }, searchParams: { requested?: string; purchase_failed?: string; insufficient_credits?: string } }) {
  let listing: any = null
  let user: any = null
  let myConvoStatus: string | null = null
  let sellerRating: { average: number; count: number } | null = null

  try {
    const supabase = createClient()
    const [{ data: l }, { data: { user: u } }] = await Promise.all([
      supabase.from('listings').select('*, profiles(id, username, city)').eq('id', params.id).single(),
      supabase.auth.getUser(),
    ])
    listing = l
    user = u

    if (listing?.is_bundle) {
      const { data: books } = await supabase
        .from('listing_books').select('title, author, cover_url').eq('listing_id', listing.id).order('position', { ascending: true })
      listing.books = books ?? []
    }
    if (u) {
      const { data: c } = await supabase
        .from('conversations').select('exchange_status')
        .eq('listing_id', params.id).eq('buyer_id', u.id).maybeSingle()
      myConvoStatus = c?.exchange_status ?? null
    }
    const sellerId = (l?.profiles as any)?.id ?? l?.user_id
    if (sellerId) {
      const { data: ratingRows } = await supabase.from('reviews').select('rating').eq('seller_id', sellerId)
      sellerRating = averageRating((ratingRows ?? []).map((r: any) => r.rating))
    }
  } catch {
    const mock = MOCK_LISTINGS.find(l => l.id === params.id)
    if (mock) listing = { ...mock, profiles: mock.profiles }
  }

  if (!listing) notFound()

  const isOwner = user?.id === listing.user_id
  const isLoggedIn = !!user || !!cookies().get('lbe_demo_user')?.value

  let initialSaved = false
  if (user) {
    try {
      const supabase = createClient()
      const { data: saved } = await supabase
        .from('saved_listings').select('id').eq('user_id', user.id).eq('listing_id', params.id).maybeSingle()
      initialSaved = !!saved
    } catch {}
  }

  // Explain a blocked purchase: too few credits overall, or credits held by
  // the buyer's other pending requests (see lib/creditCheck.ts).
  let shortfall: CreditShortfall | null = null
  if (user && searchParams.insufficient_credits === '1') {
    try {
      const supabase = createClient()
      const [{ data: p }, { data: rows }] = await Promise.all([
        supabase.from('profiles').select('credits').eq('id', user.id).single(),
        supabase.from('conversations')
          .select('exchange_status, listings(status, book_count)')
          .eq('buyer_id', user.id).neq('listing_id', params.id),
      ])
      if (p) shortfall = creditShortfall(p.credits, (rows ?? []) as unknown as OpenRequestRow[], listing.book_count ?? 1)
    } catch {}
  }

  const isPending = searchParams.requested === '1' || myConvoStatus === 'requested'
  const avail = getListingAvailability((listing.status ?? 'active') as ListingStatus, {
    isOwner,
    isRequester: myConvoStatus === 'requested',
  })

  async function startConversation(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const { cookies } = await import('next/headers')
    const { revalidatePath } = await import('next/cache')

    const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
      !!cookies().get('lbe_demo_user')

    if (isDemo) {
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      revalidatePath('/profile')
      redirect(`/profile?tab=messages&conversation=${mock?.id ?? 'mock-convo-1'}`)
    }

    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
      const supabase = createSrv()
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) redirect(`/auth/signin?redirect=/listings/${params.id}`)

      const { data: existing } = await supabase
        .from('conversations').select('id').eq('listing_id', listing.id).eq('buyer_id', u!.id).maybeSingle()
      if (existing) {
        revalidatePath('/profile')
        redirect(`/profile?tab=messages&conversation=${existing.id}`)
      }

      const sellerId = (listing.profiles as any)?.id ?? listing.user_id
      const { data: convo } = await supabase
        .from('conversations')
        .insert({ listing_id: listing.id, buyer_id: u!.id, seller_id: sellerId })
        .select('id').single()

      revalidatePath('/profile')
      redirect(`/profile?tab=messages&conversation=${convo!.id}`)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      const { MOCK_CONVERSATIONS: convos } = await import('@/lib/mock-data')
      const mock = convos.find(c => c.listing_id === params.id)
      revalidatePath('/profile')
      redirect(`/profile?tab=messages&conversation=${mock?.id ?? 'mock-convo-1'}`)
    }
  }

  async function requestPurchase(formData: FormData) {
    'use server'
    const { redirect } = await import('next/navigation')
    const { cookies } = await import('next/headers')

    const isDemo = !process.env.NEXT_PUBLIC_SUPABASE_URL?.startsWith('http') ||
      !!cookies().get('lbe_demo_user')

    if (isDemo) {
      cookies().set('lbe_demo_pending', params.id, { maxAge: 86400, path: '/', sameSite: 'lax' })
      redirect(`/listings/${params.id}?requested=1`)
    }

    let lockAcquired = false
    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
      const supabase = createSrv()
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) redirect(`/auth/signin?redirect=/listings/${params.id}`)

      // Check against credits not already committed to the buyer's other open
      // requests — see lib/creditCheck.ts.
      const [{ data: buyerProfile }, { data: buyerExchanges }] = await Promise.all([
        supabase.from('profiles').select('credits').eq('id', u!.id).single(),
        supabase.from('conversations')
          .select('exchange_status, listings(status, book_count)')
          .eq('buyer_id', u!.id).neq('listing_id', listing.id),
      ])
      if (!buyerProfile || availableCredits(buyerProfile.credits, (buyerExchanges ?? []) as unknown as OpenRequestRow[]) < (listing.book_count ?? 1)) {
        redirect(`/listings/${params.id}?insufficient_credits=1`)
      }

      const { data: locked } = await supabase.rpc('lock_listing_for_request', { p_listing_id: listing.id })
      if (!locked) {
        redirect(`/listings/${params.id}?purchase_failed=1`)
      }
      lockAcquired = true

      // Find or create conversation (without exchange_status so it works before migration)
      let convoId: string
      const { data: existing } = await supabase
        .from('conversations').select('id').eq('listing_id', listing.id).eq('buyer_id', u!.id).maybeSingle()

      if (existing) {
        convoId = existing.id
      } else {
        const sellerId = (listing.profiles as any)?.id ?? listing.user_id
        const { data: convo, error: insertErr } = await supabase
          .from('conversations')
          .insert({ listing_id: listing.id, buyer_id: u!.id, seller_id: sellerId })
          .select('id').single()
        if (insertErr || !convo) throw new Error(insertErr?.message ?? 'insert failed')
        convoId = convo.id
      }

      // Try to set exchange_status (no-op if migration hasn't been run yet)
      await supabase.from('conversations').update({ exchange_status: 'requested' }).eq('id', convoId).then(() => {})

      // Send a purchase request message
      await supabase.from('messages').insert({
        conversation_id: convoId,
        sender_id: u!.id,
        body: '🛒 I\'d like to purchase this book! Please confirm when you\'re ready.',
        kind: 'purchase_request',
      })

      redirect(`/listings/${params.id}?requested=1`)
    } catch (err: any) {
      if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
      if (lockAcquired) {
        try {
          const { createClient: createSrv } = await import('@/lib/supabase/server')
          const supabase = createSrv()
          await supabase.rpc('reopen_listing', { p_listing_id: listing.id })
        } catch {}
      }
      redirect(`/listings/${params.id}?purchase_failed=1`)
    }
  }


  const displayPhotos = listingPhotos(listing)

  const displayTitle = listing.is_bundle ? (listing.bundle_name || listing.title) : listing.title
  const sellerName = listing.profiles?.username ?? 'seller'

  return (
    <div className="home-v2">
      <div className="wrap ld-page" style={{ maxWidth: 680 }}>
        <Link href="/listings" className="ld-back">← Back to Browse</Link>

        <div className="ld-card">
          <PhotoGallery photos={displayPhotos} stockUrl={listing.cover_url} alt={displayTitle}>
            {!isOwner && (
              <HeartButton listingId={listing.id} isLoggedIn={isLoggedIn} initialSaved={initialSaved} />
            )}
            <span className="ld-credit">
              {listing.is_bundle ? `${listing.book_count ?? 1} credits` : '1 credit'}
            </span>
          </PhotoGallery>

          <div className="ld-body">
            <h1 className="ld-title">{displayTitle}</h1>
            <p className="ld-author">by {listing.author}</p>

            <div className="ld-tags">
              <span className="ld-tag cond">{conditionLabel(listing.condition)} Condition</span>
              {listing.genre && <span className="ld-tag">{listing.genre}</span>}
              {listing.isbn && <span className="ld-tag">ISBN {listing.isbn}</span>}
              <span className="ld-tag city">📍 {listing.profiles?.city || listing.city}</span>
            </div>

            {listing.description && <p className="ld-desc">{listing.description}</p>}

            {listing.is_bundle && (
              <>
                <h2 className="ld-section-h">Books in this Bundle</h2>
                <div className="ld-bundle">
                  {[{ title: listing.title, author: listing.author, cover_url: listing.cover_url }, ...(listing.books ?? [])]
                    .map((b: { title: string; author: string; cover_url: string | null }, i: number) => (
                      <div key={i} className="ld-bundle-book">
                        {b.cover_url && <img src={b.cover_url} alt="" />}
                        <div>
                          <div className="t">{b.title}</div>
                          <div className="a">{b.author}</div>
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}

            {/* Just redirected here from a purchase attempt: bring its message into view. */}
            {(searchParams.requested === '1' || searchParams.insufficient_credits === '1' || searchParams.purchase_failed === '1') && (
              <ScrollToPurchaseStatus />
            )}
            {searchParams.requested === '1' && !isOwner && <PurchaseRequestedModal sellerName={sellerName} />}
            <div className="ld-foot" id="purchase-status">
              <div className="ld-seller">
                <span>Listed by <strong>{listing.profiles?.username ?? 'a neighbor'}</strong></span>
                <StarRatingBadge rating={sellerRating} sellerId={(listing.profiles as any)?.id ?? listing.user_id} />
              </div>

              {isOwner ? (
                <Link href="/profile" className="btn btn-outline ld-quiet-btn">Manage Listing</Link>
              ) : searchParams.purchase_failed === '1' ? (
                <div className="ld-note error">Purchase failed — please try again or message the seller.</div>
              ) : searchParams.insufficient_credits === '1' ? (
                <div className="ld-stack">
                  <ShortfallNote shortfall={shortfall} />
                  <form action={saveListingAndGoToWallet}>
                    <input type="hidden" name="listing_id" value={params.id} />
                    <button type="submit" className="btn btn-primary">Buy Credits &amp; Save Listing</button>
                  </form>
                </div>
              ) : (isPending || avail === 'pending-mine') ? (
                <div className="ld-stack">
                  <div className="ld-note pending">
                    ⏳ Pending — waiting for <strong>{sellerName}</strong> to confirm
                  </div>
                  <Link href="/profile?tab=exchanges" className="ld-subtle-link">
                    View in Exchanges tab →
                  </Link>
                </div>
              ) : avail === 'pending-locked' ? (
                <div className="ld-stack">
                  <div className="ld-note pending">⏳ This book is currently pending with another buyer</div>
                  <form action={addTbrEntry}>
                    <input type="hidden" name="title" value={listing.title} />
                    <input type="hidden" name="author" value={listing.author} />
                    <input type="hidden" name="ol_work_key" value={listing.ol_work_key ?? ''} />
                    <input type="hidden" name="cover_url" value={listing.cover_url ?? ''} />
                    <input type="hidden" name="redirect_to" value="/profile?tab=tbr" />
                    <button type="submit" className="ld-link-btn">
                      📚 Add to my TBR — notify me if it reopens
                    </button>
                  </form>
                </div>
              ) : avail === 'unavailable' ? (
                <div className="ld-note muted">No longer available</div>
              ) : (
                <div className="ld-actions">
                  <form action={requestPurchase}>
                    <button type="submit" className="btn btn-primary">
                      {listing.is_bundle ? `Purchase Bundle for ${listing.book_count ?? 1} Credits` : 'Purchase with 1 Credit'}
                    </button>
                  </form>
                  <form action={startConversation}>
                    <button type="submit" className="btn btn-outline">Message Seller</button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
