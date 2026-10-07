import { describe, it, expect } from 'vitest'
import { planCreditShow, toUnseenCredits, demoUnseenCredits, type UnseenCredit } from './creditShow'

let n = 0
function row(reason: UnseenCredit['reason'], amount: number, title: string | null = 'Dune', created_at = `2026-10-06T10:00:0${n}Z`): UnseenCredit {
  n++
  return { id: `r${n}`, amount, reason, created_at, title }
}

describe('planCreditShow', () => {
  it('returns null when there is nothing to show', () => {
    expect(planCreditShow([], 3)).toBeNull()
  })

  it('a single sale: one earn burst, one coin, caption with the title', () => {
    const plan = planCreditShow([row('sale_earned', 1)], 4)!
    expect(plan.startBalance).toBe(3)
    expect(plan.finalBalance).toBe(4)
    expect(plan.bursts).toEqual([{
      kind: 'earn',
      coins: [{ value: 1, label: null }],
      caption: '+1 credit · Dune was picked up',
      srText: 'You earned 1 credit for Dune.',
    }])
  })

  it('a bundle sale: one coin per credit, plural caption with the title', () => {
    const plan = planCreditShow([row('sale_earned', 3, 'Little Women bundle')], 6)!
    expect(plan.bursts[0].coins).toHaveLength(3)
    expect(plan.bursts[0].caption).toBe('+3 credits · Little Women bundle was picked up')
    expect(plan.startBalance).toBe(3)
  })

  it('welcome bonus only', () => {
    const plan = planCreditShow([row('onboarding_bonus', 1, null)], 1)!
    expect(plan.bursts[0].caption).toBe('+1 credit · Welcome bonus')
    expect(plan.bursts[0].srText).toBe('You earned 1 credit: welcome bonus.')
  })

  it('several sales plus the bonus share one earn burst', () => {
    const plan = planCreditShow([row('sale_earned', 1), row('onboarding_bonus', 1, null), row('sale_earned', 1, 'Emma')], 5)!
    expect(plan.bursts).toHaveLength(1)
    expect(plan.bursts[0].caption).toBe('+3 credits · 2 books picked up + welcome bonus')
    expect(plan.bursts[0].srText).toBe('You earned 3 credits.')
  })

  it('a single purchase: spend burst with a minus sign and the title', () => {
    const plan = planCreditShow([row('purchase_spent', -1, 'Matilda')], 2)!
    expect(plan.startBalance).toBe(3)
    expect(plan.bursts).toEqual([{
      kind: 'spend',
      coins: [{ value: -1, label: null }],
      caption: '−1 credit · you got Matilda',
      srText: 'You spent 1 credit on Matilda.',
    }])
  })

  it('several purchases', () => {
    const plan = planCreditShow([row('purchase_spent', -1), row('purchase_spent', -2)], 0)!
    expect(plan.bursts[0].caption).toBe('−3 credits · you got 3 books')
    expect(plan.bursts[0].srText).toBe('You spent 3 credits.')
  })

  it('mixed: earn burst first, then spend, balances walk to the final value', () => {
    const plan = planCreditShow([row('purchase_spent', -1, 'Matilda'), row('sale_earned', 1, 'Dune'), row('sale_earned', 1, 'Emma')], 5)!
    expect(plan.bursts.map(b => b.kind)).toEqual(['earn', 'spend'])
    expect(plan.bursts[0].caption).toBe('+2 credits · 2 books picked up')
    expect(plan.bursts[1].caption).toBe('−1 credit · you got Matilda')
    expect(plan.startBalance).toBe(4)
    const end = plan.bursts.flatMap(b => b.coins).reduce((bal, c) => bal + c.value, plan.startBalance)
    expect(end).toBe(5)
  })

  it('caps a burst at 5 coins, the last carrying the remainder', () => {
    const plan = planCreditShow([row('sale_earned', 8)], 8)!
    expect(plan.bursts[0].coins).toEqual([
      { value: 1, label: null }, { value: 1, label: null }, { value: 1, label: null }, { value: 1, label: null },
      { value: 4, label: '+4' },
    ])
    const spend = planCreditShow([row('purchase_spent', -6)], 0)!
    expect(spend.bursts[0].coins.at(-1)).toEqual({ value: -2, label: '−2' })
    expect(spend.bursts[0].coins).toHaveLength(5)
  })

  it('exactly 5 credits is 5 plain coins', () => {
    const plan = planCreditShow([row('sale_earned', 5)], 5)!
    expect(plan.bursts[0].coins.every(c => c.label === null && c.value === 1)).toBe(true)
    expect(plan.bursts[0].coins).toHaveLength(5)
  })

  it('uses "a book" when the listing was deleted', () => {
    const plan = planCreditShow([row('sale_earned', 1, null)], 1)!
    expect(plan.bursts[0].caption).toBe('+1 credit · a book was picked up')
  })

  it('ignores reasons it does not animate (admin adjustments)', () => {
    const rows = [{ ...row('sale_earned', 1), reason: 'admin_adjustment' }] as unknown as UnseenCredit[]
    expect(planCreditShow(rows, 3)).toBeNull()
  })

  it('seenUpTo is the newest created_at, whatever the input order', () => {
    const plan = planCreditShow([
      row('sale_earned', 1, 'A', '2026-10-06T10:00:05.123456+00:00'),
      row('sale_earned', 1, 'B', '2026-10-06T09:00:00+00:00'),
    ], 2)!
    expect(plan.seenUpTo).toBe('2026-10-06T10:00:05.123456+00:00')
  })
})

