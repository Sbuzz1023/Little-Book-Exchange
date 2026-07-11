# Admin: Edit All Library Locations & Review Location Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Report a location" flow on `/locations` actually persist reports, and give admins real edit/delete control over every `library_locations` row, organized into two Admin → Locations sub-tabs: **All Locations** (browse/filter/edit/delete) and **Reports** (review real reports, resolve by editing, removing, or dismissing).

**Architecture:** A new `location_reports` table backs real report submission and review. `profiles.is_admin` (referenced in code today but missing from the schema) is added along with a trigger that blocks client-driven self-escalation. New admin-only server actions (`editLibraryLocation`, `deleteLibraryLocation`, `resolveLocationReport`) check `is_admin` server-side as defense in depth on top of new RLS policies that enforce the same rule at the database level. The public report modal in `LocationsClient.tsx` gets wired to a new `submitLocationReport` action instead of faking success. A new `app/admin/LocationsAdminTab.tsx` component owns all of the new Admin UI (sub-tab switcher, data fetching, filter/table, edit modal with a reposition mini-map, report review cards) and reports its pending count up to `AdminClient.tsx` for the sidebar badge, replacing the mock `MOCK_REPORTS`/`LocationsTab` it currently renders.

**Tech Stack:** Next.js 14 App Router, React 18, Supabase (`@supabase/ssr` server-side, `@supabase/supabase-js` browser client), Leaflet/`react-leaflet` (already a dependency, reused for the reposition mini-map), Vitest.

## Global Constraints

- `location_reports` and the `profiles.is_admin` / admin-policy additions must match the SQL in Task 1 exactly — do not rename columns, policies, or the `status`/`resolution` check-constraint values (`'pending'|'resolved'` and `'edited'|'removed'|'dismissed'`).
- Every new admin-only server action (`editLibraryLocation`, `deleteLibraryLocation`, `resolveLocationReport`) must call `requireAdmin` first — this is defense in depth; the actual enforcement boundary is the RLS policies added in Task 1.
- `resolveLocationReport` only ever updates the `location_reports` row. It never edits or deletes a location itself — the calling UI sequences `editLibraryLocation`/`deleteLibraryLocation` first, then calls it. Do not merge these into one call.
- Filing a location report requires a signed-in user, same redirect pattern as "Add a Location" (`/auth/signin?redirect=/locations`).
- At the end, hand the user the exact SQL from Task 1 to run in the Supabase SQL editor.

---

## File Structure

- Modify `supabase/schema.sql` — add `profiles.is_admin` + self-escalation guard trigger, `location_reports` table + RLS, admin update/delete policies on `library_locations`.
- Modify `lib/actions/libraryLocations.ts` — extract `validateLocationInput`; add `requireAdmin`, `editLibraryLocation`, `deleteLibraryLocation`.
- Create `lib/actions/validateLocationInput.test.ts` — unit tests for the extracted validator.
- Create `lib/actions/locationReports.ts` — `submitLocationReport`, `resolveLocationReport`.
- Modify `app/locations/LocationsClient.tsx` — gate the report modal behind `isLoggedIn`; wire `sendReport` to `submitLocationReport` with real error handling.
- Create `app/admin/LocationsAdminTab.tsx` — sub-tab switcher, data fetching, All Locations panel (filter + table + edit + delete), Reports panel (review with Edit/Remove/Dismiss), shared edit modal with reposition mini-map.
- Modify `app/admin/AdminClient.tsx` — remove `MOCK_REPORTS`/`LocationsTab`; render `LocationsAdminTab`; thread its pending count into the `Dashboard` stat card and sidebar badge.

---

### Task 1: Schema migration

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `profiles.is_admin`, `location_reports` table shape, and admin RLS policies on `library_locations` that every later task depends on. Not run automatically — handed to the user at the end to paste into the Supabase SQL editor.

- [ ] **Step 1: Append the migration block**

At the end of `supabase/schema.sql` (after the existing "Migration: library locations" block), add:

```sql

-- ── Migration: admin location editing + location reports ─────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Without this, any signed-in user could set their own is_admin to true, since
-- the existing "Users can update own profile" policy allows self-updates to
-- any column. This trigger keeps is_admin unchanged unless the actor making
-- the update is already an admin. auth.uid() is null for direct SQL editor
-- updates (no PostgREST session), so the very first admin grant still works
-- by running an update directly here.
create or replace function prevent_is_admin_self_grant()
returns trigger as $$
begin
  if new.is_admin = true and old.is_admin = false and auth.uid() is not null then
    if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true) then
      new.is_admin := false;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists guard_is_admin_grant on profiles;
create trigger guard_is_admin_grant before update on profiles
  for each row execute procedure prevent_is_admin_self_grant();

create table if not exists location_reports (
  id uuid default gen_random_uuid() primary key,
  location_id uuid references library_locations(id) on delete cascade not null,
  reporter_id uuid references profiles(id) on delete cascade not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  resolution text check (resolution in ('edited', 'removed', 'dismissed')),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz default now()
);

alter table location_reports enable row level security;

create policy "Authenticated users can file reports" on location_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

create policy "Admins can view all reports" on location_reports
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can resolve reports" on location_reports
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can update any location" on library_locations
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can delete any location" on library_locations
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add is_admin, location_reports table, and admin location RLS"
```

---

### Task 2: Extract `validateLocationInput`

**Files:**
- Modify: `lib/actions/libraryLocations.ts`
- Test: `lib/actions/validateLocationInput.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export type AddLocationInput`, `export type AddLocationResult`, `export function validateLocationInput(data: AddLocationInput): string | null`. Task 3 extends this same file and reuses `validateLocationInput`.

- [ ] **Step 1: Write the failing test**

Create `lib/actions/validateLocationInput.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateLocationInput } from './libraryLocations'

const base = {
  name: 'Corner Street LFL',
  type: 'lfl' as const,
  lat: 45.5,
  lng: -122.6,
  street: 'Oak Street',
  city: 'Portland, OR',
  description: '',
}

describe('validateLocationInput', () => {
  it('returns null when all required fields are present', () => {
    expect(validateLocationInput(base)).toBeNull()
  })

  it('requires a name', () => {
    expect(validateLocationInput({ ...base, name: '  ' })).toBe('Library name is required.')
  })

  it('requires a street', () => {
    expect(validateLocationInput({ ...base, street: '' })).toBe('Street is required.')
  })

  it('requires a city', () => {
    expect(validateLocationInput({ ...base, city: '' })).toBe('City is required.')
  })

  it('requires a start date for a fair', () => {
    expect(validateLocationInput({ ...base, type: 'fair', endDate: '2026-07-20' })).toBe('Start date is required for a fair.')
  })

  it('requires an end date for a fair', () => {
    expect(validateLocationInput({ ...base, type: 'fair', startDate: '2026-07-18' })).toBe('End date is required for a fair.')
  })

  it('requires end date on or after start date for a fair', () => {
    expect(validateLocationInput({ ...base, type: 'fair', startDate: '2026-07-20', endDate: '2026-07-18' })).toBe('End date must be on or after the start date.')
  })

  it('accepts a valid fair date range', () => {
    expect(validateLocationInput({ ...base, type: 'fair', startDate: '2026-07-18', endDate: '2026-07-20' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- validateLocationInput`
