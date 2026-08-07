# State Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every place a user's state is entered stores the canonical 2-letter USPS abbreviation, fixing admin location grouping, TBR match notifications, and the admin Locations chart's broken "State" view — for both new data and the data that's already inconsistent.

**Architecture:** A shared `US_STATES` list (`lib/usStates.ts`) backs a new `<StateSelect>` dropdown component (`components/StateSelect.tsx`), which replaces the three free-text `<input name="state">` fields (signup, profile edit, TBR wishlist). A one-time SQL migration backfills existing `profiles.state` / `tbr_entries.state` rows that can be confidently mapped; a small logic fix corrects the admin chart's dead "State" grouping.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Vitest + @testing-library/react, Supabase/Postgres.

## Global Constraints

- Dropdown covers 50 states + DC only — no US territories (per approved spec).
- Unrecognized existing `state` values are left untouched by the backfill, never blanked or guessed at (per approved spec).
- No server action changes — `updateProfile` and `addTbrEntry` already pass `state` through as a plain string; a `<select>` submits identically to a text `<input>` via `FormData`.
- Match this repo's existing code style: no semicolons, single quotes, 2-space indent (see any existing `.tsx` file in `app/` or `components/`).

---

### Task 1: `US_STATES` shared data list

**Files:**
- Create: `lib/usStates.ts`
- Test: `lib/usStates.test.ts`

**Interfaces:**
- Produces: `US_STATES: { code: string; name: string }[]` — exported constant, 50 states + DC, sorted alphabetically by `name`. Consumed by Task 2's `StateSelect`.

- [ ] **Step 1: Write the failing test**

Create `lib/usStates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { US_STATES } from './usStates'

describe('US_STATES', () => {
  it('has 50 states plus the District of Columbia', () => {
    expect(US_STATES).toHaveLength(51)
  })

  it('has a unique 2-letter uppercase code for every entry', () => {
    const codes = US_STATES.map(s => s.code)
    expect(new Set(codes).size).toBe(codes.length)
    codes.forEach(code => expect(code).toMatch(/^[A-Z]{2}$/))
  })

  it('is sorted alphabetically by name', () => {
    const names = US_STATES.map(s => s.name)
    const sorted = [...names].sort((a, b) => a.localeCompare(b))
    expect(names).toEqual(sorted)
  })

  it('includes California mapped to CA and Illinois mapped to IL', () => {
    expect(US_STATES.find(s => s.name === 'California')).toEqual({ code: 'CA', name: 'California' })
    expect(US_STATES.find(s => s.name === 'Illinois')).toEqual({ code: 'IL', name: 'Illinois' })
  })

  it('includes the District of Columbia mapped to DC', () => {
    expect(US_STATES.find(s => s.name === 'District of Columbia')).toEqual({ code: 'DC', name: 'District of Columbia' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/usStates.test.ts`
Expected: FAIL — `Cannot find module './usStates'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/usStates.ts`:

```ts
// 50 states + DC, sorted alphabetically by name. Single source of truth for
// the StateSelect dropdown (components/StateSelect.tsx). The backfill
// migration in supabase/schema.sql maps historical free-text values onto
// these same codes but does not import this file (SQL can't) — keep them
// in sync by hand if this list ever changes.
export type UsState = { code: string; name: string }

export const US_STATES: UsState[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/usStates.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/usStates.ts lib/usStates.test.ts
git commit -m "feat: add US_STATES shared state list"
```

---

### Task 2: `StateSelect` component

**Files:**
- Create: `components/StateSelect.tsx`
- Test: `components/StateSelect.test.tsx`

**Interfaces:**
- Consumes: `US_STATES` from `lib/usStates.ts` (Task 1).
- Produces: `StateSelect` default export, props `{ name: string; defaultValue?: string; required?: boolean; placeholder: string; className?: string; style?: React.CSSProperties }`. Consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Write the failing test**

