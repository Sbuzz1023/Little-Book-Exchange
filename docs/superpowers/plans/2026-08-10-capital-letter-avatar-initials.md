# Capital-Letter Avatar Initials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nav bar avatar show initials derived from the capital letters a user actually typed in their username (e.g. "SeanB" → "SB"), instead of always using the first characters of an all-lowercase string.

**Architecture:** Stop force-lowercasing usernames on write (signup, profile edit) so casing is preserved end-to-end. Convert `profiles.username` to Postgres's `citext` type so uniqueness and sign-in lookups stay case-insensitive despite preserving casing. Extract the avatar-initials algorithm into a small, independently-tested pure function (`lib/avatarInitials.ts`) and wire it into `components/Nav.tsx` in place of the current inline `initials()` helper.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (Postgres), Vitest + Testing Library.

## Global Constraints

- Code style: no semicolons, single quotes, 2-space indent (TS/TSX); SQL matches the style of the existing migration blocks already in `supabase/schema.sql`.
- Casing is preserved everywhere a username is stored/displayed, not just for the avatar (per approved spec, Decisions section).
- Username uniqueness and sign-in lookup must remain case-insensitive after this change (per approved spec).
- Only signup and profile edit may change the stored casing of a username; sign-in never writes to `profiles.username`.
- Full spec: `docs/superpowers/specs/2026-08-10-capital-letter-avatar-initials-design.md` — read it before starting if anything below is unclear.
- Known pitfall: running `npx vitest run` from the main repo while a `.claude/worktrees/*` directory exists on disk picks up that worktree's nested test files too and produces spurious failures. Always run tests with `--exclude ".claude/**"`.

---

### Task 1: Database migration — case-insensitive username

**Files:**
- Modify: `supabase/schema.sql` (append a new migration block at the end of the file)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `profiles.username` becomes `citext` instead of `text`. Every later task that reads/writes `profiles.username` relies on this being case-insensitive for comparison/uniqueness while preserving stored casing.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

Append this to the very end of the file, after the current last line (the closing divider of the "Migration: Mapbox address autofill (zip)" block):

```sql

-- ── Migration: case-insensitive usernames (capital-letter avatar initials) ─────
-- Run this block in Supabase SQL Editor. Backs the capital-letter avatar
-- initials feature — see
-- docs/superpowers/specs/2026-08-10-capital-letter-avatar-initials-design.md.
--
-- Converts profiles.username from `text` to `citext` (case-insensitive
-- text). This keeps username uniqueness and sign-in lookups working
-- correctly once the app stops force-lowercasing usernames on save —
-- "SeanB" and "seanb" are treated as the same username for comparison and
-- uniqueness, while the exact casing typed by the user is still what gets
-- stored and returned. Safe against existing data: every username stored
-- before this migration is already all-lowercase (a side effect of the
-- app's old .toLowerCase() calls), so there are no case collisions to
-- resolve.
CREATE EXTENSION IF NOT EXISTS citext;
ALTER TABLE profiles ALTER COLUMN username TYPE citext;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "docs: add case-insensitive username migration for avatar initials"
```

- [ ] **Step 3: Run the migration against the real database (manual, not automated)**

1. Open the Supabase project's SQL Editor.
2. Paste and run the full migration block added in Step 1 (from `-- ── Migration: case-insensitive usernames...` to its closing divider).
3. Confirm it succeeds with no errors. (There is no automated test for this step — `schema.sql` is not executed by the test suite, consistent with how the existing Mapbox `zip` column migration was verified.)

---

### Task 2: `lib/avatarInitials.ts` — the initials algorithm, TDD

**Files:**
- Create: `lib/avatarInitials.ts`
- Test: `lib/avatarInitials.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export function avatarInitials(username: string): string` — Task 3 imports this exact name and signature from `@/lib/avatarInitials` and calls it in place of the old inline `initials()` in `components/Nav.tsx`.

- [ ] **Step 1: Write the failing tests**

Create `lib/avatarInitials.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { avatarInitials } from './avatarInitials'

describe('avatarInitials', () => {
  it('uses the first two capital letters when two or more are present', () => {
    expect(avatarInitials('SeanB')).toBe('SB')
  })

  it('finds capitals anywhere in the string, not just at word starts', () => {
    expect(avatarInitials('sarahREADS')).toBe('RE')
  })

  it('combines the first character with the one capital when the capital is not first', () => {
    expect(avatarInitials('3sEan')).toBe('3E')
  })

  it('does not duplicate the character when the lone capital is the first character', () => {
    expect(avatarInitials('Sean')).toBe('S')
  })

  it('falls back to the first character, uppercased, when there are no capitals', () => {
    expect(avatarInitials('seanbuczynski')).toBe('S')
  })

  it('falls back to the first character as-is when it is a digit and there are no capitals', () => {
    expect(avatarInitials('3sean')).toBe('3')
  })

  it('returns an empty string for an empty username', () => {
    expect(avatarInitials('')).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/avatarInitials.test.ts --exclude ".claude/**"`
