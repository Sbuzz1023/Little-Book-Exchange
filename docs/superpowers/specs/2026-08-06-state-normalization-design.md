# State Normalization — Design

**Date:** 2026-08-06
**Status:** Approved

## Problem

`profiles.state` is a free-text field, entered via plain `<input>` on both signup
(`app/auth/signup/page.tsx`) and profile edit (`app/profile/ProfileCard.tsx`). Users
type whatever they like — `"CA"`, `"California"`, `"ca"`, `"Calif"` — and the app
treats each variant as a distinct value. This was noticed in the admin panel, where
user locations are grouped/displayed by raw `state` text and near-duplicate groups
show up for what is really the same state.

The same free-text pattern exists on `tbr_entries.state` (the "To Be Read" wishlist
form's optional state filter). That field is compared with exact string equality
against `profiles.state` in the `notify_tbr_matches()` Postgres trigger and in the
JS-side TBR match query (`app/profile/page.tsx`), so the same format mismatch
silently breaks TBR match notifications, not just the admin display.

Separately, the admin Locations chart (`UserLocationsChart` in
`app/admin/AdminClient.tsx`) has an unrelated pre-existing bug: its "State" toggle
derives a group key from `u.city.split(', ')[1]`, but `city` never contains a
comma — it's always falling through to `u.city` and mislabeling city groupings as
"state" groupings. It never reads the real `state` field at all.

## Goal

Every place `state` is entered stores the canonical 2-letter USPS abbreviation.
Fix it at the source (new entries can't go wrong) and backfill the data that's
already wrong.

## Design

### 1. Shared state list + `StateSelect` component

- `lib/usStates.ts` — exports `US_STATES: { code: string; name: string }[]`,
  the 50 states + DC, alphabetized by name. Single source of truth for the
  dropdown.
- `components/StateSelect.tsx` — a `<select>` wrapping `US_STATES`. Options
  render as `"CA — California"` (code visible, searchable either way). Props:
  `name`, `defaultValue`, `required`, `placeholder` (text for the empty first
  option — `"Select a state"` when required, `"Any state"` for the optional
  TBR case), `className`/`style` (each call site keeps its existing visual
  styling).

### 2. Call sites updated to use `StateSelect`

- **`app/auth/signup/page.tsx`**: `<input name="state">` →
  `<StateSelect name="state" required />`.
- **`app/profile/ProfileCard.tsx`**: edit-mode `<input name="state">` →
  `<StateSelect name="state" defaultValue={profile?.state ?? ''} required />`.
  View-mode (`<Field label="State">`) is unchanged — it displays whatever's
  stored, which will now read as `"CA"` instead of `"California"`.
- **`app/profile/DashboardClient.tsx`** (TBR "Add" form): `<input name="state"
  placeholder="State (optional)...">` → `<StateSelect name="state"
  placeholder="Any state" />` — not required; blank still means "match any
  state," same semantics as today.

No server action changes needed — `updateProfile` (`app/profile/actions.ts`)
and `addTbrEntry` (`lib/actions/tbrEntries.ts`) already pass the field
straight through as a plain string. A `<select>` submits via `FormData`
identically to a text `<input>`.

### 3. Admin chart fix

`UserLocationsChart`'s `view === 'state'` branch changes from
`u.city.split(', ')[1] ?? u.city` to `u.state || '(no state)'` — the real
field, now reliably a 2-letter code for every user.

### 4. Backfill migration

A one-time SQL block appended to `supabase/schema.sql`, following the file's
existing `-- Migration: ...` block convention. Updates both `profiles.state`
and `tbr_entries.state`:

- A mapping table (`VALUES` list) of the 50 states + DC: lowercase full name →
  code, *and* lowercase code → code (so case-only issues like `"ca"` → `"CA"`
  are fixed too).
- `UPDATE profiles SET state = m.code FROM (VALUES ...) AS m(input, code)
  WHERE lower(trim(profiles.state)) = m.input;` — same shape for
  `tbr_entries`.
- Anything not found in the mapping (typos, blank, non-US entries) is left
  untouched — no guessing, no silent data loss. Those rows become visible as
  outliers in the admin Users table afterward for manual fixing.

This is a one-time data-fix migration, not a reusable app function. The JS
`US_STATES` list is the source of truth for the dropdown going forward; this
SQL only needs to agree with it once, at backfill time.

## Testing

- `components/StateSelect.test.tsx` — new: renders all 51 options, honors
  `defaultValue`, required vs. optional placeholder text, submits the
  selected code via `FormData`.
- `app/profile/DashboardClient.test.tsx` — update existing TBR "Add" tests
  that reference the old free-text state input to use the new select.
- Manual QA (not automatable): after the backfill migration runs against a
  real database, spot-check the admin Users tab and the Locations "State"
  chart view against a couple of known accounts.

## Out of scope

- US territories (PR, VI, GU, etc.) — 50 states + DC only, per this app's
  local/US-focused audience.
- Fuzzy-matching/auto-correcting free text — superseded by the dropdown
  approach; no ongoing parsing logic to maintain.
- Building an admin UI to flag/review backfill outliers — the existing Users
  tab already surfaces raw `state` values; a dedicated review flow is more
  than this fix needs.
