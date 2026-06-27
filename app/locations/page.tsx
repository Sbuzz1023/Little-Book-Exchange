import type { Metadata } from 'next'
import LocationsClient from './LocationsClient'

export const metadata: Metadata = {
  title: 'Library Locations — LittleBookExchange',
  description: 'Find little free libraries and city libraries near you, or add a location to the map.',
}

export default function LocationsPage() {
  return <LocationsClient />
}