Create `components/StateSelect.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import StateSelect from './StateSelect'

describe('StateSelect', () => {
  it('renders every US state plus DC as an option, plus the placeholder', () => {
    render(<StateSelect name="state" placeholder="Select a state" />)
    // 51 states/DC + 1 placeholder option
    expect(screen.getAllByRole('option')).toHaveLength(52)
  })

  it('shows the placeholder text as the empty option', () => {
    render(<StateSelect name="state" placeholder="Any state" />)
    expect(screen.getByRole('option', { name: 'Any state' })).toHaveValue('')
  })

  it('preselects the defaultValue', () => {
    render(<StateSelect name="state" defaultValue="IL" placeholder="Select a state" />)
    expect(screen.getByRole('combobox')).toHaveValue('IL')
  })

  it('blocks submission on an empty value when required', () => {
    render(<StateSelect name="state" required placeholder="Select a state" />)
    expect(screen.getByRole('combobox')).toBeInvalid()
  })

  it('allows an empty value when not required, preserving "match any state"', () => {
    render(<StateSelect name="state" placeholder="Any state" />)
    expect(screen.getByRole('combobox')).toBeValid()
  })

  it('submits the selected state code under the given field name', () => {
    const { container } = render(
      <form>
        <StateSelect name="state" placeholder="Select a state" />
      </form>
    )
    const select = screen.getByRole('combobox')
    fireEvent.change(select, { target: { value: 'CA' } })
    const formData = new FormData(container.querySelector('form')!)
    expect(formData.get('state')).toBe('CA')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/StateSelect.test.tsx`
Expected: FAIL — `Cannot find module './StateSelect'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `components/StateSelect.tsx`:

```tsx
import { US_STATES } from '@/lib/usStates'

type Props = {
  name: string
  defaultValue?: string
  required?: boolean
  placeholder: string
  className?: string
  style?: React.CSSProperties
}

