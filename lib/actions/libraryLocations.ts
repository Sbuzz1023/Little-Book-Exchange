'use server'

import { createClient } from '@/lib/supabase/server'
import type { LibraryLocation } from '@/app/locations/MapView'
import { validateLocationInput, type AddLocationInput } from './validateLocationInput'

export type { AddLocationInput }

export type AddLocationResult =
  | { ok: true; location: LibraryLocation }
  | { ok: false; error: string }

type AdminCheck =
  | { ok: true; userId: string }
  | { ok: false; error: string }

export async function requireAdmin(supabase: ReturnType<typeof createClient>): Promise<AdminCheck> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) return { ok: false, error: 'Not authorized.' }
  return { ok: true, userId: user.id }
}

function mapRow(row: {
  id: string
  name: string
  type: 'lfl' | 'library' | 'bookstore' | 'fair'
  lat: number
  lng: number
  street: string
  city: string
  description: string | null
  start_date: string | null
  end_date: string | null
}): LibraryLocation {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    lat: row.lat,
    lng: row.lng,
    street: row.street,
    city: row.city,
    description: row.description || undefined,
    startDate: row.start_date || undefined,
    endDate: row.end_date || undefined,
  }
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

  return { ok: true, location: mapRow(inserted) }
}

export async function editLibraryLocation(id: string, data: AddLocationInput): Promise<AddLocationResult> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const validationError = validateLocationInput(data)
  if (validationError) return { ok: false, error: validationError }

  const { data: updated, error } = await supabase
    .from('library_locations')
    .update({
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
    .eq('id', id)
    .select('id, name, type, lat, lng, street, city, description, start_date, end_date')
    .single()

  if (error || !updated) return { ok: false, error: error?.message ?? 'Could not update location.' }

  return { ok: true, location: mapRow(updated) }
}

export async function deleteLibraryLocation(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { error } = await supabase.from('library_locations').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
