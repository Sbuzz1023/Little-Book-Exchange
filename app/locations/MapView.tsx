'use client'
import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { useEffect } from 'react'

export type LibraryLocation = {
  id: string
  name: string
  type: 'lfl' | 'library'
  lat: number
  lng: number
  street: string
  city: string
  description?: string
  isUserAdded?: boolean
}

function pinIcon(type: 'lfl' | 'library' | 'pending') {
  const c = {
    lfl:     { emoji: '📚', bg: '#f97316', ring: '#c2410c' },
    library: { emoji: '🏛️', bg: '#0d9488', ring: '#0f766e' },
    pending: { emoji: '📌', bg: '#22c55e', ring: '#15803d' },
  }[type]
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

function ClickHandler({ active, onMapClick }: { active: boolean; onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) { if (active) onMapClick(e.latlng.lat, e.latlng.lng) },
  })
  return null
}

interface Props {
  locations: LibraryLocation[]
  pendingPin: [number, number] | null
  flyTo: { center: [number, number]; zoom: number; nonce: number } | null
  addMode: boolean
  onMapClick: (lat: number, lng: number) => void
  onReport: (loc: LibraryLocation) => void
}

export default function MapView({ locations, pendingPin, flyTo, addMode, onMapClick, onReport }: Props) {
  return (
    <MapContainer
      center={[39.5, -98.35]}
      zoom={4}
      style={{ width: '100%', height: '100%', cursor: addMode ? 'crosshair' : undefined }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler active={addMode} onMapClick={onMapClick} />
      {flyTo && <MapFly key={flyTo.nonce} center={flyTo.center} zoom={flyTo.zoom} />}

      {locations.map(loc => (
        <Marker key={loc.id} position={[loc.lat, loc.lng]} icon={pinIcon(loc.type)}>
          <Popup minWidth={180}>
            <div style={{ fontFamily: 'Nunito, sans-serif', padding: '2px 0' }}>
              <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 3 }}>{loc.name}</div>
              <span style={{
                display: 'inline-block',
                background: loc.type === 'lfl' ? '#fff7ed' : '#ecfdf5',
                color: loc.type === 'lfl' ? '#f97316' : '#0d9488',
                borderRadius: 8, padding: '2px 8px', fontSize: 12, fontWeight: 800, marginBottom: 8,
              }}>
                {loc.type === 'lfl' ? '📚 Little Free Library' : '🏛️ City Library'}
              </span>
              <div style={{ fontSize: 13, color: '#555', marginBottom: 2 }}>{loc.street}</div>
              <div style={{ fontSize: 13, color: '#555', marginBottom: loc.description ? 6 : 10 }}>{loc.city}</div>
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
