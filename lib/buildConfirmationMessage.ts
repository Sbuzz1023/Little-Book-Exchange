export type ConfirmationParams = {
  username: string
  city: string
  state?: string | null
  address?: string | null
  address_unit?: string | null
  pickup?: string | null
}

// Phone numbers are never included here, on purpose — they must never be
// shared between users, for any reason. Do not add a `phone` field back to
// this function or its params.
export function buildConfirmationMessage(p: ConfirmationParams): string {
  const lines: string[] = []
  lines.push("📍 Exchange confirmed! Here's how to connect:")
  lines.push(`👤 ${p.username}`)
  lines.push(`📌 ${p.city}${p.state ? ', ' + p.state : ''}`)
  if (p.address || p.address_unit) {
    const addr = [p.address, p.address_unit].filter(Boolean).join(' ')
    lines.push(`🏠 ${addr}`)
  }
  if (p.pickup) lines.push(`📦 Pickup: ${p.pickup}`)
  return lines.join('\n')
}
