import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import Link from 'next/link'
import Image from 'next/image'
import HeartButton from '@/components/HeartButton'
import type { Listing, ListingStatus } from '@/lib/types'
import { MOCK_LISTINGS } from '@/lib/mock-data'
import { averageRating } from '@/lib/reviewAverages'
import { StarRatingBadge } from '@/components/StarRating'
import { getListingAvailability } from '@/lib/listingAvailability'
import { addTbrEntry } from '@/lib/actions/tbrEntries'
import BookFilterField from './BookFilterField'
import '../home.css'
import './browse.css'

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function PinIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s7-7.4 7-12.5A7 7 0 0 0 5 9.5C5 14.6 12 22 12 22z" /><circle cx="12" cy="9.5" r="2.4" />
    </svg>
  )
}

function conditionLabel(c: string) {
  if (c === 'good') return 'Good'
  if (c === 'fair') return 'Fair'
  if (c === 'well-loved') return 'Well-Loved'
  return c
}

async function getListings(params: {
  city?: string
  title?: string
  author?: string
  olWorkKey?: string
  book_type?: string
  genre?: string
  condition?: string
  sort?: string
}): Promise<Listing[]> {
  try {
    const supabase = createClient()

    if (params.olWorkKey) {
      const applyCommonFilters = (q: any) => {
        if (params.city) q = q.ilike('city', `%${params.city}%`)
        if (params.book_type === 'single') q = q.eq('is_bundle', false)
        if (params.book_type === 'bundle') q = q.eq('is_bundle', true)
        if (params.genre && params.genre !== 'all') q = q.eq('genre', params.genre)
        if (params.condition && params.condition !== 'any') q = q.eq('condition', params.condition)
        return q
      }

      // Standalone listings for this exact book.
      const directQuery = applyCommonFilters(
        supabase.from('listings').select('*, profiles(username, city)')
          .in('status', ['active', 'pending']).eq('ol_work_key', params.olWorkKey)
      )

      // Bundles containing this exact book, via listing_books.
      const { data: bundleRows } = await supabase
        .from('listing_books').select('listing_id').eq('ol_work_key', params.olWorkKey)
      const bundleListingIds = [...new Set((bundleRows ?? []).map((r: any) => r.listing_id))]

      const [{ data: direct, error: directErr }, bundleResult] = await Promise.all([
        directQuery,
        bundleListingIds.length > 0
          ? applyCommonFilters(
              supabase.from('listings').select('*, profiles(username, city)')
                .in('status', ['active', 'pending']).in('id', bundleListingIds)
            )
          : Promise.resolve({ data: [] as any[], error: null }),
      ])
      if (directErr) console.error('Browse ol_work_key query error:', directErr)

      const merged: any[] = []
      const seen = new Set<string>()
      for (const row of [...(direct ?? []), ...((bundleResult as any).data ?? [])]) {
        if (!seen.has(row.id)) { seen.add(row.id); merged.push(row) }
      }
      if (params.sort === 'price-asc') merged.sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
      else if (params.sort === 'price-desc') merged.sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
      else merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      return merged as Listing[]
    }

    let query = supabase
      .from('listings')
      .select('*, profiles(username, city)')
      .in('status', ['active', 'pending'])

    if (params.city) query = query.ilike('city', `%${params.city}%`)
    if (params.title) query = query.ilike('title', `%${params.title}%`)
    if (params.author) query = query.ilike('author', `%${params.author}%`)
    if (params.book_type === 'single') query = query.eq('is_bundle', false)
    if (params.book_type === 'bundle') query = query.eq('is_bundle', true)
    if (params.genre && params.genre !== 'all') query = query.eq('genre', params.genre)
    if (params.condition && params.condition !== 'any') query = query.eq('condition', params.condition)

    if (params.sort === 'price-asc') query = query.order('price', { ascending: true })
    else if (params.sort === 'price-desc') query = query.order('price', { ascending: false })
    else query = query.order('created_at', { ascending: false })

    const { data, error } = await query
    if (error) console.error('Browse query error:', error)
    console.log('Browse query returned', data?.length ?? 0, 'listings')
    return (data as Listing[]) ?? []
  } catch (err) {
    console.error('Browse listings exception:', err)
    return []
  }
}

