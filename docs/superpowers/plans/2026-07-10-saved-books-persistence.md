# Saved Books Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hearting/saving a listing persists to Supabase for real accounts, shows up in the Dashboard's "Saved Books" tab, and can be unsaved from either the listing card or the Dashboard.

**Architecture:** A new `saved_listings` join table backs the feature. Three server actions (`saveListing`, `unsaveListing`, `removeSavedListing`) in a new `lib/actions/savedListings.ts` handle the writes. `HeartButton`/`SaveButton` call `saveListing`/`unsaveListing` directly from their click handlers (Next 14 supports invoking an imported `'use server'` function as a plain async call from a Client Component — no `<form>` required) and optimistically flip their local state. The three server pages that read listings (`/listings`, `/listings/[id]`, `/profile`) each fetch the current user's saved state and pass it down as props. The Dashboard's existing (currently static) Saved Books tab renders the real list with a form-based "Unsave" button, matching the existing `updateListingStatus` form-action convention.

**Tech Stack:** Next.js 14 App Router, React 18, Supabase (`@supabase/ssr`), Vitest + `@testing-library/react` + jsdom for component tests.

## Global Constraints

- Persistence is for real Supabase accounts only. A session with no real `auth.users` row (demo-mode cookie only) gets `redirect()`ed to `/auth/signin?redirect=...` by the server action itself — this is the enforcement point, not the client-side `isLoggedIn` gate (which already treats demo-mode as "logged in" from the prior feature and is not changed here).
- `saved_listings` schema, exactly as specified below — do not alter column names or the `unique(user_id, listing_id)` constraint.
- `saveListing`/`unsaveListing` are called directly from client `onClick` handlers, not via `<form action>`. `removeSavedListing` is the one FormData-shaped exception, used by the Dashboard's plain `<form>` "Unsave" button.
- Follow existing test conventions: colocated `*.test.tsx` files, `describe`/`it`/`expect` from `vitest`, `render`/`screen`/`fireEvent`/`waitFor` from `@testing-library/react`.
- No demo-mode persistence, no "recently unsaved" undo, no sold/removed notifications, no seller-facing save counts — all explicitly out of scope per the spec.
- At the end, the exact SQL from Task 1 must be handed to the user to run in the Supabase SQL editor (it is not run automatically).

---

## File Structure

- Modify `supabase/schema.sql` — add the `saved_listings` table + RLS migration block.
- Create `lib/actions/savedListings.ts` — `saveListing`, `unsaveListing`, `removeSavedListing` server actions.
- Modify `components/HeartButton.tsx` — add `listingId`, `initialSaved` props; persist on click.
- Modify `components/HeartButton.test.tsx` — rewrite for the new props/behavior.
- Modify `components/SaveButton.tsx` — add `initialSaved` prop; persist on click.
- Modify `components/SaveButton.test.tsx` — rewrite for the new prop/behavior.
- Modify `app/listings/page.tsx` — fetch saved listing IDs for the current user; pass to each `HeartButton`.
- Modify `app/listings/[id]/page.tsx` — fetch saved status for this listing; pass to `SaveButton`.
- Modify `app/profile/page.tsx` — fetch the user's saved listings; pass to `DashboardClient`.
- Modify `app/profile/DashboardClient.tsx` — render the Saved Books list with an Unsave button.

---

### Task 1: `saved_listings` schema migration

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the `saved_listings` table shape (`id`, `user_id`, `listing_id`, `created_at`, unique on `(user_id, listing_id)`) that every later task's Supabase queries rely on. This SQL is NOT run automatically — it is handed to the user at the end to paste into the Supabase SQL editor, same as the existing address-privacy migration block already in this file.

- [ ] **Step 1: Append the migration block**

At the end of `supabase/schema.sql` (after the existing "Migration: address privacy toggles" block), add:

