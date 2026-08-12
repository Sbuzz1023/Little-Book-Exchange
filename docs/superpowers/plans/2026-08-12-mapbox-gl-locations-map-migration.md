# Mapbox GL Locations Map Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `app/locations/MapView.tsx`'s rendering engine from `react-leaflet` (OpenStreetMap raster tiles) to Mapbox GL JS (via `react-map-gl`), with identical visuals and behavior, and no changes required to either caller (`app/locations/LocationsClient.tsx`, `app/admin/LocationsAdminTab.tsx`).

**Architecture:** `MapView.tsx`'s props interface (`LibraryLocation`, `Bounds`, `Props`) stays byte-for-byte the same. Only its internals swap: Leaflet's `MapContainer`/`Marker`/`Popup`/`useMapEvents` become `react-map-gl`'s `Map`/`Marker`/`Popup` plus native `mapboxgl.Map` ref calls for `flyTo`/`getBounds`. Geocoding (Nominatim, in `LocationsClient.tsx`) is untouched.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript (strict), `mapbox-gl` + `react-map-gl` (new), Tailwind CSS, Vitest (no new automated tests — see spec's Testing section).

## Global Constraints

- Reuse the existing `NEXT_PUBLIC_MAPBOX_TOKEN` env var — do not add a new token or env var.
- Map style is pinned to `mapbox://styles/mapbox/streets-v12` (no custom style).
- `MapView.tsx`'s exported `LibraryLocation` type, `Bounds` type, and `Props` interface must not change — `LocationsClient.tsx` and `LocationsAdminTab.tsx` must need zero edits.
- Geocoding stays on Nominatim — do not touch `LocationsClient.tsx`'s `geocode()` function or its two call sites.
- This project's `next.config.js` sets `typescript: { ignoreBuildErrors: true }`, so `npm run build` succeeding is **not** proof the code type-checks. Use `npx tsc --noEmit` to actually verify types.
- Coordinate order gotcha: this project's own convention (`flyTo.center`, `pendingPin`, `LibraryLocation.lat`/`lng` access patterns) is `[lat, lng]`. Mapbox's native `flyTo({center})` wants `[lng, lat]` — the reverse. Get this backwards and the map will fly to the wrong hemisphere.

---

### Task 1: Install Mapbox dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json` (auto-updated by `npm install`)

**Interfaces:**
- Produces: `mapbox-gl`, `react-map-gl`, `@types/mapbox-gl` installed and available for Task 2 to import (`react-map-gl/mapbox`, `mapbox-gl/dist/mapbox-gl.css`).

- [ ] **Step 1: Install the packages**

Run: `npm install mapbox-gl react-map-gl @types/mapbox-gl`

- [ ] **Step 2: Confirm the Mapbox token is already present**

Run: `grep NEXT_PUBLIC_MAPBOX_TOKEN .env.local`
Expected: one line, `NEXT_PUBLIC_MAPBOX_TOKEN=pk....` with a real value (this was already configured for the Address Autofill feature — see `docs/superpowers/specs/2026-08-09-mapbox-address-autofill-design.md`). If it's missing, stop and flag this before continuing — Task 2's map will not render without it.

- [ ] **Step 3: Baseline type-check (nothing should have changed yet)**

