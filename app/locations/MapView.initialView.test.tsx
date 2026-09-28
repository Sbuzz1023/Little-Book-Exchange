import * as React from 'react'
import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Stub map that becomes ready right after mount (see MapView.flyTo.test.tsx
// for why the ref is populated inside an effect), with spies for the camera
// calls MapView makes on load.
const fitBoundsSpy = vi.fn()
const VISIBLE = { getSouth: () => 34, getWest: () => -121, getNorth: () => 36, getEast: () => -120 }

vi.mock('react-map-gl/mapbox', () => {
  const Map = React.forwardRef((props: any, ref: any) => {
    React.useEffect(() => {
      const map = { fitBounds: fitBoundsSpy, getBounds: () => VISIBLE, getCanvas: () => null, flyTo: vi.fn() }
      if (ref) ref.current = { getMap: () => map }
      props.onLoad?.({ target: map })
    }, [])
    return React.createElement('div', null, props.children)
  })
  return { default: Map, Map, Marker: () => null, Popup: () => null }
})

import MapView from './MapView'
import type { LibraryLocation } from './MapView'

const LOCS: LibraryLocation[] = [
  { id: 'a', name: 'A', type: 'lfl', lat: 35.1, lng: -120.6, street: '', city: '' },
  { id: 'b', name: 'B', type: 'bookstore', lat: 35.6, lng: -120.7, street: '', city: '' },
  { id: 'c', name: 'C', type: 'library', lat: 35.3, lng: -120.4, street: '', city: '' },
]

function renderMap(overrides: Partial<React.ComponentProps<typeof MapView>> = {}) {
  return render(
    <MapView
      locations={LOCS}
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

describe('MapView initial view', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-token')
    fitBoundsSpy.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('zooms to fit every location on load, clear of the floating controls and sheet', async () => {
    await act(async () => { renderMap({ topInset: 130, bottomInset: 350 }) })
    expect(fitBoundsSpy).toHaveBeenCalledTimes(1)
    const [bounds, opts] = fitBoundsSpy.mock.calls[0]
    // [[west, south], [east, north]] in mapbox's lng/lat order
    expect(bounds).toEqual([[-120.7, 35.1], [-120.4, 35.6]])
    expect(opts).toMatchObject({
      duration: 0,
      padding: { top: 130 + 40, bottom: 350 + 40, left: 40, right: 40 },
    })
    expect(opts.maxZoom).toBeGreaterThan(0)
  })

  it('reports the visible area as soon as the map loads, so the list matches the map', async () => {
    const onBounds = vi.fn()
    await act(async () => { renderMap({ onBoundsChange: onBounds }) })
    expect(onBounds).toHaveBeenCalledWith([[34, -121], [36, -120]])
  })

  it('with no locations, keeps the default view but still reports it', async () => {
    const onBounds = vi.fn()
    await act(async () => { renderMap({ locations: [], onBoundsChange: onBounds }) })
    expect(fitBoundsSpy).not.toHaveBeenCalled()
    expect(onBounds).toHaveBeenCalledTimes(1)
  })
})