describe('toUnseenCredits', () => {
  it('flattens listings(title) whether it arrives as an object, an array or null', () => {
    const out = toUnseenCredits([
      { id: 'a', amount: 1, reason: 'sale_earned', created_at: 't1', listings: { title: 'Dune' } },
      { id: 'b', amount: -1, reason: 'purchase_spent', created_at: 't2', listings: [{ title: 'Emma' }] },
      { id: 'c', amount: 1, reason: 'onboarding_bonus', created_at: 't3', listings: null },
    ])
    expect(out.map(r => r.title)).toEqual(['Dune', 'Emma', null])
    expect(out[1]).toEqual({ id: 'b', amount: -1, reason: 'purchase_spent', created_at: 't2', title: 'Emma' })
  })

  it('drops rows with reasons it does not animate or malformed amounts', () => {
    const out = toUnseenCredits([
      { id: 'a', amount: 1, reason: 'admin_adjustment', created_at: 't1', listings: null },
      { id: 'b', amount: 'x', reason: 'sale_earned', created_at: 't2', listings: null },
    ])
    expect(out).toEqual([])
  })
})

describe('demoUnseenCredits', () => {
  it('builds preview rows per mode and nothing for unknown modes', () => {
    expect(demoUnseenCredits('earn').map(r => r.reason)).toEqual(['sale_earned'])
    expect(demoUnseenCredits('spend').map(r => r.reason)).toEqual(['purchase_spent'])
    expect(demoUnseenCredits('both').map(r => r.reason).sort()).toEqual(['purchase_spent', 'sale_earned', 'sale_earned'])
    expect(demoUnseenCredits('bundle')).toEqual([expect.objectContaining({ reason: 'sale_earned', amount: 3 })])
    expect(demoUnseenCredits('nope')).toEqual([])
    expect(demoUnseenCredits(null)).toEqual([])
  })

  it('stamps rows from the given time, so each demo pickup is a new show', () => {
    const a = demoUnseenCredits('spend', 1_700_000_000_000)
    const b = demoUnseenCredits('spend', 1_700_000_005_000)
    expect(a[0].created_at).not.toBe(b[0].created_at)
    expect(demoUnseenCredits('spend')[0].created_at).toBe(demoUnseenCredits('spend')[0].created_at)
  })

  it("uses the picked-up book's title when one is given", () => {
    expect(demoUnseenCredits('spend', undefined, 'Atomic Habits')[0].title).toBe('Atomic Habits')
    expect(demoUnseenCredits('earn', undefined, 'Atomic Habits')[0].title).toBe('Atomic Habits')
    expect(demoUnseenCredits('spend')[0].title).toBe('Matilda')
  })
})
