'use server'

import { createClient } from '@/lib/supabase/server'
import type { LibraryLocation } from '@/app/locations/MapView'

type AddLocationInput = {
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

type AddLocationResult =
  | { ok: true; location: LibraryLocation }
  | { ok: false; error: string }

export async function addLibraryLocation(data: AddLocationInput): Promise<AddLocationResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in to add a location.' }

  const name = data.name.trim()
  const street = data.street.trim()
  const city = data.city.trim()
  if (!name)   return { ok: false, error: 'Library name is required.' }
  if (!street) return { ok: false, error: 'Street is required.' }
  if (!city)   return { ok: false, error: 'City is required.' }

  if (data.type === 'fair') {
    if (!data.startDate) return { ok: false, error: 'Start date is required for a fair.' }
    if (!data.endDate)   return { ok: false, error: 'End date is required for a fair.' }
    if (data.endDate < data.startDate) return { ok: false, error: 'End date must be on or after the start date.' }
  }

  const { data: inserted, error } = await supabase
    .from('library_locations')
    .insert({
      created_by: user.id,
      name,
      type: data.type,
      lat: data.lat,
      lng: data.lng,
      street,
      city,
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
