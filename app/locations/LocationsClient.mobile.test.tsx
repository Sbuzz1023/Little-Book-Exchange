import * as React from 'react'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LibraryLocation } from './MapView'

// The real map needs mapbox-gl + WebGL; stand in with a stub that records
// the props LocationsClient hands it, so tests can "tap a pin" or "tap bare
// map" by calling those callbacks directly.
let mapProps: any = null
vi.mock('next/dynamic', () => ({
  default: () => (props: any) => { mapProps = props; return null },
}))
vi.mock('@/lib/actions/libraryLocations', () => ({ addLibraryLocation: vi.fn() }))
vi.mock('@/lib/actions/locationReports', () => ({ submitLocationReport: vi.fn() }))

import LocationsClient from './LocationsClient'

const LOCS: LibraryLocation[] = [
  { id: 'a', name: 'Oak St LFL', type: 'lfl', lat: 45, lng: -122, street: 'Oak St', city: 'Portland, OR' },
  { id: 'b', name: 'Central Library', type: 'library', lat: 45.1, lng: -122.1, street: 'Main St', city: 'Portland, OR' },
]

function stubViewport(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }))
}

function sheet() {
  return screen.getByRole('region', { name: 'Locations' })
}

describe('Reading Trail on mobile', () => {
  beforeEach(() => {
    mapProps = null
    stubViewport(true)
  })

  it('lists locations in a bottom sheet with a count', () => {
    render(<LocationsClient initialLocations={LOCS} isLoggedIn={false} />)
    expect(within(sheet()).getByText('2 locations')).toBeInTheDocument()
    expect(within(sheet()).getByText('Oak St LFL')).toBeInTheDocument()
    expect(within(sheet()).getByText('Central Library')).toBeInTheDocument()
  })

  it('tapping a list row shows that location in the sheet, and Back returns to the list', () => {
    render(<LocationsClient initialLocations={LOCS} isLoggedIn={false} />)
    fireEvent.click(within(sheet()).getByText('Oak St LFL'))

    expect(within(sheet()).getByRole('button', { name: /back to list/i })).toBeInTheDocument()
    expect(within(sheet()).queryByText('Central Library')).toBeNull()
    expect(within(sheet()).getByRole('link', { name: /directions/i })).toHaveAttribute(
      'href', 'https://www.google.com/maps/dir/?api=1&destination=45,-122',
    )

    fireEvent.click(within(sheet()).getByRole('button', { name: /back to list/i }))
    expect(within(sheet()).getByText('Central Library')).toBeInTheDocument()
  })

  it('tapping a pin shows its details; tapping bare map goes back to the list', () => {
    render(<LocationsClient initialLocations={LOCS} isLoggedIn={false} />)
    act(() => mapProps.onMarkerSelect(LOCS[1]))
    expect(within(sheet()).getByRole('button', { name: /back to list/i })).toBeInTheDocument()
    expect(within(sheet()).queryByText('Oak St LFL')).toBeNull()

    act(() => mapProps.onBackgroundClick())
    expect(within(sheet()).getByText('Oak St LFL')).toBeInTheDocument()
  })

  it('filter chips toggle location types', () => {
    render(<LocationsClient initialLocations={LOCS} isLoggedIn={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Little Free Library' }))
    expect(within(sheet()).getByText('1 location')).toBeInTheDocument()
    expect(within(sheet()).queryByText('Oak St LFL')).toBeNull()
  })

  it('desktop keeps pin popups (no sheet callbacks passed to the map)', () => {
    stubViewport(false)
    render(<LocationsClient initialLocations={LOCS} isLoggedIn={false} />)
    expect(screen.queryByRole('region', { name: 'Locations' })).toBeNull()
    expect(mapProps.onMarkerSelect).toBeUndefined()
  })
})
