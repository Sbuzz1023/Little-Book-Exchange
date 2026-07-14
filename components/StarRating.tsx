import Link from 'next/link'

export function StarRatingBadge({
  rating, sellerId,
}: {
  rating: { average: number; count: number } | null
  sellerId?: string
}) {
  if (!rating || rating.count === 0) return null

  const content = (
    <span className="font-extrabold text-[11px] whitespace-nowrap" style={{ color: '#f59e0b' }}>
      ★ {rating.average.toFixed(1)} <span style={{ color: '#aaa', fontWeight: 700 }}>({rating.count})</span>
    </span>
  )

  if (!sellerId) return content

  return (
    <Link href={`/sellers/${sellerId}/reviews`} style={{ textDecoration: 'none' }} className="hover:underline">
      {content}
    </Link>
  )
}

export function StarRatingPicker({
  value, onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 28, lineHeight: 1,
            color: n <= value ? '#f59e0b' : '#e5e7eb',
          }}
        >
          ★
        </button>
      ))}
    </div>
  )
}
