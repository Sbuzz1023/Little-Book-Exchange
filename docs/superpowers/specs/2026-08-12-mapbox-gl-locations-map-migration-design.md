# Mapbox GL JS Migration for the `/locations` Map — Design

**Date:** 2026-08-12
**Status:** Approved

## Problem

`/locations`' map (`app/locations/MapView.tsx`, shared with the admin panel's
pin-repositioning UI in `app/admin/LocationsAdminTab.tsx`) is built on
`react-leaflet` with raster map tiles pulled directly from OpenStreetMap's
public tile server (`tile.openstreetmap.org`). Two issues with staying on
this stack long-term:

1. OpenStreetMap's tile-server usage policy is explicit that its public
   servers are meant for light/hobby-scale use, not production apps — sites
   that send it real traffic without prior arrangement risk being
   rate-limited or blocked, with no warning and no paid tier to fall back on.
2. Raster tiles look and feel dated next to vector-tile rendering — blurry
   while zooming, visible tile pop-in while panning — versus Mapbox GL JS's
   smoothly-scaling vector tiles.

## Goal

Replace `MapView.tsx`'s rendering engine with Mapbox GL JS (via
`react-map-gl`), preserving the page's current look and behavior exactly:
same colored emoji pins, same popups, same fly-to-search-result animation,
same map-bounds-based list filtering, same click-to-drop-a-pin add flow.
`MapView`'s props interface does not change, so neither
`app/locations/LocationsClient.tsx` nor `app/admin/LocationsAdminTab.tsx`
(both of which render `<MapView>`) need any changes.

Geocoding (turning typed text into a coordinate) is explicitly **not**
touched by this migration — it stays on Nominatim, unchanged. See Design §5
for why.

## Design

### 1. Dependencies

Add `mapbox-gl` and `react-map-gl`. Remove `leaflet`, `react-leaflet`, and
`@types/leaflet` once the migration is verified working end-to-end (kept
until then in case a revert is needed mid-implementation).

### 2. Mapbox setup

- Reuses the existing `NEXT_PUBLIC_MAPBOX_TOKEN` (already set in
  `.env.local` and Vercel Production/Preview from the Address Autofill
  work) — no new token or env var needed.
- Map style: Mapbox's built-in `mapbox://styles/mapbox/streets-v12`.
- Cost: Mapbox's Maps SDK / GL JS "map load" pricing gives 50,000 free
  loads/month, then ~$5/1,000. At this app's current scale this is
  effectively $0/month.
- Mapbox requires its attribution control to remain visible on the map per
  its terms of service — this replaces Leaflet's OpenStreetMap attribution
  control, not a removal of attribution generally.

### 3. `MapView.tsx` rewrite

A like-for-like internal port from `react-leaflet` constructs to their
`react-map-gl` equivalents. Props (`locations`, `pendingPin`, `flyTo`,
`addMode`, `onMapClick`, `onReport`, `onBoundsChange`) and the exported
`LibraryLocation`/`Bounds` types are unchanged.

| Today (`react-leaflet`) | Becomes (`react-map-gl`) |
|---|---|
| `<MapContainer center={[39.5,-98.35]} zoom={4}>` | `<Map>`, same initial center/zoom |
| `<TileLayer>` (OSM raster tiles) | Mapbox's `streets-v12` style (built in, no separate component) |
| `<Marker icon={L.divIcon(...)}>` per location, via `pinIcon()` | `<Marker>` with a small `Pin` component rendering the same styled `<div>` (same colors/emoji/size from `TYPE_META`) as JSX children instead of an HTML string |
| `<Popup>` content | Same content JSX, ported directly into `react-map-gl`'s `<Popup>` |
| `MapFly` (`useMap()` + `map.flyTo()` in a `useEffect`) | `useEffect` calling `.flyTo()` on the map ref exposed by `react-map-gl`'s `<Map ref>`, still keyed on `flyTo.nonce` |
| `BoundsTracker` (`useMapEvents` `moveend`/`zoomend`) | `onMoveEnd` handler on `<Map>`, converting `getBounds()` into the same `[[south,west],[north,east]]` `Bounds` tuple `LocationsClient.tsx` already consumes |
| `ClickHandler` (`useMapEvents` `click`, gated on `addMode`) | `onClick` handler on `<Map>`, same `addMode` gate |
| Pending-pin marker | Same, ported directly |

