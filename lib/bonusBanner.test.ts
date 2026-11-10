import { describe, it, expect } from 'vitest'
import { showBonusBanner } from './bonusBanner'

const now = new Date('2026-11-09T12:00:00.000Z')
const ago = (days: number) => new Date(now.getTime() - days * 86400000).toISOString()
const bonus = (days: number) => [{ reason: 'onboarding_bonus', created_at: ago(days) }]

describe('showBonusBanner', () => {
  it('shows 2 days after the award', () => expect(showBonusBanner(bonus(2), now)).toBe(true))
  it('hides 8 days after the award', () => expect(showBonusBanner(bonus(8), now)).toBe(false))
  it('hides at exactly 7 days', () => expect(showBonusBanner(bonus(7), now)).toBe(false))
  it('hides with no bonus row', () => {
    expect(showBonusBanner([{ reason: 'sale_earned', created_at: ago(1) }], now)).toBe(false)
    expect(showBonusBanner([], now)).toBe(false)
  })
})
