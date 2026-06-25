import Link from 'next/link'
import Image from 'next/image'
import type { Listing } from '@/lib/types'
import { formatPrice, formatCondition, getConditionBadgeClass } from '@/lib/utils'

const COVER_GRADIENTS = [
  'from-yellow-200 to-red-200',
  'from-teal-200 to-blue-200',
  'from-pink-200 to-rose-200',
  'from-purple-200 to-blue-200',
  'from-green-200 to-yellow-200',
  'from-orange-200 to-pink-200',
]

function coverGradient(id: string) {
  const sum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return COVER_GRADIENTS[sum % COVER_GRADIENTS.length]
}

export default function BookCard({ listing }: { listing: Listing }) {
  const isFree = !listing.price
  return (
    <Link href={`/listings/${listing.id}`} className="block group">
      <div className="bg-white rounded-2xl overflow-hidden border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb] hover:-translate-y-1 transition-transform">
        <div className={`relative h-40 bg-gradient-to-br ${coverGradient(listing.id)} flex items-center justify-center text-5xl`}>
          {listing.photo_url ? (
            <Image src={listing.photo_url} alt={listing.title} fill className="object-cover"/>
          ) : (
            <span>📚</span>
          )}
          <span className={`absolute top-2 right-2 px-3 py-1 rounded-full text-xs font-black ${isFree ? 'bg-bk-teal text-white' : 'bg-bk-orange text-white'}`}>
            {isFree ? 'FREE' : formatPrice(listing.price)}
          </span>
        </div>
        <div className="p-4">
          <p className="font-black text-sm truncate">{listing.title}</p>
          <p className="text-xs text-gray-400 font-semibold mb-3">{listing.author}</p>
          <div className="flex items-center justify-between">
            <span className={`text-xs font-bold px-2 py-1 rounded-lg border ${getConditionBadgeClass(listing.condition)}`}>
              {formatCondition(listing.condition)}
            </span>
            <span className="text-xs text-gray-300 font-bold">{listing.city}</span>
          </div>
        </div>
      </div>
    </Link>
  )
}
