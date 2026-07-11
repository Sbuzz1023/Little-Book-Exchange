'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useEffect, useRef } from 'react'

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

function pinIcon(type: 'lfl' | 'library' | 'bookstore' | 'fair' | 'pending') {
  const c = type === 'pending'
    ? { emoji: '📌', bg: '#22c55e', ring: '#15803d' }
    : TYPE_META[type]
  return L.divIcon({
    className: '',
    html: `<div style="
      width:40px;height:40px;border-radius:50%;
      background:${c.bg};border:3px solid white;
      outline:2px solid ${c.ring};
      display:flex;align-items:center;justify-content:center;
      font-size:19px;cursor:pointer;
      box-shadow:0 4px 12px rgba(0,0,0,0.35);
    ">${c.emoji}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 40],
    popupAnchor: [0, -44],
  })
}

function MapFly({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo(center, zoom, { duration: 1.2 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

function BoundsTracker({ onBoundsChange }: { onBoundsChange: (b: Bounds) => void }) {
  const cbRef = useRef(onBoundsChange)
  cbRef.current = onBoundsChange
  useMapEvents({
    moveend(e) {
      const b = e.target.getBounds()
      cbRef.current([[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]])
    },
    zoomend(e) {
      const b = e.target.getBounds()
      cbRef.current([[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]])
    },
  })
  return null
}

function ClickHandler({ addMode, onMapClick }: {
  addMode: boolean
  onMapClick: (lat: number, lng: number) => void
}) {
  useMapEvents({
    click(e) {
      if (addMode) onMapClick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
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

export default function MapView({
  locations, pendingPin, flyTo, addMode,
  onMapClick, onReport, onBoundsChange,
}: Props) {
  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
      style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <BoundsTracker onBoundsChange={onBoundsChange} />
      <ClickHandler addMode={addMode} onMapClick={onMapClick} />
      {flyTo && <MapFly key={flyTo.nonce} center={flyTo.center} zoom={flyTo.zoom} />}

      {locations.map(loc => (
        <Marker key={loc.id} position={[loc.lat, loc.lng]} icon={pinIcon(loc.type)}>
          <Popup minWidth={180}>
            <div style={{ fontFamily: 'Nunito, sans-serif', padding: '2px 0' }}>
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
        </Marker>
      ))}

      {pendingPin && (
        <Marker position={pendingPin} icon={pinIcon('pending')}>
          <Popup>
            <div style={{ fontFamily: 'Nunito, sans-serif', fontSize: 13, fontWeight: 700 }}>
              New location<br />
              <span style={{ color: '#888', fontWeight: 600 }}>Fill in the form to save</span>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  )
}
