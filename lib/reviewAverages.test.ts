import { describe, it, expect } from 'vitest'
import { averageRating } from './reviewAverages'

describe('averageRating', () => {
  it('returns null for an empty list', () => {
    expect(averageRating([])).toBeNull()
  })

  it('returns the exact average and count for a single rating', () => {
    expect(averageRating([5])).toEqual({ average: 5, count: 1 })
  })

  it('rounds the average to one decimal place', () => {
    expect(averageRating([5, 4, 4])).toEqual({ average: 4.3, count: 3 })
  })

  it('handles a full mix of ratings', () => {
    expect(averageRating([1, 2, 3, 4, 5])).toEqual({ average: 3, count: 5 })
  })
})