```sql

-- ── Migration: saved listings ─────────────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
create table if not exists saved_listings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  listing_id uuid references listings(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, listing_id)
);

alter table saved_listings enable row level security;

create policy "Users can view own saved listings" on saved_listings
  for select to authenticated using (auth.uid() = user_id);

create policy "Users can save listings" on saved_listings
  for insert to authenticated with check (auth.uid() = user_id);

create policy "Users can unsave own listings" on saved_listings
  for delete to authenticated using (auth.uid() = user_id);
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add saved_listings table migration"
```

---

### Task 2: Saved-listings server actions

**Files:**
- Create: `lib/actions/savedListings.ts`

**Interfaces:**
- Consumes: `saved_listings` table shape from Task 1 (queries only — does not require the migration to have been run yet to compile/type-check).
- Produces:
  - `saveListing(listingId: string, redirectTo: string): Promise<void>`
  - `unsaveListing(listingId: string, redirectTo: string): Promise<void>`
  - `removeSavedListing(formData: FormData): Promise<void>`

  Tasks 3 and 4 import `saveListing`/`unsaveListing` directly. Task 7 imports `removeSavedListing` as a `<form action>`.

- [ ] **Step 1: Write the file**

Create `lib/actions/savedListings.ts`:

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

export async function saveListing(listingId: string, redirectTo: string): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=' + redirectTo)

  await supabase
    .from('saved_listings')
    .upsert({ user_id: user.id, listing_id: listingId }, { onConflict: 'user_id,listing_id', ignoreDuplicates: true })

  revalidatePath(redirectTo)
  revalidatePath('/profile')
}

export async function unsaveListing(listingId: string, redirectTo: string): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=' + redirectTo)

  await supabase
    .from('saved_listings')
    .delete()
    .eq('user_id', user.id)
    .eq('listing_id', listingId)

  revalidatePath(redirectTo)
  revalidatePath('/profile')
}

export async function removeSavedListing(formData: FormData): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const listingId = formData.get('listing_id') as string

  await supabase
    .from('saved_listings')
    .delete()
    .eq('user_id', user.id)
    .eq('listing_id', listingId)

  redirect('/profile')
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from `lib/actions/savedListings.ts` (pre-existing unrelated errors in `app/profile/page.tsx` about `Set<any>` iteration are already present on `master` — ignore those).

- [ ] **Step 3: Commit**

```bash
git add lib/actions/savedListings.ts
git commit -m "feat: add saveListing/unsaveListing/removeSavedListing server actions"
```

---

### Task 3: Persist saves from `HeartButton`

**Files:**
- Modify: `components/HeartButton.tsx`
- Modify: `components/HeartButton.test.tsx`

**Interfaces:**
- Consumes: `saveListing(listingId, redirectTo)` / `unsaveListing(listingId, redirectTo)` from Task 2.
- Produces: `HeartButton({ listingId: string, isLoggedIn: boolean, initialSaved: boolean })` — `listingId` and `initialSaved` are new required props. Task 5 must pass them.

- [ ] **Step 1: Rewrite the failing tests**

Replace `components/HeartButton.test.tsx` entirely with:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import HeartButton from './HeartButton'
import { saveListing, unsaveListing } from '@/lib/actions/savedListings'

vi.mock('@/lib/actions/savedListings', () => ({
  saveListing: vi.fn(() => Promise.resolve()),
  unsaveListing: vi.fn(() => Promise.resolve()),
}))

