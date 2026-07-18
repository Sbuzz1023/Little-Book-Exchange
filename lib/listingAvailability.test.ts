import { describe, it, expect } from 'vitest'
import { getListingAvailability } from './listingAvailability'

describe('getListingAvailability', () => {
  it('is active for an active listing regardless of viewer', () => {
    expect(getListingAvailability('active', { isOwner: false, isRequester: false })).toBe('active')
  })

  it('is pending-mine for the owner of a pending listing', () => {
    expect(getListingAvailability('pending', { isOwner: true, isRequester: false })).toBe('pending-mine')
  })

  it('is pending-mine for the buyer who requested a pending listing', () => {
    expect(getListingAvailability('pending', { isOwner: false, isRequester: true })).toBe('pending-mine')
  })

  it('is pending-locked for any other viewer of a pending listing', () => {
    expect(getListingAvailability('pending', { isOwner: false, isRequester: false })).toBe('pending-locked')
  })

  it('is unavailable for a sold listing', () => {
    expect(getListingAvailability('sold', { isOwner: false, isRequester: false })).toBe('unavailable')
  })

  it('is unavailable for a given-away listing', () => {
    expect(getListingAvailability('given', { isOwner: false, isRequester: false })).toBe('unavailable')
  })
})
