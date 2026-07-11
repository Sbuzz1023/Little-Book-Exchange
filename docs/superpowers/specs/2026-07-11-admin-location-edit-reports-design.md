# Admin: Edit All Library Locations & Review Location Reports

**Date:** 2026-07-11
**Status:** Approved

## Overview

Two things are currently stubbed out and don't do anything real:

1. The "📩 Report" button on `/locations` (card list and map popup) opens a "Request Location Change" modal, but `sendReport()` just fakes a success message after a timeout — nothing is ever saved.
2. The Admin panel's Locations tab (`app/admin/AdminClient.tsx`) shows a hardcoded `MOCK_REPORTS` array with Remove/Dismiss buttons that only mutate local React state.

There is also no way for anyone to *edit* an existing `library_locations` row — `addLibraryLocation` only inserts. This feature makes reports real (submit → persist → admin review) and gives admins full edit/delete control over every location, split into two sub-tabs under Admin → Locations: **All Locations** (browse/filter/edit/delete every location) and **Reports** (review real reports, resolve by editing, removing, or dismissing).

A related gap surfaced during design: `profiles.is_admin` is read/written by `AdminClient.tsx` today but was never added to `schema.sql` — the existing "toggle admin" button in the Users tab has been silently non-functional. Since the new admin-only actions in this feature need a real `is_admin` check, this spec adds the column (fixing that button as a side effect) and closes a self-escalation gap that adding the column would otherwise open.

---

## Data