No changes to `Bounds`'s shape or meaning — `LocationsClient.tsx`'s
`filteredLocations` bounds-filtering logic keeps working untouched.

### 4. Data flow

Unchanged. `app/locations/page.tsx` still server-fetches
`library_locations` from Supabase and passes them to `LocationsClient`;
`LocationsClient` still owns search, type-filtering, distance-sorting,
bounds-filtering, and the add/report modals exactly as today. Only
`MapView.tsx`'s internals change.

### 5. Geocoding stays on Nominatim (not migrated)

Considered and rejected: moving the search bar / "locate by address"
geocoding to Mapbox as part of this migration.

- Both the "Add a Location" flow (which permanently saves the resulting
  `lat`/`lng` into `library_locations`) and the general search bar would
  need a geocoding provider whose terms allow that. Mapbox's cheap/free
  geocoding tier is explicitly ephemeral-use-only (same restriction that
  forced `lat`/`lng` out of the Address Autofill feature — see
  `2026-08-09-mapbox-address-autofill-design.md`'s Addendum); the tier that
  does allow permanent storage (Mapbox's Permanent Geocoding API) has no
  free tier, starts at $5/1,000 requests, and requires contacting Mapbox
  sales to enable at all.
- Nominatim (OpenStreetMap's free geocoder, already in use) has no such
  storage restriction and costs nothing, but has its own limits worth
  recording: a shared 1-request/second rate limit across the whole app, no
  official paid tier to grow into, and its usage policy explicitly
  prohibits auto-complete/type-ahead implementations ("this is not yet
  supported by Nominatim and you must not implement such a service").
- At this app's current (low, solo-run) scale, Nominatim's free tier is
  adequate and the Mapbox alternative's cost/friction isn't justified.
  **Decision:** keep Nominatim exactly as-is. `LocationsClient.tsx`'s
  `geocode()` function and its two call sites (search bar, "locate by
  address") are not touched by this migration. The search bar and "locate
  by address" keep their current one-shot "type it, hit Go/Locate" behavior
  — no live-suggestions/autocomplete upgrade, since that would require
  either the paid Mapbox tier or violate Nominatim's policy.
- If/when real traffic numbers justify revisiting this, the options at that
  point are: pay for Mapbox's Permanent Geocoding, self-host Nominatim, or
  use a commercial Nominatim-compatible provider (e.g. LocationIQ). None of
  that is part of this migration.

### 6. Error handling

If the Mapbox token is missing or invalid, the map area shows a friendly
inline message ("Map couldn't load — please refresh the page.") in place of
a blank or crashed map, following the same graceful-degradation spirit as
`AddressAutofillField`'s fallback-to-plain-input behavior. This is a
low-probability case since the token is already configured and working.

### 7. Testing / verification

There's no existing automated test coverage on `MapView.tsx` or
`LocationsClient.tsx`, and a real interactive Mapbox GL canvas isn't
practical to meaningfully unit test. Consistent with how prior map/location
work in this project was verified, this will be checked by hand against the
running app rather than via new automated tests:

- Pins render with the correct color/emoji per type, and popups show the
  correct content (name, type badge, street/city, fair dates, description,
  Directions link, Report button).
- Search bar geocode + fly-to-result still works; "My Location" geolocation
  still works; type-filter buttons still work; the location list still
  filters to what's in view as the map is panned/zoomed.
- "Add a Location": click-to-drop-a-pin, "locate by address," and the save
  flow all still work, and the new pin appears correctly on the map.
- Admin panel: editing a location's pin position (`LocationsAdminTab.tsx`'s
  reuse of `MapView`) still works.
- Mobile layout (map on top, list below) still looks and behaves correctly.

### 8. Cleanup

Once the above is verified, remove `leaflet`, `react-leaflet`, and
`@types/leaflet` from `package.json`.

## Out of scope

- **Migrating geocoding to Mapbox** — see Design §5. Nominatim stays as the
  geocoding provider.
- **Live-suggestions/autocomplete search UX** — blocked either by cost
  (Mapbox) or policy (Nominatim); see Design §5.
- **Distance-radius search on book listings** — unrelated feature, already
  out of scope per `2026-08-09-mapbox-address-autofill-design.md`.
- **A custom Mapbox map style** — using the built-in `streets-v12` style
  as-is, no custom branding/styling pass.
- **Self-hosting Nominatim or switching to a commercial Nominatim-compatible
  provider** (e.g. LocationIQ) — a future option if real usage numbers ever
  justify it, not part of this migration.
