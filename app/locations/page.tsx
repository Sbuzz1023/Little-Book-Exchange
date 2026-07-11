import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import LocationsClient from './LocationsClient'
import type { LibraryLocation } from './MapView'

export const metadata: Metadata = {
  title: 'Library Locations — LittleBookExchange',
  description: 'Find little free libraries, public libraries, book stores, and library fairs near you, or add a location to the map.',
}

async function getIsLoggedIn(): Promise<boolean> {
  if (cookies().get('lbe_demo_user')?.value) return true
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return !!user
  } catch {
    return false
  }
}

async function getLocations(): Promise<LibraryLocation[]> {
  try {
    const supabase = createClient()
    const today = new Date().toISOString().slice(0, 10)

    await supabase.from('library_locations').delete().eq('type', 'fair').lt('end_date', today)

    const { data } = await supabase
      .from('library_locations')
      .select('id, name, type, lat, lng, street, city, description, start_date, end_date')
      .order('created_at', { ascending: false })

    return (data ?? []).map(row => ({
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
    }))
  } catch {
    return []
  }
}

export default async function LocationsPage() {
  const [locations, isLoggedIn] = await Promise.all([getLocations(), getIsLoggedIn()])
  return <LocationsClient initialLocations={locations} isLoggedIn={isLoggedIn} />
}
