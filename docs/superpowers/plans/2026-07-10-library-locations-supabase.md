# Library Locations: Shared Supabase Storage, Type Filter, Fairs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Libraries page's hardcoded mock locations and per-browser `localStorage` "Add a Location" with a real shared `library_locations` Supabase table; remove the mile-radius distance filter; add a type filter (LFL / Public Library / Book Store / Fair); and give Library Fair entries a required date range that causes them to expire (and get deleted) the day after they end.

**Architecture:** A new `library_locations` table backs all four location types. `app/locations/page.tsx` becomes an async server component: it deletes expired fairs, fetches the remaining locations, determines login state, and hands both to `LocationsClient` as props. `LocationsClient` (unchanged in spirit, heavily edited in detail) keeps its existing map/list/search UX but drops the distance-radius filter and localStorage, adds a type filter, and calls a new `addLibraryLocation` server action directly (same "invoke a `'use server'` function from a client `onClick`" pattern already used by `saveListing`/`unsaveListing`) instead of writing to `localStorage`. `MapView.tsx` widens its `LibraryLocation` type and pin styling to cover the two new types and drops the radius-circle rendering that went with the removed distance filter.

**Tech Stack:** Next.js 14 App Router, React 18, Supabase (`@supabase/ssr`), Leaflet/`react-leaflet` (already a dependency, unchanged).

## Global Constraints

- `library_locations` schema, exactly as specified in Task 1 — do not alter column names, the `type` check constraint values, or the `fair_requires_dates` check constraint.
- Adding a location requires a real signed-in Supabase account — enforced both client-side (`isLoggedIn` gate, redirect to `/auth/signin?redirect=/locations`) and server-side in `addLibraryLocation` (defense in depth, same pattern as `saveListing`).
- Fair expiry is opportunistic, not a real cron job: every page load deletes `fair` rows with `end_date < today` before fetching. The RLS delete policy only ever permits deleting rows matching that exact condition.
- The distance-radius filter (mile pills, radius circle on the map, "click map to set radius center") is removed entirely. City/address search, "My Location", map-viewport-based list filtering, and the "X mi away" sort/label stay.
- The "Report a location" flow is unchanged — still a locally-faked success message, no persistence. Do not touch `reportTarget`/`reportReason`/`sendReport`.
- At the end, the exact SQL from Task 1 must be handed to the user to run in the Supabase SQL editor.

---

## File Structure

- Modify `supabase/schema.sql` — add the `library_locations` table + RLS migration block.
- Create `lib/actions/libraryLocations.ts` — `addLibraryLocation`.
- Modify `app/locations/MapView.tsx` — widen `LibraryLocation`, add Book Store/Fair pin styling and popup labels, drop the radius-circle rendering and its props.
- Modify `app/locations/LocationsClient.tsx` — drop mock data/localStorage/distance filter, add type filter, extend the Add Location form for fairs, call `addLibraryLocation`.
- Modify `app/locations/page.tsx` — becomes an async server component: expire fairs, fetch locations + `isLoggedIn`, pass to `LocationsClient`.

---

### Task 1: `library_locations` schema migration

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the `library_locations` table shape that Tasks 2 and 5 query against. NOT run automatically — handed to the user at the end to paste into the Supabase SQL editor.

- [ ] **Step 1: Append the migration block**

At the end of `supabase/schema.sql` (after the existing "Migration: TBR (to be read) list" block), add:

```sql

-- ── Migration: library locations ──────────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
create table if not exists library_locations (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references profiles(id) on delete cascade not null,
  name text not null,
  type text not null check (type in ('lfl', 'library', 'bookstore', 'fair')),
  lat double precision not null,
  lng double precision not null,
  street text not null default '',
  city text not null default '',
  description text not null default '',
  start_date date,
  end_date date,
  created_at timestamptz default now(),
  constraint fair_requires_dates check (
    type <> 'fair' or (start_date is not null and end_date is not null and end_date >= start_date)
  )
);

alter table library_locations enable row level security;

create policy "Locations are viewable by everyone" on library_locations
  for select using (true);

create policy "Authenticated users can add locations" on library_locations
  for insert to authenticated with check (auth.uid() = created_by);

create policy "Anyone can clean up expired fairs" on library_locations
  for delete using (type = 'fair' and end_date < current_date);
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add library_locations table migration"
```