### `profiles.is_admin` (new column + escalation guard)

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- Without this, any signed-in user could set their own is_admin to true,
-- since the existing "Users can update own profile" policy allows self-updates
-- to any column. This trigger silently keeps is_admin unchanged unless the
-- actor performing the update is already an admin.
--
-- The `auth.uid() is not null` guard matters: auth.uid() reads a JWT claim
-- that's only present on requests routed through PostgREST with a user's
-- session (i.e. real client calls). A direct `update ...` run in the Supabase
-- SQL editor has no such claim, so auth.uid() is null there and this trigger
-- deliberately does not apply — that's what keeps the bootstrap admin grant
-- (see below) working.
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
```

- Existing policy `"Users can update own profile" ... using (auth.uid() = id)` is unchanged; the trigger runs on top of it regardless of which policy allowed the update.
- The very first admin has to be granted by running `update profiles set is_admin = true where email = '...'` directly in the Supabase SQL editor. Because that path has no `auth.uid()`, the guard above skips it entirely, so the grant goes through — this remains the bootstrap path, same as today.

### New table: `location_reports`

```sql
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
```

- `resolution` is `null` while `status = 'pending'`; set exactly once, when resolving.
- `location_id` cascades on delete — if a location is removed (via this feature or otherwise), any reports about it are removed too; there's nothing left to review once the location is gone.
- No select policy for the reporter themselves — reports are write-only for regular users (file it and move on), matching the "Our team reviews requests" framing already in the existing modal copy. Nobody has asked for a "my reports" view.

### `library_locations`: admin edit/delete policies

The table already has select-by-everyone, insert-by-owner, and delete-expired-fairs-by-anyone policies. This adds two more:

```sql
create policy "Admins can update any location" on library_locations
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can delete any location" on library_locations
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));
```

This SQL (all three blocks above) is handed to the user to run in the Supabase SQL editor once implementation is complete, same as prior features.

---

## Server Actions

### `lib/actions/libraryLocations.ts` (existing file, extended)

- Extract the existing inline validation in `addLibraryLocation` (name/street/city non-blank, fair date checks) into a standalone pure function:

  ```ts
  export function validateLocationInput(data: AddLocationInput): string | null
  ```

  Returns the first validation error message, or `null` if valid. `addLibraryLocation` calls this instead of its current inline `if` chain — behavior is unchanged, just deduplicated so `editLibraryLocation` can reuse it.

- New admin-only helper, exported so `locationReports.ts` can reuse it too:

  ```ts
  export async function requireAdmin(supabase): Promise<{ ok: true; userId: string } | { ok: false; error: string }>
  ```

  Fetches the current user; if none, `{ ok: false, error: 'Please sign in.' }`. Otherwise fetches `profiles.is_admin` for that user; if not true, `{ ok: false, error: 'Not authorized.' }`. This is a defense-in-depth check for a clean error message — the RLS policies above are the actual enforcement boundary.

- New exports:

  ```ts
  export async function editLibraryLocation(id: string, data: AddLocationInput): Promise<AddLocationResult>
  export async function deleteLibraryLocation(id: string): Promise<{ ok: true } | { ok: false; error: string }>
  ```

  `editLibraryLocation`: `requireAdmin` → `validateLocationInput` → `update(...).eq('id', id).select(...).single()` → same `AddLocationResult` shape as `addLibraryLocation` (so the admin edit modal can reuse the same success/error handling).

  `deleteLibraryLocation`: `requireAdmin` → `delete().eq('id', id)` → `{ ok: true }` or `{ ok: false, error }`.

### `lib/actions/locationReports.ts` (new file)

```ts
export async function submitLocationReport(locationId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }>
```
Requires a signed-in user (else `{ ok: false, error: 'Please sign in to report a location.' }`); requires non-blank `reason` (else `{ ok: false, error: 'Please describe the issue.' }`); inserts with `reporter_id = user.id`, `status: 'pending'`.

```ts
export async function resolveLocationReport(reportId: string, resolution: 'edited' | 'removed' | 'dismissed'): Promise<{ ok: true } | { ok: false; error: string }>
```
`requireAdmin` (imported from `libraryLocations.ts`) → updates the report row: `status: 'resolved'`, `resolution`, `resolved_by: userId`, `resolved_at: now()`.

This action only ever touches the report row. It does not edit or delete the location itself — the admin UI is responsible for calling `editLibraryLocation`/`deleteLibraryLocation` first when the resolution is `'edited'`/`'removed'`, then calling this. Each action does exactly one thing; the UI sequences them.

---

## Component Changes

### `app/locations/LocationsClient.tsx`

- `onReport` (used by both the list's `LocationCard` and `MapView`'s popup) gates on `isLoggedIn` before opening the modal, same pattern `startAddMode` already uses: if not logged in, `window.location.href = '/auth/signin?redirect=/locations'`.
- `sendReport` becomes `async`, calls `submitLocationReport(reportTarget.id, reportReason)`. On `{ ok: true }`, unchanged existing behavior (show "Request Sent!", close after the timeout). On `{ ok: false }`, show `result.error` in the modal (new small error line above the buttons, same visual treatment as `formError` in the add-location form) and stay open instead of closing.
- Needs `isLoggedIn` at the point `onReport` is invoked — it's already a prop on `LocationsClient`, no new prop needed.

### `app/admin/AdminClient.tsx`

- Delete `MOCK_REPORTS`. `Report` type becomes a real shape matching `location_reports` joined with `library_locations` (name, type, city, street) and `profiles` (reporter username/email):

  ```ts
  type Report = {
    id: string
    locationId: string
    locationName: string
    locationType: 'lfl' | 'library' | 'bookstore' | 'fair'
    street: string
    city: string
    reason: string
    reporter: string
    date: string
    status: 'pending' | 'resolved'
    resolution: 'edited' | 'removed' | 'dismissed' | null
  }
  ```

- `AdminClient`'s existing `useEffect(() => { ... }, [authed])` block that fetches `profiles` gains sibling fetches (same client-side pattern, run when `authed === 'yes'`):
  - All locations: `supabase.from('library_locations').select('*').order('created_at', { ascending: false })` → `locations` state.
  - Reports: `supabase.from('location_reports').select('*, library_locations(name, type, street, city), profiles(username, email)').order('created_at', { ascending: false })` → mapped into `Report[]` → `reports` state (replaces the `useState(MOCK_REPORTS)` initializer).

- The `locations` sidebar tab gains an inner two-tab switcher (`'all' | 'reports'`, default `'all'`), rendered the same visual way the outer `TABS` row is (pill buttons), inside what is currently `LocationsTab`:

  **All Locations sub-tab** (new):
  - Filter bar: type pills (all/lfl/library/bookstore/fair, same `TYPE_OPTIONS` styling as the public `/locations` page) + a city text search input.
  - Table: Name · Type (emoji + label) · Street · City · [Edit] [Delete] — same table visual style as `UsersTab`'s table.
  - **Edit**: opens a modal reusing the same field set as the public "Add a Location" form (name, type, street, city, description, fair start/end dates when type is `fair`) *plus* a reposition control: a small embedded `MapView` (dynamic-imported, `ssr: false`, same as the public page) showing just that one pin in `addMode`-equivalent click-to-place behavior, so clicking anywhere on the mini-map updates the pending lat/lng. Submits via `editLibraryLocation`; on success, updates the row in `locations` state and closes; on failure, shows the error inline (same `formError` pattern).
  - **Delete**: `window.confirm(...)` (matching the existing "Cancel Request" confirm-before-destructive pattern elsewhere in the app) → `deleteLibraryLocation` → removes the row from `locations` state on success.

  **Reports sub-tab** (replaces today's `LocationsTab` body):
  - Pending list: same card layout as today's mock version (location name/type badge/city, reporter, date, reason quote), but now backed by real `reports` state.
  - Three actions per pending report instead of two:
    - **Edit Location**: opens the same edit modal as the All Locations tab, pre-loaded with that report's location. On successful save, additionally calls `resolveLocationReport(report.id, 'edited')` and marks the report resolved in local state.
    - **Remove Location**: confirm → `deleteLibraryLocation(report.locationId)` → on success, `resolveLocationReport(report.id, 'removed')` → marks resolved in local state.
    - **Dismiss**: `resolveLocationReport(report.id, 'dismissed')` → marks resolved in local state, no data change.
  - Resolved section below (same collapsed-row style as today) now shows the real `resolution` value (`Edited` / `Removed` / `Dismissed`) instead of the current `approved`/`dismissed` mock statuses.
  - The sidebar badge count for the Locations tab (`badge('locations')`, currently `pendingReports` from mock data) now reflects `reports.filter(r => r.status === 'pending').length` from real data — no change to how the badge itself renders.

### `app/locations/MapView.tsx`

No changes. The admin edit modal's reposition map is a second, independent instance of the same existing component (new pin-only, no `onReport`/existing-locations clutter) — not a modification to `MapView` itself.

---

## Testing

- New `lib/actions/validateLocationInput.test.ts`: unit tests for the extracted pure validator (name/street/city required, fair requires both dates, end >= start) — same style as `lib/buildConfirmationMessage.test.ts`. This is the only new pure logic introduced by this feature.
- Everything else (server actions against Supabase, RLS enforcement, the admin UI, the reposition mini-map) follows this codebase's existing convention: not unit tested, verified manually against a real Supabase project — same as `addLibraryLocation` and `MapView` have no tests today.
- Manual verification checklist before considering this done:
  - Non-admin user cannot see the All Locations/Reports admin sub-tabs' data (RLS blocks the select) even if they know the admin passcode.
  - Filing a report while signed out redirects to sign-in; filing while signed in persists and shows up in the admin Reports sub-tab.
  - Editing a location's position via the mini-map, saving, and confirming the public `/locations` map shows the pin in its new spot.
  - Each of Edit/Remove/Dismiss on a report correctly updates both `location_reports` and (for Remove) `library_locations`, and moves the report to the Resolved section.
  - A non-admin user attempting to set their own `is_admin` to `true` via the client is silently blocked by the trigger.

---

## Out of Scope

- Any UI for a regular user to see the status of reports they've filed.
- Bulk actions (bulk delete, bulk resolve) in either admin sub-tab.
- Editing a location's `created_by`/ownership, or any notion of location ownership transfer.
- Real-time/push updates to the admin panel when a new report comes in — it's fetched on tab load, not subscribed.
- Automated admin-granting flow (invite links, email-based promotion, etc.) — the bootstrap admin is still granted via a direct SQL editor `update`, same as before this feature existed (it just wasn't reachable at all previously, since the column didn't exist).
- Rate-limiting or spam prevention on report submission beyond requiring sign-in.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | Add `profiles.is_admin` + escalation-guard trigger; add `location_reports` table + RLS; add admin update/delete policies on `library_locations` |
| `lib/actions/libraryLocations.ts` | Extract `validateLocationInput`; add `requireAdmin` helper; add `editLibraryLocation`, `deleteLibraryLocation` |
| `lib/actions/locationReports.ts` | New file — `submitLocationReport`, `resolveLocationReport` |
| `lib/actions/validateLocationInput.test.ts` | New — unit tests for the extracted validator |
| `app/locations/LocationsClient.tsx` | Gate report modal on `isLoggedIn`; wire `sendReport` to `submitLocationReport` with real error handling |
| `app/admin/AdminClient.tsx` | Remove `MOCK_REPORTS`; fetch real locations + reports; split Locations tab into All Locations (filter/edit/delete) and Reports (real review with Edit/Remove/Dismiss) sub-tabs |
