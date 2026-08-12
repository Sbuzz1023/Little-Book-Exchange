'use client'
import 'mapbox-gl/dist/mapbox-gl.css'
import Map, { Marker, Popup } from 'react-map-gl/mapbox'
import type { MapRef } from 'react-map-gl/mapbox'
import { useEffect, useRef, useState } from 'react'

export type LibraryLocation = {
  id: string
  name: string
  type: 'lfl' | 'library' | 'bookstore' | 'fair'
  lat: number
  lng: number
  street: string
  city: string
  description?: string
  startDate?: string
  endDate?: string
}

export type Bounds = [[number, number], [number, number]]

const TYPE_META: Record<'lfl' | 'library' | 'bookstore' | 'fair', {
  emoji: string
  label: string
  bg: string
  ring: string
  badgeBg: string
  badgeColor: string
}> = {
  lfl:       { emoji: '📚', label: 'Little Free Library', bg: '#f97316', ring: '#c2410c', badgeBg: '#fff7ed', badgeColor: '#f97316' },
  library:   { emoji: '🏛️', label: 'Public Library',      bg: '#0d9488', ring: '#0f766e', badgeBg: '#ecfdf5', badgeColor: '#0d9488' },
  bookstore: { emoji: '📖', label: 'Book Store',           bg: '#2563eb', ring: '#1d4ed8', badgeBg: '#eff6ff', badgeColor: '#2563eb' },
  fair:      { emoji: '🎪', label: 'Library Fair',         bg: '#db2777', ring: '#be185d', badgeBg: '#fdf2f8', badgeColor: '#db2777' },
}

