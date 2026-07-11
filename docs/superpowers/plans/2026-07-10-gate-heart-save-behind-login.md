# Gate Heart/Save Buttons Behind Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Logged-out visitors clicking the heart (listing cards) or save (listing detail) button get redirected to sign-in instead of toggling the button.

**Architecture:** `HeartButton` and `SaveButton` gain a required `isLoggedIn: boolean` prop. The two server pages that render them (`app/listings/page.tsx`, `app/listings/[id]/page.tsx`) compute that boolean the same way `app/layout.tsx` already does (demo cookie OR real Supabase user) and pass it down. On click, if `isLoggedIn` is false, the component navigates to `/auth/signin?redirect=<currentPath>` instead of updating its local `saved` state.

**Tech Stack:** Next.js 14 App Router, React 18, Supabase (`@supabase/ssr`), Vitest + `@testing-library/react` + jsdom for component tests.

## Global Constraints

- No new database table or persistence — spec explicitly scopes this to gating the click only.
- Reuse the existing login-detection rule from `app/layout.tsx`: logged in ⟺ `cookies().get('lbe_demo_user')?.value` is truthy, OR `supabase.auth.getUser()` returns a user.
- Reuse the existing `?redirect=` query param convention already used by `/auth/signin`, `requestPurchase`, and `startConversation` in `app/listings/[id]/page.tsx`.
- Do not touch the separate `isDemo` detection logic inside the `requestPurchase`/`startConversation` server actions — out of scope per spec.
- Follow existing test conventions: colocated `*.test.tsx` files, `describe`/`it`/`expect` from `vitest`, `render`/`screen`/`fireEvent` from `@testing-library/react` (see `components/ShareToggle.test.tsx`).

---

## File Structure

- Modify `components/HeartButton.tsx` — add `isLoggedIn` prop and redirect-on-click-when-logged-out behavior.
- Create `components/HeartButton.test.tsx` — unit tests for both logged-in and logged-out click behavior.
- Modify `components/SaveButton.tsx` — add `isLoggedIn` prop and redirect-on-click-when-logged-out behavior.
- Create `components/SaveButton.test.tsx` — unit tests for both logged-in and logged-out click behavior.
- Modify `app/listings/page.tsx` — compute `isLoggedIn` server-side, pass to each `HeartButton`.
- Modify `app/listings/[id]/page.tsx` — compute `isLoggedIn` from the already-fetched `user` plus the demo cookie, pass to `SaveButton`.

---

### Task 1: Gate `HeartButton` behind login

**Files:**
- Modify: `components/HeartButton.tsx`
- Test: `components/HeartButton.test.tsx`

