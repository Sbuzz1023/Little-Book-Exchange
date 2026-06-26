import Link from 'next/link'
import Image from 'next/image'
import type { Listing } from '@/lib/types'

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

export default function BookCard({ listing }: { listing: Listing }) {
  const isFree = !listing.price
  const gradient = coverGradient(listing.id)

  return (
    <Link
      href={`/listings/${listing.id}`}
      className="block bg-white border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb] hover:-translate-y-1 transition-transform overflow-hidden"
      style={{ borderRadius: 20, textDecoration: 'none', color: 'inherit' }}
    >
      <div
        className="relative flex items-center justify-center text-[46px]"
        style={{ height: 135, background: gradient }}
      >
        {listing.photo_url ? (
          <Image src={listing.photo_url} alt={listing.title} fill className="object-cover" />
        ) : (
          <span>📚</span>
        )}
        <span
          className="absolute text-white font-black"
          style={{
            top: 8, right: 8,
            padding: '3px 10px',
            borderRadius: 999,
            fontSize: 11,
            background: isFree ? '#0d9488' : '#f97316',
          }}
        >
          {isFree ? 'FREE' : `$${Number(listing.price).toFixed(2)}`}
        </span>
        {listing.genre && (
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
            {listing.genre}
          </span>
        )}
      </div>
      <div style={{ padding: '12px 14px' }}>
        <p className="font-black text-[13px] truncate mb-0.5">{listing.title}</p>
        <p className="text-[11px] font-semibold mb-2" style={{ color: '#aaa' }}>{listing.author}</p>
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
            {conditionLabel(listing.condition)}
          </span>
          <span className="text-[10px] font-bold" style={{ color: '#ccc' }}>
            {listing.profiles?.city || listing.city}
          </span>
        </div>
      </div>
    </Link>
  )
}
