'use server'

import { createClient } from '@/lib/supabase/server'
import type { LibraryLocation } from '@/app/locations/MapView'

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

export type AddLocationResult =
  | { ok: true; location: LibraryLocation }
  | { ok: false; error: string }

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

export async function addLibraryLocation(data: AddLocationInput): Promise<AddLocationResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in to add a location.' }

  const validationError = validateLocationInput(data)
  if (validationError) return { ok: false, error: validationError }

  const { data: inserted, error } = await supabase
    .from('library_locations')
    .insert({
      created_by: user.id,
      name: data.name.trim(),
      type: data.type,
      lat: data.lat,
      lng: data.lng,
      street: data.street.trim(),
      city: data.city.trim(),
      description: data.description.trim(),
      start_date: data.type === 'fair' ? data.startDate : null,
      end_date: data.type === 'fair' ? data.endDate : null,
    })
    .select('id, name, type, lat, lng, street, city, description, start_date, end_date')
    .single()

  if (error || !inserted) return { ok: false, error: error?.message ?? 'Could not save location.' }

  return {
    ok: true,
    location: {
      id: inserted.id,
      name: inserted.name,
      type: inserted.type,
      lat: inserted.lat,
      lng: inserted.lng,
      street: inserted.street,
      city: inserted.city,
      description: inserted.description || undefined,
      startDate: inserted.start_date || undefined,
      endDate: inserted.end_date || undefined,
    },
  }
}