Run: `npx tsc --noEmit`
Expected: passes with no errors (the codebase still uses `react-leaflet` at this point — this step only confirms the new install didn't break anything).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add mapbox-gl and react-map-gl dependencies"
```

---

### Task 2: Rewrite `MapView.tsx` on Mapbox GL JS

**Files:**
- Modify: `app/locations/MapView.tsx` (full rewrite)

**Interfaces:**
- Consumes: `NEXT_PUBLIC_MAPBOX_TOKEN` (Task 1), `mapbox-gl`/`react-map-gl` packages (Task 1).
- Produces: default export `MapView(props: Props)` where `Props = { locations: LibraryLocation[]; pendingPin: [number, number] | null; flyTo: { center: [number, number]; zoom: number; nonce: number } | null; addMode: boolean; onMapClick: (lat: number, lng: number) => void; onReport: (loc: LibraryLocation) => void; onBoundsChange: (b: Bounds) => void }`, and exported types `LibraryLocation`, `Bounds` — identical to today, consumed unchanged by `LocationsClient.tsx` and `LocationsAdminTab.tsx`.

- [ ] **Step 1: Replace the full contents of `app/locations/MapView.tsx`**

```tsx
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

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

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

  // Incoming flyTo.center is [lat, lng] (this project's convention — see
  // LocationsClient.tsx's applyLocation/selectLocation). mapbox-gl's native
  // flyTo() wants [lng, lat] — deliberately swapped below.
  useEffect(() => {
    if (!flyTo) return
    const map = mapRef.current?.getMap()
    if (!map) return
    map.flyTo({ center: [flyTo.center[1], flyTo.center[0]], zoom: flyTo.zoom, duration: 1200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo?.nonce])

  // A pending pin's popup should start closed every time a *new* pin is
  // dropped, not carry over "open" from a previous drop. Every add-flow
  // path in LocationsClient.tsx sets pendingPin to null before setting a
  // new value, so resetting on `!pendingPin` catches every case.
  useEffect(() => {
    if (!pendingPin) setPendingPopupOpen(false)
  }, [pendingPin])

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
      style={{ width: '100%', height: '100%', cursor: 'crosshair' }}
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: passes with no errors. (Remember: `npm run build` succeeding is not sufficient proof here — this project's `next.config.js` sets `ignoreBuildErrors: true`.)

- [ ] **Step 3: Start the dev server**

Run: `npm run dev`

- [ ] **Step 4: Verify base map + pins render**

Open `http://localhost:3000/locations`. Expected: the map loads with Mapbox's Streets style (not the old OpenStreetMap look), and every existing library location shows as a colored circular pin with its emoji (📚 orange for Little Free Library, 🏛️ teal for Public Library, 📖 blue for Book Store, 🎪 pink for Library Fair) — same colors/emojis as before the migration.

- [ ] **Step 5: Verify popups open and stay open**

Click one pin. Expected: its popup opens (name, type badge, street, city, Directions link, 📩 Report button) and **stays open** — it must not flicker closed immediately (this is the exact bug the `clickedMarkerOrPopup` guard in Step 1 exists to prevent). Click a different pin: the first popup closes and the new one opens. Click empty map area (not a pin): the open popup closes.

- [ ] **Step 6: Verify the Directions and Report actions**

In an open popup, confirm "Directions" opens Google Maps directions to that pin's coordinates in a new tab, and "📩 Report" opens the existing "Request Location Change" modal.

- [ ] **Step 7: Verify search + fly-to uses correct coordinates**

Type a real US city (e.g. "Chicago, IL") into the "City or address…" search bar and hit Go. Expected: the map flies to actually-Chicago (upper-middle US) — not a nonsensical location. This specifically confirms the `[lat,lng]` → `[lng,lat]` conversion in the `flyTo` effect is correct; if it's backwards, the map will fly to the wrong hemisphere entirely, which will be obvious.

- [ ] **Step 8: Verify "My Location," type filters, and bounds-based list filtering**

Click "📍 My Location" (allow the browser permission prompt) and confirm the map flies to your real location. Click each type-filter pill (All/LFL/Library/Bookstore/Fair) and confirm pins and the left-hand list both filter correctly. Pan/zoom the map and confirm the location list updates to show only pins currently in view.

- [ ] **Step 9: Verify "Add a Location"**

Click "📌 Add a Location," then click anywhere on the map. Expected: a green 📌 pending pin appears at that spot and the "Add a Location" form opens. Fill in a name/type/street/city and save. Expected: the form closes and the new pin appears on the map in its proper color, immediately, without a page reload.

- [ ] **Step 10: Verify the admin panel's pin-repositioning map still works**

Sign in as an admin, go to the Locations admin tab, edit an existing location. Expected: its small embedded map still shows the pin at the correct position, and clicking elsewhere on that small map moves the pin (this reuses the same `MapView` unchanged — confirms the props interface truly didn't change).

- [ ] **Step 11: Verify mobile layout**

Resize the browser to a narrow (phone-width) viewport. Expected: map on top, scrollable location list below, same as before.

- [ ] **Step 12: Commit**

```bash
git add app/locations/MapView.tsx
git commit -m "feat: migrate locations map from Leaflet to Mapbox GL JS"
```

---

### Task 3: Remove Leaflet dependencies and dead references

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `app/globals.css`
- Modify: `components/AddressAutofillField.tsx` (comment accuracy only, no logic change)

**Interfaces:**
- Consumes: Task 2's verified, working `MapView.tsx` (no remaining `leaflet`/`react-leaflet` imports anywhere in the codebase).
- Produces: a codebase with no `leaflet`/`react-leaflet` references left in dependencies, styles, or comments.

- [ ] **Step 1: Confirm nothing else still imports Leaflet**

Run: `grep -ril "react-leaflet\|from 'leaflet'\|from \"leaflet\"" --include="*.tsx" --include="*.ts" .`
Expected: no output (Task 2 already replaced the only real usage in `app/locations/MapView.tsx`).

- [ ] **Step 2: Remove the packages**

Run: `npm uninstall leaflet react-leaflet @types/leaflet`

- [ ] **Step 3: Remove the now-dead Leaflet CSS override**

In `app/globals.css`, delete this block (Mapbox GL renders its map via `<canvas>`, not `<img>` tiles, so this Tailwind-reset fix for Leaflet's raster `<img>` tiles no longer applies to anything):

```css
/* Prevent Tailwind base reset from breaking Leaflet tile images */
.leaflet-container img {
  max-width: none !important;
  box-shadow: none !important;
}
```

- [ ] **Step 4: Fix a now-stale comment in `components/AddressAutofillField.tsx`**

Find this sentence in the file's top comment block:

```
matching the identical fix this codebase already uses for react-leaflet in
app/locations/LocationsClient.tsx, for the same underlying reason.
```

Replace it with:

```
matching the identical fix this codebase already uses for mapbox-gl in
app/locations/MapView.tsx, for the same underlying reason.
```

- [ ] **Step 5: Type-check and confirm the dev server still runs clean**

Run: `npx tsc --noEmit`
Expected: passes with no errors.

Run: `npm run dev`, reload `http://localhost:3000/locations`.
Expected: map still renders correctly (unchanged from Task 2's verification — this step only confirms removing the old packages didn't break anything).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app/globals.css components/AddressAutofillField.tsx
git commit -m "chore: remove leaflet/react-leaflet now that the locations map runs on Mapbox GL"
```

## Self-Review Notes

- **Spec coverage:** Design §1 (deps) → Task 1. §2 (Mapbox setup, token reuse, style) → Task 2 Step 1. §3 (full `MapView.tsx` rewrite table) → Task 2 Step 1. §4 (data flow unchanged) → enforced by keeping `Props`/types identical, verified in Task 2 Step 10 (admin reuse still works). §5 (Nominatim untouched) → enforced by Global Constraints; no task touches `LocationsClient.tsx`. §6 (error handling) → Task 2 Step 1's `if (!MAPBOX_TOKEN)` fallback. §7 (manual verification) → Task 2 Steps 4-11. §8 (cleanup) → Task 3.
- **Placeholder scan:** none found — every step has real code, exact commands, and concrete expected results.
- **Type consistency:** `Bounds`, `LibraryLocation`, and `Props` are defined once in Task 2 Step 1 and not redefined or contradicted elsewhere; no other task touches these types.
