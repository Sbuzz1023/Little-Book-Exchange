# Server/DB-Side State Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A value that isn't one of the 51 valid state codes can never end up stored in `profiles.state` or `tbr_entries.state` again, regardless of which code path writes it — closing the gap flagged as finding #2 in the state-normalization feature's final review.

**Architecture:** A pure `isValidStateCode()` helper (`lib/usStates.ts`) backs a one-line coercion added to each of the three write paths (`updateProfile`, `addTbrEntry`, `signUp`) — invalid input becomes `''`, the existing "no state" value every path already understands. A validated `CHECK` constraint on both `profiles.state` and `tbr_entries.state` (added after a one-time cleanup of any non-conforming legacy rows) is the permanent database-level backstop.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Vitest, Supabase/Postgres.

## Global Constraints

- On invalid input, coerce to `''` silently — never reject/show an error. This path is unreachable through the `<StateSelect>` dropdown; it only matters for a hand-crafted request, so there's no user to show an error to (per approved spec).
- The DB constraint is a *format* check (`^[A-Z]{2}$`), not an exact match against all 51 codes. It must be added validated, not `NOT VALID` — `NOT VALID` only skips the initial verification scan, not per-row enforcement on every future `UPDATE`, which would make any pre-existing non-conforming row permanently un-updatable (this was caught and fixed during the final review; see Task 5). Any non-conforming legacy rows are measured and blanked before the constraint is added, so it applies cleanly with no follow-up validation step needed.
- No new test files for `app/profile/actions.ts`, `lib/actions/tbrEntries.ts`, or `app/auth/signup/page.tsx` — this repo has no precedent for mocking the Supabase server client in a test, and none of these three files has a test file today. Full logic coverage lives in `isValidStateCode()`'s tests; the three call sites are thin, one-line changes verified by the full suite (per approved spec).
- Code style: no semicolons, single quotes, 2-space indent (TS/TSX); SQL matches the style of the existing migration blocks already in `supabase/schema.sql`.

---

### Task 1: `isValidStateCode` helper

**Files:**
- Modify: `lib/usStates.ts` (append the function)
- Modify: `lib/usStates.test.ts` (append the tests)

**Interfaces:**
- Produces: `isValidStateCode(code: string): boolean` — exported function. Consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Write the failing tests**

In `lib/usStates.test.ts`, add this new `describe` block at the end of the file (after the existing `describe('US_STATES', ...)` block):

```ts
describe('isValidStateCode', () => {
  it('returns true for a valid state code', () => {
    expect(isValidStateCode('CA')).toBe(true)
  })

  it('returns true for DC', () => {
    expect(isValidStateCode('DC')).toBe(true)
  })

  it('returns false for an empty string', () => {
    expect(isValidStateCode('')).toBe(false)
  })

  it('returns false for a lowercase code', () => {
    expect(isValidStateCode('ca')).toBe(false)
  })

  it('returns false for a full state name', () => {
    expect(isValidStateCode('California')).toBe(false)
  })

  it('returns false for a two-letter code that is not a real state', () => {
    expect(isValidStateCode('ZZ')).toBe(false)
  })
})
```

Update the import at the top of the file from:

```ts
import { describe, it, expect } from 'vitest'
import { US_STATES } from './usStates'
```

to:

