export type RatingSummary = { average: number; count: number }

export function averageRating(ratings: number[]): RatingSummary | null {
  if (ratings.length === 0) return null
  const sum = ratings.reduce((a, b) => a + b, 0)
  return { average: Math.round((sum / ratings.length) * 10) / 10, count: ratings.length }
}