Expected: FAIL — `avatarInitials` is not defined / module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/avatarInitials.ts`:

```ts
// Avatar initials for the nav bar, derived from the capital letters a user
// typed in their username (e.g. "SeanB" -> "SB"). See
// docs/superpowers/specs/2026-08-10-capital-letter-avatar-initials-design.md
// for the full rule table and rationale.
export function avatarInitials(username: string): string {
  if (!username) return ''

  const capitals: { char: string; index: number }[] = []
  for (let i = 0; i < username.length; i++) {
    const char = username[i]
    if (char >= 'A' && char <= 'Z') capitals.push({ char, index: i })
  }

  if (capitals.length >= 2) {
    return capitals[0].char + capitals[1].char
  }

  const firstChar = username[0]
  const firstCharDisplay = firstChar >= 'a' && firstChar <= 'z' ? firstChar.toUpperCase() : firstChar

  if (capitals.length === 1) {
    if (capitals[0].index === 0) return firstCharDisplay
    return firstCharDisplay + capitals[0].char
  }

  return firstCharDisplay
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/avatarInitials.test.ts --exclude ".claude/**"`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/avatarInitials.ts lib/avatarInitials.test.ts
git commit -m "feat: add avatarInitials — capital-letter-aware avatar initials"
```

---

### Task 3: Wire `avatarInitials` into `Nav.tsx`

**Files:**
- Modify: `components/Nav.tsx:1-10` (remove inline `initials()`, import `avatarInitials`), `components/Nav.tsx:108` and `components/Nav.tsx:148` (call sites)
- Test: `components/Nav.test.tsx`

**Interfaces:**
- Consumes: `avatarInitials` from `@/lib/avatarInitials` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `components/Nav.test.tsx` (inside the existing `describe('Nav', ...)` block, after the last test):

```ts
  it('renders avatar initials from the capital letters in the username', () => {
    render(<Nav userName="SeanB" />)
    const avatars = screen.getAllByText('SB')
    expect(avatars.length).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run components/Nav.test.tsx --exclude ".claude/**"`
Expected: FAIL — no element with text "SB" (current code renders "SE" for "SeanB", since it slices the first two raw characters).

- [ ] **Step 3: Replace the inline `initials()` helper with the shared import**

In `components/Nav.tsx`, replace lines 1-10:

```ts
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'

function initials(name: string) {
  const parts = name.split(/[\s._\-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
```

with:

```ts
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import { avatarInitials } from '@/lib/avatarInitials'
```

Then update the two call sites:

`components/Nav.tsx:108` — change `{initials(userName)}` to `{avatarInitials(userName)}`

`components/Nav.tsx:148` — change `{initials(userName)}` to `{avatarInitials(userName)}`

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run components/Nav.test.tsx --exclude ".claude/**"`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Commit**

```bash
git add components/Nav.tsx components/Nav.test.tsx
git commit -m "feat: nav avatar uses capital-letter-aware initials"
```

---

### Task 4: Preserve casing on signup and profile edit

**Files:**
- Modify: `app/auth/signup/page.tsx:25`
- Modify: `app/profile/actions.ts:22`
- Test: `app/profile/actions.test.ts:71-76`

**Interfaces:**
- Consumes: nothing from other tasks (independent of Tasks 1-3; relies on Task 1's `citext` migration being applied to the real database for uniqueness/sign-in to behave correctly end-to-end, but that's a runtime dependency, not a code dependency).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the existing test to expect preserved casing**

In `app/profile/actions.test.ts`, replace the test at lines 71-76:

```ts
  it('lowercases and strips whitespace from the submitted username, matching signup', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData({ ...baseFields, username: ' New Name ' })))
      .rejects.toThrow('REDIRECT:/profile?tab=account&success=1')
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ username: 'newname' }))
  })
```

with:

```ts
  it('preserves casing and strips whitespace from the submitted username, matching signup', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData({ ...baseFields, username: ' New Name ' })))
      .rejects.toThrow('REDIRECT:/profile?tab=account&success=1')
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ username: 'NewName' }))
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run app/profile/actions.test.ts --exclude ".claude/**"`
Expected: FAIL — `updateProfile` still lowercases, so `updateMock` was called with `username: 'newname'`, not `'NewName'`.

- [ ] **Step 3: Stop lowercasing in `updateProfile`**

In `app/profile/actions.ts:22`, change:

```ts
  const username = ((formData.get('username') as string) || '').toLowerCase().replace(/\s+/g, '')
