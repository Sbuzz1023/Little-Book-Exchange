import { describe, it, expect } from 'vitest'
import { bucketActivity } from './activityBuckets'

// A fixed "now" so every test is deterministic regardless of when it runs.
const NOW = new Date('2026-08-20T12:00:00.000Z') // a Thursday

describe('bucketActivity — daily', () => {
  it('returns 14 buckets, oldest first, ending on today', () => {
    const buckets = bucketActivity('daily', { posts: [], signups: [], trades: [] }, NOW)
    expect(buckets).toHaveLength(14)
    expect(buckets[13].label).toBe('Aug 20')
    expect(buckets[0].label).toBe('Aug 7')
  })

  it('counts an event on the exact bucket day it happened', () => {
    const buckets = bucketActivity('daily', { posts: ['2026-08-20T09:00:00.000Z'], signups: [], trades: [] }, NOW)
    expect(buckets[13].posts).toBe(1)
    expect(buckets.reduce((s, b) => s + b.posts, 0)).toBe(1)
  })

  it('excludes an event from outside the 14-day window', () => {
    const buckets = bucketActivity('daily', { posts: ['2026-07-01T09:00:00.000Z'], signups: [], trades: [] }, NOW)
    expect(buckets.reduce((s, b) => s + b.posts, 0)).toBe(0)
  })

  it('tallies posts, signups, and trades independently in the same bucket', () => {
    const buckets = bucketActivity('daily', {
      posts:   ['2026-08-19T01:00:00.000Z', '2026-08-19T23:00:00.000Z'],
      signups: ['2026-08-19T12:00:00.000Z'],
      trades:  [],
    }, NOW)
    const yesterday = buckets[12]
    expect(yesterday.label).toBe('Aug 19')
    expect(yesterday).toEqual({ label: 'Aug 19', posts: 2, signups: 1, trades: 0 })
  })
})

describe('bucketActivity — weekly', () => {
  it('returns 8 buckets', () => {
    const buckets = bucketActivity('weekly', { posts: [], signups: [], trades: [] }, NOW)
    expect(buckets).toHaveLength(8)
  })

  it('groups the whole current week together, regardless of day of week', () => {
    // NOW is Thursday Aug 20 2026 — its week (Mon Aug 17 – Sun Aug 23) is the
    // most recent bucket, so an event on the Monday of that same week lands
    // in the same bucket as an event on NOW itself.
    const buckets = bucketActivity('weekly', {
      posts: ['2026-08-17T00:00:01.000Z', '2026-08-20T12:00:00.000Z'],
      signups: [], trades: [],
    }, NOW)
    expect(buckets[7].posts).toBe(2)
  })

  it('puts an event from the prior week in the previous bucket', () => {
    const buckets = bucketActivity('weekly', { posts: ['2026-08-10T12:00:00.000Z'], signups: [], trades: [] }, NOW)
    expect(buckets[6].posts).toBe(1)
    expect(buckets[7].posts).toBe(0)
  })
})

describe('bucketActivity — monthly', () => {
  it('returns 12 buckets ending on the current month', () => {
    const buckets = bucketActivity('monthly', { posts: [], signups: [], trades: [] }, NOW)
    expect(buckets).toHaveLength(12)
    expect(buckets[11].label).toBe("Aug '26")
    expect(buckets[0].label).toBe("Sep '25")
  })

  it('groups an event by its calendar month', () => {
    const buckets = bucketActivity('monthly', { posts: [], signups: [], trades: ['2026-03-15T00:00:00.000Z'] }, NOW)
    const march = buckets.find(b => b.label === "Mar '26")
    expect(march?.trades).toBe(1)
  })
})

describe('bucketActivity — yearly', () => {
  it('returns 5 buckets ending on the current year', () => {
    const buckets = bucketActivity('yearly', { posts: [], signups: [], trades: [] }, NOW)
    expect(buckets).toHaveLength(5)
    expect(buckets.map(b => b.label)).toEqual(['2022', '2023', '2024', '2025', '2026'])
  })

  it('groups an event by its calendar year', () => {
    const buckets = bucketActivity('yearly', { posts: [], signups: ['2024-06-01T00:00:00.000Z'], trades: [] }, NOW)
    expect(buckets.find(b => b.label === '2024')?.signups).toBe(1)
  })
})
