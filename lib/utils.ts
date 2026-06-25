export function formatPrice(price: number | null): string {
  if (!price) return 'Free'
  return `$${price.toFixed(2)}`
}

export function formatCondition(condition: string): string {
  const map: Record<string, string> = {
    good: 'Good',
    fair: 'Fair',
    'well-loved': 'Well-Loved',
  }
  return map[condition] ?? condition
}

export function getConditionBadgeClass(condition: string): string {
  const map: Record<string, string> = {
    good: 'bg-yellow-100 text-yellow-800 border-yellow-300',
    fair: 'bg-orange-100 text-orange-800 border-orange-300',
    'well-loved': 'bg-red-100 text-red-800 border-red-300',
  }
  return map[condition] ?? 'bg-gray-100 text-gray-700'
}

export function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