**Interfaces:**
- Consumes: nothing new (no other task's output).
- Produces: `HeartButton({ isLoggedIn: boolean })` — the `isLoggedIn` prop is now **required**. Later tasks (`app/listings/page.tsx`) must pass it.

- [ ] **Step 1: Write the failing tests**

Create `components/HeartButton.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import HeartButton from './HeartButton'

describe('HeartButton', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // @ts-expect-error - deliberately replacing window.location for the test
    delete window.location
    // @ts-expect-error - minimal stand-in, only href/pathname are used
    window.location = { ...originalLocation, href: '', pathname: '/listings' }
  })

  afterEach(() => {
    window.location = originalLocation
  })

  it('toggles saved style when clicked while logged in', () => {
    const { container } = render(<HeartButton isLoggedIn={true} />)
    const button = container.querySelector('button') as HTMLButtonElement
    expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)')
    fireEvent.click(button)
    expect(button.style.background).toBe('rgb(255, 240, 243)')
  })

  it('does not navigate when clicked while logged in', () => {
    const { container } = render(<HeartButton isLoggedIn={true} />)
    fireEvent.click(container.querySelector('button')!)
    expect(window.location.href).toBe('')
  })

  it('redirects to sign-in with the current path when clicked while logged out', () => {
    const { container } = render(<HeartButton isLoggedIn={false} />)
    fireEvent.click(container.querySelector('button')!)
    expect(window.location.href).toBe('/auth/signin?redirect=/listings')
  })

  it('does not toggle saved style when clicked while logged out', () => {
    const { container } = render(<HeartButton isLoggedIn={false} />)
    const button = container.querySelector('button') as HTMLButtonElement
    fireEvent.click(button)
    expect(button.style.background).toBe('rgba(255, 255, 255, 0.92)')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- components/HeartButton.test.tsx`
Expected: FAIL — `isLoggedIn` prop doesn't exist yet (TypeScript error) and/or the logged-out redirect assertions fail because current `HeartButton` always toggles and never reads `window.location`.

- [ ] **Step 3: Implement the minimal change**

Replace `components/HeartButton.tsx` with:

```tsx
'use client'

import { useState } from 'react'

export default function HeartButton({ isLoggedIn }: { isLoggedIn: boolean }) {
  const [saved, setSaved] = useState(false)

  return (
    <button
      onClick={e => {
        e.preventDefault()
        e.stopPropagation()
        if (!isLoggedIn) {
          window.location.href = '/auth/signin?redirect=' + window.location.pathname
          return
        }
        setSaved(s => !s)
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
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/HeartButton.tsx components/HeartButton.test.tsx
git commit -m "feat: gate HeartButton behind login"
```

---

### Task 2: Gate `SaveButton` behind login

**Files:**
- Modify: `components/SaveButton.tsx`
- Test: `components/SaveButton.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `SaveButton({ listingId: string, isLoggedIn: boolean })` — `isLoggedIn` is now a **required** prop. Later tasks (`app/listings/[id]/page.tsx`) must pass it.

- [ ] **Step 1: Write the failing tests**

Create `components/SaveButton.test.tsx`:

```tsx
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import SaveButton from './SaveButton'

describe('SaveButton', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // @ts-expect-error - deliberately replacing window.location for the test
    delete window.location
    // @ts-expect-error - minimal stand-in, only href/pathname are used
    window.location = { ...originalLocation, href: '', pathname: '/listings/abc-123' }
  })

  afterEach(() => {
    window.location = originalLocation
  })

  it('toggles to "Saved" when clicked while logged in', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} />)
    const button = getByRole('button')
    expect(button).toHaveTextContent('Save')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Saved ✓')
  })

  it('does not navigate when clicked while logged in', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={true} />)
    fireEvent.click(getByRole('button'))
    expect(window.location.href).toBe('')
  })

  it('redirects to sign-in with the current path when clicked while logged out', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={false} />)
    fireEvent.click(getByRole('button'))
    expect(window.location.href).toBe('/auth/signin?redirect=/listings/abc-123')
  })

  it('does not toggle to "Saved" when clicked while logged out', () => {
    const { getByRole } = render(<SaveButton listingId="abc-123" isLoggedIn={false} />)
    const button = getByRole('button')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Save')
    expect(button).not.toHaveTextContent('Saved ✓')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- components/SaveButton.test.tsx`
Expected: FAIL — `isLoggedIn` prop doesn't exist yet and the logged-out assertions fail because current `SaveButton` always toggles.

- [ ] **Step 3: Implement the minimal change**

Replace `components/SaveButton.tsx` with:

```tsx
'use client'
import { useState } from 'react'

export default function SaveButton({ listingId, isLoggedIn }: { listingId: string; isLoggedIn: boolean }) {
  const [saved, setSaved] = useState(false)

  function toggle() {
    if (!isLoggedIn) {
      window.location.href = '/auth/signin?redirect=' + window.location.pathname
      return
    }
    setSaved(s => !s)
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
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add components/SaveButton.tsx components/SaveButton.test.tsx
git commit -m "feat: gate SaveButton behind login"
```

---

### Task 3: Wire login state into `app/listings/page.tsx`

**Files:**
- Modify: `app/listings/page.tsx`

**Interfaces:**
- Consumes: `HeartButton({ isLoggedIn: boolean })` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `cookies` import and an `isLoggedIn` helper**

In `app/listings/page.tsx`, change the top imports from:

```ts
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import Image from 'next/image'
import HeartButton from '@/components/HeartButton'
import type { Listing } from '@/lib/types'
import { MOCK_LISTINGS } from '@/lib/mock-data'
```

to:

```ts
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import Link from 'next/link'
import Image from 'next/image'
import HeartButton from '@/components/HeartButton'
import type { Listing } from '@/lib/types'
import { MOCK_LISTINGS } from '@/lib/mock-data'
```

Then add this function directly below the existing `getListings` function (after its closing `}`, before `const filterInputStyle = ...`):

```ts
async function getIsLoggedIn(): Promise<boolean> {
  if (cookies().get('lbe_demo_user')?.value) return true
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return !!user
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Fetch `isLoggedIn` alongside the listings query**

In the `ListingsPage` component body, find:

```ts
  const listings = await getListings({ city, title, author, type, genre, condition, sort })
```

Replace it with:

```ts
  const [listings, isLoggedIn] = await Promise.all([
    getListings({ city, title, author, type, genre, condition, sort }),
    getIsLoggedIn(),
  ])
```

- [ ] **Step 3: Pass `isLoggedIn` to `HeartButton`**

Find:

```tsx
                    <HeartButton />
```

Replace with:

```tsx
                    <HeartButton isLoggedIn={isLoggedIn} />
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors (the required `isLoggedIn` prop is now satisfied).

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, then in a browser:
1. Without signing in, visit `http://localhost:3000/listings` and click a book's heart icon. Expected: redirected to `/auth/signin?redirect=/listings`.
2. Sign in (demo mode: any username/password works), revisit `/listings`, click a heart icon. Expected: heart fills in place, no navigation.

- [ ] **Step 6: Commit**

```bash
git add app/listings/page.tsx
git commit -m "feat: gate heart button on listings page behind login"
```

---

### Task 4: Wire login state into `app/listings/[id]/page.tsx`

**Files:**
- Modify: `app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: `SaveButton({ listingId: string, isLoggedIn: boolean })` from Task 2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the `cookies` import**

Change the top imports from:

```ts
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import SaveButton from '@/components/SaveButton'
import { MOCK_LISTINGS, MOCK_CONVERSATIONS, MOCK_USER_ID } from '@/lib/mock-data'
```

to:

```ts
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Image from 'next/image'
import Link from 'next/link'
import SaveButton from '@/components/SaveButton'
import { MOCK_LISTINGS, MOCK_CONVERSATIONS, MOCK_USER_ID } from '@/lib/mock-data'
```

- [ ] **Step 2: Compute `isLoggedIn` from the already-fetched `user`**

Find:

```ts
  const isOwner = user?.id === listing.user_id
```

Replace with:

```ts
  const isOwner = user?.id === listing.user_id
  const isLoggedIn = !!user || !!cookies().get('lbe_demo_user')?.value
```

- [ ] **Step 3: Pass `isLoggedIn` to `SaveButton`**

Find:

```tsx
                <SaveButton listingId={listing.id} />
```

Replace with:

```tsx
                <SaveButton listingId={listing.id} isLoggedIn={isLoggedIn} />
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, then in a browser:
1. Without signing in, visit any listing detail page (e.g. `http://localhost:3000/listings/<id>`) and click "Save". Expected: redirected to `/auth/signin?redirect=/listings/<id>`.
2. Sign in, revisit the same listing, click "Save". Expected: button switches to "Saved ✓", no navigation.

- [ ] **Step 6: Commit**

```bash
git add "app/listings/[id]/page.tsx"
git commit -m "feat: gate save button on listing detail page behind login"
```

---

## Full Test Suite Check

- [ ] Run: `npm run test:run`
- [ ] Expected: all tests pass, including the new `HeartButton.test.tsx` and `SaveButton.test.tsx` alongside the existing `ShareToggle.test.tsx`.