describe('HeartButton', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error - deliberately replacing window.location for the test
    delete window.location
    // @ts-expect-error - minimal stand-in, only href/pathname are used
    window.location = { ...originalLocation, href: '', pathname: '/listings' }
  })

  afterEach(() => {
    // @ts-expect-error - restoring the real Location object after the test stand-in
    window.location = originalLocation
  })

  it('starts unsaved when initialSaved is false', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={false} />)
    const button = container.querySelector('button') as HTMLButtonElement
    expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)')
  })

  it('starts saved when initialSaved is true', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={true} />)
    const button = container.querySelector('button') as HTMLButtonElement
    expect(button.style.background).toBe('rgb(255, 240, 243)')
  })

  it('calls saveListing and flips to saved style when clicked while unsaved and logged in', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={false} />)
    const button = container.querySelector('button') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.style.background).toBe('rgb(255, 240, 243)')
    expect(saveListing).toHaveBeenCalledWith('l1', '/listings')
    expect(unsaveListing).not.toHaveBeenCalled()
  })

  it('calls unsaveListing and flips to unsaved style when clicked while saved and logged in', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={true} />)
    const button = container.querySelector('button') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)')
    expect(unsaveListing).toHaveBeenCalledWith('l1', '/listings')
    expect(saveListing).not.toHaveBeenCalled()
  })

  it('reverts the optimistic flip if the save call fails', async () => {
    vi.mocked(saveListing).mockRejectedValueOnce(new Error('boom'))
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={true} initialSaved={false} />)
    const button = container.querySelector('button') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.style.background).toBe('rgb(255, 240, 243)')
    await waitFor(() => expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)'))
  })

  it('does not call saveListing/unsaveListing when clicked while logged out', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={false} initialSaved={false} />)
    fireEvent.click(container.querySelector('button')!)
    expect(saveListing).not.toHaveBeenCalled()
    expect(unsaveListing).not.toHaveBeenCalled()
  })

  it('redirects to sign-in with the current path when clicked while logged out', () => {
    const { container } = render(<HeartButton listingId="l1" isLoggedIn={false} initialSaved={false} />)
    fireEvent.click(container.querySelector('button')!)
    expect(window.location.href).toBe('/auth/signin?redirect=/listings')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- components/HeartButton.test.tsx`
Expected: FAIL — `HeartButton` doesn't accept `listingId`/`initialSaved` yet and never calls `saveListing`/`unsaveListing`.

- [ ] **Step 3: Implement the minimal change**

Replace `components/HeartButton.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { saveListing, unsaveListing } from '@/lib/actions/savedListings'

export default function HeartButton({
  listingId,
  isLoggedIn,
  initialSaved,
}: {
  listingId: string
  isLoggedIn: boolean
  initialSaved: boolean
}) {
  const [saved, setSaved] = useState(initialSaved)

  return (
    <button
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        if (!isLoggedIn) {
          window.location.href = '/auth/signin?redirect=' + window.location.pathname
          return
        }
        const next = !saved
        setSaved(next)
        const action = next
          ? saveListing(listingId, window.location.pathname)
          : unsaveListing(listingId, window.location.pathname)
        action.catch(() => setSaved(!next))
      }}
      className="absolute flex items-center justify-center transition-transform hover:scale-110"
      style={{
        top: 8, left: 8,
        width: 28, height: 28,
        borderRadius: '50%',
        border: 'none',
        background: saved ? '#fff0f3' : 'rgba(255,255,255,0.92)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        cursor: 'pointer',
        zIndex: 2,
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={saved ? '#f87171' : 'none'} stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
    </button>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- components/HeartButton.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add components/HeartButton.tsx components/HeartButton.test.tsx
git commit -m "feat: persist HeartButton saves via saveListing/unsaveListing"
```

---

### Task 4: Persist saves from `SaveButton`

**Files:**
- Modify: `components/SaveButton.tsx`
- Modify: `components/SaveButton.test.tsx`

**Interfaces:**
- Consumes: `saveListing(listingId, redirectTo)` / `unsaveListing(listingId, redirectTo)` from Task 2.
- Produces: `SaveButton({ listingId: string, isLoggedIn: boolean, initialSaved: boolean })` — `initialSaved` is a new required prop. Task 6 must pass it.

- [ ] **Step 1: Rewrite the failing tests**

Replace `components/SaveButton.test.tsx` entirely with:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import SaveButton from './SaveButton'
import { saveListing, unsaveListing } from '@/lib/actions/savedListings'

vi.mock('@/lib/actions/savedListings', () => ({
  saveListing: vi.fn(() => Promise.resolve()),
  unsaveListing: vi.fn(() => Promise.resolve()),
}))

describe('SaveButton', () => {
  const originalLocation = window.location

  beforeEach(() => {
    vi.clearAllMocks()
    // @ts-expect-error - deliberately replacing window.location for the test
    delete window.location
    // @ts-expect-error - minimal stand-in, only href/pathname are used
    window.location = { ...originalLocation, href: '', pathname: '/listings/abc-123' }
  })

  afterEach(() => {
    // @ts-expect-error - restoring the real Location object after the test stand-in
    window.location = originalLocation
  })

  it('starts on "Save" when initialSaved is false', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={false} />)
    expect(getByRole('button')).toHaveTextContent('Save')
  })

  it('starts on "Saved" when initialSaved is true', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={true} />)
    expect(getByRole('button')).toHaveTextContent('Saved ✓')
  })

  it('calls saveListing and flips to "Saved" when clicked while unsaved and logged in', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={false} />)
    const button = getByRole('button')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Saved ✓')
    expect(saveListing).toHaveBeenCalledWith('abc-123', '/listings/abc-123')
    expect(unsaveListing).not.toHaveBeenCalled()
  })

  it('calls unsaveListing and flips to "Save" when clicked while saved and logged in', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={true} />)
    const button = getByRole('button')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Save')
    expect(button).not.toHaveTextContent('Saved ✓')
    expect(unsaveListing).toHaveBeenCalledWith('abc-123', '/listings/abc-123')
    expect(saveListing).not.toHaveBeenCalled()
  })

  it('reverts the optimistic flip if the save call fails', async () => {
    vi.mocked(saveListing).mockRejectedValueOnce(new Error('boom'))
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} initialSaved={false} />)
    const button = getByRole('button')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Saved ✓')
    await waitFor(() => expect(button).toHaveTextContent('Save'))
    expect(button).not.toHaveTextContent('Saved ✓')
  })

  it('does not call saveListing/unsaveListing when clicked while logged out', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={false} initialSaved={false} />)
    fireEvent.click(getByRole('button'))
    expect(saveListing).not.toHaveBeenCalled()
    expect(unsaveListing).not.toHaveBeenCalled()
  })

  it('redirects to sign-in with the current path when clicked while logged out', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={false} initialSaved={false} />)
    fireEvent.click(getByRole('button'))
    expect(window.location.href).toBe('/auth/signin?redirect=/listings/abc-123')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- components/SaveButton.test.tsx`
Expected: FAIL — `SaveButton` doesn't accept `initialSaved` yet and never calls `saveListing`/`unsaveListing`.

- [ ] **Step 3: Implement the minimal change**

Replace `components/SaveButton.tsx` with:

```tsx
'use client'
import { useState } from 'react'
import { saveListing, unsaveListing } from '@/lib/actions/savedListings'

export default function SaveButton({
  listingId,
  isLoggedIn,
  initialSaved,
}: {
  listingId: string
  isLoggedIn: boolean
  initialSaved: boolean
}) {
  const [saved, setSaved] = useState(initialSaved)

  function toggle() {
    if (!isLoggedIn) {
      window.location.href = '/auth/signin?redirect=' + window.location.pathname
      return
    }
    const next = !saved
    setSaved(next)
    const action = next
      ? saveListing(listingId, window.location.pathname)
      : unsaveListing(listingId, window.location.pathname)
    action.catch(() => setSaved(!next))
  }

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-2 font-extrabold text-base transition-all"
      style={{
        padding: '14px 24px',
        borderRadius: 999,
        border: saved ? '2.5px solid #f43f5e' : '2.5px solid #fda4af',
        background: saved ? '#fff0f3' : '#fff',
        color: '#f43f5e',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={saved ? '#f43f5e' : 'none'}
        stroke="#f43f5e"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </svg>
      {saved ? 'Saved ✓' : 'Save'}
    </button>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- components/SaveButton.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add components/SaveButton.tsx components/SaveButton.test.tsx
git commit -m "feat: persist SaveButton saves via saveListing/unsaveListing"
```

---

### Task 5: Wire saved state into `app/listings/page.tsx`

**Files:**
- Modify: `app/listings/page.tsx`

**Interfaces:**
- Consumes: `HeartButton({ listingId: string, isLoggedIn: boolean, initialSaved: boolean })` from Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add a `getSavedListingIds` helper**

In `app/listings/page.tsx`, add this function directly below the existing `getIsLoggedIn` function:

```ts
async function getSavedListingIds(): Promise<Set<string>> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Set()
    const { data } = await supabase.from('saved_listings').select('listing_id').eq('user_id', user.id)
    return new Set((data ?? []).map(r => r.listing_id))
  } catch {
    return new Set()
  }
}
```

- [ ] **Step 2: Fetch it alongside listings and login state**

Find:

```ts
  const [listings, isLoggedIn] = await Promise.all([
    getListings({ city, title, author, type, genre, condition, sort }),
    getIsLoggedIn(),
  ])
```

Replace with:

```ts
  const [listings, isLoggedIn, savedIds] = await Promise.all([
    getListings({ city, title, author, type, genre, condition, sort }),
    getIsLoggedIn(),
    getSavedListingIds(),
  ])
```

- [ ] **Step 3: Pass `listingId` and `initialSaved` to `HeartButton`**

Find:

```tsx
                    <HeartButton isLoggedIn={isLoggedIn} />
```

Replace with:

```tsx
                    <HeartButton listingId={l.id} isLoggedIn={isLoggedIn} initialSaved={savedIds.has(l.id)} />
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add app/listings/page.tsx
git commit -m "feat: pass saved state to HeartButton on listings page"
```

---

### Task 6: Wire saved state into `app/listings/[id]/page.tsx`

**Files:**
- Modify: `app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: `SaveButton({ listingId: string, isLoggedIn: boolean, initialSaved: boolean })` from Task 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Compute `initialSaved` after `isLoggedIn`**

Find:

```ts
  const isOwner = user?.id === listing.user_id
  const isLoggedIn = !!user || !!cookies().get('lbe_demo_user')?.value
```

Replace with:

```ts
  const isOwner = user?.id === listing.user_id
  const isLoggedIn = !!user || !!cookies().get('lbe_demo_user')?.value

  let initialSaved = false
  if (user) {
    try {
      const supabase = createClient()
      const { data: saved } = await supabase
        .from('saved_listings').select('id').eq('user_id', user.id).eq('listing_id', params.id).maybeSingle()
      initialSaved = !!saved
    } catch {}
  }
```

- [ ] **Step 2: Pass `initialSaved` to `SaveButton`**

Find:

```tsx
                <SaveButton listingId={listing.id} isLoggedIn={isLoggedIn} />
```

Replace with:

```tsx
                <SaveButton listingId={listing.id} isLoggedIn={isLoggedIn} initialSaved={initialSaved} />
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add "app/listings/[id]/page.tsx"
git commit -m "feat: pass saved state to SaveButton on listing detail page"
```

---

### Task 7: Saved Books tab in the Dashboard

**Files:**
- Modify: `app/profile/page.tsx`
- Modify: `app/profile/DashboardClient.tsx`

**Interfaces:**
- Consumes: `removeSavedListing(formData: FormData): Promise<void>` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Fetch saved listings in `app/profile/page.tsx`**

Add `savedListings` to the `let` declarations near the top of `ProfilePage`. Find:

```ts
  let profile: any = null
  let listings: any[] = []
  let exchanges: any[] = []
  let queryError: string | null = null
```

Replace with:

```ts
  let profile: any = null
  let listings: any[] = []
  let exchanges: any[] = []
  let savedListings: any[] = []
  let queryError: string | null = null
```

Then, in the real-user (`else`) branch, find:

```ts
      profile = p
      listings = l ?? []
```

Replace with:

```ts
      profile = p
      listings = l ?? []

      const { data: savedRows } = await supabase
        .from('saved_listings').select('listing_id').eq('user_id', user.id)
      const savedIds = (savedRows ?? []).map((r: any) => r.listing_id)
      if (savedIds.length > 0) {
        const { data: sl } = await supabase
          .from('listings').select('id, title, author, photo_url, condition, price, status').in('id', savedIds)
        savedListings = sl ?? []
      }
```

(The `demo` branch and the outer `catch` block are unchanged — `savedListings` stays `[]` for both, matching the "no demo-mode persistence" constraint.)

- [ ] **Step 2: Pass `savedListings` and `removeSavedListing` to `DashboardClient`**

Add the import. Find:

```ts
import { updateProfile, updateListingStatus, notifyPickedUp, confirmExchange, cancelPurchase } from './actions'
```

Replace with:

```ts
import { updateProfile, updateListingStatus, notifyPickedUp, confirmExchange, cancelPurchase } from './actions'
import { removeSavedListing } from '@/lib/actions/savedListings'
```

Find the `<DashboardClient ... />` call:

```tsx
  return (
    <DashboardClient
      profile={profile}
      listings={listings}
      exchanges={exchanges}
      updateAction={updateProfile}
      updateListingStatus={updateListingStatus}
      notifyPickedUp={notifyPickedUp}
      confirmExchange={confirmExchange}
      cancelPurchase={cancelPurchase}
      success={!!searchParams.success}
      defaultTab={searchParams.demo_pending ? 'exchanges' : 'listings'}
      queryError={queryError}
    />
  )
```

Replace with:

```tsx
  return (
    <DashboardClient
      profile={profile}
      listings={listings}
      exchanges={exchanges}
      savedListings={savedListings}
      updateAction={updateProfile}
      updateListingStatus={updateListingStatus}
      notifyPickedUp={notifyPickedUp}
      confirmExchange={confirmExchange}
      cancelPurchase={cancelPurchase}
      removeSavedListing={removeSavedListing}
      success={!!searchParams.success}
      defaultTab={searchParams.demo_pending ? 'exchanges' : 'listings'}
      queryError={queryError}
    />
  )
```

- [ ] **Step 3: Add the `SavedListing` type and new props to `DashboardClient.tsx`**

Find:

```ts
type Exchange = {
```

Insert directly above it:

```ts
type SavedListing = {
  id: string
  title: string
  author: string
  photo_url?: string | null
  condition: string
  price?: number | null
  status: string
}

```

Find the `Props` type:

```ts
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
    pickup_description?: string | null
    share_pickup?: boolean | null
    created_at?: string | null
  } | null
  listings: Listing[]
  exchanges: Exchange[]
  updateAction: (formData: FormData) => Promise<void>
  updateListingStatus: (formData: FormData) => Promise<void>
  notifyPickedUp: (formData: FormData) => Promise<void>
  confirmExchange: (formData: FormData) => Promise<void>
  cancelPurchase: (formData: FormData) => Promise<void>
  success?: boolean
  defaultTab?: Tab
  queryError?: string | null
}
```

Replace with:

```ts
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
    pickup_description?: string | null
    share_pickup?: boolean | null
    created_at?: string | null
  } | null
  listings: Listing[]
  exchanges: Exchange[]
  savedListings: SavedListing[]
  updateAction: (formData: FormData) => Promise<void>
  updateListingStatus: (formData: FormData) => Promise<void>
  notifyPickedUp: (formData: FormData) => Promise<void>
  confirmExchange: (formData: FormData) => Promise<void>
  cancelPurchase: (formData: FormData) => Promise<void>
  removeSavedListing: (formData: FormData) => Promise<void>
  success?: boolean
  defaultTab?: Tab
  queryError?: string | null
}
```

- [ ] **Step 4: Destructure the new props**

Find:

```tsx
export default function DashboardClient({ profile, listings, exchanges, updateAction, updateListingStatus, notifyPickedUp, confirmExchange, cancelPurchase, success, defaultTab, queryError }: Props) {
```

Replace with:

```tsx
export default function DashboardClient({ profile, listings, exchanges, savedListings, updateAction, updateListingStatus, notifyPickedUp, confirmExchange, cancelPurchase, removeSavedListing, success, defaultTab, queryError }: Props) {
```

- [ ] **Step 5: Render the real Saved Books list**

Find the entire existing block:

```tsx
      {/* ── SAVED BOOKS ── */}
      {activeTab === 'saved' && (
        <div style={cardStyle}>
          <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
            No saved books yet.{' '}
            <Link href="/listings" className="font-extrabold hover:underline" style={{ color: '#e11d48' }}>Browse listings</Link>
            {' '}and tap the ♡ to save!
          </div>
        </div>
      )}
```

Replace with:

```tsx
      {/* ── SAVED BOOKS ── */}
      {activeTab === 'saved' && (
        <div style={cardStyle}>
          {savedListings.length === 0 ? (
            <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
              No saved books yet.{' '}
              <Link href="/listings" className="font-extrabold hover:underline" style={{ color: '#e11d48' }}>Browse listings</Link>
              {' '}and tap the ♡ to save!
            </div>
          ) : (
            <div>
              {savedListings.map(l => (
                <div key={l.id} className="flex items-center gap-3" style={{ padding: '12px 0', borderBottom: '2px solid #f3f4f6' }}>
                  <div className="relative shrink-0 overflow-hidden"
                    style={{ width: 42, height: 42, borderRadius: 10, background: coverGradient(l.id) }}>
                    {l.photo_url ? (
                      <Image src={l.photo_url} alt={l.title} fill className="object-cover" />
                    ) : (
                      <span className="flex items-center justify-center w-full h-full text-[20px]">📚</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link href={`/listings/${l.id}`} className="font-black text-[14px] truncate block hover:text-bk-orange transition-colors">
                      {l.title}
                    </Link>
                    <p className="font-semibold text-[12px]" style={{ color: '#aaa' }}>
                      {l.author} · {l.condition}
                    </p>
                  </div>
                  <form action={removeSavedListing} className="shrink-0">
                    <input type="hidden" name="listing_id" value={l.id} />
                    <button className="font-extrabold text-[11px] hover:opacity-80"
                      style={{ background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer', padding: 0 }}>
                      💔 Unsave
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 6: Verify the app builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add app/profile/page.tsx app/profile/DashboardClient.tsx
git commit -m "feat: render Saved Books tab with unsave action"
```

---

## Full Test Suite Check

- [ ] Run: `npm run test:run`
- [ ] Expected: all tests pass, including the rewritten `HeartButton.test.tsx` and `SaveButton.test.tsx` alongside `ShareToggle.test.tsx` and `buildConfirmationMessage.test.ts`.

## Manual Browser Verification

There is no automated test coverage for the Supabase-backed server actions or the server-rendered pages (`app/listings/page.tsx`, `app/listings/[id]/page.tsx`, `app/profile/page.tsx`) — this matches the existing testing conventions in this repo (only client components have test files). Verify end-to-end in a browser against a real Supabase account, after running the Task 1 SQL in the Supabase SQL editor:

1. Sign in with a real account. Heart a book on `/listings`. Refresh the page — the heart should still be filled in (persisted, not just optimistic).
2. Go to `/profile` → "Saved Books" tab. The hearted book should appear.
3. Click "💔 Unsave" in the Dashboard. The book should disappear from the list, and the heart on `/listings` should be unfilled again on next visit.
4. On a listing detail page (`/listings/[id]`), click "Save". Refresh — it should still say "Saved ✓". Click it again to unsave.
5. Sign out (or use a demo-only session via the `lbe_demo_user` cookie with no real account) and click a heart or Save button — expect a redirect to `/auth/signin?redirect=...`, not a silent failure.

## Final Deliverable: SQL for Supabase

After all tasks are complete and verified, hand the user this SQL to run in the Supabase SQL editor (same block as Task 1, Step 1):

```sql
create table if not exists saved_listings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  listing_id uuid references listings(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, listing_id)
);

alter table saved_listings enable row level security;

create policy "Users can view own saved listings" on saved_listings
  for select to authenticated using (auth.uid() = user_id);

create policy "Users can save listings" on saved_listings
  for insert to authenticated with check (auth.uid() = user_id);

create policy "Users can unsave own listings" on saved_listings
  for delete to authenticated using (auth.uid() = user_id);
```