Expected: FAIL — `validateLocationInput` is not exported from `./libraryLocations`.

- [ ] **Step 3: Replace `lib/actions/libraryLocations.ts`**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import type { LibraryLocation } from '@/app/locations/MapView'

export type AddLocationInput = {
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

export type AddLocationResult =
  | { ok: true; location: LibraryLocation }
  | { ok: false; error: string }

export function validateLocationInput(data: AddLocationInput): string | null {
  if (!data.name.trim())   return 'Library name is required.'
  if (!data.street.trim()) return 'Street is required.'
  if (!data.city.trim())   return 'City is required.'

  if (data.type === 'fair') {
    if (!data.startDate) return 'Start date is required for a fair.'
    if (!data.endDate)   return 'End date is required for a fair.'
    if (data.endDate < data.startDate) return 'End date must be on or after the start date.'
  }

  return null
}

export async function addLibraryLocation(data: AddLocationInput): Promise<AddLocationResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in to add a location.' }

  const validationError = validateLocationInput(data)
  if (validationError) return { ok: false, error: validationError }

  const { data: inserted, error } = await supabase
    .from('library_locations')
    .insert({
      created_by: user.id,
      name: data.name.trim(),
      type: data.type,
      lat: data.lat,
      lng: data.lng,
      street: data.street.trim(),
      city: data.city.trim(),
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- validateLocationInput`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/actions/libraryLocations.ts lib/actions/validateLocationInput.test.ts
git commit -m "feat: extract validateLocationInput from addLibraryLocation"
```

---

### Task 3: `requireAdmin`, `editLibraryLocation`, `deleteLibraryLocation`

**Files:**
- Modify: `lib/actions/libraryLocations.ts`

**Interfaces:**
- Consumes: `AddLocationInput`, `AddLocationResult`, `validateLocationInput` from Task 2; `location_reports`/admin RLS policies from Task 1 (runtime only).
- Produces: `export async function requireAdmin(supabase): Promise<{ ok: true; userId: string } | { ok: false; error: string }>` (imported by Task 4's `locationReports.ts`); `export async function editLibraryLocation(id: string, data: AddLocationInput): Promise<AddLocationResult>` and `export async function deleteLibraryLocation(id: string): Promise<{ ok: true } | { ok: false; error: string }>` (both called by Task 6's `LocationsAdminTab.tsx`).

- [ ] **Step 1: Replace `lib/actions/libraryLocations.ts`**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import type { LibraryLocation } from '@/app/locations/MapView'

export type AddLocationInput = {
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

export type AddLocationResult =
  | { ok: true; location: LibraryLocation }
  | { ok: false; error: string }

export function validateLocationInput(data: AddLocationInput): string | null {
  if (!data.name.trim())   return 'Library name is required.'
  if (!data.street.trim()) return 'Street is required.'
  if (!data.city.trim())   return 'City is required.'

  if (data.type === 'fair') {
    if (!data.startDate) return 'Start date is required for a fair.'
    if (!data.endDate)   return 'End date is required for a fair.'
    if (data.endDate < data.startDate) return 'End date must be on or after the start date.'
  }

  return null
}

type AdminCheck =
  | { ok: true; userId: string }
  | { ok: false; error: string }

export async function requireAdmin(supabase: ReturnType<typeof createClient>): Promise<AdminCheck> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) return { ok: false, error: 'Not authorized.' }
  return { ok: true, userId: user.id }
}

function mapRow(row: {
  id: string
  name: string
  type: 'lfl' | 'library' | 'bookstore' | 'fair'
  lat: number
  lng: number
  street: string
  city: string
  description: string | null
  start_date: string | null
  end_date: string | null
}): LibraryLocation {
  return {
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
  }
}

export async function addLibraryLocation(data: AddLocationInput): Promise<AddLocationResult> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in to add a location.' }

  const validationError = validateLocationInput(data)
  if (validationError) return { ok: false, error: validationError }

  const { data: inserted, error } = await supabase
    .from('library_locations')
    .insert({
      created_by: user.id,
      name: data.name.trim(),
      type: data.type,
      lat: data.lat,
      lng: data.lng,
      street: data.street.trim(),
      city: data.city.trim(),
      description: data.description.trim(),
      start_date: data.type === 'fair' ? data.startDate : null,
      end_date: data.type === 'fair' ? data.endDate : null,
    })
    .select('id, name, type, lat, lng, street, city, description, start_date, end_date')
    .single()

  if (error || !inserted) return { ok: false, error: error?.message ?? 'Could not save location.' }

  return { ok: true, location: mapRow(inserted) }
}

export async function editLibraryLocation(id: string, data: AddLocationInput): Promise<AddLocationResult> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const validationError = validateLocationInput(data)
  if (validationError) return { ok: false, error: validationError }

  const { data: updated, error } = await supabase
    .from('library_locations')
    .update({
      name: data.name.trim(),
      type: data.type,
      lat: data.lat,
      lng: data.lng,
      street: data.street.trim(),
      city: data.city.trim(),
      description: data.description.trim(),
      start_date: data.type === 'fair' ? data.startDate : null,
      end_date: data.type === 'fair' ? data.endDate : null,
    })
    .eq('id', id)
    .select('id, name, type, lat, lng, street, city, description, start_date, end_date')
    .single()

  if (error || !updated) return { ok: false, error: error?.message ?? 'Could not update location.' }

  return { ok: true, location: mapRow(updated) }
}

