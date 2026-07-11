# Library Locations: Shared Supabase Storage, Type Filter, Fairs

**Date:** 2026-07-10
**Status:** Approved

## Overview

The Libraries page (`/locations`) currently ships with a hardcoded `MOCK_LOCATIONS` array and lets anyone add a pin, but new pins only ever land in that browser's `localStorage` — nobody else ever sees them. This feature replaces that with a real shared `library_locations` Supabase table, adds two new location types (Book Store, Library Fair), replaces the mile-radius distance filter with a type filter, and gives Library Fair entries a required date range that causes them to disappear (and get cleaned up) the day after they end.

The existing "Report a location" flow (fake success message, nothing persisted) is unchanged — explicitly out of scope here.

---

## Data

### New table: `library_locations`

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

- `type` covers all four kinds: `lfl` (Little Free Library), `library` (public/city library), `bookstore`, `fair` (library/book fair).
- `start_date`/`end_date` are `null` for every type except `fair`, where the `fair_requires_dates` check constraint enforces both are present and `end_date >= start_date`.
- The select policy is public (`using (true)`, no `to` restriction) so anonymous visitors can browse the map without signing in — matches `listings`.
- The delete policy is intentionally narrow: it only ever matches rows where `type = 'fair' and end_date < current_date`, so any client (including an anonymous one) can trigger cleanup without being able to delete anything else.
- Inserting requires a real signed-in account (`to authenticated`), unlike today's anonymous-friendly localStorage flow — this matches how posting a book or adding a TBR entry already requires sign-in.

This SQL is handed to the user to run in the Supabase SQL editor once implementation is complete, same as the prior features.

---

## Fetching and Expiry (`app/locations/page.tsx`)

