export type ConfirmationParams = {
  username: string
  city: string
  state?: string | null
  phone?: string | null
  address?: string | null
  address_unit?: string | null
  share_address: boolean
  listing_pickup?: string | null
  profile_pickup?: string | null
  share_pickup: boolean
}

export function buildConfirmationMessage(p: ConfirmationParams): string {
  const lines: string[] = []
  lines.push("📍 Exchange confirmed! Here's how to connect:")
  lines.push(`👤 ${p.username}`)
  lines.push(`📌 ${p.city}${p.state ? ', ' + p.state : ''}`)
  if (p.phone) lines.push(`📞 ${p.phone}`)
  if (p.share_address && (p.address || p.address_unit)) {
    const addr = [p.address, p.address_unit].filter(Boolean).join(' ')
    lines.push(`🏠 ${addr}`)
  }
  if (p.share_pickup) {
    const pickup = p.listing_pickup || p.profile_pickup
    if (pickup) lines.push(`📦 Pickup: ${pickup}`)
  }
  return lines.join('\n')
}
