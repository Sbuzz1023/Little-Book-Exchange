import { describe, it, expect } from 'vitest'
import { availableCredits, creditShortfall } from './creditCheck'

type Req = { exchange_status: string; listings: { status: string; book_count: number | null } | null }
const req = (exchange_status: string, status: string, book_count: number | null = 1): Req =>
  ({ exchange_status, listings: { status, book_count } })

describe('availableCredits', () => {
  it('is the full balance when the buyer has no open requests', () => {
    expect(availableCredits(2, [])).toBe(2)
  })

  it('subtracts credits already committed to open requests (buzz: 2 credits, 2 open requests → 0 left)', () => {
    expect(availableCredits(2, [req('requested', 'pending'), req('confirmed', 'pending')])).toBe(0)
  })

  it('counts a bundle request at its full book count', () => {
    expect(availableCredits(10, [req('requested', 'pending', 7)])).toBe(3)
  })

  it('treats a missing book_count as 1 credit', () => {
    expect(availableCredits(3, [req('requested', 'pending', null)])).toBe(2)
  })

  it('ignores exchanges that are finished or were never requests', () => {
    expect(availableCredits(2, [
      req('completed', 'sold'),   // already deducted from the balance
      req('declined', 'active'),
      req('none', 'active'),      // just a message thread
    ])).toBe(2)
  })

  it('ignores a stale "confirmed" exchange whose listing is no longer pending', () => {
    // buzz's Dark Matter: confirmed, but the listing was already marked sold.
    expect(availableCredits(2, [req('confirmed', 'sold')])).toBe(2)
  })

  it('ignores rows whose listing is missing', () => {
    expect(availableCredits(2, [{ exchange_status: 'requested', listings: null }])).toBe(2)
  })
})

describe('creditShortfall', () => {
  it('is null when the buyer can afford it', () => {
    expect(creditShortfall(2, [req('requested', 'pending')], 1)).toBeNull()
  })

  it("says 'balance' when the whole balance is too small, pending requests or not", () => {
    expect(creditShortfall(0, [], 1)).toEqual({ reason: 'balance', balance: 0, held: 0, pendingCount: 0, cost: 1 })
    expect(creditShortfall(1, [req('requested', 'pending')], 7)).toMatchObject({ reason: 'balance' })
  })

  it("says 'pending' when the balance would cover it but open requests hold the credits (buzz)", () => {
    expect(creditShortfall(2, [req('requested', 'pending'), req('confirmed', 'pending')], 1))
      .toEqual({ reason: 'pending', balance: 2, held: 2, pendingCount: 2, cost: 1 })
  })

  it('counts held credits by book count, not by number of requests', () => {
    expect(creditShortfall(8, [req('requested', 'pending', 7)], 2))
      .toEqual({ reason: 'pending', balance: 8, held: 7, pendingCount: 1, cost: 2 })
  })
})