```ts
import { describe, it, expect } from 'vitest'
import { US_STATES, isValidStateCode } from './usStates'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/usStates.test.ts`
Expected: FAIL — `isValidStateCode is not a function` (doesn't exist yet).

- [ ] **Step 3: Write the implementation**

In `lib/usStates.ts`, append this after the `US_STATES` array (after its closing `]`):

```ts

export function isValidStateCode(code: string): boolean {
  return US_STATES.some(s => s.code === code)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/usStates.test.ts`
Expected: PASS (11 tests — 5 existing + 6 new)

- [ ] **Step 5: Commit**

```bash
git add lib/usStates.ts lib/usStates.test.ts
git commit -m "feat: add isValidStateCode helper"
```

---

### Task 2: Coerce invalid state in `updateProfile`

**Files:**
- Modify: `app/profile/actions.ts:1-25`

**Interfaces:**
- Consumes: `isValidStateCode` from `lib/usStates.ts` (Task 1).

- [ ] **Step 1: Add the import and the coercion**

In `app/profile/actions.ts`, change:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { buildConfirmationMessage } from '@/lib/buildConfirmationMessage'

export async function updateProfile(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  await supabase.from('profiles').update({
    city:               formData.get('city')                as string,
    state:              formData.get('state')               as string,
    phone:              formData.get('phone')               as string,
```

to:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { buildConfirmationMessage } from '@/lib/buildConfirmationMessage'
import { isValidStateCode } from '@/lib/usStates'

export async function updateProfile(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const rawState = (formData.get('state') as string) ?? ''
  const state = isValidStateCode(rawState) ? rawState : ''
  await supabase.from('profiles').update({
    city:               formData.get('city')                as string,
    state,
    phone:              formData.get('phone')               as string,
```

Everything below `state,` (address, share_address, notification fields, etc.) is unchanged — only the `state` line and the two new lines above the `.update()` call change.

- [ ] **Step 2: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS (this file has no dedicated test suite of its own — this step is the only automated check for it, per the Global Constraints).

- [ ] **Step 3: Commit**

```bash
git add app/profile/actions.ts
git commit -m "fix: reject an invalid state value in updateProfile"
```

---

### Task 3: Coerce invalid state in `addTbrEntry`

**Files:**
- Modify: `lib/actions/tbrEntries.ts:1-11`

**Interfaces:**
- Consumes: `isValidStateCode` from `lib/usStates.ts` (Task 1).

- [ ] **Step 1: Add the import and the coercion**

In `lib/actions/tbrEntries.ts`, change:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function addTbrEntry(formData: FormData): Promise<void> {
  const title = ((formData.get('title') as string) || '').trim()
  const author = ((formData.get('author') as string) || '').trim()
  const city = ((formData.get('city') as string) || '').trim()
  const state = ((formData.get('state') as string) || '').trim()
  const redirectTo = ((formData.get('redirect_to') as string) || '').trim() || '/profile'
```

to:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isValidStateCode } from '@/lib/usStates'

export async function addTbrEntry(formData: FormData): Promise<void> {
  const title = ((formData.get('title') as string) || '').trim()
  const author = ((formData.get('author') as string) || '').trim()
  const city = ((formData.get('city') as string) || '').trim()
  const rawState = ((formData.get('state') as string) || '').trim()
  const state = isValidStateCode(rawState) ? rawState : ''
  const redirectTo = ((formData.get('redirect_to') as string) || '').trim() || '/profile'
```

Everything below (the `title`/`author` check, the insert, `removeTbrEntry`) is unchanged.

- [ ] **Step 2: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS (this file has no dedicated test suite of its own — this step is the only automated check for it, per the Global Constraints).

- [ ] **Step 3: Commit**

```bash
git add lib/actions/tbrEntries.ts
git commit -m "fix: reject an invalid state value in addTbrEntry"
```

---

### Task 4: Coerce invalid state in `signUp`

**Files:**
- Modify: `app/auth/signup/page.tsx:1-24`

**Interfaces:**
- Consumes: `isValidStateCode` from `lib/usStates.ts` (Task 1).

- [ ] **Step 1: Add the import**

In `app/auth/signup/page.tsx`, change:

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContactToggle from './ContactToggle'
import ShareToggle from '@/components/ShareToggle'
import StateSelect from '@/components/StateSelect'
```

to:

```tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import ContactToggle from './ContactToggle'
import ShareToggle from '@/components/ShareToggle'
import StateSelect from '@/components/StateSelect'
import { isValidStateCode } from '@/lib/usStates'
```

- [ ] **Step 2: Add the coercion**

In the same file, change:

```tsx
  async function signUp(formData: FormData) {
    'use server'
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      const { error } = await supabase.auth.signUp({
        email: formData.get('email') as string,
        password: formData.get('password') as string,
        options: {
          data: {
            username:           (formData.get('username') as string).toLowerCase().replace(/\s+/g, ''),
            city:               formData.get('city') as string,
            state:              formData.get('state') as string,
            phone:              formData.get('phone') as string,
```

to:

```tsx
  async function signUp(formData: FormData) {
    'use server'
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      const rawState = formData.get('state') as string
      const state = isValidStateCode(rawState) ? rawState : ''
      const { error } = await supabase.auth.signUp({
        email: formData.get('email') as string,
        password: formData.get('password') as string,
        options: {
          data: {
            username:           (formData.get('username') as string).toLowerCase().replace(/\s+/g, ''),
            city:               formData.get('city') as string,
            state,
            phone:              formData.get('phone') as string,
```

Everything below `state,` (contact_preference, address, etc.) and the rest of the file (error handling, the JSX form) is unchanged.

- [ ] **Step 3: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS (this file has no dedicated test suite of its own — this step is the only automated check for it, per the Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add app/auth/signup/page.tsx
git commit -m "fix: reject an invalid state value in signUp"
```

---

### Task 5: Database-level CHECK constraints

**Files:**
- Modify: `supabase/schema.sql` (append a new migration block at the end of the file)

**Interfaces:**
- None — one-time SQL script, not application code.

- [ ] **Step 1: Append the migration block**

Append this to the end of `supabase/schema.sql` (after the final `-- ──...──` divider line that currently ends the file — the one closing the "normalize existing state values to 2-letter codes" migration):

```sql

-- ── Migration: enforce state format at the database level ─────────────────────
-- Run this block in Supabase SQL Editor:
-- Backstop for the state-normalization work above: the app layer (signup,
-- profile edit, TBR add — see isValidStateCode() in lib/usStates.ts) now
-- rejects anything that isn't one of the 51 valid state codes before ever
-- writing it, but that's an app-layer guarantee, not a data-layer one — and
-- RLS does not restrict which columns a signed-in user's own browser
-- session can write (see "Users can update own profile" / "Users can add
-- tbr entries" policies above), so a direct client call bypassing the app
-- entirely can still write anything until this constraint exists. This is
-- not insurance against a hypothetical regression — until this block runs,
-- it is the only control on that direct-write path.
--
-- This is validated up front, not added NOT VALID: NOT VALID only skips
-- the one-time verification scan at creation — every subsequent INSERT
-- and UPDATE is still checked per-row, including updates that don't touch
-- `state`. Adding it NOT VALID on top of the known-remaining unmapped
-- legacy rows (left as free text by the backfill migration above,
-- deliberately not guessed at) would make every one of those rows
-- un-updatable forever after — silently breaking, among other things,
-- email/phone verification (sync_verification_status(), no exception
-- handler, runs inside GoTrue's own transaction) and exchange completion
-- (complete_exchange_marks_listing_sold()) for those users.
--
-- So: measure first, blank whatever doesn't conform (the app already
-- treats '' as "no state" everywhere — this loses no information the app
-- itself wouldn't already discard on that user's next profile save), then
-- add the constraints validated.

-- 1. Measure — inspect before blanking if you want a record of what's there.
select id, state from profiles    where state <> '' and state !~ '^[A-Z]{2}$';
select id, state from tbr_entries where state <> '' and state !~ '^[A-Z]{2}$';

-- 2. Blank anything that doesn't conform to "empty or two uppercase letters".
update profiles    set state = '' where state <> '' and state !~ '^[A-Z]{2}$';
update tbr_entries set state = '' where state <> '' and state !~ '^[A-Z]{2}$';

-- 3. Add the constraints validated — every row already complies at this
--    point, so this is instant and there is no follow-up validate step.
--    The drop-if-exists preamble matches this file's existing
--    drop-trigger-if-exists convention and makes this block safely
--    re-runnable.
alter table profiles drop constraint if exists profiles_state_format;
alter table profiles add constraint profiles_state_format
  check (state = '' or state ~ '^[A-Z]{2}$');

alter table tbr_entries drop constraint if exists tbr_entries_state_format;
alter table tbr_entries add constraint tbr_entries_state_format
  check (state = '' or state ~ '^[A-Z]{2}$');
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS (SQL-only change; this is the standard check applied to every task in this plan).

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add validated state-format CHECK constraints"
```

- [ ] **Step 4: Run the migration against the real database (manual, not automated)**

This step is not run by an automated test — it modifies real schema. **This is a hard deploy gate, not an optional follow-up:** RLS does not restrict which columns a signed-in user's own browser session may write directly, so until this migration runs, the app-layer guard from Tasks 1-4 is the *only* thing stopping bad data — any user can bypass it entirely via a direct client call (e.g. the browser console). Run this promptly after Tasks 1-4 are deployed, not "whenever convenient":

1. Open the Supabase project's SQL Editor.
2. If you want to see which rows (if any) are about to be blanked, run just the two `select` statements at the top of the migration block first, on their own — the Supabase SQL Editor only surfaces the last statement's result set for a multi-statement paste, so their output is otherwise invisible once you run the whole block. Then paste and run the full migration block from `supabase/schema.sql` (the block between the `-- ── Migration: enforce state format at the database level...` header and its closing divider). It's a measure → blank → add-validated sequence (see the block's own comments) followed by two independent `alter table` statements — no temp table, no cross-statement transaction dependency (same lesson as the earlier backfill migration's fix).
3. Verify the constraints exist and are validated (non-destructive — no write to any real row):
```sql
select conname, convalidated, pg_get_constraintdef(oid)
from pg_constraint
where conname in ('profiles_state_format', 'tbr_entries_state_format');
```
Expect two rows, both with `convalidated = true`.

---

### Task 6: Final full-suite verification

**Files:** None — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS, all tests green (prior suite count + the 6 new tests from Task 1).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: No new errors introduced by this plan's changes. (This repo has a handful of pre-existing, unrelated errors — e.g. in `app/profile/HistorySection.test.tsx` and files using `[...new Set(...)]` — confirm the error list is unchanged from a `git stash` baseline, not that it's empty.)

- [ ] **Step 3: Confirm no code changes remain uncommitted**

Run: `git status -s`
Expected: Clean (aside from any files unrelated to this plan, e.g. `.claude/`).
