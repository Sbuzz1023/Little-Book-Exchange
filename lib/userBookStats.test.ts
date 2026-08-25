import { describe, it, expect } from 'vitest'
import { computeUserBookStats } from './userBookStats'

describe('computeUserBookStats', () => {
  it('counts every listing a user has ever posted, regardless of status', () => {
    const listings = [
      { user_id: 'u1' }, { user_id: 'u1' }, { user_id: 'u1' },
    ]
    const stats = computeUserBookStats(listings, [])
    expect(stats['u1'].booksPosted).toBe(3)
  })

  it('counts a completed exchange as sold for the seller and bought for the buyer', () => {
    const conversations = [
      { seller_id: 's1', buyer_id: 'b1', exchange_status: 'completed' },
    ]
    const stats = computeUserBookStats([], conversations)
    expect(stats['s1'].booksSold).toBe(1)
    expect(stats['b1'].booksBought).toBe(1)
  })

  it('does not count a pending (non-completed) exchange as sold or bought', () => {
    const conversations = [
      { seller_id: 's1', buyer_id: 'b1', exchange_status: 'confirmed' },
      { seller_id: 's1', buyer_id: 'b1', exchange_status: 'requested' },
    ]
    const stats = computeUserBookStats([], conversations)
    expect(stats['s1']?.booksSold ?? 0).toBe(0)
    expect(stats['b1']?.booksBought ?? 0).toBe(0)
  })

  it('gives a user with no listings or exchanges all zeros rather than being absent', () => {
    const stats = computeUserBookStats([{ user_id: 'active-user' }], [], ['active-user', 'quiet-user'])
    expect(stats['quiet-user']).toEqual({ booksPosted: 0, booksSold: 0, booksBought: 0 })
  })

  it('tallies posted, sold, and bought independently for the same user', () => {
    const listings = [{ user_id: 'u1' }, { user_id: 'u1' }]
    const conversations = [
      { seller_id: 'u1', buyer_id: 'other', exchange_status: 'completed' },
      { seller_id: 'someone-else', buyer_id: 'u1', exchange_status: 'completed' },
    ]
    const stats = computeUserBookStats(listings, conversations)
    expect(stats['u1']).toEqual({ booksPosted: 2, booksSold: 1, booksBought: 1 })
  })
})
