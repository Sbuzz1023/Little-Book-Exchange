export function buildDirectionsUrl(params: {
  address: string
  addressUnit: string
  city: string
  state: string
}): string | null {
  const address = params.address.trim()
  if (!address) return null

  const parts = [
    [address, params.addressUnit.trim()].filter(Boolean).join(' '),
    [params.city.trim(), params.state.trim()].filter(Boolean).join(', '),
  ].filter(Boolean)

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(parts.join(', '))}`
}