export async function deleteLibraryLocation(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { error } = await supabase.from('library_locations').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 2: Run the existing unit tests to make sure nothing broke**

Run: `npm run test:run -- validateLocationInput`
Expected: PASS (8 tests, unchanged from Task 2).

- [ ] **Step 3: Commit**

```bash
git add lib/actions/libraryLocations.ts
git commit -m "feat: add requireAdmin, editLibraryLocation, deleteLibraryLocation"
```

(Type-checking this file in isolation is fine on its own — it has no dependency on files not yet created.)

---

### Task 4: `lib/actions/locationReports.ts`

**Files:**
- Create: `lib/actions/locationReports.ts`

**Interfaces:**
- Consumes: `requireAdmin` from Task 3.
- Produces: `export async function submitLocationReport(locationId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }>` (called by Task 5's `LocationsClient.tsx`); `export async function resolveLocationReport(reportId: string, resolution: 'edited' | 'removed' | 'dismissed'): Promise<{ ok: true } | { ok: false; error: string }>` (called by Task 6's `LocationsAdminTab.tsx`).

- [ ] **Step 1: Write the file**

Create `lib/actions/locationReports.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

export async function submitLocationReport(locationId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in to report a location.' }

  const trimmedReason = reason.trim()
  if (!trimmedReason) return { ok: false, error: 'Please describe the issue.' }

  const { error } = await supabase
    .from('location_reports')
    .insert({ location_id: locationId, reporter_id: user.id, reason: trimmedReason })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function resolveLocationReport(
  reportId: string,
  resolution: 'edited' | 'removed' | 'dismissed'
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { error } = await supabase
    .from('location_reports')
    .update({
      status: 'resolved',
      resolution,
      resolved_by: admin.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/actions/locationReports.ts
git commit -m "feat: add submitLocationReport and resolveLocationReport server actions"
```

---

### Task 5: Wire the public report modal to `submitLocationReport`

**Files:**
- Modify: `app/locations/LocationsClient.tsx`

**Interfaces:**
- Consumes: `submitLocationReport` from Task 4.
- Produces: nothing consumed by later tasks — this is the last change to the public-facing page in this feature.

- [ ] **Step 1: Import the new action**

In `app/locations/LocationsClient.tsx`, change:

```ts
import { addLibraryLocation } from '@/lib/actions/libraryLocations'
```

to:

```ts
import { addLibraryLocation } from '@/lib/actions/libraryLocations'
import { submitLocationReport } from '@/lib/actions/locationReports'
```

- [ ] **Step 2: Add a `reportSending`/`reportError` state and a login-gated open function**

Change:

```ts
  // Report state
  const [reportTarget, setReportTarget] = useState<LibraryLocation | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportSent, setReportSent] = useState(false)
```

to:

```ts
  // Report state
  const [reportTarget, setReportTarget] = useState<LibraryLocation | null>(null)
  const [reportReason, setReportReason] = useState('')
  const [reportSent, setReportSent] = useState(false)
  const [reportSending, setReportSending] = useState(false)
  const [reportError, setReportError] = useState('')
```

- [ ] **Step 3: Gate opening the report modal behind login, and make `sendReport` real**

Change:

```ts
  function sendReport() {
    setReportSent(true)
    setTimeout(() => { setReportTarget(null); setReportReason(''); setReportSent(false) }, 2200)
  }
```

to:

```ts
  function openReport(loc: LibraryLocation) {
    if (!isLoggedIn) {
      window.location.href = '/auth/signin?redirect=/locations'
      return
    }
    setReportError('')
    setReportTarget(loc)
  }

  async function sendReport() {
    if (!reportTarget) return
    setReportSending(true)
    const result = await submitLocationReport(reportTarget.id, reportReason)
    setReportSending(false)
    if (!result.ok) { setReportError(result.error); return }
    setReportSent(true)
    setTimeout(() => { setReportTarget(null); setReportReason(''); setReportSent(false) }, 2200)
  }
```

- [ ] **Step 4: Use `openReport` instead of `setReportTarget` at both call sites**

Change:

```tsx
                  {filteredLocations.map(loc => (
                    <LocationCard key={loc.id} loc={loc} userCoords={userCoords} onReport={setReportTarget} onSelect={selectLocation} />
                  ))}
```

to:

```tsx
                  {filteredLocations.map(loc => (
                    <LocationCard key={loc.id} loc={loc} userCoords={userCoords} onReport={openReport} onSelect={selectLocation} />
                  ))}
```

Change:

```tsx
            <MapView
              locations={filteredLocations}
              pendingPin={pendingPin}
              flyTo={flyTo}
              addMode={addMode}
              onMapClick={handleMapClick}
              onReport={setReportTarget}
              onBoundsChange={setMapBounds}
            />
```

to:

```tsx
            <MapView
              locations={filteredLocations}
              pendingPin={pendingPin}
              flyTo={flyTo}
              addMode={addMode}
              onMapClick={handleMapClick}
              onReport={openReport}
              onBoundsChange={setMapBounds}
            />
```

- [ ] **Step 5: Show the error and a sending state in the modal**

Change:

```tsx
                <p className="text-[#bbb] text-[12px] font-semibold mb-4">📬 Our team reviews requests within 1–3 business days.</p>
                <div className="flex gap-3">
                  <button onClick={() => { setReportTarget(null); setReportReason('') }}
                    className="flex-1 border-2 border-[#e5e7eb] rounded-xl py-3 font-extrabold text-[14px] text-[#888]">Cancel</button>
                  <button onClick={sendReport} disabled={!reportReason.trim()}
                    className="flex-1 bg-bk-orange text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c] disabled:opacity-50 disabled:shadow-none">
                    Send Request
                  </button>
                </div>
```

to:

```tsx
                <p className="text-[#bbb] text-[12px] font-semibold mb-4">📬 Our team reviews requests within 1–3 business days.</p>
                {reportError && <p className="text-red-500 font-bold text-[13px] mb-3">⚠️ {reportError}</p>}
                <div className="flex gap-3">
                  <button onClick={() => { setReportTarget(null); setReportReason(''); setReportError('') }}
                    className="flex-1 border-2 border-[#e5e7eb] rounded-xl py-3 font-extrabold text-[14px] text-[#888]">Cancel</button>
                  <button onClick={sendReport} disabled={!reportReason.trim() || reportSending}
                    className="flex-1 bg-bk-orange text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c] disabled:opacity-50 disabled:shadow-none">
                    {reportSending ? 'Sending…' : 'Send Request'}
                  </button>
                </div>
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors in `app/locations/LocationsClient.tsx`.

- [ ] **Step 7: Commit**

```bash
git add app/locations/LocationsClient.tsx
git commit -m "feat: gate location reports behind login and persist them"
```

---

### Task 6: `app/admin/LocationsAdminTab.tsx`

**Files:**
- Create: `app/admin/LocationsAdminTab.tsx`

**Interfaces:**
- Consumes: `editLibraryLocation`, `deleteLibraryLocation` from Task 3; `resolveLocationReport` from Task 4; `MapView` from `@/app/locations/MapView` (unchanged).
- Produces: `export default function LocationsAdminTab({ onPendingCountChange: (n: number) => void })`. Task 7 renders this in place of the removed `LocationsTab`.

- [ ] **Step 1: Write the file**

Create `app/admin/LocationsAdminTab.tsx`:

```tsx
'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/client'
import { editLibraryLocation, deleteLibraryLocation } from '@/lib/actions/libraryLocations'
import { resolveLocationReport } from '@/lib/actions/locationReports'

const MapView = dynamic(() => import('@/app/locations/MapView'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#e8f4ea] font-bold text-[13px] text-[#888]">
      Loading map…
    </div>
  ),
})

