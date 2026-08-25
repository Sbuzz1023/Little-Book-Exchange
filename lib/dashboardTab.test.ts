import { describe, it, expect } from 'vitest'
import { resolveDefaultTab } from './dashboardTab'

describe('resolveDefaultTab', () => {
  it.each(['listings', 'exchanges', 'tbr', 'saved', 'wallet', 'account', 'messages'])(
    'honors an explicit, valid %s tab param',
    tab => {
      expect(resolveDefaultTab(tab, undefined)).toBe(tab)
    }
  )

  it('falls back to listings when there is no tab param and no demo_pending', () => {
    expect(resolveDefaultTab(undefined, undefined)).toBe('listings')
  })

  it('falls back to exchanges when there is no tab param but demo_pending is set', () => {
    expect(resolveDefaultTab(undefined, 'listing-1')).toBe('exchanges')
  })

  it('ignores an unrecognized tab value and falls back to listings', () => {
    expect(resolveDefaultTab('not-a-real-tab', undefined)).toBe('listings')
  })

  it('prefers an explicit valid tab param over demo_pending', () => {
    expect(resolveDefaultTab('saved', 'listing-1')).toBe('saved')
  })
})