---

### Task 2: `addLibraryLocation` server action

**Files:**
- Create: `lib/actions/libraryLocations.ts`

**Interfaces:**
- Consumes: `library_locations` table shape from Task 1; imports the `LibraryLocation` type from `@/app/locations/MapView` (defined/widened in Task 3 — this task can be written and will type-check once Task 3 lands; order doesn't block writing the file).
- Produces: `addLibraryLocation(data: { name, type, lat, lng, street, city, description, startDate?, endDate? }): Promise<{ ok: true; location: LibraryLocation } | { ok: false; error: string }>`. Task 4's `saveLocation` calls this directly.

- [ ] **Step 1: Write the file**

Create `lib/actions/libraryLocations.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import type { LibraryLocation } from '@/app/locations/MapView'

type AddLocationInput = {
  name: string
  type: 'lfl' | 'library' | 'bookstore' | 'fair'
  lat: number
  lng: number
  street: string
  city: string
  description: string
  startDate?: string
  endDate?: string
}

type AddLocationResult =
  | { ok: true; location: LibraryLocation }
  | { ok: false; error: string }

export async function addLibraryLocation(data: AddLocationInput): Promise<AddLocationResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in to add a location.' }

  const name = data.name.trim()
  const street = data.street.trim()
  const city = data.city.trim()
  if (!name)   return { ok: false, error: 'Library name is required.' }
  if (!street) return { ok: false, error: 'Street is required.' }
  if (!city)   return { ok: false, error: 'City is required.' }

  if (data.type === 'fair') {
    if (!data.startDate) return { ok: false, error: 'Start date is required for a fair.' }
    if (!data.endDate)   return { ok: false, error: 'End date is required for a fair.' }
    if (data.endDate < data.startDate) return { ok: false, error: 'End date must be on or after the start date.' }
  }

  const { data: inserted, error } = await supabase
    .from('library_locations')
    .insert({
      created_by: user.id,
      name,
      type: data.type,
      lat: data.lat,
      lng: data.lng,
      street,
      city,
      description: data.description.trim(),
      start_date: data.type === 'fair' ? data.startDate : null,
      end_date: data.type === 'fair' ? data.endDate : null,
    })
    .select('id, name, type, lat, lng, street, city, description, start_date, end_date')
    .single()

  if (error || !inserted) return { ok: false, error: error?.message ?? 'Could not save location.' }

  return {
    ok: true,
    location: {
      id: inserted.id,
      name: inserted.name,
      type: inserted.type,
      lat: inserted.lat,
      lng: inserted.lng,
      street: inserted.street,
      city: inserted.city,
      description: inserted.description || undefined,
      startDate: inserted.start_date || undefined,
      endDate: inserted.end_date || undefined,
    },
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/actions/libraryLocations.ts
git commit -m "feat: add addLibraryLocation server action"
```

(Type-checking this file in isolation will show an error until Task 3 widens `LibraryLocation` in `MapView.tsx` — expected, resolved by the next task. Don't run `tsc` as a gate for this task alone.)

---

### Task 3: Widen `MapView.tsx` for the new types, drop the radius filter

**Files:**
- Modify: `app/locations/MapView.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `LibraryLocation` type (`id, name, type: 'lfl'|'library'|'bookstore'|'fair', lat, lng, street, city, description?, startDate?, endDate?`) and `MapView`'s narrowed `Props` (drops `radiusCenter`, `radiusMiles`, `onSetCenter`). Tasks 2, 4, and 5 all depend on this exact `LibraryLocation` shape.

- [ ] **Step 1: Replace the whole file**

Replace `app/locations/MapView.tsx` with:

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add app/locations/MapView.tsx
git commit -m "feat: widen MapView for book store/fair types, drop radius filter"
```

(`app/locations/LocationsClient.tsx` will fail to compile until Task 4 updates it to match this file's new `Props` — expected, don't gate this task on a full `tsc` pass yet.)

---

### Task 4: Rework `LocationsClient.tsx`

**Files:**
- Modify: `app/locations/LocationsClient.tsx`

**Interfaces:**
- Consumes: `LibraryLocation`/`Bounds` types and `MapView`'s new `Props` from Task 3; `addLibraryLocation` from Task 2.
- Produces: `LocationsClient({ initialLocations: LibraryLocation[], isLoggedIn: boolean })` — both props are new and required. Task 5 must pass them.

- [ ] **Step 1: Replace the whole file**

Replace `app/locations/LocationsClient.tsx` with:

```tsx
'use client'
import { useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { LibraryLocation, Bounds } from './MapView'
import { addLibraryLocation } from '@/lib/actions/libraryLocations'

const MapView = dynamic(() => import('./MapView'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#e8f4ea] font-bold text-[#888]">
      Loading map…
    </div>
  ),
})

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8
  const φ1 = (lat1 * Math.PI) / 180, φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180, Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function geocode(query: string): Promise<[number, number] | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
      { headers: { 'Accept-Language': 'en' } }
    )
    const data = await res.json()
    if (data?.[0]) return [parseFloat(data[0].lat), parseFloat(data[0].lon)]
  } catch {}
  return null
}

function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

type LocType = 'lfl' | 'library' | 'bookstore' | 'fair'

const TYPE_META: Record<LocType, { emoji: string; label: string; color: string; bg: string }> = {
  lfl:       { emoji: '📚', label: 'LFL',       color: '#f97316', bg: '#fff7ed' },
  library:   { emoji: '🏛️', label: 'Library',   color: '#0d9488', bg: '#ecfdf5' },
  bookstore: { emoji: '📖', label: 'Bookstore', color: '#2563eb', bg: '#eff6ff' },
  fair:      { emoji: '🎪', label: 'Fair',      color: '#db2777', bg: '#fdf2f8' },
}

const TYPE_OPTIONS: { val: 'all' | LocType; label: string; emoji: string }[] = [
  { val: 'all',       label: 'All',              emoji: '' },
  { val: 'lfl',       label: 'Little Free Library', emoji: '📚' },
  { val: 'library',   label: 'Public Library',      emoji: '🏛️' },
  { val: 'bookstore', label: 'Book Store',          emoji: '📖' },
  { val: 'fair',      label: 'Fair',                emoji: '🎪' },
]

type FlyTo = { center: [number, number]; zoom: number; nonce: number }

export default function LocationsClient({ initialLocations, isLoggedIn }: {
  initialLocations: LibraryLocation[]
  isLoggedIn: boolean
}) {
  const [locations, setLocations] = useState<LibraryLocation[]>(initialLocations)
  const [userCoords, setUserCoords] = useState<[number, number] | null>(null)
  const [searchLabel, setSearchLabel] = useState('')   // human-readable "Near X" label
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null)
  const [search, setSearch] = useState('')
  const [searching, setSearching] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | LocType>('all')
  const [geoLoading, setGeoLoading] = useState(false)
  const [mapBounds, setMapBounds] = useState<Bounds | null>(null)

  // Add location state
  const [addMode, setAddMode] = useState(false)
  const [pendingPin, setPendingPin] = useState<[number, number] | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState({ name: '', type: 'lfl' as LocType, street: '', city: '', description: '', startDate: '', endDate: '' })
  const [formError, setFormError] = useState('')

  // Report state
  const [reportTarget, setReportTarget] = useState<LibraryLocation | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportSent, setReportSent] = useState(false)

  const filteredLocations = useMemo(() => {
    let result = locations
    if (mapBounds) {
      const [[swLat, swLng], [neLat, neLng]] = mapBounds
      result = result.filter(l => l.lat >= swLat && l.lat <= neLat && l.lng >= swLng && l.lng <= neLng)
    }
    if (typeFilter !== 'all') {
      result = result.filter(l => l.type === typeFilter)
    }
    if (userCoords) {
      result = [...result].sort((a, b) =>
        haversine(userCoords[0], userCoords[1], a.lat, a.lng) -
        haversine(userCoords[0], userCoords[1], b.lat, b.lng)
      )
    }
    return result
  }, [locations, userCoords, mapBounds, typeFilter])

  function applyLocation(coords: [number, number], label: string, zoom = 12) {
    setUserCoords(coords)
    setSearchLabel(label)
    setFlyTo({ center: coords, zoom, nonce: Date.now() })
  }

  function clearSearch() {
    setUserCoords(null)
    setSearchLabel('')
    setSearch('')
  }

  function useMyLocation() {
    if (!navigator.geolocation) return
    setGeoLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        applyLocation(coords, 'My Location')
        setGeoLoading(false)
      },
      () => {
        setGeoLoading(false)
        alert('Could not get your location — check your browser permissions.')
      }
    )
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!search.trim()) return
    setSearching(true)
    const coords = await geocode(search)
    setSearching(false)
    if (coords) applyLocation(coords, search.trim())
    else alert('Location not found. Try a city name or full address.')
  }

  function startAddMode() {
    if (!isLoggedIn) {
      window.location.href = '/auth/signin?redirect=/locations'
      return
    }
    setAddMode(true)
  }

  function handleMapClick(lat: number, lng: number) {
    setPendingPin([lat, lng])
    setShowAddForm(true)
  }

  function cancelAdd() {
    setAddMode(false); setPendingPin(null); setShowAddForm(false)
    setForm({ name: '', type: 'lfl', street: '', city: '', description: '', startDate: '', endDate: '' })
    setFormError('')
  }

  async function saveLocation() {
    if (!pendingPin) return
    if (!form.name.trim())   { setFormError('Library name is required'); return }
    if (!form.street.trim()) { setFormError('Street is required'); return }
    if (!form.city.trim())   { setFormError('City is required'); return }
    if (form.type === 'fair') {
      if (!form.startDate) { setFormError('Start date is required for a fair'); return }
      if (!form.endDate)   { setFormError('End date is required for a fair'); return }
      if (form.endDate < form.startDate) { setFormError('End date must be on or after the start date'); return }
    }
    setFormError('')

    const result = await addLibraryLocation({
      name: form.name.trim(),
      type: form.type,
      lat: pendingPin[0],
      lng: pendingPin[1],
      street: form.street.trim(),
      city: form.city.trim(),
      description: form.description.trim(),
      startDate: form.type === 'fair' ? form.startDate : undefined,
      endDate: form.type === 'fair' ? form.endDate : undefined,
    })

    if (!result.ok) { setFormError(result.error); return }
    setLocations(prev => [...prev, result.location])
    cancelAdd()
  }

  function sendReport() {
    setReportSent(true)
    setTimeout(() => { setReportTarget(null); setReportReason(''); setReportSent(false) }, 2200)
  }

  return (
    <>
      <div className="flex flex-col lg:h-[calc(100vh-68px)] lg:overflow-hidden bg-cream">

        {/* ── Compact header: title + search + my location in one bar ── */}
        <div className="flex-shrink-0 bg-bk-orange px-3 md:px-5 py-2 flex items-center gap-2 md:gap-3">
          <h1 className="font-display text-[17px] md:text-[19px] text-white whitespace-nowrap shrink-0">
            🗺️ <span className="hidden sm:inline">LFL </span>Locations
          </h1>
          <form onSubmit={handleSearch} className="flex items-center gap-1.5 bg-white/20 border border-white/40 rounded-xl px-2.5 py-1.5 w-[220px] md:w-[260px] shrink-0">
            <span className="text-white text-[14px] shrink-0">🔍</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="City or address…"
              className="flex-1 bg-transparent font-bold text-[13px] text-white placeholder:text-white/60 focus:outline-none min-w-0 w-0"
            />
            {(search || searchLabel) && (
              <button type="button" onClick={clearSearch}
                className="text-white/70 hover:text-white font-black text-[16px] leading-none shrink-0">
                ×
              </button>
            )}
            <button type="submit" disabled={searching}
              className="bg-white text-bk-orange font-extrabold text-[12px] px-2.5 py-1 rounded-lg shrink-0 disabled:opacity-60">
              {searching ? '…' : 'Go'}
            </button>
          </form>
          <button onClick={useMyLocation} disabled={geoLoading}
            className="flex items-center gap-1 text-white font-bold text-[13px] shrink-0 disabled:opacity-60 whitespace-nowrap">
            {geoLoading ? '⏳' : '📍'}<span className="hidden md:inline"> My Location</span>
          </button>
        </div>

        {/* ── Type filter + active search label ── */}
        <div className="flex-shrink-0 bg-white border-b border-[#f3f4f6] px-3 md:px-5 py-1.5 flex items-center gap-1.5 flex-wrap">
          <span className="font-bold text-[11px] text-[#999] shrink-0">Type:</span>
          {TYPE_OPTIONS.map(opt => (
            <button
              key={opt.val}
              onClick={() => setTypeFilter(opt.val)}
              className={`px-2.5 py-0.5 rounded-full font-extrabold text-[11px] border-2 transition-colors ${
                typeFilter === opt.val
                  ? 'bg-bk-orange border-bk-orange text-white'
                  : 'bg-white border-[#e5e7eb] text-[#666] hover:border-bk-orange cursor-pointer'
              }`}>
              {opt.emoji ? `${opt.emoji} ` : ''}{opt.label}
            </button>
          ))}

          {/* Active search label with clear */}
          {searchLabel && (
            <div className="flex items-center gap-1 bg-[#fff7ed] border border-[#fed7aa] rounded-full px-2 py-0.5 ml-1">
              <span className="text-[11px] font-bold text-[#f97316] max-w-[120px] truncate">Near {searchLabel}</span>
              <button onClick={clearSearch}
                className="text-[#f97316] font-black text-[15px] leading-none ml-0.5 hover:text-red-500">
                ×
              </button>
            </div>
          )}
          {!userCoords && (
            <span className="text-[11px] font-semibold text-[#bbb] ml-1">Search a city or use My Location to sort by distance</span>
          )}
          <span className="ml-auto font-bold text-[11px] text-[#aaa] whitespace-nowrap">
            {filteredLocations.length} location{filteredLocations.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Add mode hint */}
        {addMode && !pendingPin && (
          <div className="flex-shrink-0 bg-[#ecfdf5] border-b-2 border-bk-teal px-4 py-2 text-bk-teal font-bold text-[13px] text-center">
            Click anywhere on the map to drop your pin 📌
          </div>
        )}

        {/* ── Main content: List LEFT · Map RIGHT ── */}
        <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0 lg:overflow-hidden">

          {/* LIST — left panel */}
          <div className="order-2 lg:order-1 w-full lg:w-[360px] lg:flex-shrink-0 flex flex-col lg:overflow-hidden border-t-4 lg:border-t-0 lg:border-r-4 border-[#fed7aa] bg-white">

            {/* Add Location button */}
            <div className="flex-shrink-0 p-2.5 border-b border-[#f3f4f6]">
              {addMode ? (
                <button onClick={cancelAdd}
                  className="w-full flex items-center justify-center gap-2 bg-red-50 text-red-500 border-2 border-red-200 font-bold text-[13px] px-4 py-2 rounded-xl">
                  ✕ Cancel Adding Location
                </button>
              ) : (
                <button onClick={startAddMode}
                  className="w-full flex items-center justify-center gap-2 bg-bk-teal text-white font-extrabold text-[13px] px-4 py-2 rounded-xl shadow-[0_3px_0_#0f766e] hover:shadow-[0_1px_0_#0f766e] hover:translate-y-px transition-all">
                  📌 Add a Location
                </button>
              )}
            </div>

            {/* Location cards — scrollable */}
            <div className="flex-1 lg:overflow-y-auto">
              {filteredLocations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-6 text-center text-[#bbb]">
                  <div className="text-4xl mb-3">📭</div>
                  <p className="font-bold text-[14px] text-[#aaa]">No locations found</p>
                  <p className="font-semibold text-[12px] mt-1">Try a different type filter or clear the search</p>
                </div>
              ) : (
                <div>
                  {filteredLocations.map(loc => (
                    <LocationCard key={loc.id} loc={loc} userCoords={userCoords} onReport={setReportTarget} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* MAP — right panel */}
          <div className="order-1 lg:order-2 lg:flex-1 relative h-[300px] lg:h-auto">
            <MapView
              locations={filteredLocations}
              pendingPin={pendingPin}
              flyTo={flyTo}
              addMode={addMode}
              onMapClick={handleMapClick}
              onReport={setReportTarget}
              onBoundsChange={setMapBounds}
            />
          </div>

        </div>
      </div>

      {/* ── Add Location form modal ── */}
      {showAddForm && pendingPin && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-[440px] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="font-display text-[22px] mb-1">Add a Location</h2>
            <p className="text-[#aaa] font-semibold text-[13px] mb-4">
              📌 Pin at {pendingPin[0].toFixed(4)}°, {pendingPin[1].toFixed(4)}°
              <button onClick={() => { setPendingPin(null); setShowAddForm(false) }}
                className="text-bk-orange font-bold ml-3 text-[12px]">Move pin</button>
            </p>
            <div className="space-y-3 mb-4">
              <FormField label="Library Name *">
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Corner Street LFL"
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </FormField>
              <FormField label="Type *">
                <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as LocType }))}
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange bg-white">
                  <option value="lfl">📚 Little Free Library</option>
                  <option value="library">🏛️ Public Library</option>
                  <option value="bookstore">📖 Book Store</option>
                  <option value="fair">🎪 Library Fair</option>
                </select>
              </FormField>
              {form.type === 'fair' && (
                <>
                  <FormField label="Start Date *">
                    <input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
                      className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
                  </FormField>
                  <FormField label="End Date *">
                    <input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
                      className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
                  </FormField>
                </>
              )}
              <FormField label="Street *" hint="No exact address needed">
                <input value={form.street} onChange={e => setForm(f => ({ ...f, street: e.target.value }))}
                  placeholder="e.g. Oak Street"
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </FormField>
              <FormField label="City *">
                <input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                  placeholder="e.g. Portland, OR"
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </FormField>
              <FormField label="Description" hint="optional">
                <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Red barn shape, near the oak tree"
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </FormField>
            </div>
            <p className="text-[#bbb] text-[12px] font-semibold mb-3">🔒 Exact addresses are not stored — the pin marks the spot.</p>
            {formError && <p className="text-red-500 font-bold text-[13px] mb-3">⚠️ {formError}</p>}
            <div className="flex gap-3">
              <button onClick={cancelAdd}
                className="flex-1 border-2 border-[#e5e7eb] rounded-xl py-3 font-extrabold text-[14px] text-[#888]">Cancel</button>
              <button onClick={saveLocation}
                className="flex-1 bg-bk-teal text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#0f766e]">Save Location</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Request to Move modal ── */}
      {reportTarget && (
        <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-[440px] p-6 shadow-2xl">
            {reportSent ? (
              <div className="text-center py-6">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="font-display text-[22px] mb-2">Request Sent!</h2>
                <p className="font-semibold text-[14px] text-[#666]">Our team will review your request and update the map.</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-[22px] mb-1">Request Location Change</h2>
                <p className="text-[#888] font-semibold text-[13px] mb-4">This will be sent to an admin for review.</p>
                <div className="border-l-4 rounded-xl p-3 mb-4" style={{ borderLeftColor: TYPE_META[reportTarget.type].color, background: TYPE_META[reportTarget.type].bg }}>
                  <div className="font-black text-[14px] text-[#2d2d2d]">{reportTarget.name}</div>
                  <div className="font-semibold text-[13px] text-[#666]">{reportTarget.street}, {reportTarget.city}</div>
                  <div className="text-[11px] font-bold mt-0.5" style={{ color: TYPE_META[reportTarget.type].color }}>
                    {TYPE_META[reportTarget.type].emoji} {TYPE_META[reportTarget.type].label}
                  </div>
                </div>
                <label className="block font-extrabold text-[13px] mb-1.5 text-[#444]">Reason for request *</label>
                <textarea
                  value={reportReason}
                  onChange={e => setReportReason(e.target.value)}
                  placeholder="e.g. This library has moved / no longer exists / address is incorrect…"
                  rows={4}
                  className="w-full border-2 border-[#e5e7eb] rounded-xl px-3 py-2.5 font-semibold text-[14px] focus:outline-none focus:border-bk-orange resize-none mb-3"
                />
                <p className="text-[#bbb] text-[12px] font-semibold mb-4">📬 Our team reviews requests within 1–3 business days.</p>
                <div className="flex gap-3">
                  <button onClick={() => { setReportTarget(null); setReportReason('') }}
                    className="flex-1 border-2 border-[#e5e7eb] rounded-xl py-3 font-extrabold text-[14px] text-[#888]">Cancel</button>
                  <button onClick={sendReport} disabled={!reportReason.trim()}
                    className="flex-1 bg-bk-orange text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c] disabled:opacity-50 disabled:shadow-none">
                    Send Request
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-extrabold text-[13px] mb-1 text-[#444]">
        {label}{hint && <span className="font-semibold text-[#aaa] ml-1.5">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function LocationCard({ loc, userCoords, onReport }: {
  loc: LibraryLocation
  userCoords: [number, number] | null
  onReport: (loc: LibraryLocation) => void
}) {
  const dist = userCoords ? haversine(userCoords[0], userCoords[1], loc.lat, loc.lng) : null
  const meta = TYPE_META[loc.type]

  return (
    <div className="flex border-l-4 hover:bg-[#fafafa] transition-colors" style={{ borderLeftColor: meta.color }}>
      {/* Color swatch column */}
      <div className="w-10 flex-shrink-0 flex flex-col items-center justify-start pt-3.5 pb-3 gap-1" style={{ background: meta.bg }}>
        <span className="text-[18px]">{meta.emoji}</span>
        <span className="text-[9px] font-extrabold uppercase tracking-wide" style={{ color: meta.color, writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
          {meta.label}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 px-3 py-3 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-black text-[14px] text-[#2d2d2d] leading-tight">{loc.name}</div>
            <div className="text-[12px] font-semibold text-[#777] mt-0.5">{loc.street}, {loc.city}</div>
            {loc.type === 'fair' && loc.startDate && loc.endDate && (
              <div className="text-[11px] font-extrabold mt-0.5" style={{ color: meta.color }}>
                🗓️ {formatDate(loc.startDate)} – {formatDate(loc.endDate)}
              </div>
            )}
            {loc.description && (
              <div className="text-[11px] text-[#aaa] font-semibold mt-0.5 truncate">{loc.description}</div>
            )}
            {dist !== null && (
              <div className="text-[11px] font-extrabold mt-1" style={{ color: meta.color }}>
                {dist.toFixed(1)} mi away
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`}
              target="_blank" rel="noopener noreferrer"
              className="text-[11px] font-bold text-bk-orange hover:underline whitespace-nowrap">
              Directions ↗
            </a>
            <button onClick={() => onReport(loc)}
              className="text-[11px] font-bold text-[#ccc] hover:text-[#888] transition-colors">
              📩 Report
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/locations/LocationsClient.tsx
git commit -m "feat: shared library locations, type filter, fair dates, drop distance filter"
```

(`app/locations/page.tsx` still calls `<LocationsClient />` with no props at this point — expected type error, resolved by Task 5.)

---

### Task 5: `app/locations/page.tsx` fetches real data

**Files:**
- Modify: `app/locations/page.tsx`

**Interfaces:**
- Consumes: `LocationsClient({ initialLocations, isLoggedIn })` from Task 4; `LibraryLocation` type from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the whole file**

Replace `app/locations/page.tsx` with:

```tsx
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors only from the pre-existing unrelated `Set<any>` issue in `app/profile/page.tsx` (already present on `master`) — no new errors anywhere in `app/locations/*` or `lib/actions/libraryLocations.ts`.

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/locations/page.tsx
git commit -m "feat: fetch real library locations and login state server-side"
```

---

## Full Test Suite Check

- [ ] Run: `npm run test:run`
- [ ] Expected: all existing tests still pass (this feature adds no new component tests — the Libraries page has no test file today either, consistent with the existing convention that only small reusable client components get test files).

## Manual Browser Verification

After running the Task 1 SQL in the Supabase SQL editor:

1. Visit `/locations` while logged out. Confirm the map and list are empty (no more mock Portland/Seattle/etc. pins) and the "Distance:" pill row is gone, replaced by a "Type:" filter row.
2. Click "Add a Location" while logged out — confirm it redirects to `/auth/signin?redirect=/locations` instead of opening add-mode.
3. Sign in with a real account. Click "Add a Location," click the map, and add a Little Free Library. Confirm it appears immediately in the list and on the map with no page reload, and that reloading the page still shows it (persisted, not localStorage).
4. Add a Library Fair without filling in Start/End Date — confirm the inline error blocks saving. Add one with an end date before the start date — confirm that's blocked too. Add one with a valid range — confirm the popup and card show the date range and the pink 🎪 styling.
5. Use the Type filter pills to narrow the list/map to just one type at a time, and back to "All."
6. Manually set a fair's `end_date` to yesterday directly in the Supabase table editor, then reload `/locations` — confirm the fair disappears and the row is gone from the table (deleted, not just hidden).
7. Confirm city/address search and "My Location" still work (map flies to the location, "X mi away" labels appear on cards) — these were explicitly kept, not part of the removed distance filter.

## Final Deliverable: SQL for Supabase

After all tasks are complete and verified, hand the user this SQL to run in the Supabase SQL editor (same block as Task 1, Step 1):

```sql
create table if not exists library_locations (
  id uuid default gen_random_uuid() primary key,
  created_by uuid references profiles(id) on delete cascade not null,
  name text not null,
  type text not null check (type in ('lfl', 'library', 'bookstore', 'fair')),
  lat double precision not null,
  lng double precision not null,
  street text not null default '',
  city text not null default '',
  description text not null default '',
  start_date date,
  end_date date,
  created_at timestamptz default now(),
  constraint fair_requires_dates check (
    type <> 'fair' or (start_date is not null and end_date is not null and end_date >= start_date)
  )
);

alter table library_locations enable row level security;

create policy "Locations are viewable by everyone" on library_locations
  for select using (true);

create policy "Authenticated users can add locations" on library_locations
  for insert to authenticated with check (auth.uid() = created_by);

create policy "Anyone can clean up expired fairs" on library_locations
  for delete using (type = 'fair' and end_date < current_date);
```