function Pin({ type }: { type: 'lfl' | 'library' | 'bookstore' | 'fair' | 'pending' }) {
  const c = type === 'pending'
    ? { emoji: '📌', bg: '#22c55e', ring: '#15803d' }
    : TYPE_META[type]
  return (
    <div style={{
      width: 40, height: 40, borderRadius: '50%',
      background: c.bg, border: '3px solid white',
      outline: `2px solid ${c.ring}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 19, cursor: 'pointer',
      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
    }}>
      {c.emoji}
    </div>
  )
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface Props {
  locations: LibraryLocation[]
  pendingPin: [number, number] | null
  flyTo: { center: [number, number]; zoom: number; nonce: number } | null
  addMode: boolean
  onMapClick: (lat: number, lng: number) => void
  onReport: (loc: LibraryLocation) => void
  onBoundsChange: (b: Bounds) => void
}

// mapbox-gl-js renders every Marker/Popup as its own absolutely-positioned
// DOM element stacked on top of the map canvas, and (per a longstanding
// react-map-gl issue: https://github.com/visgl/react-map-gl/issues/304) a
// click on one of them ALSO bubbles up and fires the underlying <Map>'s
// onClick — stopPropagation() does not stop it. So instead of trying to
// suppress that bubbled event, the map's own onClick below explicitly
// ignores clicks whose real target was a marker/popup (identified by
// mapbox-gl's own stable, documented class names), and only acts on clicks
// that hit bare map canvas.
function clickedMarkerOrPopup(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('.mapboxgl-marker, .mapboxgl-popup')
}

export default function MapView({
  locations, pendingPin, flyTo, addMode,
  onMapClick, onReport, onBoundsChange,
}: Props) {
  const mapRef = useRef<MapRef>(null)
  const [openPopupId, setOpenPopupId] = useState<string | null>(null)
  const [pendingPopupOpen, setPendingPopupOpen] = useState(false)
  // react-map-gl v8 creates the underlying mapbox-gl map instance
  // asynchronously (it dynamically imports mapbox-gl before populating the
  // ref), so mapRef.current?.getMap() can be undefined for a beat after
  // first mount. mapReady flips true once <Map>'s onLoad fires, gating the
  // effects below so a flyTo/cursor update present on first render isn't
  // silently dropped while the map is still initializing.
  const [mapReady, setMapReady] = useState(false)

  const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

  // Incoming flyTo.center is [lat, lng] (this project's convention — see
  // LocationsClient.tsx's applyLocation/selectLocation). mapbox-gl's native
  // flyTo() wants [lng, lat] — deliberately swapped below.
  useEffect(() => {
    if (!flyTo || !mapReady) return
    const map = mapRef.current?.getMap()
    if (!map) return
    map.flyTo({ center: [flyTo.center[1], flyTo.center[0]], zoom: flyTo.zoom, duration: 1200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.nonce, mapReady])

  // mapbox-gl.css sets cursor:grab on the canvas itself, which overrides any
  // inline `cursor` style set on <Map>'s outer container (that style lands
  // on an ancestor, not the canvas). Apply the cursor directly to the
  // canvas instead, once it exists, and only while addMode is true — a
  // clearer affordance than an always-on crosshair, since clicking the map
  // only does something in addMode.
  useEffect(() => {
    const canvas = mapRef.current?.getMap()?.getCanvas()
    if (canvas) canvas.style.cursor = addMode ? 'crosshair' : ''
  }, [addMode, mapReady])

  // A pending pin's popup should start closed every time a *new* pin is
  // dropped, not carry over "open" from a previous drop. Every add-flow
  // path in LocationsClient.tsx sets pendingPin to null before setting a
  // new value, so resetting on `!pendingPin` catches every case.
  useEffect(() => {
    if (!pendingPin) setPendingPopupOpen(false)
  }, [pendingPin])

  // `locations` here is caller-filtered (LocationsClient.tsx passes bounds-
  // and type-filtered results). If the open popup's location gets filtered
  // out — panning away, or changing the type filter — the Popup unmounts
  // but openPopupId itself would otherwise stick around, so panning back or
  // clearing the filter would silently reopen it with no new click.
  useEffect(() => {
    if (openPopupId && !locations.some(l => l.id === openPopupId)) setOpenPopupId(null)
  }, [locations, openPopupId])

  if (!MAPBOX_TOKEN) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#e8f4ea] font-bold text-[#888] text-center px-6">
        Map couldn&apos;t load — please refresh the page.
      </div>
    )
  }

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={MAPBOX_TOKEN}
      initialViewState={{ longitude: -98.35, latitude: 39.5, zoom: 4 }}
      mapStyle="mapbox://styles/mapbox/streets-v12"
      style={{ width: '100%', height: '100%' }}
      onLoad={() => setMapReady(true)}
      onClick={e => {
        if (clickedMarkerOrPopup(e.originalEvent.target)) return
        if (addMode) {
          onMapClick(e.lngLat.lat, e.lngLat.lng)
        } else {
          setOpenPopupId(null)
          setPendingPopupOpen(false)
        }
      }}
      onMoveEnd={e => {
        const b = e.target.getBounds()
        if (!b) return
        onBoundsChange([[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]])
      }}
    >
      {locations.map(loc => (
        <Marker
          key={loc.id}
          longitude={loc.lng}
          latitude={loc.lat}
          anchor="bottom"
          onClick={() => setOpenPopupId(loc.id)}
        >
          <Pin type={loc.type} />
        </Marker>
      ))}

      {locations.filter(loc => loc.id === openPopupId).map(loc => (
        <Popup
          key={loc.id}
          longitude={loc.lng}
          latitude={loc.lat}
          anchor="bottom"
          offset={44}
          closeButton
          closeOnClick={false}
          onClose={() => setOpenPopupId(null)}
        >
          <div style={{ fontFamily: 'Nunito, sans-serif', padding: '2px 0', minWidth: 180 }}>
            <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 3 }}>{loc.name}</div>
            <span style={{
              display: 'inline-block',
              background: TYPE_META[loc.type].badgeBg,
              color: TYPE_META[loc.type].badgeColor,
              borderRadius: 8, padding: '2px 8px', fontSize: 12, fontWeight: 800, marginBottom: 8,
            }}>
              {TYPE_META[loc.type].emoji} {TYPE_META[loc.type].label}
            </span>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 2 }}>{loc.street}</div>
            <div style={{
              fontSize: 13, color: '#555',
              marginBottom: (loc.description || (loc.type === 'fair' && loc.startDate && loc.endDate)) ? 6 : 10,
            }}>{loc.city}</div>
            {loc.type === 'fair' && loc.startDate && loc.endDate && (
              <div style={{ fontSize: 13, color: '#db2777', fontWeight: 700, marginBottom: loc.description ? 6 : 10 }}>
                🗓️ {formatDate(loc.startDate)} – {formatDate(loc.endDate)}
              </div>
            )}
            {loc.description && (
              <div style={{ fontSize: 13, color: '#888', fontStyle: 'italic', marginBottom: 10 }}>{loc.description}</div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  flex: 1, background: '#f97316', color: '#fff', borderRadius: 8,
                  padding: '5px 0', fontSize: 12, fontWeight: 800, textDecoration: 'none',
                  textAlign: 'center', display: 'block',
                }}
              >
                Directions
              </a>
              <button
                onClick={() => onReport(loc)}
                style={{
                  background: '#f8f9fa', color: '#888', border: '1.5px solid #e5e7eb',
                  borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                📩 Report
              </button>
            </div>
          </div>
        </Popup>
      ))}

      {pendingPin && (
        <Marker
          longitude={pendingPin[1]}
          latitude={pendingPin[0]}
          anchor="bottom"
          onClick={() => setPendingPopupOpen(true)}
        >
          <Pin type="pending" />
        </Marker>
      )}

      {pendingPin && pendingPopupOpen && (
        <Popup
          longitude={pendingPin[1]}
          latitude={pendingPin[0]}
          anchor="bottom"
          offset={44}
          closeButton
          closeOnClick={false}
          onClose={() => setPendingPopupOpen(false)}
        >
          <div style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700 }}>
            New location<br />
            <span style={{ color: '#888', fontWeight: 600 }}>Fill in the form to save</span>
          </div>
        </Popup>
      )}
    </Map>
  )
}
