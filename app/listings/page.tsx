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
  type?: string
  genre?: string
  condition?: string
  sort?: string
}): Promise<Listing[]> {
  try {
    const supabase = createClient()

    if (params.olWorkKey) {
      const applyCommonFilters = (q: any) => {
        if (params.city) q = q.ilike('city', `%${params.city}%`)
        if (params.type === 'free') q = q.is('price', null)
        if (params.type === 'sale') q = q.not('price', 'is', null)
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
    if (params.type === 'free') query = query.is('price', null)
    if (params.type === 'sale') query = query.not('price', 'is', null)
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

const filterInputStyle = {
  width: '100%',
  border: '2px solid #fed7aa',
  borderRadius: 12,
  padding: '9px 12px',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 700,
  background: '#fffbf0',
  color: '#2d2d2d',
  outline: 'none',
} as React.CSSProperties

export default async function ListingsPage({
  searchParams,
}: {
  searchParams: {
    city?: string
    title?: string
    author?: string
    ol_work_key?: string
    type?: string
    genre?: string
    condition?: string
    sort?: string
  }
}) {
  const city = searchParams.city ?? ''
  const title = searchParams.title ?? ''
  const author = searchParams.author ?? ''
  const olWorkKey = searchParams.ol_work_key ?? ''
  const type = searchParams.type ?? 'all'
  const genre = searchParams.genre ?? 'all'
  const condition = searchParams.condition ?? 'any'
  const sort = searchParams.sort ?? 'newest'

  const [listings, { isLoggedIn, userId, savedIds }] = await Promise.all([
    getListings({ city, title, author, olWorkKey, type, genre, condition, sort }),
    getUserSaveContext(),
  ])
  const sellerRatings = await getSellerRatings(listings)
  const myRequestedIds = await getMyRequestedListingIds(userId)

  const activeFilters = [
    city && { label: `📍 ${city}`, key: 'city' },
    title && { label: `Title: "${title}"`, key: 'title' },
    author && { label: `Author: "${author}"`, key: 'author' },
    type !== 'all' && { label: type === 'free' ? '🎁 Free only' : '💲 For sale', key: 'type' },
    genre !== 'all' && { label: genre, key: 'genre' },
    condition !== 'any' && { label: `${conditionLabel(condition)} condition`, key: 'condition' },
  ].filter(Boolean) as { label: string; key: string }[]

  function clearFilterUrl(key: string) {
    const p = new URLSearchParams()
    if (city && key !== 'city') p.set('city', city)
    if (title && key !== 'title') p.set('title', title)
    if (olWorkKey && key !== 'title') p.set('ol_work_key', olWorkKey)
    if (author && key !== 'author') p.set('author', author)
    if (type !== 'all' && key !== 'type') p.set('type', type)
    if (genre !== 'all' && key !== 'genre') p.set('genre', genre)
    if (condition !== 'any' && key !== 'condition') p.set('condition', condition)
    if (sort !== 'newest') p.set('sort', sort)
    return `/listings?${p.toString()}`
  }

  // Rendered twice below: once inside the mobile <details> accordion, once in
  // an always-visible desktop wrapper. Desktop no longer depends on the
  // <details> element's native open/closed rendering (see fix commit for why).
  const filterForm = (
      <form
        method="GET"
        action="/listings"
        className="bg-white border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb]"
        style={{ borderRadius: 24, padding: 24 }}
      >
        <h2 className="font-display text-[18px] text-bk-orange mb-5">🔍 Filters</h2>

        <div style={{ marginBottom: 22 }}>
          <span className="block mb-2.5" style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}>
            City
          </span>
          <input name="city" type="text" defaultValue={city} placeholder="e.g. Chicago..." style={filterInputStyle} />
        </div>

        <div style={{ marginBottom: 22 }}>
          <span className="block mb-2.5" style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}>
            Search Title
          </span>
          <BookFilterField defaultValue={title} style={filterInputStyle} defaultOlWorkKey={olWorkKey} />
        </div>

        <div style={{ marginBottom: 22 }}>
          <span className="block mb-2.5" style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}>
            Search Author
          </span>
          <input name="author" type="text" defaultValue={author} placeholder="e.g. Tara Westover..." style={filterInputStyle} />
        </div>

        {/* Listing Type chips */}
        <div style={{ marginBottom: 22 }}>
          <span
            className="block mb-2.5"
            style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}
          >
            Listing Type
          </span>
          <div className="flex flex-wrap gap-1.5">
            {[
              { val: 'all', label: 'All' },
              { val: 'sale', label: '📗 For Sale' },
              { val: 'free', label: '🎁 Free' },
            ].map(o => (
              <label key={o.val} style={{ cursor: 'pointer' }}>
                <input type="radio" name="type" value={o.val} defaultChecked={type === o.val} className="sr-only" />
                <span
                  style={{
                    display: 'inline-block',
                    padding: '5px 12px',
                    borderRadius: 999,
                    fontWeight: 800,
                    fontSize: 12,
                    border: '2px solid',
                    borderColor: type === o.val ? (o.val === 'free' ? '#0d9488' : '#f97316') : '#e5e7eb',
                    background: type === o.val ? (o.val === 'free' ? '#0d9488' : '#f97316') : '#fff',
                    color: type === o.val ? '#fff' : '#555',
                  }}
                >
                  {o.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Genre */}
        <div style={{ marginBottom: 22 }}>
          <span
            className="block mb-2.5"
            style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}
          >
            Genre
          </span>
          <select name="genre" defaultValue={genre} style={filterInputStyle}>
            <option value="all">All Genres</option>
            {['Fiction','Non-Fiction','Mystery','Sci-Fi','Romance','Biography',"Children's",'Self-Help','History','Cooking','Art','Other'].map(g => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>

        {/* Condition chips */}
        <div style={{ marginBottom: 22 }}>
          <span
            className="block mb-2.5"
            style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}
          >
            Condition
          </span>
          <div className="flex flex-wrap gap-1.5">
            {[
              { val: 'any', label: 'Any' },
              { val: 'good', label: 'Good' },
              { val: 'fair', label: 'Fair' },
              { val: 'well-loved', label: 'Well-Loved' },
            ].map(o => (
              <label key={o.val} style={{ cursor: 'pointer' }}>
                <input type="radio" name="condition" value={o.val} defaultChecked={condition === o.val} className="sr-only" />
                <span
                  style={{
                    display: 'inline-block',
                    padding: '5px 12px',
                    borderRadius: 999,
                    fontWeight: 800,
                    fontSize: 12,
                    border: '2px solid',
                    borderColor: condition === o.val ? '#f97316' : '#e5e7eb',
                    background: condition === o.val ? '#f97316' : '#fff',
                    color: condition === o.val ? '#fff' : '#555',
                  }}
                >
                  {o.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Sort */}
        <div style={{ marginBottom: 22 }}>
          <span
            className="block mb-2.5"
            style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}
          >
            Sort By
          </span>
          <select name="sort" defaultValue={sort} style={filterInputStyle}>
            <option value="newest">Newest First</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
          </select>
        </div>

        <button
          type="submit"
          className="w-full text-white font-black text-[15px] shadow-[0_3px_0_#c2410c]"
          style={{ background: '#f97316', padding: 12, borderRadius: 14, border: 'none', cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 }}
        >
          Apply Filters
        </button>
        <Link
          href="/listings"
          className="block text-center font-extrabold text-[13px] mt-2"
          style={{
            border: '2px solid #e5e7eb',
            padding: 10,
            borderRadius: 14,
            color: '#aaa',
          }}
        >
          Clear All
        </Link>
      </form>
  )

  return (
    <div className="mx-auto px-4 py-6 md:px-8 md:py-9 flex flex-col md:flex-row md:gap-7 md:items-start" style={{ maxWidth: 1160 }}>
      {/* Sidebar / Filters */}
      <div className="w-full md:w-[240px] md:flex-shrink-0 md:sticky md:top-6 mb-4 md:mb-0">
        {/* Mobile: native collapsible accordion, closed unless a filter is already active */}
        <details open={activeFilters.length > 0} className="md:hidden">
          <summary className="cursor-pointer list-none flex items-center justify-between bg-white border-2 border-gray-100 rounded-[16px] px-5 py-3 font-extrabold text-[14px] text-bk-orange shadow-[0_3px_0_#e5e7eb] mb-2">
            🔍 Filters {activeFilters.length > 0 ? `(${activeFilters.length} active)` : ''}
            <span className="text-[18px] font-black">⌄</span>
          </summary>
          {filterForm}
        </details>
        {/* Desktop: always visible, independent of <details> open/closed rendering */}
        <div className="hidden md:block">
          {filterForm}
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Active filter tags */}
        {activeFilters.length > 0 && (
          <div className="flex gap-2 flex-wrap mb-4">
            {activeFilters.map(f => (
              <Link
                key={f.key}
                href={clearFilterUrl(f.key)}
                className="flex items-center gap-1.5 font-extrabold text-[12px]"
                style={{
                  background: '#fff7ed',
                  border: '2px solid #fed7aa',
                  color: '#c2410c',
                  padding: '4px 12px',
                  borderRadius: 999,
                }}
              >
                {f.label} <span style={{ color: '#f97316', fontWeight: 900, fontSize: 14 }}>×</span>
              </Link>
            ))}
          </div>
        )}

        <p className="font-bold text-[13px] mb-4" style={{ color: '#aaa' }}>
          Showing {listings.length} book{listings.length !== 1 ? 's' : ''}
        </p>

        {listings.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(185px, 1fr))', gap: 18 }}>
            {listings.map(l => {
              const gradient = coverGradient(l.id)
              const avail = getListingAvailability((l.status ?? 'active') as ListingStatus, {
                isOwner: l.user_id === userId,
                isRequester: myRequestedIds.has(l.id),
              })
              const locked = avail === 'pending-locked'

              const cardInner = (
                <>
                  <div
                    className="relative flex items-center justify-center text-[46px]"
                    style={{ height: 135 }}
                  >
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{ background: gradient, ...(locked ? { filter: 'grayscale(1)', opacity: 0.55 } : {}) }}
                    >
                      {l.photo_url ? (
                        <Image src={l.photo_url} alt={l.title} fill className="object-cover" />
                      ) : l.cover_url ? (
                        <Image src={l.cover_url} alt={l.title} fill className="object-cover" />
                      ) : (
                        <span>📚</span>
                      )}
                    </div>
                    {avail === 'active' ? (
                      <span
                        className="absolute text-white font-black"
                        style={{ top: 8, right: 8, padding: '3px 10px', borderRadius: 999, fontSize: 11, background: '#f97316' }}
                      >
                        {l.is_bundle ? `${l.book_count ?? 1} credits` : '1 credit'}
                      </span>
                    ) : (
                      <span
                        className="absolute text-white font-black"
                        style={{ top: 8, right: 8, padding: '3px 10px', borderRadius: 999, fontSize: 11, background: '#dc2626' }}
                      >
                        ⏳ Pending
                      </span>
                    )}
                    {l.genre && (
                      <span
                        className="absolute font-extrabold"
                        style={{ bottom: 8, left: 8, padding: '2px 8px', borderRadius: 999, fontSize: 10, background: 'rgba(255,255,255,0.85)', color: '#555' }}
                      >
                        {l.genre}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '12px 14px' }}>
                    <p className="font-black text-[13px] truncate mb-0.5">{l.is_bundle ? (l.bundle_name || l.title) : l.title}</p>
                    <p className="text-[11px] font-semibold mb-2" style={{ color: '#aaa' }}>{l.author}</p>
                    {l.profiles?.username && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-[11px] font-bold truncate" style={{ color: '#888' }}>{l.profiles.username}</span>
                        <StarRatingBadge rating={sellerRatings[l.user_id] ?? null} sellerId={l.user_id} />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span
                        className="font-extrabold text-[10px]"
                        style={{ padding: '2px 7px', borderRadius: 6, background: '#fef9c3', color: '#854d0e', border: '1.5px solid #fde047' }}
                      >
                        {conditionLabel(l.condition)}
                      </span>
                      <span className="font-extrabold text-[10px]" style={{ color: '#f97316' }}>
                        {l.is_bundle ? `📚 Bundle · ${l.book_count ?? 1} books · ${l.book_count ?? 1} credits` : '🪙 1 credit'}
                      </span>
                    </div>
                    {locked && (
                      <form action={addTbrEntry} className="mt-2">
                        <input type="hidden" name="title" value={l.title} />
                        <input type="hidden" name="author" value={l.author} />
                        <input type="hidden" name="ol_work_key" value={l.ol_work_key ?? ''} />
                        <input type="hidden" name="cover_url" value={l.cover_url ?? ''} />
                        <input type="hidden" name="redirect_to" value="/profile?tab=tbr" />
                        <button
                          type="submit"
                          className="w-full font-extrabold text-[11px]"
                          style={{ background: '#f5f3ff', border: '1.5px solid #ddd6fe', color: '#7c3aed', padding: '6px 0', borderRadius: 10, cursor: 'pointer' }}
                        >
                          📚 Add to my TBR
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
                    <div
                      className="bg-white border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb] overflow-hidden"
                      style={{ borderRadius: 20 }}
                    >
                      {cardInner}
                    </div>
                  ) : (
                    <Link
                      href={`/listings/${l.id}`}
                      className="block bg-white border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb] hover:-translate-y-1 transition-transform overflow-hidden"
                      style={{ borderRadius: 20, textDecoration: 'none', color: 'inherit' }}
                    >
                      {cardInner}
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-16 font-bold" style={{ color: '#aaa' }}>
            <div className="text-5xl mb-4">📭</div>
            <p className="text-base mb-3">No books match your filters.</p>
            <Link href="/listings" className="text-bk-orange font-extrabold hover:underline">Clear filters</Link>
          </div>
        )}
      </div>
    </div>
  )
}
