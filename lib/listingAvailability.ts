import type { ListingStatus } from './types'

export type ListingAvailability = 'active' | 'pending-mine' | 'pending-locked' | 'unavailable'

export function getListingAvailability(
  status: ListingStatus,
  viewer: { isOwner: boolean; isRequester: boolean }
): ListingAvailability {
  if (status === 'active') return 'active'
  if (status === 'pending') return viewer.isOwner || viewer.isRequester ? 'pending-mine' : 'pending-locked'
  return 'unavailable'
}
