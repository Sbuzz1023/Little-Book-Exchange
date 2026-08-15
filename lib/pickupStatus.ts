export type PickupRole = 'buyer' | 'seller'

export type PickupState =
  | { kind: 'not_yet' }
  | { kind: 'can_confirm' }
  | { kind: 'waiting'; deadline: string }
  | { kind: 'disputed' }

export function pickupState(params: {
  role: PickupRole
  exchangeStatus: string
  sellerPickedUpAt: string | null
  buyerPickedUpAt: string | null
  hasOpenDispute: boolean
}): PickupState {
  if (params.exchangeStatus !== 'confirmed') return { kind: 'not_yet' }
  if (params.hasOpenDispute) return { kind: 'disputed' }

  const ownTimestamp = params.role === 'seller' ? params.sellerPickedUpAt : params.buyerPickedUpAt
  if (ownTimestamp) {
    const deadline = new Date(new Date(ownTimestamp).getTime() + 48 * 60 * 60 * 1000).toISOString()
    return { kind: 'waiting', deadline }
  }
  return { kind: 'can_confirm' }
}

export function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
