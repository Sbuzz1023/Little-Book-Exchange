import * as React from 'react'
import { render, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// react-map-gl v8's real <Map> component (@vis.gl/react-mapbox's map.js)
// creates the underlying mapbox-gl map instance asynchronously:
//   Promise.resolve(mapLib || import('mapbox-gl')).then(module => { ... })
// inside a useEffect, and only populates the forwarded ref (and fires
// onLoad) once that promise resolves. On first mount, mapRef.current is
// therefore `null` for at least one microtask/effect-flush.
//
// This stub reproduces exactly that timing, under our own control: the ref
// stays unpopulated until the test calls `resolveMapReady()`, mirroring the
// real async import resolving. It is intentionally NOT a mock of mapbox-gl
// internals (transform/painter/style) — those are real-mapbox-gl-only
// concerns unrelated to the bug under test, which is purely about
// react-map-gl's ref-population timing vs. MapView's effect dependencies.
let resolveMapReady: () => void = () => {}
const flyToSpy = vi.fn()
const fakeCanvas = document.createElement('canvas')

vi.mock('react-map-gl/mapbox', () => {
  const Map = React.forwardRef((props: any, ref: any) => {
    React.useEffect(() => {
      let cancelled = false
      const ready = new Promise<void>(resolve => { resolveMapReady = resolve })
      ready.then(() => {
        if (cancelled) return
        const fakeMap = {
          flyTo: flyToSpy,
          getCanvas: () => fakeCanvas,
          getBounds: () => ({
            getSouth: () => 0, getWest: () => 0, getNorth: () => 0, getEast: () => 0,
          }),
        }
        if (ref) ref.current = { getMap: () => fakeMap }
        props.onLoad?.()
      })
      return () => { cancelled = true }
    }, [])
    return React.createElement('div', null, props.children)
  })
  return {
    default: Map,
    Map,
    Marker: () => null,
    Popup: () => null,
  }
})

// mapbox-gl's own CSS import — irrelevant to this test's logic, and vitest
// (via vite's default css handling) stubs CSS imports to a no-op module
// automatically, so no explicit mock is needed here.

import MapView from './MapView'

describe('MapView flyTo effect — react-map-gl async-ready gating', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_MAPBOX_TOKEN', 'test-token')
    flyToSpy.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does NOT call flyTo before the map is ready, and DOES call it exactly once the map becomes ready — even when flyTo is present on the very first render', async () => {
    render(
      <MapView
        locations={[]}
        pendingPin={null}
        flyTo={{ center: [41.8781, -87.6298], zoom: 12, nonce: 1 }}
        addMode={false}
        onMapClick={() => {}}
        onReport={() => {}}
        onBoundsChange={() => {}}
      />
    )

    // Matches real react-map-gl timing: right after mount, the underlying
    // map isn't ready yet, so flyTo must not have fired.
    expect(flyToSpy).not.toHaveBeenCalled()

    // Let the stubbed "async map instantiation" resolve — mirrors mapbox-gl
    // finishing its dynamic import and the Map constructor running.
    await act(async () => {
      resolveMapReady()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(flyToSpy).toHaveBeenCalledTimes(1)
    // MapView deliberately swaps [lat, lng] -> [lng, lat] for mapbox-gl's
    // native flyTo() call.
    expect(flyToSpy).toHaveBeenCalledWith({
      center: [-87.6298, 41.8781],
      zoom: 12,
      duration: 1200,
    })
  })
})
