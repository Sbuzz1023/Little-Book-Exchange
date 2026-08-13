import { describe, it, expect } from 'vitest'
import { filterRecipients, type BroadcastTarget } from './broadcastRecipients'

const PROFILES = [
  { id: '1', email: 'a@example.com', city: 'Chicago', state: 'IL', marketing_opt_out: false },
  { id: '2', email: 'b@example.com', city: 'Chicago', state: 'IL', marketing_opt_out: true },
  { id: '3', email: 'c@example.com', city: 'Austin', state: 'TX', marketing_opt_out: false },
  { id: '4', email: null, city: 'Austin', state: 'TX', marketing_opt_out: false },
]

describe('filterRecipients', () => {
  it('"all" returns every opted-in user with an email, excluding opt-outs', () => {
    const target: BroadcastTarget = { kind: 'all' }
    expect(filterRecipients(PROFILES, target)).toEqual([
      { id: '1', email: 'a@example.com' },
      { id: '3', email: 'c@example.com' },
    ])
  })

  it('"user" returns only that user, even if they are opted out', () => {
    const target: BroadcastTarget = { kind: 'user', userId: '2' }
    expect(filterRecipients(PROFILES, target)).toEqual([{ id: '2', email: 'b@example.com' }])
  })

  it('"user" returns nothing if the id does not match any profile', () => {
    const target: BroadcastTarget = { kind: 'user', userId: 'nope' }
    expect(filterRecipients(PROFILES, target)).toEqual([])
  })

  it('"filtered" by city narrows to that city, still excluding opt-outs', () => {
    const target: BroadcastTarget = { kind: 'filtered', city: 'Chicago' }
    expect(filterRecipients(PROFILES, target)).toEqual([{ id: '1', email: 'a@example.com' }])
  })

  it('"filtered" by city and state applies both', () => {
    const target: BroadcastTarget = { kind: 'filtered', city: 'Austin', state: 'TX' }
    expect(filterRecipients(PROFILES, target)).toEqual([{ id: '3', email: 'c@example.com' }])
  })

  it('excludes profiles with no email regardless of target', () => {
    const target: BroadcastTarget = { kind: 'filtered', city: 'Austin' }
    expect(filterRecipients(PROFILES, target).find(r => r.id === '4')).toBeUndefined()
  })
})
