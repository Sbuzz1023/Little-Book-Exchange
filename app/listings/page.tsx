import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import HeartButton from '@/components/HeartButton'
import type { Listing } from '@/lib/types'
import { MOCK_LISTINGS } from '@/lib/mock-data'

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
  type?: string
  genre?: string
  condition?: string
  sort?: string
}): Promise<Listing[]> {
  try {
    const supabase = createClient()
    let query = supabase
      .from('listings')
      .select('*, profiles(name, city)')
      .eq('status', 'active')

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

    const { data } = await query
    return (data as Listing[]) ?? []
  } catch {
    let results = [...MOCK_LISTINGS]
    if (params.city) results = results.filter(l => l.city.toLowerCase().includes(params.city!.toLowerCase()))
    if (params.title) results = results.filter(l => l.title.toLowerCase().includes(params.title!.toLowerCase()))
    if (params.author) results = results.filter(l => l.author.toLowerCase().includes(params.author!.toLowerCase()))
    if (params.type === 'free') results = results.filter(l => !l.price)
    if (params.type === 'sale') results = results.filter(l => !!l.price)
    if (params.genre && params.genre !== 'all') results = results.filter(l => l.genre === params.genre)
    if (params.condition && params.condition !== 'any') results = results.filter(l => l.condition.toLowerCase() === params.condition!)
    return results as unknown as Listing[]
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
    type?: string
    genre?: string
    condition?: string
    sort?: string
  }
}) {
  const city = searchParams.city ?? ''
  const title = searchParams.title ?? ''
  const author = searchParams.author ?? ''
  const type = searchParams.type ?? 'all'
  const genre = searchParams.genre ?? 'all'
  const condition = searchParams.condition ?? 'any'
  const sort = searchParams.sort ?? 'newest'

  const listings = await getListings({ city, title, author, type, genre, condition, sort })

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
    if (author && key !== 'author') p.set('author', author)
    if (type !== 'all' && key !== 'type') p.set('type', type)
    if (genre !== 'all' && key !== 'genre') p.set('genre', genre)
    if (condition !== 'any' && key !== 'condition') p.set('condition', condition)
    if (sort !== 'newest') p.set('sort', sort)
    return `/listings?${p.toString()}`
  }

  return (
    <div className="mx-auto px-4 py-6 md:px-8 md:py-9 flex flex-col md:flex-row md:gap-7" style={{ maxWidth: 1160, alignItems: 'flex-start' }}>
      {/* Sidebar / Filters */}
      <div className="w-full md:w-[240px] md:flex-shrink-0 md:sticky md:top-6 mb-4 md:mb-0">
        <details open className="md:contents">
          <summary className="md:hidden cursor-pointer list-none flex items-center justify-between bg-white border-2 border-gray-100 rounded-[16px] px-5 py-3 font-extrabold text-[14px] text-bk-orange shadow-[0_3px_0_#e5e7eb] mb-2">
            🔍 Filters {activeFilters.length > 0 ? `(${activeFilters.length} active)` : ''}
            <span className="text-[18px] font-black">⌄</span>
          </summary>
      <form
        method="GET"
        action="/listings"
        className="bg-white border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb]"
        style={{ borderRadius: 24, padding: 24 }}
      >
        <h2 className="font-display text-[18px] text-bk-orange mb-5">🔍 Filters</h2>

        {[
          { label: 'City', name: 'city', placeholder: 'e.g. Chicago...', value: city },
          { label: 'Search Title', name: 'title', placeholder: 'e.g. Great Gatsby...', value: title },
          { label: 'Search Author', name: 'author', placeholder: 'e.g. Tara Westover...', value: author },
        ].map(f => (
          <div key={f.name} style={{ marginBottom: 22 }}>
            <span
              className="block mb-2.5"
              style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}
            >
              {f.label}
            </span>
            <input
              name={f.name}
              type="text"
              defaultValue={f.value}
              placeholder={f.placeholder}
              style={filterInputStyle}
            />
          </div>
        ))}

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
        </details>
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
              return (
                <Link
                  key={l.id}
                  href={`/listings/${l.id}`}
                  className="block bg-white border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb] hover:-translate-y-1 transition-transform overflow-hidden"
                  style={{ borderRadius: 20, textDecoration: 'none', color: 'inherit' }}
                >
                  <div
                    className="relative flex items-center justify-center text-[46px]"
                    style={{ height: 135, background: gradient }}
                  >
                    <span>📚</span>
                    <HeartButton />
                    {/* Price tag */}
                    <span
                      className="absolute text-white font-black"
                      style={{
                        top: 8, right: 8,
                        padding: '3px 10px',
                        borderRadius: 999,
                        fontSize: 11,
                        background: '#f97316',
                      }}
                    >
                      1 credit
                    </span>
                    {/* Genre tag */}
                    {l.genre && (
                      <span
                        className="absolute font-extrabold"
                        style={{
                          bottom: 8, left: 8,
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 10,
                          background: 'rgba(255,255,255,0.85)',
                          color: '#555',
                        }}
                      >
                        {l.genre}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '12px 14px' }}>
                    <p className="font-black text-[13px] truncate mb-0.5">{l.title}</p>
                    <p className="text-[11px] font-semibold mb-2" style={{ color: '#aaa' }}>{l.author}</p>
                    <div className="flex items-center justify-between">
                      <span
                        className="font-extrabold text-[10px]"
                        style={{
                          padding: '2px 7px',
                          borderRadius: 6,
                          background: '#fef9c3',
                          color: '#854d0e',
                          border: '1.5px solid #fde047',
                        }}
                      >
                        {conditionLabel(l.condition)}
                      </span>
                      <span
                        className="font-extrabold text-[10px]"
                        style={{ color: '#f97316' }}
                      >
                        🪙 1 credit
                      </span>
                    </div>
                  </div>
                </Link>
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