`page.tsx` becomes an async server component (it's currently just `return <LocationsClient />`):

1. Delete expired fairs: `supabase.from('library_locations').delete().eq('type', 'fair').lt('end_date', <today as 'YYYY-MM-DD'>)`.
2. Fetch everything else: `supabase.from('library_locations').select('*').order('created_at', { ascending: false })`.
3. Determine `isLoggedIn` the same way the listings pages already do (demo cookie or `supabase.auth.getUser()`).
4. Pass `initialLocations` (mapped to the existing `LibraryLocation` shape) and `isLoggedIn` to `LocationsClient`.

Both Supabase calls are wrapped in `try/catch` — on any failure (e.g. before the migration has been run), fall back to an empty locations array and `isLoggedIn = false` rather than crashing the page, matching the defensive pattern used elsewhere (e.g. `app/listings/page.tsx`).

---

## Component Changes

### `app/locations/LocationsClient.tsx`

- Delete `MOCK_LOCATIONS` entirely, the `localStorage` read `useEffect`, and the `localStorage.setItem` call in `saveLocation`.
- Accept new props: `initialLocations: LibraryLocation[]`, `isLoggedIn: boolean`. `locations` state is seeded from `initialLocations` instead of `MOCK_LOCATIONS`.
- **Remove the distance filter:** delete `DISTANCE_OPTIONS`, the `distance` state, the `userCoords`-radius branch of `filteredLocations` (`if (distance > 0 && userCoords) { ... }`), the radius auto-apply-5mi behavior in `applyLocation`, the "Distance:" pill row UI, and the `radiusMiles`/radius-related props passed to `MapView` (the `Circle` overlay and its use of `radiusMiles`).
  - **Keep:** the city/address search box, "My Location" geolocation button, and the map-bounds-based list filtering (`else if (mapBounds) { filter by bounds }`) — these aren't the distance filter, they're map navigation and viewport-following, and stay as-is. `filteredLocations` always filters by `mapBounds` now (no more `distance === 0` gate on it).
  - **Keep:** the "X mi away" distance label on each card and distance-based sort when `userCoords` is set (from a search or "My Location") — informational, not a filter that hides anything.
- **Add a type filter**, replacing the old (static, non-interactive) legend row, in the same visual slot the distance pills occupied:
  ```ts
  const TYPE_OPTIONS = [
    { val: 'all',      label: 'All',               emoji: '' },
    { val: 'lfl',      label: 'Little Free Library', emoji: '📚' },
    { val: 'library',  label: 'Public Library',      emoji: '🏛️' },
    { val: 'bookstore',label: 'Book Store',          emoji: '📖' },
    { val: 'fair',     label: 'Fair',                emoji: '🎪' },
  ]
  ```
  New `typeFilter` state (`'all' | 'lfl' | 'library' | 'bookstore' | 'fair'`, default `'all'`), pill-button UI matching the removed distance row's visual style. `filteredLocations` adds `if (typeFilter !== 'all') result = result.filter(l => l.type === typeFilter)`.
- **Gate "Add a Location" behind `isLoggedIn`:** clicking the button when `!isLoggedIn` redirects to `/auth/signin?redirect=/locations` instead of entering add-mode (same redirect pattern as `HeartButton`/`SaveButton`).
- **Extend the Add Location form:**
  - `form` state's `type` field becomes `'lfl' | 'library' | 'bookstore' | 'fair'`; the `<select>` gets two new `<option>`s (Book Store, Library Fair).
  - Add `startDate`/`endDate` string fields to `form` state (empty by default).
  - When `form.type === 'fair'`, render two additional required date inputs (Start Date, End Date) between the Type field and the Street field.
  - `saveLocation`'s validation gains: if `form.type === 'fair'`, both dates are required and `endDate >= startDate`, else `setFormError(...)` and return (same pattern as the existing name/street/city checks).
  - `saveLocation` becomes `async`. Instead of building a local object and pushing to `localStorage`, it calls the new `addLibraryLocation(...)` server action directly (Next 14 supports invoking an imported `'use server'` function as a plain async call from a Client Component, same pattern as `saveListing`/`unsaveListing`). On success, the returned row is appended to local `locations` state (so the new pin shows immediately without a full page reload) and the form closes via `cancelAdd()`. On failure, `setFormError` shows the returned error message instead of closing.

### `app/locations/MapView.tsx`

- `LibraryLocation['type']` widens to `'lfl' | 'library' | 'bookstore' | 'fair'`.
- `pinIcon()` gains two new cases:
  - `bookstore`: `{ emoji: '📖', bg: '#2563eb', ring: '#1d4ed8' }` (blue, matching the app's existing blue accents)
  - `fair`: `{ emoji: '🎪', bg: '#db2777', ring: '#be185d' }` (pink, matching the app's existing pink/rose accents)
- The popup's type badge (`loc.type === 'lfl' ? '📚 Little Free Library' : '🏛️ City Library'`) becomes a small lookup covering all four types, and — for `fair` — appends the date range (e.g. "Jun 20 – Jun 22") below the existing description line.

---

## Server Action — `lib/actions/libraryLocations.ts`

New file, `'use server'`. One export, called directly from the client (not via `<form action>`, since the Add Location flow is a client-driven modal tied to map pin state and needs to report validation errors back into the same modal without a page navigation):

```ts
addLibraryLocation(data: {
  name: string
  type: 'lfl' | 'library' | 'bookstore' | 'fair'
  lat: number
  lng: number
  street: string
  city: string
  description: string
  startDate?: string
  endDate?: string
}): Promise<{ ok: true; location: LibraryLocation } | { ok: false; error: string }>
```

- Fetches the current Supabase user; if none, returns `{ ok: false, error: 'Please sign in to add a location.' }` (the client-side `isLoggedIn` gate should prevent reaching this in practice, but the action re-checks — same defense-in-depth as `saveListing`).
- Re-validates name/street/city non-blank and, for `type === 'fair'`, both dates present and `endDate >= startDate` — mirrors the client-side checks so a request that somehow bypasses the client validation still gets a clean error instead of hitting the DB check constraint.
- Inserts the row (`created_by: user.id`, plus all the fields above), returns `{ ok: true, location: <inserted row mapped to LibraryLocation> }` on success or `{ ok: false, error: <message> }` on any Supabase error.

---

## Out of Scope

- The "Report a location" flow — stays exactly as it is today (locally-faked success, nothing persisted, no connection to the Admin → Locations tab).
- Editing an existing location (delete-and-re-add only, no UI provided for that either right now).
- Any admin moderation/approval step before a newly added location appears publicly — it's visible immediately on insert.
- Automatic expiry via a real cron/scheduled job — expiry is opportunistic (checked and cleaned up on each page load), not real-time.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | Add `library_locations` table + RLS (handed to user as SQL to run in Supabase) |
| `lib/actions/libraryLocations.ts` | New file — `addLibraryLocation` |
| `app/locations/page.tsx` | Becomes async server component: expire fairs, fetch locations + `isLoggedIn`, pass to `LocationsClient` |
| `app/locations/LocationsClient.tsx` | Remove mock data/localStorage/distance filter; add type filter; extend Add Location form for fairs; call `addLibraryLocation` |
| `app/locations/MapView.tsx` | Widen `LibraryLocation['type']`; add Book Store/Fair pin styling and popup labels |