async function getUserSaveContext(): Promise<{ isLoggedIn: boolean; userId: string | null; savedIds: Set<string> }> {
  const hasDemoCookie = !!cookies().get('lbe_demo_user')?.value
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { isLoggedIn: hasDemoCookie, userId: null, savedIds: new Set() }
    const { data } = await supabase.from('saved_listings').select('listing_id').eq('user_id', user.id)
    return { isLoggedIn: true, userId: user.id, savedIds: new Set((data ?? []).map(r => r.listing_id)) }
  } catch {
    return { isLoggedIn: hasDemoCookie, userId: null, savedIds: new Set() }
  }
}

async function getMyRequestedListingIds(userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set()
  try {
    const supabase = createClient()
    const { data } = await supabase
      .from('conversations')
      .select('listing_id')
      .eq('buyer_id', userId)
      .eq('exchange_status', 'requested')
    return new Set((data ?? []).map(r => r.listing_id))
  } catch {
    return new Set()
  }
}

async function getSellerRatings(listings: Listing[]): Promise<Record<string, { average: number; count: number } | null>> {
  const sellerIds = [...new Set(listings.map(l => l.user_id))]
  if (sellerIds.length === 0) return {}
  try {
    const supabase = createClient()
    const { data } = await supabase.from('reviews').select('seller_id, rating').in('seller_id', sellerIds)
    const bySeller: Record<string, number[]> = {}
    for (const r of data ?? []) (bySeller[r.seller_id] ??= []).push(r.rating)
    const result: Record<string, { average: number; count: number } | null> = {}
    for (const id of sellerIds) result[id] = averageRating(bySeller[id] ?? [])
    return result
  } catch {
    return {}
  }
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: {
    city?: string
    title?: string
    author?: string
    ol_work_key?: string
    book_type?: string
    genre?: string
    condition?: string
    sort?: string
  }
}) {
  const city = searchParams.city ?? ''
  const title = searchParams.title ?? ''
  const author = searchParams.author ?? ''
  const olWorkKey = searchParams.ol_work_key ?? ''
  const bookType = searchParams.book_type ?? 'all'
  const genre = searchParams.genre ?? 'all'
  const condition = searchParams.condition ?? 'any'
  const sort = searchParams.sort ?? 'newest'

  const [listings, { isLoggedIn, userId, savedIds }] = await Promise.all([
    getListings({ city, title, author, olWorkKey, book_type: bookType, genre, condition, sort }),
    getUserSaveContext(),
  ])
  const sellerRatings = await getSellerRatings(listings)
  const myRequestedIds = await getMyRequestedListingIds(userId)

  const activeFilters = [
    city && { label: city, key: 'city' },
    title && { label: `Title: "${title}"`, key: 'title' },
    author && { label: `Author: "${author}"`, key: 'author' },
    bookType !== 'all' && { label: bookType === 'single' ? 'Single books only' : 'Bundles only', key: 'book_type' },
    genre !== 'all' && { label: genre, key: 'genre' },
    condition !== 'any' && { label: `${conditionLabel(condition)} condition`, key: 'condition' },
  ].filter(Boolean) as { label: string; key: string }[]

  function clearFilterUrl(key: string) {
    const p = new URLSearchParams()
    if (city && key !== 'city') p.set('city', city)
    if (title && key !== 'title') p.set('title', title)
    if (olWorkKey && key !== 'title') p.set('ol_work_key', olWorkKey)
    if (author && key !== 'author') p.set('author', author)
    if (bookType !== 'all' && key !== 'book_type') p.set('book_type', bookType)
    if (genre !== 'all' && key !== 'genre') p.set('genre', genre)
    if (condition !== 'any' && key !== 'condition') p.set('condition', condition)
    if (sort !== 'newest') p.set('sort', sort)
    return `/listings?${p.toString()}`
  }

  // Rendered twice below: once inside the mobile <details> accordion, once in
  // an always-visible desktop wrapper. Desktop no longer depends on the
  // <details> element's native open/closed rendering (see fix commit for why).
  const filterForm = (
      <form method="GET" action="/listings" className="br-filters">
        <h2>
          <SearchIcon />
          Filters
        </h2>

        <div className="br-f-group">
          <span className="br-f-label">City</span>
          <div className="br-input-wrap">
            <PinIcon />
            <input className="br-input" name="city" type="text" defaultValue={city} placeholder="e.g. Chicago..." />
          </div>
        </div>

        <div className="br-f-group">
          <span className="br-f-label">Search Title</span>
          <div className="br-input-wrap">
            <SearchIcon />
            <BookFilterField defaultValue={title} style={{}} className="br-input" defaultOlWorkKey={olWorkKey} />
          </div>
        </div>

        <div className="br-f-group">
          <span className="br-f-label">Search Author</span>
          <div className="br-input-wrap">
            <SearchIcon />
            <input className="br-input" name="author" type="text" defaultValue={author} placeholder="e.g. Tara Westover..." />
          </div>
        </div>

        {/* Books &amp; Bundles: single books vs. bundles, three-way segmented toggle.
            Highlight is pure CSS (:checked in globals.css) so it flips instantly
            on click instead of waiting for the server-rendered state to catch up
            on form submit, like the other filters below still do. */}
        <div className="br-f-group">
          <span className="br-f-label">Books &amp; Bundles</span>
          <div className="br-seg">
            {[
              { val: 'single', label: 'Single' },
              { val: 'all', label: 'All' },
              { val: 'bundle', label: 'Bundles' },
            ].map(o => (
              <label key={o.val}>
                <input type="radio" name="book_type" value={o.val} defaultChecked={bookType === o.val} className="sr-only" />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Genre */}
        <div className="br-f-group">
          <span className="br-f-label">Genre</span>
          <select name="genre" defaultValue={genre} className="br-input">
            <option value="all">All Genres</option>
            {['Fiction','Non-Fiction','Mystery','Sci-Fi','Romance','Biography',"Children's",'Self-Help','History','Cooking','Art','Other'].map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        {/* Condition chips */}
        <div className="br-f-group">
          <span className="br-f-label">Condition</span>
          <div className="br-chip-row">
            {[
              { val: 'any', label: 'Any' },
              { val: 'good', label: 'Good' },
              { val: 'fair', label: 'Fair' },
              { val: 'well-loved', label: 'Well-Loved' },
            ].map(o => (
              <label key={o.val}>
                <input type="radio" name="condition" value={o.val} defaultChecked={condition === o.val} className="sr-only" />
                <span className="br-chip-opt">{o.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Sort */}
        <div className="br-f-group">
          <span className="br-f-label">Sort By</span>
          <select name="sort" defaultValue={sort} className="br-input">
            <option value="newest">Newest First</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
          </select>
        </div>

        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
          Apply Filters
        </button>
        <Link href="/listings" className="br-clear-link">
          Clear All
        </Link>
      </form>
  )

  return (
    <div className="home-v2">
      <section className="browse-hero">
        <div className="wrap browse-hero-grid">
          <img src="/home/browse-vine.png?v=12" alt="" aria-hidden="true" className="browse-vine" />
          <div className="browse-hero-copy">
            <h1>Browse Books</h1>
            <p className="sub">Find your next good read nearby.</p>
          </div>
          <img
            className="browse-hero-art"
            src="/home/browse-hero.png?v=6"
            alt="A colorful stack of books beside a yellow flower on a pink background, captioned Good books build brighter days"
          />
        </div>
      </section>

      <div className="wrap browse-layout">
        {/* Sidebar / Filters */}
        <div className="br-filters-col">
          {/* Mobile: native collapsible accordion, closed unless a filter is already active */}
          <details open={activeFilters.length > 0} className="md:hidden">
            <summary className="br-filters-toggle">
              Filters {activeFilters.length > 0 ? `(${activeFilters.length} active)` : ''}
              <span>⌄</span>
            </summary>
            {filterForm}
          </details>
          {/* Desktop: always visible, independent of <details> open/closed rendering */}
          <div className="hidden md:block">
            {filterForm}
            <img src="/home/browse-sidebar-flower.png?v=2" alt="" aria-hidden="true" className="br-sidebar-deco" />
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Active filter tags */}
          {activeFilters.length > 0 && (
            <div className="br-active-row">
              {activeFilters.map(f => (
                <Link key={f.key} href={clearFilterUrl(f.key)} className="br-active-chip">
                  {f.label} <span className="x">&times;</span>
                </Link>
              ))}
            </div>
          )}

        {listings.length > 0 ? (
          <div className="br-grid">
            {listings.map(l => {
              const avail = getListingAvailability((l.status ?? 'active') as ListingStatus, {
                isOwner: l.user_id === userId,
                isRequester: myRequestedIds.has(l.id),
              })
              const locked = avail === 'pending-locked'
              const lockedStyle = locked ? { filter: 'grayscale(1)', opacity: 0.55 } : undefined

              const cardInner = (
                <>
                  <div className="br-cover-wrap">
                    {l.cover_url ? (
                      <div className="absolute inset-0" style={{ background: '#fff', ...lockedStyle }}>
                        <Image src={l.cover_url} alt={l.title} fill className="object-contain" />
                      </div>
                    ) : (
                      <div className="br-cover-fallback" style={lockedStyle}>
                        <span>{l.is_bundle ? (l.bundle_name || l.title) : l.title}</span>
                      </div>
                    )}
                    {avail === 'active' ? (
                      <span className="br-badge-credit">
                        {l.is_bundle ? `${l.book_count ?? 1} credits` : '1 credit'}
                      </span>
                    ) : (
                      <span className="br-badge-pending">Pending</span>
                    )}
                    {l.genre && <span className="br-badge-genre">{l.genre}</span>}
                  </div>
                  <div className="br-card-body">
                    <p className="br-title">{l.is_bundle ? (l.bundle_name || l.title) : l.title}</p>
                    <p className="br-author">{l.author}</p>
                    <div className="br-seller-row">
                      {l.profiles?.username && (
                        <>
                          <span className="br-seller-name">{l.profiles.username}</span>
                          {/* No sellerId here: the whole card is already a <Link> to the
                              listing detail page, and StarRatingBadge renders its own <Link>
                              to the seller's reviews when given one — nesting an <a> inside
                              an <a> is invalid HTML and was the actual cause of the browser's
                              "Expected server HTML to contain a matching <div> in <a>"
                              hydration error. Plain (non-link) badge here; the clickable
                              version still appears on the listing detail page itself. */}
                          <StarRatingBadge rating={sellerRatings[l.user_id] ?? null} />
                        </>
                      )}
                    </div>
                    <div className="br-foot-row">
                      <span className="br-cond-badge">{conditionLabel(l.condition)}</span>
                      <span className="br-credit-lbl">
                        {l.is_bundle ? `Bundle · ${l.book_count ?? 1} books` : '1 credit'}
                      </span>
                    </div>
                    {locked && (
                      <form action={addTbrEntry}>
                        <input type="hidden" name="title" value={l.title} />
                        <input type="hidden" name="author" value={l.author} />
                        <input type="hidden" name="ol_work_key" value={l.ol_work_key ?? ''} />
                        <input type="hidden" name="cover_url" value={l.cover_url ?? ''} />
                        <input type="hidden" name="redirect_to" value="/profile?tab=tbr" />
                        <button type="submit" className="br-tbr-btn">
                          Add to my TBR
                        </button>
                      </form>
                    )}
                  </div>
                </>
              )

              return (
                <div key={l.id} style={{ position: 'relative' }}>
                  {/* HeartButton sits outside the <Link>/<div> card on purpose — a <button>
                      nested inside an <a> is invalid HTML and causes a hydration mismatch
                      ("Expected server HTML to contain a matching <div> in <a>") on any
                      listing that isn't locked and isn't owned by the viewer. Same absolute
                      top:8/left:8 positioning, just anchored to this wrapper instead. */}
                  {!locked && l.user_id !== userId && (
                    <HeartButton listingId={l.id} isLoggedIn={isLoggedIn} initialSaved={savedIds.has(l.id)} />
                  )}
                  {locked ? (
                    <div className="br-card pending">
                      {cardInner}
                    </div>
                  ) : (
                    <Link href={`/listings/${l.id}`} className="br-card">
                      {cardInner}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="br-empty">
            <p style={{ marginBottom: 10 }}>No books match your filters.</p>
            <Link href="/listings">Clear filters</Link>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
