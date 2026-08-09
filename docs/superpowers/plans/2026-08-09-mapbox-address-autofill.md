# Mapbox Address Autofill (Signup + Profile Edit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing in the Street Address field on signup or profile edit offers real Mapbox address suggestions; picking one fills City, State, and a new Zip field, and captures lat/lng on the profile — laying the groundwork for a future distance-radius search, without building that search here.

**Architecture:** A single new client component, `AddressAutofillField`, wraps the Street Address `<input>` in Mapbox's `<AddressAutofill>` and drives City/State/Zip/lat/lng via its `onRetrieve` callback (not the browser-autofill-attribute pattern, since Mapbox's own docs only show that filling `<input>`s, and the State field is a `<select>` requiring an exact 2-letter code). It replaces the City/State/Street/Zip block on both the signup page and the profile-edit form; the existing Apt/Unit field is untouched. Two new nullable `profiles` columns (`lat`, `lng`) plus a `zip` column carry the captured data through the existing server actions into Supabase.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Vitest + Testing Library, Supabase/Postgres, `@mapbox/search-js-react`.

## Global Constraints

- Code style: no semicolons, single quotes, 2-space indent (TS/TSX); SQL matches the style of the existing migration blocks already in `supabase/schema.sql` (per approved spec and this repo's established convention).
- Country restricted to `us` in the Autofill config, matching `StateSelect`'s US-only, 2-letter-code constraint (per approved spec).
- `zip` is never required and never format-validated — it isn't consumed by anything yet, so there's nothing to validate against (per approved spec).
- `lat`/`lng` are never required; absent unless a Mapbox suggestion was picked (per approved spec).
- No token / Mapbox unreachable → the field degrades to a plain editable input, no error shown — a normal signup/profile-save must never be blocked by a third-party service being unavailable (per approved spec).
- The existing Apt/Unit field is not touched or moved into the new component (per approved brainstorming decision — it stays separate free text).
- `handle_new_user()` is defined twice in `supabase/schema.sql` via `create or replace function` (line ~26 and line ~890) — only the **later** definition (line ~890) is live. Only that one is modified; the earlier one is left untouched, per the file's existing convention of appending rather than editing history.
- No new Permanent Geocoding charge applies to this feature — Address Autofill is its own priced product whose terms explicitly permit permanently storing the address/coordinates it returns (per approved spec's cost research).
- This repo has no precedent for mocking the Supabase server client in a test, and neither `app/auth/signup/page.tsx` nor `app/profile/actions.ts` has a test file today — no new test files are added for either (per approved spec; matches the established convention also documented in `docs/superpowers/plans/2026-08-06-state-validation.md`).

---

### Task 1: Database — `zip`/`lat`/`lng` columns and `handle_new_user()`

**Files:**
- Modify: `supabase/schema.sql` (the live `handle_new_user()` definition, ~line 890; append a new migration block at the end of the file)

**Interfaces:**
- Produces: `profiles.zip text not null default ''`, `profiles.lat double precision` (nullable), `profiles.lng double precision` (nullable) — consumed by Tasks 3 and 4's server actions.

- [ ] **Step 1: Modify the live `handle_new_user()` definition**

In `supabase/schema.sql`, find the **second** occurrence of `create or replace function handle_new_user()` (it's the one immediately preceded by the comment `-- 9. Seed email_verified/phone_verified at signup...`, currently around line 890). Change it from:

```sql
create or replace function handle_new_user()
returns trigger as $$
begin
  -- Must be schema-qualified: this trigger fires inside GoTrue's own
  -- transaction (as supabase_auth_admin), whose search_path doesn't
  -- include public, so the bare table name fails to resolve.
  insert into public.profiles (id, email, username, city, state, phone, contact_preference, address, address_unit, share_address, pickup_description, share_pickup, email_verified, phone_verified)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', ''),
    coalesce(new.raw_user_meta_data->>'city', ''),
    coalesce(new.raw_user_meta_data->>'state', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'contact_preference', 'email'),
    coalesce(new.raw_user_meta_data->>'address', ''),
    coalesce(new.raw_user_meta_data->>'address_unit', ''),
    coalesce((new.raw_user_meta_data->>'share_address')::boolean, true),
    coalesce(new.raw_user_meta_data->>'pickup_description', ''),
    coalesce((new.raw_user_meta_data->>'share_pickup')::boolean, true),
    (new.email_confirmed_at is not null),
    (new.phone_confirmed_at is not null)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
```

to:

```sql
create or replace function handle_new_user()
returns trigger as $$
begin
  -- Must be schema-qualified: this trigger fires inside GoTrue's own
  -- transaction (as supabase_auth_admin), whose search_path doesn't
  -- include public, so the bare table name fails to resolve.
  insert into public.profiles (id, email, username, city, state, phone, contact_preference, address, address_unit, share_address, pickup_description, share_pickup, email_verified, phone_verified, zip, lat, lng)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', ''),
    coalesce(new.raw_user_meta_data->>'city', ''),
    coalesce(new.raw_user_meta_data->>'state', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'contact_preference', 'email'),
    coalesce(new.raw_user_meta_data->>'address', ''),
    coalesce(new.raw_user_meta_data->>'address_unit', ''),
    coalesce((new.raw_user_meta_data->>'share_address')::boolean, true),
    coalesce(new.raw_user_meta_data->>'pickup_description', ''),
    coalesce((new.raw_user_meta_data->>'share_pickup')::boolean, true),
    (new.email_confirmed_at is not null),
    (new.phone_confirmed_at is not null),
    coalesce(new.raw_user_meta_data->>'zip', ''),
    (new.raw_user_meta_data->>'lat')::double precision,
    (new.raw_user_meta_data->>'lng')::double precision
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;
```

- [ ] **Step 2: Append the column migration block**

Append this to the very end of `supabase/schema.sql` (after the final `-- ──...──` divider line, currently the one closing the "Migration: listing ISBN" block):

```sql

-- ── Migration: Mapbox address autofill (zip + coordinates) ─────────────────────
-- Run this block in Supabase SQL Editor. Backs the Address Autofill feature on
-- signup/profile edit — see
-- docs/superpowers/specs/2026-08-09-mapbox-address-autofill-design.md.
-- lat/lng are nullable: a manually-typed address (no Mapbox suggestion picked)
-- never has coordinates, and that's an expected, permanent state for some
-- rows, not a to-be-filled-in-later gap.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS zip text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS (SQL-only change; no test file covers `schema.sql` directly, per the Global Constraints and the approved spec's Testing section).

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add zip/lat/lng columns for Mapbox address autofill

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Run the migration against the real database (manual, not automated)**

This step modifies real schema and is not covered by an automated test:

1. Open the Supabase project's SQL Editor.
2. Paste and run the full migration block added in Step 2 (from `-- ── Migration: Mapbox address autofill...` to its closing divider).
3. Paste and run the modified `handle_new_user()` function block from Step 1 (the full `create or replace function ... $$ language plpgsql security definer set search_path = public, pg_temp;` statement) so the live trigger function picks up the change.
4. Verify the columns exist (non-destructive read):

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'profiles' and column_name in ('zip', 'lat', 'lng');
```

Expect three rows: `zip` (`text`, not nullable, default `''`), `lat` (`double precision`, nullable), `lng` (`double precision`, nullable).

---

### Task 2: `AddressAutofillField` component

**Files:**
- Create: `components/AddressAutofillField.tsx`
- Create: `components/AddressAutofillField.test.tsx`
- Modify: `package.json` / `package-lock.json` (via `npm install`)
- Modify: `.env.local` (manual, not committed — see Step 2)

**Interfaces:**
- Produces: `export default function AddressAutofillField(props: { defaultAddress?: string; defaultCity?: string; defaultState?: string; defaultZip?: string; defaultLat?: number | null; defaultLng?: number | null; inputClassName: string; inputStyle: React.CSSProperties; labelStyle: React.CSSProperties; requiredMark?: React.ReactNode })`. Renders (as a Fragment, so it drops directly into a parent's flex/grid/space-y layout): hidden `lat`/`lng` inputs, then Street Address / City / State / Zip fields, each named `address` / `city` / `state` / `zip` for `FormData` — consumed by Tasks 3 and 4.

- [ ] **Step 1: Install the Mapbox Search JS React package**

Run: `npm install --save @mapbox/search-js-react`
Expected: `package.json` and `package-lock.json` gain the new dependency; no install errors.

- [ ] **Step 2: Add your Mapbox token to `.env.local`**

Add this line to `.env.local` (this file is gitignored — `git status -s` should show no change from this step):

```
NEXT_PUBLIC_MAPBOX_TOKEN=
```

Paste in your Mapbox default public token (starts with `pk.`) from https://account.mapbox.com/access-tokens/. Also add the same variable to the Vercel project's environment variables before deploying (Project Settings → Environment Variables) — `.env.local` only affects your local dev server.

- [ ] **Step 3: Write the failing tests**

Create `components/AddressAutofillField.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AddressAutofillField from './AddressAutofillField'

// Stub out Mapbox's real <AddressAutofill> (a web component wrapper that
// would otherwise try to reach the network in jsdom). The stub renders the
// wrapped input as-is and exposes a button to simulate picking a suggestion,
// calling the real onRetrieve prop with a representative Mapbox response.
vi.mock('@mapbox/search-js-react', () => ({
  AddressAutofill: ({ children, onRetrieve }: any) => (
    <div>
      {children}
      <button type="button" onClick={() => onRetrieve(SAMPLE_RETRIEVE_RESPONSE)}>
        simulate retrieve
      </button>
    </div>
  ),
}))

const SAMPLE_RETRIEVE_RESPONSE = {
  features: [
    {
      properties: {
        context: {
          place: { name: 'Chicago' },
          region: { region_code: 'IL' },
          postcode: { name: '60614' },
        },
        coordinates: { latitude: 41.9, longitude: -87.6 },
      },
    },
  ],
}

const inputClassName = 'test-input'
const inputStyle = {}
const labelStyle = {}

describe('AddressAutofillField', () => {
  it('renders plain editable fields seeded with the given defaults', () => {
    render(
      <AddressAutofillField
        defaultAddress="123 Main St"
        defaultCity="Springfield"
        defaultState="IL"
        defaultZip="62704"
        inputClassName={inputClassName}
        inputStyle={inputStyle}
        labelStyle={labelStyle}
      />
    )
    expect(screen.getByPlaceholderText('e.g. 123 Main St')).toHaveValue('123 Main St')
    expect(screen.getByPlaceholderText('e.g. Chicago')).toHaveValue('Springfield')
    expect(screen.getByPlaceholderText('e.g. 60614')).toHaveValue('62704')
  })

  it('preserves previously-saved coordinates in hidden fields until a new suggestion is picked', () => {
    const { container } = render(
      <AddressAutofillField
        defaultLat={41.5}
        defaultLng={-88.1}
        inputClassName={inputClassName}
        inputStyle={inputStyle}
        labelStyle={labelStyle}
      />
    )
    expect(container.querySelector('input[name="lat"]')).toHaveValue('41.5')
    expect(container.querySelector('input[name="lng"]')).toHaveValue('-88.1')
  })

  it('picking a suggestion fills city, state, zip, and hidden lat/lng', () => {
    const { container } = render(
      <AddressAutofillField
        inputClassName={inputClassName}
        inputStyle={inputStyle}
        labelStyle={labelStyle}
      />
    )
    fireEvent.click(screen.getByText('simulate retrieve'))

    expect(screen.getByPlaceholderText('e.g. Chicago')).toHaveValue('Chicago')
    expect(container.querySelector('select[name="state"]')).toHaveValue('IL')
    expect(screen.getByPlaceholderText('e.g. 60614')).toHaveValue('60614')
    expect(container.querySelector('input[name="lat"]')).toHaveValue('41.9')
    expect(container.querySelector('input[name="lng"]')).toHaveValue('-87.6')
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run components/AddressAutofillField.test.tsx`
Expected: FAIL — `Failed to resolve import "./AddressAutofillField"` (the component doesn't exist yet).

- [ ] **Step 5: Write the implementation**

Create `components/AddressAutofillField.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { AddressAutofill } from '@mapbox/search-js-react'
import StateSelect from '@/components/StateSelect'

// Mapbox's Address Autofill onRetrieve payload is a GeoJSON FeatureCollection.
// Only the fields this component reads are typed here — see
// https://docs.mapbox.com/api/search/geocoding/ for the full response shape.
type AddressAutofillRetrieveResponse = {
  features: {
    properties?: {
      context?: {
        place?: { name?: string }
        region?: { region_code?: string }
        postcode?: { name?: string }
      }
      coordinates?: { latitude?: number; longitude?: number }
    }
  }[]
}

type Props = {
  defaultAddress?: string
  defaultCity?: string
  defaultState?: string
  defaultZip?: string
  defaultLat?: number | null
  defaultLng?: number | null
  inputClassName: string
  inputStyle: React.CSSProperties
  labelStyle: React.CSSProperties
  requiredMark?: React.ReactNode
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

export default function AddressAutofillField({
  defaultAddress = '',
  defaultCity = '',
  defaultState = '',
  defaultZip = '',
  defaultLat = null,
  defaultLng = null,
  inputClassName,
  inputStyle,
  labelStyle,
  requiredMark,
}: Props) {
  const [city, setCity] = useState(defaultCity)
  const [state, setState] = useState(defaultState)
  const [zip, setZip] = useState(defaultZip)
  // Round-trip previously-saved coordinates as hidden fields so an unrelated
  // profile edit (one that doesn't touch the address) doesn't wipe them.
  // They're only replaced when the user picks a new suggestion below — a
  // manual text edit to the street address leaves them as whatever was last
  // picked, a deliberate, low-stakes trade-off (see the design spec's "Out
  // of scope").
  const [lat, setLat] = useState(defaultLat != null ? String(defaultLat) : '')
  const [lng, setLng] = useState(defaultLng != null ? String(defaultLng) : '')

  function handleRetrieve(res: AddressAutofillRetrieveResponse) {
    const context = res.features?.[0]?.properties?.context
    if (context?.place?.name) setCity(context.place.name)
    if (context?.region?.region_code) setState(context.region.region_code)
    if (context?.postcode?.name) setZip(context.postcode.name)
    const coords = res.features?.[0]?.properties?.coordinates
    if (typeof coords?.latitude === 'number') setLat(String(coords.latitude))
    if (typeof coords?.longitude === 'number') setLng(String(coords.longitude))
  }

  const addressInput = (
    <input
      name="address"
      type="text"
      placeholder="e.g. 123 Main St"
      defaultValue={defaultAddress}
      autoComplete="address-line1"
      className={inputClassName}
      style={inputStyle}
    />
  )

  return (
    <>
      <input type="hidden" name="lat" value={lat} />
      <input type="hidden" name="lng" value={lng} />

      <div>
        <label className="block mb-1.5" style={labelStyle}>Street Address</label>
        {MAPBOX_TOKEN ? (
          <AddressAutofill accessToken={MAPBOX_TOKEN} options={{ country: 'us' }} onRetrieve={handleRetrieve}>
            {addressInput}
          </AddressAutofill>
        ) : addressInput}
      </div>

      <div>
        <label className="block mb-1.5" style={labelStyle}>City{requiredMark}</label>
        <input
          name="city"
          type="text"
          placeholder="e.g. Chicago"
          value={city}
          onChange={e => setCity(e.target.value)}
          required
          autoComplete="address-level2"
          className={inputClassName}
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block mb-1.5" style={labelStyle}>State{requiredMark}</label>
        <StateSelect
          key={state}
          name="state"
          defaultValue={state}
          required
          placeholder="Select a state"
          className={inputClassName}
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block mb-1.5" style={labelStyle}>Zip Code</label>
        <input
          name="zip"
          type="text"
          placeholder="e.g. 60614"
          value={zip}
          onChange={e => setZip(e.target.value)}
          autoComplete="postal-code"
          className={inputClassName}
          style={inputStyle}
        />
      </div>
    </>
  )
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run components/AddressAutofillField.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add components/AddressAutofillField.tsx components/AddressAutofillField.test.tsx package.json package-lock.json
git commit -m "feat: add AddressAutofillField component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire into the signup form

**Files:**
- Modify: `app/auth/signup/page.tsx`

**Interfaces:**
- Consumes: `AddressAutofillField` from `components/AddressAutofillField.tsx` (Task 2).

- [ ] **Step 1: Add the import**

In `app/auth/signup/page.tsx`, change:

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContactToggle from './ContactToggle'
import ShareToggle from '@/components/ShareToggle'
import StateSelect from '@/components/StateSelect'
import { isValidStateCode } from '@/lib/usStates'
```

to:

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContactToggle from './ContactToggle'
import ShareToggle from '@/components/ShareToggle'
import StateSelect from '@/components/StateSelect'
import AddressAutofillField from '@/components/AddressAutofillField'
import { isValidStateCode } from '@/lib/usStates'
```

- [ ] **Step 2: Pass the three new fields through in `signUp`**

Change:

```tsx
          data: {
            username:           (formData.get('username') as string).toLowerCase().replace(/\s+/g, ''),
            city:               formData.get('city') as string,
            state,
            phone:              formData.get('phone') as string,
            contact_preference: formData.get('contact_preference') as string,
            address:            (formData.get('address') as string) || '',
            address_unit:       (formData.get('address_unit') as string) || '',
            share_address:      formData.get('share_address') === 'true',
            pickup_description: (formData.get('pickup_description') as string) || '',
            share_pickup:       formData.get('share_pickup') === 'true',
          },
```

to:

```tsx
          data: {
            username:           (formData.get('username') as string).toLowerCase().replace(/\s+/g, ''),
            city:               formData.get('city') as string,
            state,
            phone:              formData.get('phone') as string,
            contact_preference: formData.get('contact_preference') as string,
            address:            (formData.get('address') as string) || '',
            address_unit:       (formData.get('address_unit') as string) || '',
            share_address:      formData.get('share_address') === 'true',
            pickup_description: (formData.get('pickup_description') as string) || '',
            share_pickup:       formData.get('share_pickup') === 'true',
            zip:                (formData.get('zip') as string) || '',
            lat:                formData.get('lat') ? parseFloat(formData.get('lat') as string) : undefined,
            lng:                formData.get('lng') ? parseFloat(formData.get('lng') as string) : undefined,
          },
```

- [ ] **Step 3: Replace the City / State / Street Address block with `AddressAutofillField`**

Change:

```tsx
          {/* City */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>City{req}</label>
            <input name="city" type="text" placeholder="e.g. Chicago" required
              className={inputClass} style={inputStyle} />
          </div>

          {/* State */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>State{req}</label>
            <StateSelect name="state" required placeholder="Select a state"
              className={inputClass} style={inputStyle} />
          </div>

          {/* Street Address */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>Street Address</label>
            <input name="address" type="text" placeholder="e.g. 123 Main St"
              className={inputClass} style={inputStyle} />
          </div>

          {/* Apt / Unit */}
```

to:

```tsx
          {/* Street Address / City / State / Zip — Mapbox autofill */}
          <AddressAutofillField
            inputClassName={inputClass}
            inputStyle={inputStyle}
            labelStyle={labelStyle}
            requiredMark={req}
          />

          {/* Apt / Unit */}
```

Everything else in the file (the `req`/`labelStyle`/`inputClass`/`inputStyle` declarations above the form, the Apt/Unit field itself, and everything below it) is unchanged. `StateSelect` is no longer referenced directly in this file's JSX — `AddressAutofillField` renders it internally now — so remove the now-unused `StateSelect` import:

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContactToggle from './ContactToggle'
import ShareToggle from '@/components/ShareToggle'
import AddressAutofillField from '@/components/AddressAutofillField'
import { isValidStateCode } from '@/lib/usStates'
```

- [ ] **Step 4: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS (this file has no dedicated test suite of its own, per the Global Constraints — this step is the only automated check for it).

- [ ] **Step 5: Commit**

```bash
git add app/auth/signup/page.tsx
git commit -m "feat: wire Mapbox address autofill into signup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Wire into profile edit

**Files:**
- Modify: `app/profile/ProfileCard.tsx`
- Modify: `app/profile/actions.ts:1-30`

**Interfaces:**
- Consumes: `AddressAutofillField` from `components/AddressAutofillField.tsx` (Task 2).

- [ ] **Step 1: Add `zip`/`lat`/`lng` to `ProfileCard`'s `profile` prop type and import `AddressAutofillField`**

In `app/profile/ProfileCard.tsx`, change:

```tsx
'use client'

import { useState } from 'react'
import ShareToggle from '@/components/ShareToggle'
import StateSelect from '@/components/StateSelect'

type Props = {
  profile: {
    id?: string | null
    name?: string | null
    username?: string | null
    email?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    address?: string | null
    address_unit?: string | null
    share_address?: boolean | null
```

to:

```tsx
'use client'

import { useState } from 'react'
import ShareToggle from '@/components/ShareToggle'
import AddressAutofillField from '@/components/AddressAutofillField'

type Props = {
  profile: {
    id?: string | null
    name?: string | null
    username?: string | null
    email?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    address?: string | null
    address_unit?: string | null
    zip?: string | null
    lat?: number | null
    lng?: number | null
    share_address?: boolean | null
```

(`StateSelect` is no longer used directly in this file — its import is dropped in favor of `AddressAutofillField`, which renders it internally.)

- [ ] **Step 2: Replace the City / State block and the Street Address / Apt-Unit block**

Change:

```tsx
            <div>
              <EditLabel>City</EditLabel>
              <input name="city" defaultValue={profile?.city ?? ''} required
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>
            <div>
              <EditLabel>State</EditLabel>
              <StateSelect name="state" defaultValue={profile?.state ?? ''} required placeholder="Select a state"
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>
            <div>
              <EditLabel>Phone</EditLabel>
              <input name="phone" defaultValue={profile?.phone ?? ''} type="tel"
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>

            {/* Address section */}
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 900, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                📍 Private Address
              </p>
              <div className="flex flex-col gap-4">
                <div>
                  <EditLabel>Street Address</EditLabel>
                  <input name="address" defaultValue={profile?.address ?? ''}
                    placeholder="e.g. 123 Main St"
                    className={inputClass} style={{ padding: '12px 16px' }} />
                </div>
                <div>
                  <EditLabel>Apt / Unit #</EditLabel>
                  <input name="address_unit" defaultValue={profile?.address_unit ?? ''}
                    placeholder="e.g. Apt 2B"
                    className={inputClass} style={{ padding: '12px 16px' }} />
                </div>
                <ShareToggle
                  name="share_address"
                  defaultValue={profile?.share_address ?? true}
                  label="Share address after approval"
                  hint="🏠 Your street address is only revealed to a buyer after you approve their purchase request."
                />
              </div>
            </div>
```

to:

```tsx
            <div>
              <EditLabel>Phone</EditLabel>
              <input name="phone" defaultValue={profile?.phone ?? ''} type="tel"
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>

            {/* Address section */}
            <div style={{ borderTop: '2px dashed #fed7aa', paddingTop: 16, marginTop: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 900, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
                📍 Private Address
              </p>
              <div className="flex flex-col gap-4">
                <AddressAutofillField
                  defaultAddress={profile?.address ?? ''}
                  defaultCity={profile?.city ?? ''}
                  defaultState={profile?.state ?? ''}
                  defaultZip={profile?.zip ?? ''}
                  defaultLat={profile?.lat ?? null}
                  defaultLng={profile?.lng ?? null}
                  inputClassName={inputClass}
                  inputStyle={{ padding: '12px 16px' }}
                  labelStyle={{ fontSize: 12, fontWeight: 900, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}
                />
                <div>
                  <EditLabel>Apt / Unit #</EditLabel>
                  <input name="address_unit" defaultValue={profile?.address_unit ?? ''}
                    placeholder="e.g. Apt 2B"
                    className={inputClass} style={{ padding: '12px 16px' }} />
                </div>
                <ShareToggle
                  name="share_address"
                  defaultValue={profile?.share_address ?? true}
                  label="Share address after approval"
                  hint="🏠 Your street address is only revealed to a buyer after you approve their purchase request."
                />
              </div>
            </div>
```

City and State moved from the top-level field grid into the Address section, immediately before Street Address/Zip, since they're now rendered by the same `AddressAutofillField` block as those two. This is a minor visual reordering (City/State now sit inside "📍 Private Address" instead of above it) — everything remains editable exactly as before, just grouped with the fields that autofill can now populate together.

- [ ] **Step 3: Add a Zip line to the read-only view**

Change:

```tsx
          <Field label="City" value={profile?.city} />
          <Field label="State" value={profile?.state} />
          <Field label="Phone" value={profile?.phone} />
          <Field label="Member Since" value={formatDate(profile?.created_at)} />
          {profile?.address && (
            <Field label="Address" value={[profile.address, profile.address_unit].filter(Boolean).join(' ')} />
          )}
```

to:

```tsx
          <Field label="City" value={profile?.city} />
          <Field label="State" value={profile?.state} />
          <Field label="Phone" value={profile?.phone} />
          <Field label="Member Since" value={formatDate(profile?.created_at)} />
          {profile?.address && (
            <Field label="Address" value={[profile.address, profile.address_unit].filter(Boolean).join(' ')} />
          )}
          {profile?.zip && (
            <Field label="Zip" value={profile.zip} />
          )}
```

- [ ] **Step 4: Wire `zip`/`lat`/`lng` through `updateProfile`**

In `app/profile/actions.ts`, change:

```ts
  await supabase.from('profiles').update({
    city:               formData.get('city')                as string,
    state,
    phone:              formData.get('phone')               as string,
    address:            (formData.get('address')            as string) || '',
    address_unit:       (formData.get('address_unit')       as string) || '',
    share_address:      formData.get('share_address')       === 'true',
    pickup_description: (formData.get('pickup_description') as string) || '',
    share_pickup:       formData.get('share_pickup')        === 'true',
```

to:

```ts
  await supabase.from('profiles').update({
    city:               formData.get('city')                as string,
    state,
    phone:              formData.get('phone')               as string,
    address:            (formData.get('address')            as string) || '',
    address_unit:       (formData.get('address_unit')       as string) || '',
    zip:                (formData.get('zip')                as string) || '',
    lat:                formData.get('lat') ? parseFloat(formData.get('lat') as string) : null,
    lng:                formData.get('lng') ? parseFloat(formData.get('lng') as string) : null,
    share_address:      formData.get('share_address')       === 'true',
    pickup_description: (formData.get('pickup_description') as string) || '',
    share_pickup:       formData.get('share_pickup')        === 'true',
```

Everything below (notification fields) and the rest of the file (`updateListingStatus` and everything after it) is unchanged.

- [ ] **Step 5: Confirm `app/profile/page.tsx` already passes `zip`/`lat`/`lng` through**

No code change needed here — `app/profile/page.tsx:81` already does `supabase.from('profiles').select('*')` for the signed-in user's own profile, so the new columns are included automatically once Task 1's migration has run. Just a sanity check: open `app/profile/page.tsx` and confirm line 81 still reads `select('*')` (not an explicit column list) before moving on.

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS. `app/profile/DashboardClient.test.tsx`, `HistorySection.test.tsx`, `MessagesTab.test.tsx`, and `TbrAddForm.test.tsx` don't touch `ProfileCard` or `updateProfile` directly, so none should be affected — but confirm none newly fail.

- [ ] **Step 7: Commit**

```bash
git add app/profile/ProfileCard.tsx app/profile/actions.ts
git commit -m "feat: wire Mapbox address autofill into profile edit

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Final verification

**Files:** None — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, all tests green (prior suite count + the 3 new `AddressAutofillField` tests from Task 2).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors introduced by this plan's changes. (Compare against a `git stash` baseline if any pre-existing errors are present — confirm the error list is unchanged, not that it's empty.)

- [ ] **Step 3: Manual smoke test**

With `NEXT_PUBLIC_MAPBOX_TOKEN` set in `.env.local` (Task 2, Step 2) and the Task 1 migration applied to the Supabase project this dev server points at:

1. Run `npm run dev`, open `/auth/signup`.
2. Type a real street address into "Street Address" — confirm a Mapbox suggestions dropdown appears.
3. Pick a suggestion — confirm City, State, and Zip Code fill in automatically.
4. Complete and submit the signup form; confirm the account is created without error.
5. Sign in as that account, go to `/profile`, click Edit — confirm Zip shows up under the read-only view (after saving) and the address fields are pre-filled.
6. In Supabase's Table Editor, open the `profiles` row for that account and confirm `zip`, `lat`, `lng` all have real values (not empty/null).
7. Edit the profile again without touching the address (e.g. just change Phone) and save — confirm `lat`/`lng` in the database are unchanged, not wiped to null.

- [ ] **Step 4: Confirm no code changes remain uncommitted**

Run: `git status -s`
Expected: Clean (aside from `.env.local`, which is gitignored and expected to show no diff, and any files unrelated to this plan, e.g. `.claude/`).