// A plain <option value=""> placeholder — never disabled. Disabling it is a
// common footgun: browsers skip a disabled first option and auto-select the
// next one instead (silently landing on "Alabama"), which is worse than no
// placeholder at all. `required` alone is enough to block submission while
// the empty option is still selected.
export default function StateSelect({ name, defaultValue, required, placeholder, className, style }: Props) {
  return (
    <select
      name={name}
      defaultValue={defaultValue ?? ''}
      required={required}
      className={className}
      style={style}
    >
      <option value="">{placeholder}</option>
      {US_STATES.map(s => (
        <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
      ))}
    </select>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/StateSelect.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add components/StateSelect.tsx components/StateSelect.test.tsx
git commit -m "feat: add StateSelect dropdown component"
```

---

### Task 3: Wire `StateSelect` into signup

**Files:**
- Modify: `app/auth/signup/page.tsx:1-4` (imports), `app/auth/signup/page.tsx:88-93` (State field)

**Interfaces:**
- Consumes: `StateSelect` from `components/StateSelect.tsx` (Task 2).

- [ ] **Step 1: Add the import**

In `app/auth/signup/page.tsx`, change:

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContactToggle from './ContactToggle'
import ShareToggle from '@/components/ShareToggle'
```

to:

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContactToggle from './ContactToggle'
import ShareToggle from '@/components/ShareToggle'
import StateSelect from '@/components/StateSelect'
```

- [ ] **Step 2: Replace the free-text state input**

In the same file, change:

```tsx
          {/* State */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>State{req}</label>
            <input name="state" type="text" placeholder="e.g. IL" required
              className={inputClass} style={inputStyle} />
          </div>
```

to:

```tsx
          {/* State */}
          <div>
            <label className="block mb-1.5" style={labelStyle}>State{req}</label>
            <StateSelect name="state" required placeholder="Select a state"
              className={inputClass} style={inputStyle} />
          </div>
```

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS, same count as before this task (this file has no existing test suite of its own — this step is the only automated check for it).

- [ ] **Step 4: Commit**

```bash
git add app/auth/signup/page.tsx
git commit -m "feat: use StateSelect dropdown on signup"
```

---

### Task 4: Wire `StateSelect` into profile edit

**Files:**
- Modify: `app/profile/ProfileCard.tsx:1-4` (imports), `app/profile/ProfileCard.tsx:103-107` (State field, edit mode)

**Interfaces:**
- Consumes: `StateSelect` from `components/StateSelect.tsx` (Task 2).

- [ ] **Step 1: Add the import**

In `app/profile/ProfileCard.tsx`, change:

```tsx
'use client'

import { useState } from 'react'
import ShareToggle from '@/components/ShareToggle'
```

to:

```tsx
'use client'

import { useState } from 'react'
import ShareToggle from '@/components/ShareToggle'
import StateSelect from '@/components/StateSelect'
```

- [ ] **Step 2: Replace the free-text state input**

In the same file, change:

```tsx
            <div>
              <EditLabel>State</EditLabel>
              <input name="state" defaultValue={profile?.state ?? ''} required
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>
```

to:

```tsx
            <div>
              <EditLabel>State</EditLabel>
              <StateSelect name="state" defaultValue={profile?.state ?? ''} required placeholder="Select a state"
                className={inputClass} style={{ padding: '12px 16px' }} />
            </div>
```

View mode (the `<Field label="State" value={profile?.state} />` a few lines down) is unchanged — it just displays whatever's stored.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS, same count as before this task (this file has no existing test suite of its own — this step is the only automated check for it).

- [ ] **Step 4: Commit**

```bash
git add app/profile/ProfileCard.tsx
git commit -m "feat: use StateSelect dropdown on profile edit"
```

---

### Task 5: Wire `StateSelect` into the TBR add form

**Files:**
- Modify: `app/profile/DashboardClient.tsx` (imports near top; the TBR "Add" form)
- Test: `app/profile/DashboardClient.test.tsx`

**Interfaces:**
- Consumes: `StateSelect` from `components/StateSelect.tsx` (Task 2).

- [ ] **Step 1: Write the failing test**

In `app/profile/DashboardClient.test.tsx`, add this test inside the existing `describe('DashboardClient — notification badges and highlighting', ...)` block (it already has `beforeEach`/`it` blocks — add alongside them, e.g. right after the `'shows the tbr unread count as a badge on the TBR tab'` test):

```tsx
  it('offers a state dropdown (not free text) on the TBR add form, with "any state" as the default', () => {
    render(<DashboardClient {...baseProps} exchanges={[]} defaultTab="tbr" />)
    // The TBR add form's state field is the only <select> rendered on this tab.
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Any state' })).toHaveValue('')
    expect(screen.getByRole('option', { name: 'IL — Illinois' })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/profile/DashboardClient.test.tsx`
Expected: FAIL — no `combobox` role exists yet on the TBR tab (the field is still a text `<input>`).

- [ ] **Step 3: Add the import**

In `app/profile/DashboardClient.tsx`, change:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import ProfileCard from './ProfileCard'
import MessagesTab from './MessagesTab'
import HistorySection, { type HistoryExchange } from './HistorySection'
import { createClient } from '@/lib/supabase/client'
```

to:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import ProfileCard from './ProfileCard'
import MessagesTab from './MessagesTab'
import HistorySection, { type HistoryExchange } from './HistorySection'
import { createClient } from '@/lib/supabase/client'
import StateSelect from '@/components/StateSelect'
```

- [ ] **Step 4: Replace the free-text state input in the TBR add form**

In the same file, change:

```tsx
            <input name="state" placeholder="State (optional)..."
              className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
              style={{ padding: '9px 12px', minWidth: 100 }} />
```

to:

```tsx
            <StateSelect name="state" placeholder="Any state"
              className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
              style={{ padding: '9px 12px', minWidth: 100 }} />
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run app/profile/DashboardClient.test.tsx`
Expected: PASS (all tests in this file, including the new one)

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/profile/DashboardClient.tsx app/profile/DashboardClient.test.tsx
git commit -m "feat: use StateSelect dropdown on the TBR add form"
```

---

### Task 6: Fix the admin Locations chart's broken "State" grouping

**Files:**
- Modify: `app/admin/AdminClient.tsx:126-144` (`UserLocationsChart`'s `data` computation)

**Interfaces:**
- None — self-contained logic fix, no new exports.

- [ ] **Step 1: Fix the grouping key**

In `app/admin/AdminClient.tsx`, change:

```tsx
  const data = useMemo(() => {
    const counts: Record<string, number> = {}
    users.forEach(u => {
      let key = ''
      if (view === 'city') {
        key = u.city
      } else if (view === 'state') {
        const parts = u.city.split(', ')
        key = parts[1] ?? u.city
      } else {
        // street — mock: group by first word of city as a stand-in for neighbourhood
        key = u.city.split(',')[0]
      }
      counts[key] = (counts[key] ?? 0) + 1
    })
```

to:

```tsx
  const data = useMemo(() => {
    const counts: Record<string, number> = {}
    users.forEach(u => {
      let key = ''
      if (view === 'city') {
        key = u.city
      } else if (view === 'state') {
        key = u.state || '(no state)'
      } else {
        // street — mock: group by first word of city as a stand-in for neighbourhood
        key = u.city.split(',')[0]
      }
      counts[key] = (counts[key] ?? 0) + 1
    })
```

This was previously always falling through to grouping by city (`u.city` never contains a comma, so `parts[1]` was always `undefined`) — it never read the real `state` field at all. Now that `state` is consistently a 2-letter code (Tasks 3–5, plus the Task 7 backfill), grouping by it directly is meaningful.

- [ ] **Step 2: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS (this file has no existing test suite of its own — this step is the only automated check for it)

- [ ] **Step 3: Commit**

```bash
git add app/admin/AdminClient.tsx
git commit -m "fix: admin Locations chart groups by the real state field"
```

---

### Task 7: Backfill migration for existing data

**Files:**
- Modify: `supabase/schema.sql` (append a new migration block at the end of the file)

**Interfaces:**
- None — one-time SQL script, not application code.

- [ ] **Step 1: Append the migration block**

Append this to the end of `supabase/schema.sql` (after the final `-- ──...──` divider line that currently ends the file):

```sql

-- ── Migration: normalize existing state values to 2-letter codes ──────────────
-- Run this block in Supabase SQL Editor:
-- One-time backfill. profiles.state and tbr_entries.state used to be free
-- text (e.g. "California", "ca", "CA" all meant the same state but were
-- stored as different strings) — this broke both admin location grouping
-- and the exact-match comparison against profiles.state in
-- notify_tbr_matches() (see that function, further up this file). New
-- entries now come from a fixed <select> of 2-letter codes
-- (components/StateSelect.tsx / lib/usStates.ts), so this is a one-time
-- fix, not an ongoing function. Anything not recognized below (typos,
-- blank, non-US values) is left untouched rather than guessed at — those
-- rows are visible afterward in the admin Users tab for manual fixing.
with state_map(input, code) as (
  values
    ('alabama','AL'), ('al','AL'),
    ('alaska','AK'), ('ak','AK'),
    ('arizona','AZ'), ('az','AZ'),
    ('arkansas','AR'), ('ar','AR'),
    ('california','CA'), ('ca','CA'),
    ('colorado','CO'), ('co','CO'),
    ('connecticut','CT'), ('ct','CT'),
    ('delaware','DE'), ('de','DE'),
    ('district of columbia','DC'), ('washington dc','DC'), ('washington d.c.','DC'), ('dc','DC'),
    ('florida','FL'), ('fl','FL'),
    ('georgia','GA'), ('ga','GA'),
    ('hawaii','HI'), ('hi','HI'),
    ('idaho','ID'), ('id','ID'),
    ('illinois','IL'), ('il','IL'),
    ('indiana','IN'), ('in','IN'),
    ('iowa','IA'), ('ia','IA'),
    ('kansas','KS'), ('ks','KS'),
    ('kentucky','KY'), ('ky','KY'),
    ('louisiana','LA'), ('la','LA'),
    ('maine','ME'), ('me','ME'),
    ('maryland','MD'), ('md','MD'),
    ('massachusetts','MA'), ('ma','MA'),
    ('michigan','MI'), ('mi','MI'),
    ('minnesota','MN'), ('mn','MN'),
    ('mississippi','MS'), ('ms','MS'),
    ('missouri','MO'), ('mo','MO'),
    ('montana','MT'), ('mt','MT'),
    ('nebraska','NE'), ('ne','NE'),
    ('nevada','NV'), ('nv','NV'),
    ('new hampshire','NH'), ('nh','NH'),
    ('new jersey','NJ'), ('nj','NJ'),
    ('new mexico','NM'), ('nm','NM'),
    ('new york','NY'), ('ny','NY'),
    ('north carolina','NC'), ('nc','NC'),
    ('north dakota','ND'), ('nd','ND'),
    ('ohio','OH'), ('oh','OH'),
    ('oklahoma','OK'), ('ok','OK'),
    ('oregon','OR'), ('or','OR'),
    ('pennsylvania','PA'), ('pa','PA'),
    ('rhode island','RI'), ('ri','RI'),
    ('south carolina','SC'), ('sc','SC'),
    ('south dakota','SD'), ('sd','SD'),
    ('tennessee','TN'), ('tn','TN'),
    ('texas','TX'), ('tx','TX'),
    ('utah','UT'), ('ut','UT'),
    ('vermont','VT'), ('vt','VT'),
    ('virginia','VA'), ('va','VA'),
    ('washington','WA'), ('wa','WA'),
    ('west virginia','WV'), ('wv','WV'),
    ('wisconsin','WI'), ('wi','WI'),
    ('wyoming','WY'), ('wy','WY')
)
update profiles set state = m.code
from state_map m
where lower(trim(profiles.state)) = m.input
  and profiles.state <> m.code;

with state_map(input, code) as (
  values
    ('alabama','AL'), ('al','AL'),
    ('alaska','AK'), ('ak','AK'),
    ('arizona','AZ'), ('az','AZ'),
    ('arkansas','AR'), ('ar','AR'),
    ('california','CA'), ('ca','CA'),
    ('colorado','CO'), ('co','CO'),
    ('connecticut','CT'), ('ct','CT'),
    ('delaware','DE'), ('de','DE'),
    ('district of columbia','DC'), ('washington dc','DC'), ('washington d.c.','DC'), ('dc','DC'),
    ('florida','FL'), ('fl','FL'),
    ('georgia','GA'), ('ga','GA'),
    ('hawaii','HI'), ('hi','HI'),
    ('idaho','ID'), ('id','ID'),
    ('illinois','IL'), ('il','IL'),
    ('indiana','IN'), ('in','IN'),
    ('iowa','IA'), ('ia','IA'),
    ('kansas','KS'), ('ks','KS'),
    ('kentucky','KY'), ('ky','KY'),
    ('louisiana','LA'), ('la','LA'),
    ('maine','ME'), ('me','ME'),
    ('maryland','MD'), ('md','MD'),
    ('massachusetts','MA'), ('ma','MA'),
    ('michigan','MI'), ('mi','MI'),
    ('minnesota','MN'), ('mn','MN'),
    ('mississippi','MS'), ('ms','MS'),
    ('missouri','MO'), ('mo','MO'),
    ('montana','MT'), ('mt','MT'),
    ('nebraska','NE'), ('ne','NE'),
    ('nevada','NV'), ('nv','NV'),
    ('new hampshire','NH'), ('nh','NH'),
    ('new jersey','NJ'), ('nj','NJ'),
    ('new mexico','NM'), ('nm','NM'),
    ('new york','NY'), ('ny','NY'),
    ('north carolina','NC'), ('nc','NC'),
    ('north dakota','ND'), ('nd','ND'),
    ('ohio','OH'), ('oh','OH'),
    ('oklahoma','OK'), ('ok','OK'),
    ('oregon','OR'), ('or','OR'),
    ('pennsylvania','PA'), ('pa','PA'),
    ('rhode island','RI'), ('ri','RI'),
    ('south carolina','SC'), ('sc','SC'),
    ('south dakota','SD'), ('sd','SD'),
    ('tennessee','TN'), ('tn','TN'),
    ('texas','TX'), ('tx','TX'),
    ('utah','UT'), ('ut','UT'),
    ('vermont','VT'), ('vt','VT'),
    ('virginia','VA'), ('va','VA'),
    ('washington','WA'), ('wa','WA'),
    ('west virginia','WV'), ('wv','WV'),
    ('wisconsin','WI'), ('wi','WI'),
    ('wyoming','WY'), ('wy','WY')
)
update tbr_entries set state = m.code
from state_map m
where lower(trim(tbr_entries.state)) = m.input
  and tbr_entries.state <> m.code;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: backfill migration to normalize existing state values"
```

- [ ] **Step 3: Run the migration against the real database (manual, not automated)**

This step is not run by an automated test — it modifies real data. Do it once, when ready to ship:

1. Open the Supabase project's SQL Editor.
2. Paste and run the new migration block from `supabase/schema.sql` (the block between the `-- ── Migration: normalize existing state values...` header and its closing divider).
3. Spot-check: in the admin Users tab, confirm a previously-inconsistent account (e.g. one that showed "California") now shows "CA". In the Locations chart's "State" view, confirm the bars now group by 2-letter code instead of city name.

---

### Task 8: Final full-suite verification

**Files:** None — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, all tests green (prior suite count + the new tests from Tasks 1, 2, and 5).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors introduced by this plan's changes. (This repo has a handful of pre-existing, unrelated errors — e.g. in `app/profile/HistorySection.test.tsx` and files using `[...new Set(...)]` — confirm the error list is unchanged from `git stash`'s baseline, not that it's empty.)

- [ ] **Step 3: Confirm no code changes remain uncommitted**

Run: `git status -s`
Expected: Clean (aside from any files unrelated to this plan, e.g. `.claude/`).
