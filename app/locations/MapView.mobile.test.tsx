import * as React from 'react'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Minimal react-map-gl stand-in: Marker renders its pin as a clickable
// element, Popup renders a marker we can look for, and Map exposes its
// onClick through a "bare map" button and becomes ready immediately. See
// MapView.flyTo.test.tsx for why the ref is populated inside an effect.
const flyToSpy = vi.fn()

vi.mock('react-map-gl/mapbox', () => {
  const Map = React.forwardRef((props: any, ref: any) => {
    React.useEffect(() => {
      if (ref) ref.current = { getMap: () => ({ flyTo: flyToSpy, fitBounds: vi.fn(), getCanvas: () => null, getBounds: () => null }) }
      props.onLoad?.()
    }, [])
    return React.createElement('div', null,
      React.createElement('button', {
        'data-testid': 'bare-map',
        onClick: () => props.onClick?.({ originalEvent: { target: null }, lngLat: { lat: 1, lng: 2 } }),
      }),
      props.children,
    )
  })
  return {
    default: Map,
    Map,
    Marker: (props: any) => React.createElement('div', { 'data-testid': 'marker', onClick: props.onClick }, props.children),
    Popup: () => React.createElement('div', { 'data-testid': 'popup' }),
  }
})

import MapView from './MapView'
import type { LibraryLocation } from './MapView'

const LOC: LibraryLocation = {
  id: 'a', name: 'Oak St LFL', type: 'lfl', lat: 45, lng: -122, street: 'Oak St', city: 'Portland, OR',
}

function renderMap(overrides: Partial<React.ComponentProps<typeof MapView>> = {}) {
  return render(
    <MapView
      locations={[LOC]}
      pendingPin={null}
      flyTo={null}
      addMode={false}
      onMapClick={() => {}}
      onReport={() => {}}
      onBoundsChange={() => {}}
      {...overrides}
    />
  )
}

describe('MapView in sheet mode (mobile)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-token')
    flyToSpy.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('tapping a pin reports the location and does not open a popup', () => {
    const onSelect = vi.fn()
    renderMap({ onMarkerSelect: onSelect })
    fireEvent.click(screen.getByTestId('marker'))
    expect(onSelect).toHaveBeenCalledWith(LOC)
    expect(screen.queryByTestId('popup')).toBeNull()
  })

  it('without onMarkerSelect, tapping a pin still opens the popup (desktop)', () => {
    renderMap()
    fireEvent.click(screen.getByTestId('marker'))
    expect(screen.getByTestId('popup')).toBeTruthy()
  })

  it('tapping bare map reports a background click', () => {
    const onBackground = vi.fn()
    renderMap({ onBackgroundClick: onBackground })
    fireEvent.click(screen.getByTestId('bare-map'))
    expect(onBackground).toHaveBeenCalled()
  })

  it('flyTo keeps the target clear of the bottom sheet', async () => {
    await act(async () => {
      renderMap({ flyTo: { center: [45, -122], zoom: 16, nonce: 1 }, bottomInset: 300 })
    })
    expect(flyToSpy).toHaveBeenCalledWith(expect.objectContaining({
      center: [-122, 45],
      padding: { top: 0, bottom: 300, left: 0, right: 0 },
    }))
  })
})