```

to:

```ts
  const username = ((formData.get('username') as string) || '').replace(/\s+/g, '')
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run app/profile/actions.test.ts --exclude ".claude/**"`
Expected: PASS (all tests)

- [ ] **Step 5: Stop lowercasing at signup**

In `app/auth/signup/page.tsx:25`, change:

```ts
            username:           (formData.get('username') as string).toLowerCase().replace(/\s+/g, ''),
```

to:

```ts
            username:           (formData.get('username') as string).replace(/\s+/g, ''),
```

There is no existing automated test file for the signup page (it's a server-action-driven page with no unit test coverage today, consistent with `app/auth/signin/page.tsx`), so this step is verified manually in Task 6.

- [ ] **Step 6: Run the full test suite to confirm nothing else broke**

Run: `npx vitest run --exclude ".claude/**"`
Expected: PASS (all tests)

- [ ] **Step 7: Commit**

```bash
git add app/auth/signup/page.tsx app/profile/actions.ts app/profile/actions.test.ts
git commit -m "feat: preserve username casing on signup and profile edit"
```

---

### Task 5: Drop the now-redundant lowercasing at sign-in

**Files:**
- Modify: `app/auth/signin/page.tsx:30`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Remove `.toLowerCase()` from the sign-in username lookup**

In `app/auth/signin/page.tsx:30`, change:

```ts
          .from('profiles').select('email').eq('username', identifier.toLowerCase()).single()
```

to:

```ts
          .from('profiles').select('email').eq('username', identifier).single()
```

Once Task 1's `citext` migration is applied, this comparison is case-insensitive at the database level, so lowercasing the identifier in application code is no longer doing anything — removing it for clarity per the approved spec.

There is no existing automated test file for the sign-in page, so this is verified manually in Task 6.

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `npx vitest run --exclude ".claude/**"`
Expected: PASS (all tests)

- [ ] **Step 3: Commit**

```bash
git add app/auth/signin/page.tsx
git commit -m "refactor: drop redundant toLowerCase on sign-in username lookup"
```

---

### Task 6: End-to-end manual verification

**Files:** none (manual verification against the running app + real Supabase project)

**Interfaces:**
- Consumes: the deployed/running app with Tasks 1-5 applied, and Task 1's migration already run against the Supabase project the dev server points at (per Task 1, Step 3).
- Produces: nothing (final task).

- [ ] **Step 1: Confirm the migration applied**

In the Supabase SQL Editor, run:

```sql
select data_type from information_schema.columns
where table_name = 'profiles' and column_name = 'username';
```

Expected: `citext` (or `USER-DEFINED` with `udt_name = 'citext'`, depending on how Postgres reports it — either confirms the type changed).

- [ ] **Step 2: Sign up with a mixed-case username**

Start the dev server (`npm run dev`), go to `/auth/signup`, and sign up with a username like `SeanB`. Complete signup.

Expected: no errors. Confirm in the Supabase table editor that `profiles.username` for the new row is stored as `SeanB` (not `seanb`).

- [ ] **Step 3: Confirm the nav avatar shows the right initials**

While signed in as that user, look at the nav bar avatar (top right, both desktop and — resize the window or use dev tools device mode — mobile layouts).

Expected: avatar shows `SB`.

- [ ] **Step 4: Sign out and sign back in with different casing**

Sign out. Go to `/auth/signin` and sign in using the username field with different casing than was used at signup (e.g. `seanb` or `SEANB`), with the correct password.

Expected: sign-in succeeds — confirms the case-insensitive lookup works end-to-end.

- [ ] **Step 5: Confirm a case-variant username is rejected as taken**

Sign out. Go to `/auth/signup` and attempt to register a new account using a case-variant of the existing username (e.g. `seanb` if `SeanB` is already taken), with a different email address.

Expected: signup fails with the "That username is already taken" error (or equivalent duplicate-key handling), not a successful second account.

- [ ] **Step 6: Confirm an existing (pre-migration) lowercase username still works**

If there's an existing account from before this change (all-lowercase username), sign in as that user and check its nav avatar.

Expected: sign-in works normally; avatar shows the single-first-character fallback (e.g. username `sarahreads` → avatar `S`), since no capitals are stored — matches the spec's "Existing users" section. This is expected, not a bug.

- [ ] **Step 7: Report results to the user**

Summarize what was verified (steps 1-6, pass/fail for each) so this can be confirmed complete per the project's verification standard — no shortcutting this with "tests pass" alone, since none of steps 2-6 are covered by the automated suite.
