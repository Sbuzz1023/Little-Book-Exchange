export type AddLocationInput = {
  name: string
  type: 'lfl' | 'library' | 'bookstore' | 'fair'
  lat: number
  lng: number
  street: string
  city: string
  description: string
  startDate?: string
  endDate?: string
}

export function validateLocationInput(data: AddLocationInput): string | null {
  if (!data.name.trim())   return 'Library name is required.'
  if (!data.street.trim()) return 'Street is required.'
  if (!data.city.trim())   return 'City is required.'

  if (data.type === 'fair') {
    if (!data.startDate) return 'Start date is required for a fair.'
    if (!data.endDate)   return 'End date is required for a fair.'
    if (data.endDate < data.startDate) return 'End date must be on or after the start date.'
  }

  return null
}