type LocType = 'lfl' | 'library' | 'bookstore' | 'fair'

type AdminLocation = {
  id: string
  name: string
  type: LocType
  lat: number
  lng: number
  street: string
  city: string
  description: string
  startDate: string | null
  endDate: string | null
}

type Report = {
  id: string
  locationId: string
  locationName: string
  locationType: LocType
  street: string
  city: string
  reason: string
  reporter: string
  date: string
  status: 'pending' | 'resolved'
  resolution: 'edited' | 'removed' | 'dismissed' | null
}

const TYPE_META: Record<LocType, { emoji: string; label: string; color: string; bg: string }> = {
  lfl:       { emoji: '📚', label: 'LFL',       color: '#f97316', bg: '#fff7ed' },
  library:   { emoji: '🏛️', label: 'Library',   color: '#0d9488', bg: '#ecfdf5' },
  bookstore: { emoji: '📖', label: 'Bookstore', color: '#2563eb', bg: '#eff6ff' },
  fair:      { emoji: '🎪', label: 'Fair',      color: '#db2777', bg: '#fdf2f8' },
}

const TYPE_OPTIONS: { val: 'all' | LocType; label: string; emoji: string }[] = [
  { val: 'all',       label: 'All',       emoji: '' },
  { val: 'lfl',       label: 'LFL',       emoji: '📚' },
  { val: 'library',   label: 'Library',   emoji: '🏛️' },
  { val: 'bookstore', label: 'Bookstore', emoji: '📖' },
  { val: 'fair',      label: 'Fair',      emoji: '🎪' },
]

type EditForm = {
  name: string
  type: LocType
  street: string
  city: string
  description: string
  startDate: string
  endDate: string
  lat: number
  lng: number
}

function toEditForm(loc: AdminLocation): EditForm {
  return {
    name: loc.name,
    type: loc.type,
    street: loc.street,
    city: loc.city,
    description: loc.description,
    startDate: loc.startDate ?? '',
    endDate: loc.endDate ?? '',
    lat: loc.lat,
    lng: loc.lng,
  }
}

export default function LocationsAdminTab({ onPendingCountChange }: { onPendingCountChange: (n: number) => void }) {
  const [subTab, setSubTab] = useState<'all' | 'reports'>('all')
  const [locations, setLocations] = useState<AdminLocation[]>([])
  const [reports, setReports] = useState<Report[]>([])

  const [typeFilter, setTypeFilter] = useState<'all' | LocType>('all')
  const [citySearch, setCitySearch] = useState('')

  const [editTarget, setEditTarget] = useState<AdminLocation | null>(null)
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editReportId, setEditReportId] = useState<string | null>(null)
  const [editError, setEditError] = useState('')
  const [editFlyNonce, setEditFlyNonce] = useState(0)

  const pendingCountRef = useRef(onPendingCountChange)
  pendingCountRef.current = onPendingCountChange

  useEffect(() => {
    const supabase = createClient()

    supabase
      .from('library_locations')
      .select('id, name, type, lat, lng, street, city, description, start_date, end_date')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        setLocations(data.map(row => ({
          id: row.id,
          name: row.name,
          type: row.type,
          lat: row.lat,
          lng: row.lng,
          street: row.street,
          city: row.city,
          description: row.description || '',
          startDate: row.start_date,
          endDate: row.end_date,
        })))
      })

    supabase
      .from('location_reports')
      .select('id, location_id, reason, status, resolution, created_at, library_locations(name, type, street, city), profiles(username, email)')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return
        const mapped: Report[] = (data as any[]).map(row => ({
          id: row.id,
          locationId: row.location_id,
          locationName: row.library_locations?.name ?? 'Deleted location',
          locationType: row.library_locations?.type ?? 'lfl',
          street: row.library_locations?.street ?? '',
          city: row.library_locations?.city ?? '',
          reason: row.reason,
          reporter: row.profiles?.username || row.profiles?.email || 'Unknown',
          date: row.created_at ? row.created_at.slice(0, 10) : '',
          status: row.status,
          resolution: row.resolution,
        }))
        setReports(mapped)
        pendingCountRef.current(mapped.filter(r => r.status === 'pending').length)
      })
  }, [])

  const filteredLocations = useMemo(() => {
    let result = locations
    if (typeFilter !== 'all') result = result.filter(l => l.type === typeFilter)
    if (citySearch.trim()) {
      const q = citySearch.trim().toLowerCase()
      result = result.filter(l => l.city.toLowerCase().includes(q))
    }
    return result
  }, [locations, typeFilter, citySearch])

  const pending = reports.filter(r => r.status === 'pending')
  const resolved = reports.filter(r => r.status !== 'pending')

  function openEdit(loc: AdminLocation, reportId?: string) {
    setEditTarget(loc)
    setEditForm(toEditForm(loc))
    setEditReportId(reportId ?? null)
    setEditError('')
    setEditFlyNonce(n => n + 1)
  }

  function closeEdit() {
    setEditTarget(null)
    setEditForm(null)
    setEditReportId(null)
    setEditError('')
  }

  function handleReposition(lat: number, lng: number) {
    setEditForm(f => f && ({ ...f, lat, lng }))
  }

  async function saveEdit() {
    if (!editTarget || !editForm) return

    const result = await editLibraryLocation(editTarget.id, {
      name: editForm.name.trim(),
      type: editForm.type,
      lat: editForm.lat,
      lng: editForm.lng,
      street: editForm.street.trim(),
      city: editForm.city.trim(),
      description: editForm.description.trim(),
      startDate: editForm.type === 'fair' ? editForm.startDate : undefined,
      endDate: editForm.type === 'fair' ? editForm.endDate : undefined,
    })

    if (!result.ok) { setEditError(result.error); return }

    const updated: AdminLocation = {
      id: result.location.id,
      name: result.location.name,
      type: result.location.type,
      lat: result.location.lat,
      lng: result.location.lng,
      street: result.location.street,
      city: result.location.city,
      description: result.location.description ?? '',
      startDate: result.location.startDate ?? null,
      endDate: result.location.endDate ?? null,
    }
    setLocations(prev => prev.map(l => l.id === updated.id ? updated : l))

    if (editReportId) {
      await resolveLocationReport(editReportId, 'edited')
      setReports(prev => {
        const next = prev.map(r => r.id === editReportId ? { ...r, status: 'resolved' as const, resolution: 'edited' as const } : r)
        pendingCountRef.current(next.filter(r => r.status === 'pending').length)
        return next
      })
    }

    closeEdit()
  }

  async function handleDelete(loc: AdminLocation, reportId?: string) {
    if (!window.confirm(`Delete "${loc.name}"? This cannot be undone.`)) return

    const result = await deleteLibraryLocation(loc.id)
    if (!result.ok) { alert(result.error); return }

    setLocations(prev => prev.filter(l => l.id !== loc.id))

    if (reportId) {
      await resolveLocationReport(reportId, 'removed')
    }

    setReports(prev => {
      // Deleting a location cascades away every report about it in the
      // database — mirror that locally, except keep (and mark resolved)
      // the specific report this delete was resolving, if any.
      const next = prev
        .filter(r => r.locationId !== loc.id || r.id === reportId)
        .map(r => r.id === reportId ? { ...r, status: 'resolved' as const, resolution: 'removed' as const } : r)
      pendingCountRef.current(next.filter(r => r.status === 'pending').length)
      return next
    })
  }

  async function handleDismiss(report: Report) {
    const result = await resolveLocationReport(report.id, 'dismissed')
    if (!result.ok) { alert(result.error); return }
    setReports(prev => {
      const next = prev.map(r => r.id === report.id ? { ...r, status: 'resolved' as const, resolution: 'dismissed' as const } : r)
      pendingCountRef.current(next.filter(r => r.status === 'pending').length)
      return next
    })
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {(['all', 'reports'] as const).map(t => (
          <button key={t} onClick={() => setSubTab(t)}
            className={`px-4 py-2 rounded-full font-extrabold text-[13px] border-2 transition-colors ${subTab === t ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b] hover:border-bk-orange'}`}>
            {t === 'all' ? `📍 All Locations (${locations.length})` : `🚩 Reports (${pending.length} pending)`}
          </button>
        ))}
      </div>

      {subTab === 'all' ? (
        <AllLocationsPanel
          locations={filteredLocations}
          typeFilter={typeFilter} setTypeFilter={setTypeFilter}
          citySearch={citySearch} setCitySearch={setCitySearch}
          onEdit={loc => openEdit(loc)}
          onDelete={loc => handleDelete(loc)}
        />
      ) : (
        <ReportsPanel
          pending={pending} resolved={resolved}
          onEdit={report => {
            const loc = locations.find(l => l.id === report.locationId)
            if (loc) openEdit(loc, report.id)
          }}
          onRemove={report => {
            const loc = locations.find(l => l.id === report.locationId)
            if (loc) handleDelete(loc, report.id)
          }}
          onDismiss={handleDismiss}
        />
      )}

      {editTarget && editForm && (
        <EditLocationModal
          form={editForm} setForm={setEditForm}
          error={editError}
          flyNonce={editFlyNonce}
          onCancel={closeEdit}
          onSave={saveEdit}
          onReposition={handleReposition}
        />
      )}
    </div>
  )
}

