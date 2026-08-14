import { describe, it, expect } from 'vitest'
import { pickupState, formatDeadline } from './pickupStatus'

describe('pickupState', () => {
  const base = {
    exchangeStatus: 'confirmed',
    sellerPickedUpAt: null as string | null,
    buyerPickedUpAt: null as string | null,
    hasOpenDispute: false,
  }

  it('returns not_yet when the exchange is not in the confirmed status', () => {
    expect(pickupState({ ...base, role: 'seller', exchangeStatus: 'requested' })).toEqual({ kind: 'not_yet' })
  })

  it('returns disputed when there is an open dispute, regardless of timestamps', () => {
    expect(pickupState({ ...base, role: 'seller', hasOpenDispute: true })).toEqual({ kind: 'disputed' })
  })

  it('returns can_confirm when neither party has confirmed yet', () => {
    expect(pickupState({ ...base, role: 'seller' })).toEqual({ kind: 'can_confirm' })
    expect(pickupState({ ...base, role: 'buyer' })).toEqual({ kind: 'can_confirm' })
  })

  it('returns can_confirm for the party who has not confirmed, when the other one has', () => {
    expect(pickupState({ ...base, role: 'buyer', sellerPickedUpAt: '2026-08-01T00:00:00.000Z' })).toEqual({ kind: 'can_confirm' })
  })

  it('returns waiting with a deadline 48 hours after the confirming party own timestamp', () => {
    const result = pickupState({ ...base, role: 'seller', sellerPickedUpAt: '2026-08-01T00:00:00.000Z' })
    expect(result).toEqual({ kind: 'waiting', deadline: '2026-08-03T00:00:00.000Z' })
  })

  it('computes the waiting deadline from the correct role\'s own timestamp', () => {
    const result = pickupState({ ...base, role: 'buyer', buyerPickedUpAt: '2026-08-01T00:00:00.000Z' })
    expect(result).toEqual({ kind: 'waiting', deadline: '2026-08-03T00:00:00.000Z' })
  })
})

describe('formatDeadline', () => {
  it('formats an ISO string as a short human-readable date and time', () => {
    const formatted = formatDeadline('2026-08-03T14:30:00.000Z')
    expect(formatted).toMatch(/Aug/)
    expect(formatted).toMatch(/3/)
  })
})
