# Mapbox Address Autofill (Signup + Profile Edit) — Design

**Date:** 2026-08-09
**Status:** Approved (coordinate storage descoped — see Addendum)

## Addendum (2026-08-09, discovered during implementation)

**Coordinate storage (`lat`/`lng`) was removed from this feature after
implementation began.** This spec originally claimed (§2 "Mapbox setup"):
"Address Autofill has its own free tier... and its own terms explicitly
permit permanently storing the address/coordinates it returns." That claim
is **wrong about the coordinates specifically**. While implementing Task 2,
the installed `@mapbox/search-js-core` package's own type declarations
(`AddressAutofillCore.retrieve()`'s JSDoc) were found to state: "Geographic
coordinates should be used ephemerally and not persisted. This permanent
policy is consistent with the Mapbox Terms of Service." Mapbox's own docs
confirm coordinates from the Autofill/temporary-geocoding family of
endpoints cannot be stored — only the separate, standalone Permanent
Geocoding API (`mapbox.places-permanent`, priced at $5/1,000 requests with
no free tier — see `2026-08-09-mapbox-address-autofill.md`'s cost research)
carries permanent-storage rights.

The original claim was correct about the address **text** fields
(street/city/state/zip — Autofill exists precisely to let you store those,
same as any checkout-autofill product) — only the coordinates are affected.

**Resolution (human decision):** drop coordinate capture/storage from this
feature entirely. `profiles` gains only `zip`, not `lat`/`lng`. The
distance-radius search this spec's Problem section motivated is not
abandoned — it needs its own follow-up spec that gets coordinates the
compliant way (an explicit Permanent Geocoding API call), not as a free
side effect of an Autofill `retrieve()` already being made for a different
purpose. Every mention of `lat`/`lng` capture/storage below is historical:
it describes what was originally designed and briefly implemented (Tasks
1-4), then removed (Task 6) before this branch was merged.

## Problem

Signup and profile edit collect City, State, Street Address, and Apt/Unit as
plain free-text/`<select>` fields with no validation against real addresses
and no geographic coordinates. Two things now need real, permanently-stored
coordinates per user:

1. A future distance-radius filter on book search (a buyer picks a radius —
   10/25/50 mi — and the app filters listings by actual distance). Text
   matching (city/state equality, as `notify_tbr_matches()` already does for
   TBR alerts) cannot answer "how far away," only "same city." That requires
   real lat/lng.
2. Cleaner, validated addresses generally — autofill suggestions cut down on
   typos and malformed entries at the point of entry.

This spec covers autofilling the address fields and capturing coordinates
when a user picks a suggestion. It does not build the radius search itself
(see Out of scope).

## Goal

Typing in the Street Address field on signup or profile edit offers real
address suggestions (Mapbox Address Autofill). Picking one fills City, State,
and a new Zip field, and captures lat/lng for that profile. A user who types
manually instead of picking a suggestion can still submit the form exactly as
today — just without coordinates captured.

## Design

### 1. Data model

Append a migration block to `supabase/schema.sql`, following the file's
existing "append, don't rewrite" convention (see the address-privacy-toggles
and state-format migration blocks already in that file):

```sql
alter table profiles
  ADD COLUMN IF NOT EXISTS zip text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;
```

- `zip` follows the same "always has a value, defaults to empty string"
  convention as `city`/`state`/`address` — it's optional today (no radius
  search consuming it yet) but keeping the column non-null/empty-string
  matches every other profile text field and avoids a mixed null/''
  convention across the table.
- `lat`/`lng` are nullable — a manually-typed address (no suggestion picked)
  never has coordinates, and that's an expected, permanent state for some
  rows, not a to-be-filled-in-later gap.
- `handle_new_user()` (the function that copies `raw_user_meta_data` into a
  new `profiles` row on signup) is defined twice in `supabase/schema.sql`
  via `create or replace function` — once near the top of the file, once
  further down as part of a later migration block. Only the **later**
  definition is actually live (the second `create or replace` supersedes the
  first), so the three new
  `coalesce(new.raw_user_meta_data->>'zip', '')` /
  `(new.raw_user_meta_data->>'lat')::double precision` /
  `(new.raw_user_meta_data->>'lng')::double precision` lines get added only
  to that later definition, mirroring its existing `address`/`address_unit`
  copy. The earlier definition is dead code and is left untouched, same as
  the file's existing convention of appending rather than editing history.

### 2. Mapbox setup

- New dependency: `@mapbox/search-js-react`.
- New env var: `NEXT_PUBLIC_MAPBOX_TOKEN`, added to `.env.local` (and Vercel
  project env). Mapbox's default public token (`pk.…`, from
  `https://account.mapbox.com/access-tokens/`) is designed to be used
  client-side — same trust model as `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Country restricted to `us` in the Autofill config, matching
  `StateSelect`'s US-only, 2-letter-code constraint.
- Cost: Address Autofill has its own free tier (1,000 sessions/month, then
  $12.50/1,000) and its own terms explicitly permit permanently storing the
  address/coordinates it returns — no separate Permanent Geocoding charge
  applies to this feature.

### 3. `AddressAutofillField` component

New file: `components/AddressAutofillField.tsx` (`'use client'`), following
the existing pattern of small client components dropped into a
server-rendered form (`ContactToggle`, `ShareToggle`, `StateSelect`).

- Wraps the Street Address `<input name="address">` in
  `<AddressAutofill accessToken={...} options={{ country: 'us' }}>`.
- Renders (or is passed, see below) the City input, the `StateSelect`, and a
  new Zip input, plus two hidden `<input type="hidden" name="lat">` /
  `name="lng"` fields — all inside the same `<form>` so everything rides
  along in one `FormData` submit, unchanged from how the form already works.
- `onRetrieve(feature)` sets:
  - City from `feature.properties.context.place.name`
  - State from `feature.properties.context.region.region_code` (confirmed
    against Mapbox's docs to be the same 2-letter format `StateSelect`
    already requires, e.g. `"IL"`)
  - Zip from `feature.properties.context.postcode.name`
  - `lat`/`lng` from `feature.properties.coordinates.{latitude,longitude}`
- Takes `defaultValue`s for address/unit/city/state/zip as props, so the same
  component serves both the empty signup form and the pre-filled profile
  edit form.
- If the user types instead of selecting a suggestion (no token, Mapbox
  unreachable, or they just don't pick one), every field stays a plain
  editable input — no coordinates captured, form submits exactly as it does
  today. This is not an error state; it's the expected fallback path.

### 4. Signup form (`app/auth/signup/page.tsx`)

Replace the City / State / Street Address / Apt-Unit block with
`<AddressAutofillField>`, add a Zip field (optional, no `required`, matching
Street Address/Apt-Unit's current optionality — City and State stay
required, unchanged). The `signUp` server action reads three more fields off
`formData` (`zip`, `lat`, `lng`) and passes them through in
`options.data`, the same way `address_unit` is handled today. `lat`/`lng`
parse as floats when present, `undefined` when not (so they arrive in
Supabase Auth metadata as absent rather than `"null"` strings, keeping the
trigger's `(...)::double precision` cast simple).

### 5. Profile edit (`app/profile/ProfileCard.tsx`)

Same swap inside the existing edit-mode form: City / State / Street Address /
Apt-Unit block becomes `<AddressAutofillField>` with `defaultValue`s from
`profile.{city,state,address,address_unit,zip}` (and lat/lng, though these
aren't displayed — only re-submitted if the user picks a new suggestion
during this edit). The read-only view gains a Zip line next to the existing
Address line when set. `updateProfile` (`app/profile/actions.ts`) reads and
writes the same three new fields to `profiles`, following the existing
field-by-field pattern in that function.

### 6. Error handling

- **No token / Mapbox unreachable:** graceful degradation to plain inputs,
  as above — no error banner, since a normal signup/profile-save must never
  be blocked by a third-party service being unavailable.
- **Zip:** no format validation added. It isn't required today and isn't
  consumed by anything yet; over-validating a field nothing reads yet adds a
  rejection path with no corresponding benefit.
- **Lat/lng:** never required, never validated beyond the float parse
  already described. Absent unless a suggestion was picked.

## Testing

- New `components/AddressAutofillField.test.tsx` (vitest + testing-library,
  matching the style of `app/profile/TbrAddForm.test.tsx`): typing manually
  without triggering `onRetrieve` leaves the form submittable with the typed
  values and no lat/lng; simulating `onRetrieve` with a representative
  Mapbox feature object correctly populates city/state/zip/lat/lng.
- No new tests for `signUp` or `updateProfile` themselves — neither has a
  test file today (consistent with `lib/actions/validateLocationInput.ts`'s
  established pattern in this repo: pure/testable logic gets tests, thin
  server-action wrappers around it don't). Verified instead by reading the
  diff and running the full suite.
- No automated test for the `schema.sql` migration or trigger update —
  consistent with how this repo has handled prior schema migrations (see
  `2026-08-06-state-validation-design.md`). Manual verification: run the
  migration against a scratch/dev Supabase project, sign up a test account
  via the autofill flow, confirm `zip`/`lat`/`lng` land correctly in the new
  `profiles` row.

## Out of scope

- **Mapbox GL JS migration for the `/locations` map** (replacing Leaflet +
  OpenStreetMap tiles + Nominatim geocoding) — a separate, independently
  shippable piece of work, to be designed as its own spec.
- **Distance-radius search on book listings** — the feature that originally
  motivated storing coordinates here. Per the Addendum, this spec no longer
  captures or stores `lat`/`lng` at all (a Mapbox ToS conflict, found during
  implementation). A future spec for this feature needs to get profile
  coordinates the compliant way — an explicit Permanent Geocoding API call —
  not as a side effect of Address Autofill's `retrieve()`.
- **Mapbox's built-in unit-number suggestion feature** — the existing
  separate Apt/Unit free-text field is kept as-is (see the corresponding
  brainstorming decision); Autofill only drives Street/City/State/Zip.