function AllLocationsPanel({ locations, typeFilter, setTypeFilter, citySearch, setCitySearch, onEdit, onDelete }: {
  locations: AdminLocation[]
  typeFilter: 'all' | LocType
  setTypeFilter: (t: 'all' | LocType) => void
  citySearch: string
  setCitySearch: (s: string) => void
  onEdit: (loc: AdminLocation) => void
  onDelete: (loc: AdminLocation) => void
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {TYPE_OPTIONS.map(opt => (
          <button key={opt.val} onClick={() => setTypeFilter(opt.val)}
            className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${typeFilter === opt.val ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b] hover:border-bk-orange'}`}>
            {opt.emoji ? `${opt.emoji} ` : ''}{opt.label}
          </button>
        ))}
        <input
          value={citySearch}
          onChange={e => setCitySearch(e.target.value)}
          placeholder="Filter by city…"
          className="border-2 border-[#e2e8f0] rounded-xl px-3 py-1.5 font-bold text-[13px] focus:outline-none focus:border-bk-orange ml-auto w-[200px]"
        />
      </div>

      <div className="bg-white rounded-2xl border border-[#f1f5f9] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#f1f5f9] bg-[#f8fafc]">
                {['Name', 'Type', 'Street', 'City', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-extrabold text-[#94a3b8] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {locations.map(loc => {
                const meta = TYPE_META[loc.type]
                return (
                  <tr key={loc.id} className="border-b border-[#f8fafc] hover:bg-[#fafafa] transition-colors">
                    <td className="px-4 py-3 font-black text-[13px] text-[#1e293b]">{loc.name}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: meta.bg, color: meta.color }}>
                        {meta.emoji} {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] font-semibold text-[#64748b] whitespace-nowrap">{loc.street}</td>
                    <td className="px-4 py-3 text-[12px] font-semibold text-[#64748b] whitespace-nowrap">{loc.city}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => onEdit(loc)} className="text-[12px] font-bold text-bk-orange hover:underline whitespace-nowrap">Edit ✏️</button>
                        <button onClick={() => onDelete(loc)} className="text-[12px] font-bold text-red-500 hover:underline whitespace-nowrap">Delete 🗑️</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {locations.length === 0 && (
            <div className="py-12 text-center text-[#94a3b8] font-bold text-[14px]">No locations match this filter</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ReportsPanel({ pending, resolved, onEdit, onRemove, onDismiss }: {
  pending: Report[]
  resolved: Report[]
  onEdit: (r: Report) => void
  onRemove: (r: Report) => void
  onDismiss: (r: Report) => void
}) {
  const RESOLUTION_LABEL: Record<NonNullable<Report['resolution']>, string> = {
    edited: 'Edited', removed: 'Removed', dismissed: 'Dismissed',
  }
  const RESOLUTION_COLOR: Record<NonNullable<Report['resolution']>, string> = {
    edited: '#f97316', removed: '#dc2626', dismissed: '#059669',
  }

  return (
    <div>
      {pending.length === 0 && (
        <div className="bg-white rounded-2xl border border-[#f1f5f9] p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="font-black text-[16px] text-[#1e293b]">All reports resolved</p>
          <p className="font-semibold text-[13px] text-[#94a3b8] mt-1">No pending location reports.</p>
        </div>
      )}

      <div className="space-y-4">
        {pending.map(r => {
          const meta = TYPE_META[r.locationType]
          return (
            <div key={r.id} className="bg-white rounded-2xl border border-[#f1f5f9] shadow-sm overflow-hidden">
              <div className="px-5 py-3 flex items-center gap-3 border-b border-[#f1f5f9]" style={{ background: meta.bg }}>
                <span className="text-xl">{meta.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-black text-[14px] text-[#1e293b]">{r.locationName}</div>
                  <div className="text-[12px] font-semibold text-[#64748b]">{r.street}, {r.city} · {meta.label}</div>
                </div>
                <span className="text-[11px] font-bold text-[#94a3b8] shrink-0">{r.date}</span>
              </div>
              <div className="px-5 py-4">
                <div className="text-[12px] font-extrabold text-[#94a3b8] uppercase tracking-wide mb-1">Report from {r.reporter}</div>
                <p className="font-semibold text-[14px] text-[#334155] leading-relaxed mb-4">"{r.reason}"</p>
                <div className="flex gap-3 flex-wrap">
                  <button onClick={() => onEdit(r)}
                    className="flex-1 min-w-[120px] bg-[#fff7ed] text-[#c2410c] border-2 border-[#fed7aa] rounded-xl py-2.5 font-extrabold text-[13px] hover:bg-orange-100 transition-colors">
                    ✏️ Edit Location
                  </button>
                  <button onClick={() => onRemove(r)}
                    className="flex-1 min-w-[120px] bg-[#fef2f2] text-[#dc2626] border-2 border-[#fecaca] rounded-xl py-2.5 font-extrabold text-[13px] hover:bg-red-100 transition-colors">
                    🗑️ Remove Location
                  </button>
                  <button onClick={() => onDismiss(r)}
                    className="flex-1 min-w-[120px] bg-[#f0fdf4] text-[#059669] border-2 border-[#bbf7d0] rounded-xl py-2.5 font-extrabold text-[13px] hover:bg-green-100 transition-colors">
                    ✓ Dismiss
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {resolved.length > 0 && (
        <div className="mt-8">
          <h3 className="font-black text-[14px] text-[#94a3b8] uppercase tracking-wide mb-3">Resolved</h3>
          <div className="space-y-2">
            {resolved.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-[#f1f5f9] px-4 py-3 flex items-center gap-3">
                <span className="text-[17px]">{TYPE_META[r.locationType].emoji}</span>
                <div className="flex-1">
                  <span className="font-bold text-[13px] text-[#334155]">{r.locationName}</span>
                  <span className="text-[12px] text-[#94a3b8] font-semibold ml-2">{r.city}</span>
                </div>
                {r.resolution && (
                  <span className="text-[11px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: RESOLUTION_COLOR[r.resolution] + '18', color: RESOLUTION_COLOR[r.resolution] }}>
                    {RESOLUTION_LABEL[r.resolution]}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function EditLocationModal({ form, setForm, error, flyNonce, onCancel, onSave, onReposition }: {
  form: EditForm
  setForm: React.Dispatch<React.SetStateAction<EditForm | null>>
  error: string
  flyNonce: number
  onCancel: () => void
  onSave: () => void
  onReposition: (lat: number, lng: number) => void
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-3xl w-full max-w-[520px] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-[20px] text-[#1e293b]">Edit Location</h2>
          <button onClick={onCancel} className="text-[#94a3b8] hover:text-[#475569] text-[22px] font-black leading-none">×</button>
        </div>

        <div className="space-y-3 mb-4">
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Name</label>
            <input value={form.name} onChange={e => setForm(f => f && ({ ...f, name: e.target.value }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Type</label>
            <select value={form.type} onChange={e => setForm(f => f && ({ ...f, type: e.target.value as LocType }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange bg-white">
              <option value="lfl">📚 Little Free Library</option>
              <option value="library">🏛️ Public Library</option>
              <option value="bookstore">📖 Book Store</option>
              <option value="fair">🎪 Library Fair</option>
            </select>
          </div>
          {form.type === 'fair' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Start Date</label>
                <input type="date" value={form.startDate} onChange={e => setForm(f => f && ({ ...f, startDate: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">End Date</label>
                <input type="date" value={form.endDate} onChange={e => setForm(f => f && ({ ...f, endDate: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
            </div>
          )}
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Street</label>
            <input value={form.street} onChange={e => setForm(f => f && ({ ...f, street: e.target.value }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">City</label>
            <input value={form.city} onChange={e => setForm(f => f && ({ ...f, city: e.target.value }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Description</label>
            <input value={form.description} onChange={e => setForm(f => f && ({ ...f, description: e.target.value }))}
              className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[14px] focus:outline-none focus:border-bk-orange" />
          </div>
          <div>
            <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">
              Position <span className="font-semibold text-[#94a3b8] normal-case">— click the map to move the pin</span>
            </label>
            <div className="h-[220px] rounded-xl overflow-hidden border-2 border-[#e2e8f0]">
              <MapView
                locations={[]}
                pendingPin={[form.lat, form.lng]}
                flyTo={{ center: [form.lat, form.lng], zoom: 15, nonce: flyNonce }}
                addMode={true}
                onMapClick={onReposition}
                onReport={() => {}}
                onBoundsChange={() => {}}
              />
            </div>
            <p className="text-[11px] font-semibold text-[#94a3b8] mt-1">{form.lat.toFixed(4)}°, {form.lng.toFixed(4)}°</p>
          </div>
        </div>

        {error && <p className="text-red-500 font-bold text-[13px] mb-3">⚠️ {error}</p>}

        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 border-2 border-[#e2e8f0] rounded-xl py-3 font-extrabold text-[14px] text-[#64748b]">Cancel</button>
          <button onClick={onSave}
            className="flex-1 bg-bk-orange text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c]">Save Changes</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/admin/LocationsAdminTab.tsx
git commit -m "feat: add LocationsAdminTab with All Locations and Reports sub-tabs"
```

(This file imports `MapView` and the two new server actions, all already present from earlier tasks — it type-checks standalone. It isn't rendered anywhere yet; Task 7 wires it in.)

---

### Task 7: Wire `LocationsAdminTab` into `AdminClient.tsx`

**Files:**
- Modify: `app/admin/AdminClient.tsx`

**Interfaces:**
- Consumes: `LocationsAdminTab` from Task 6.
- Produces: nothing consumed by later tasks — final task in this plan.

- [ ] **Step 1: Import the new component**

Change:

```ts
'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
```

to:

```ts
'use client'
import { useState, useEffect, useMemo, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import LocationsAdminTab from './LocationsAdminTab'
```

- [ ] **Step 2: Remove `MOCK_REPORTS`**

Change:

```ts
const MOCK_REPORTS = [
  { id:'rp1', locationName:'Hawthorne LFL',       city:'Portland, OR',  type:'lfl',     reason:'This library was removed last month — the host moved away.',        reporter:'sarah@example.com', date:'2024-06-20', status:'pending' },
  { id:'rp2', locationName:'Harold Washington Library', city:'Chicago, IL', type:'library', reason:'Address listed is incorrect. The entrance is on State St not Wabash.', reporter:'priya@example.com', date:'2024-06-21', status:'pending' },
  { id:'rp3', locationName:'Park Slope LFL',       city:'Brooklyn, NY',  type:'lfl',     reason:'The little library was damaged by a car and is being repaired.',    reporter:'maria@example.com', date:'2024-06-22', status:'pending' },
  { id:'rp4', locationName:'Capitol Hill LFL',     city:'Seattle, WA',   type:'lfl',     reason:'Moved two blocks east — new location is on Summit Ave.',            reporter:'james@example.com', date:'2024-06-23', status:'pending' },
]

const MOCK_REVIEWS = [
```

to:

```ts
const MOCK_REVIEWS = [
```

- [ ] **Step 3: Remove the `Report` type alias**

Change:

```ts
type Report = typeof MOCK_REPORTS[0]
type Review = typeof MOCK_REVIEWS[0]
```

to:

```ts
type Review = typeof MOCK_REVIEWS[0]
```

- [ ] **Step 4: Update `Dashboard`'s props**

Change:

```ts
function Dashboard({ users, reports, reviews }: { users: User[]; reports: Report[]; reviews: Review[] }) {
  const totalCredits = users.reduce((s, u) => s + u.credits, 0)
  const totalBooks   = users.reduce((s, u) => s + u.booksPosted, 0)
  const totalTrades  = users.reduce((s, u) => s + u.booksSold, 0)
  const pendingReports = reports.filter(r => r.status === 'pending').length
  const flaggedReviews = reviews.filter(r => r.flagged).length
```

to:

```ts
function Dashboard({ users, pendingLocationReports, reviews }: { users: User[]; pendingLocationReports: number; reviews: Review[] }) {
  const totalCredits = users.reduce((s, u) => s + u.credits, 0)
  const totalBooks   = users.reduce((s, u) => s + u.booksPosted, 0)
  const totalTrades  = users.reduce((s, u) => s + u.booksSold, 0)
  const pendingReports = pendingLocationReports
  const flaggedReviews = reviews.filter(r => r.flagged).length
```

- [ ] **Step 5: Remove the entire `LocationsTab` function**

Delete this whole block (the "Location reports tab" section, from its header comment through the closing brace right before the "Reviews tab" comment):

```ts
// ─── Location reports tab ────────────────────────────────────────────────────

function LocationsTab({ reports, setReports }: { reports: Report[]; setReports: React.Dispatch<React.SetStateAction<Report[]>> }) {
  const [done, setDone] = useState<string[]>([])

  function resolve(id: string, action: 'approved' | 'dismissed') {
    setReports(prev => prev.map(r => r.id === id ? { ...r, status: action } : r))
    setDone(d => [...d, id])
  }

  const pending   = reports.filter(r => r.status === 'pending')
  const resolved  = reports.filter(r => r.status !== 'pending')

  return (
    <div>
      <h2 className="font-display text-[22px] text-[#1e293b] mb-4">
        Location Reports <span className="text-[#94a3b8] font-bold text-[16px] ml-1">({pending.length} pending)</span>
      </h2>

      {pending.length === 0 && (
        <div className="bg-white rounded-2xl border border-[#f1f5f9] p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <p className="font-black text-[16px] text-[#1e293b]">All reports resolved</p>
          <p className="font-semibold text-[13px] text-[#94a3b8] mt-1">No pending location reports.</p>
        </div>
      )}

      <div className="space-y-4">
        {pending.map(r => (
          <div key={r.id} className="bg-white rounded-2xl border border-[#f1f5f9] shadow-sm overflow-hidden">
            <div className={`px-5 py-3 flex items-center gap-3 border-b border-[#f1f5f9] ${r.type === 'lfl' ? 'bg-[#fff7ed]' : 'bg-[#ecfdf5]'}`}>
              <span className="text-xl">{r.type === 'lfl' ? '📚' : '🏛️'}</span>
              <div className="flex-1 min-w-0">
                <div className="font-black text-[14px] text-[#1e293b]">{r.locationName}</div>
                <div className="text-[12px] font-semibold text-[#64748b]">{r.city} · {r.type === 'lfl' ? 'Little Free Library' : 'Public Library'}</div>
              </div>
              <span className="text-[11px] font-bold text-[#94a3b8] shrink-0">{r.date}</span>
            </div>
            <div className="px-5 py-4">
              <div className="text-[12px] font-extrabold text-[#94a3b8] uppercase tracking-wide mb-1">Report from {r.reporter}</div>
              <p className="font-semibold text-[14px] text-[#334155] leading-relaxed mb-4">"{r.reason}"</p>
              <div className="flex gap-3">
                <button onClick={() => resolve(r.id, 'approved')}
                  className="flex-1 bg-[#fef2f2] text-[#dc2626] border-2 border-[#fecaca] rounded-xl py-2.5 font-extrabold text-[13px] hover:bg-red-100 transition-colors">
                  🗑️ Remove Location
                </button>
                <button onClick={() => resolve(r.id, 'dismissed')}
                  className="flex-1 bg-[#f0fdf4] text-[#059669] border-2 border-[#bbf7d0] rounded-xl py-2.5 font-extrabold text-[13px] hover:bg-green-100 transition-colors">
                  ✓ Dismiss Report
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {resolved.length > 0 && (
        <div className="mt-8">
          <h3 className="font-black text-[14px] text-[#94a3b8] uppercase tracking-wide mb-3">Resolved</h3>
          <div className="space-y-2">
            {resolved.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-[#f1f5f9] px-4 py-3 flex items-center gap-3">
                <span className="text-[17px]">{r.type === 'lfl' ? '📚' : '🏛️'}</span>
                <div className="flex-1">
                  <span className="font-bold text-[13px] text-[#334155]">{r.locationName}</span>
                  <span className="text-[12px] text-[#94a3b8] font-semibold ml-2">{r.city}</span>
                </div>
                <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full ${r.status === 'approved' ? 'bg-[#fef2f2] text-[#dc2626]' : 'bg-[#f0fdf4] text-[#059669]'}`}>
                  {r.status === 'approved' ? 'Removed' : 'Dismissed'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Reviews tab ─────────────────────────────────────────────────────────────
```

Replace it with just:

```ts
// ─── Reviews tab ─────────────────────────────────────────────────────────────
```

- [ ] **Step 6: Replace the `reports` state with `pendingLocationReports`**

Change:

```ts
  const [users, setUsers] = useState<User[]>([])
  const [reports, setReports] = useState(MOCK_REPORTS)
  const [reviews, setReviews] = useState(MOCK_REVIEWS)
```

to:

```ts
  const [users, setUsers] = useState<User[]>([])
  const [pendingLocationReports, setPendingLocationReports] = useState(0)
  const [reviews, setReviews] = useState(MOCK_REVIEWS)
```

- [ ] **Step 7: Update the sidebar badge computation**

Change:

```ts
  const pendingReports = reports.filter(r => r.status === 'pending').length
  const flaggedReviews = reviews.filter(r => r.flagged).length

  function badge(id: Tab) {
    if (id === 'locations') return pendingReports
    if (id === 'reviews') return flaggedReviews
    return 0
  }
```

to:

```ts
  const flaggedReviews = reviews.filter(r => r.flagged).length

  function badge(id: Tab) {
    if (id === 'locations') return pendingLocationReports
    if (id === 'reviews') return flaggedReviews
    return 0
  }
```

- [ ] **Step 8: Update the tab render**

Change:

```tsx
          {tab === 'dashboard' && <Dashboard users={users} reports={reports} reviews={reviews} />}
          {tab === 'users'     && <UsersTab users={users} setUsers={setUsers} toggleAdmin={toggleAdmin} />}
          {tab === 'locations' && <LocationsTab reports={reports} setReports={setReports} />}
          {tab === 'reviews'   && <ReviewsTab reviews={reviews} setReviews={setReviews} />}
```

to:

```tsx
          {tab === 'dashboard' && <Dashboard users={users} pendingLocationReports={pendingLocationReports} reviews={reviews} />}
          {tab === 'users'     && <UsersTab users={users} setUsers={setUsers} toggleAdmin={toggleAdmin} />}
          {tab === 'locations' && <LocationsAdminTab onPendingCountChange={setPendingLocationReports} />}
          {tab === 'reviews'   && <ReviewsTab reviews={reviews} setReviews={setReviews} />}
```

- [ ] **Step 9: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors in `app/admin/*`.

- [ ] **Step 10: Verify the app builds**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 11: Commit**

```bash
git add app/admin/AdminClient.tsx
git commit -m "feat: replace mock location reports with real admin review + edit"
```

---

## Full Test Suite Check

- [ ] Run: `npm run test:run`
- [ ] Expected: all existing tests still pass, plus the new 8 `validateLocationInput` tests from Task 2.

## Manual Browser Verification

After running the Task 1 SQL in the Supabase SQL editor, and running `update profiles set is_admin = true where email = '<your account email>'` directly in the Supabase SQL editor to bootstrap your own admin account:

1. Visit `/locations` while logged out and click "Report" on any location card or map popup — confirm it redirects to `/auth/signin?redirect=/locations` instead of opening the modal.
2. Sign in, click "Report" on a location, submit a reason. Confirm "Request Sent!" shows, then check the location's row in the `location_reports` Supabase table to confirm it was actually inserted with `status = 'pending'`.
3. Open `/admin`, enter the passcode, go to the Locations tab. Confirm it shows "All Locations" and "Reports" sub-tabs, and the report just filed appears under Reports with the correct location name/city/reason/reporter.
4. In All Locations, filter by type and by city — confirm the table narrows correctly and clears back to everything when filters reset.
5. Click Edit on a location, change its name/description, drag/click the mini-map to a new spot, save. Confirm the table row updates immediately, and confirm on `/locations` that the pin moved.
6. From the Reports sub-tab, click "Edit Location" on the pending report from step 2, change something, save — confirm the report moves to Resolved with an "Edited" tag, and the pending count/badge decreases by one.
7. File a second report on a different location, then click "Remove Location" on it — confirm the confirmation dialog appears, the location disappears from both the admin table and `/locations`, and the report moves to Resolved with a "Removed" tag.
8. File a third report and click "Dismiss" — confirm it moves to Resolved with a "Dismissed" tag and the location is untouched.
9. Using a second, non-admin account, confirm the Locations tab in `/admin` (if you can even get in with the shared passcode) shows no locations/reports data — the Supabase calls should return empty due to RLS.
10. In the browser console while signed in as a non-admin user, try `await (await import('/lib/actions/libraryLocations')).deleteLibraryLocation('<some-id>')` — confirm it returns `{ ok: false, error: 'Not authorized.' }` rather than deleting anything.
11. As a non-admin, try to set your own `is_admin` to `true` via `supabase.from('profiles').update({ is_admin: true }).eq('id', <your id>)` in the browser console — confirm it silently fails to take effect (re-fetch the row afterward and confirm `is_admin` is still `false`).

## Final Deliverable: SQL for Supabase

After all tasks are complete and verified, hand the user this SQL to run in the Supabase SQL editor (same block as Task 1, Step 1):

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

create or replace function prevent_is_admin_self_grant()
returns trigger as $$
begin
  if new.is_admin = true and old.is_admin = false and auth.uid() is not null then
    if not exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true) then
      new.is_admin := false;
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists guard_is_admin_grant on profiles;
create trigger guard_is_admin_grant before update on profiles
  for each row execute procedure prevent_is_admin_self_grant();

create table if not exists location_reports (
  id uuid default gen_random_uuid() primary key,
  location_id uuid references library_locations(id) on delete cascade not null,
  reporter_id uuid references profiles(id) on delete cascade not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  resolution text check (resolution in ('edited', 'removed', 'dismissed')),
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz default now()
);

alter table location_reports enable row level security;

create policy "Authenticated users can file reports" on location_reports
  for insert to authenticated with check (auth.uid() = reporter_id);

create policy "Admins can view all reports" on location_reports
  for select using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can resolve reports" on location_reports
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can update any location" on library_locations
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can delete any location" on library_locations
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));
```

After running it, bootstrap your own admin account with:

```sql
update profiles set is_admin = true where email = '<your account email>';
```
