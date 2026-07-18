# Pending Transaction Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent two different buyers from both being able to purchase the same listing, by locking a listing to `pending` on the first request, delisting it from Browse at seller confirmation instead of pickup completion, and reopening it (with the existing TBR match feature as the reopen notification) on deny or cancel.

**Architecture:** Add `'pending'` as a new `listings.status` value. All lock/unlock transitions are single conditional `UPDATE ... WHERE status = X` statements (atomic at the Postgres level, so no separate locking table or DB constraint is needed). A new pure function, `getListingAvailability`, centralizes the three-way "can this viewer act on this listing" decision so Browse and the listing detail page don't duplicate that branching logic.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase (Postgres + supabase-js), TypeScript, Vitest.

## Global Constraints

- `listings.status` check constraint values, exact: `'active' | 'pending' | 'sold' | 'given'`.
- The listing flips to `'sold'` at seller **confirmation** (not at final pickup completion) — reuses `'sold'` uniformly regardless of free/paid, matching existing behavior (`'given'` has no code path that ever sets it today).
- Every lock/unlock transition is a conditional `UPDATE` guarded by the expected current status (e.g. `.eq('status', 'active')` or `.eq('status', 'pending')`) — this is what makes concurrent requests safe without extra locking infrastructure.
- No new notification infrastructure (toast/badge/email). Reopening a listing surfaces exclusively through the existing TBR match-on-Profile-visit behavior in `app/profile/page.tsx`.
- Denying a request deletes the conversation row outright, same as the existing buyer-side cancel — no `'denied'` history state.
- Server actions and page-level components with live Supabase calls are **not** unit tested in this codebase's existing convention (zero existing tests for `app/profile/actions.ts`, `app/listings/page.tsx`, or `app/listings/[id]/page.tsx`) — only pure, DB-free functions get Vitest coverage (e.g. `lib/tbrMatch.ts`, `lib/reviewAverages.ts`). This plan follows that boundary: the one genuinely new piece of pure logic (`getListingAvailability`) gets full TDD; everything else gets a TypeScript compile check plus a manual QA note.

---

### Task 1: Data model — add `pending` listing status

**Files:**
- Modify: `supabase/schema.sql` (append after line 376, the end of the file)
- Modify: `lib/types.ts:10`

**Interfaces:**
- Produces: `ListingStatus` (from `lib/types.ts`) now includes `'pending'` — every later task that imports this type relies on it.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

Add this at the very end of the file (after the existing "Migration: exchange completion..." block):

```sql

-- ── Migration: pending transaction lock ───────────────────────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'pending', 'sold', 'given'));
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run this migration against your Supabase instance**

Paste the block above into the Supabase SQL Editor for this project and run it. (This plan can't run it for you — there's no migration runner in this repo, matching the file's existing convention of hand-run "Migration: ..." blocks.)

- [ ] **Step 3: Update `lib/types.ts`**

Change line 10 from:

```ts
export type ListingStatus = 'active' | 'sold' | 'given'
```

to:

```ts
export type ListingStatus = 'active' | 'pending' | 'sold' | 'given'
```

- [ ] **Step 4: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors (nothing consumes `'pending'` yet, so this is just confirming the type edit itself is valid).

- [ ] **Step 5: Commit**

```bash
git add supabase/schema.sql lib/types.ts
git commit -m "feat: add pending status to listings for transaction locking"
```

---

### Task 2: `getListingAvailability` — pure viewer/status decision function

**Files:**
- Create: `lib/listingAvailability.ts`
- Test: `lib/listingAvailability.test.ts`

**Interfaces:**
- Consumes: `ListingStatus` from `lib/types.ts` (Task 1).
- Produces: `getListingAvailability(status: ListingStatus, viewer: { isOwner: boolean; isRequester: boolean }): ListingAvailability`, where `ListingAvailability = 'active' | 'pending-mine' | 'pending-locked' | 'unavailable'`. Tasks 5 and 6 both call this with the same signature.

- [ ] **Step 1: Write the failing test**

Create `lib/listingAvailability.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getListingAvailability } from './listingAvailability'

describe('getListingAvailability', () => {
  it('is active for an active listing regardless of viewer', () => {
    expect(getListingAvailability('active', { isOwner: false, isRequester: false })).toBe('active')
  })

  it('is pending-mine for the owner of a pending listing', () => {
    expect(getListingAvailability('pending', { isOwner: true, isRequester: false })).toBe('pending-mine')
  })

  it('is pending-mine for the buyer who requested a pending listing', () => {
    expect(getListingAvailability('pending', { isOwner: false, isRequester: true })).toBe('pending-mine')
  })

  it('is pending-locked for any other viewer of a pending listing', () => {
    expect(getListingAvailability('pending', { isOwner: false, isRequester: false })).toBe('pending-locked')
  })

  it('is unavailable for a sold listing', () => {
    expect(getListingAvailability('sold', { isOwner: false, isRequester: false })).toBe('unavailable')
  })

  it('is unavailable for a given-away listing', () => {
    expect(getListingAvailability('given', { isOwner: false, isRequester: false })).toBe('unavailable')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/listingAvailability.test.ts`
Expected: FAIL — `Cannot find module './listingAvailability'` (the module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/listingAvailability.ts`:

```ts
import type { ListingStatus } from './types'

export type ListingAvailability = 'active' | 'pending-mine' | 'pending-locked' | 'unavailable'

export function getListingAvailability(
  status: ListingStatus,
  viewer: { isOwner: boolean; isRequester: boolean }
): ListingAvailability {
  if (status === 'active') return 'active'
  if (status === 'pending') return viewer.isOwner || viewer.isRequester ? 'pending-mine' : 'pending-locked'
  return 'unavailable'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/listingAvailability.test.ts`
Expected: PASS — 6 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/listingAvailability.ts lib/listingAvailability.test.ts
git commit -m "feat: add getListingAvailability for pending-listing viewer logic"
```

---

### Task 3: TBR quick-add redirect target

**Files:**
- Modify: `lib/actions/tbrEntries.ts:6-29`

**Interfaces:**
- Produces: `addTbrEntry(formData)` now honors an optional `redirect_to` form field (falls back to `/profile`, so every existing caller is unaffected). Tasks 5 and 6 both submit forms to this action with `title`, `author`, and `redirect_to` set.

- [ ] **Step 1: Modify `addTbrEntry`**

Replace the function body (lines 6-29) with:

```ts
export async function addTbrEntry(formData: FormData): Promise<void> {
  const title = ((formData.get('title') as string) || '').trim()
  const author = ((formData.get('author') as string) || '').trim()
  const city = ((formData.get('city') as string) || '').trim()
  const state = ((formData.get('state') as string) || '').trim()
  const redirectTo = ((formData.get('redirect_to') as string) || '').trim() || '/profile'

  if (!title && !author) {
    redirect('/profile?tbr_error=' + encodeURIComponent('Enter a title or an author.'))
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=/profile')

  await supabase.from('tbr_entries').insert({
    user_id: user.id,
    title,
    author,
    city,
    state,
  })

  redirect(redirectTo)
}
```

(`removeTbrEntry` below it is untouched.)

- [ ] **Step 2: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check**

This is a server action with no existing test coverage in this codebase (consistent with every other file in `lib/actions/`). It'll be exercised end-to-end once Tasks 5 and 6 wire up call sites — no standalone manual check needed yet.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/tbrEntries.ts
git commit -m "feat: let addTbrEntry redirect back to the caller's page"
```

---

### Task 4: Lock lifecycle in the exchange actions

**Files:**
- Modify: `app/profile/actions.ts:92-146` (`confirmExchange`)
- Modify: `app/profile/actions.ts:74-90` (`cancelPurchase`)
- Modify: `app/profile/actions.ts` (new `denyPurchase`, appended at end of file)

**Interfaces:**
- Consumes: `listings.status` values from Task 1 (`'active' | 'pending' | 'sold' | 'given'`).
- Produces: `denyPurchase(formData: FormData): Promise<void>` — a new exported server action. Task 7's Deny button submits to this.

- [ ] **Step 1: Update `confirmExchange` to flip the listing to `sold`**

In `app/profile/actions.ts`, find this block inside `confirmExchange` (currently lines 116-123):

```ts
  if (convo?.listing_id) {
    const { data: listing } = await supabase
      .from('listings')
      .select('pickup_description')
      .eq('id', convo.listing_id)
      .single()
    listingPickup = listing?.pickup_description ?? null
  }
```

Replace it with:

```ts
  if (convo?.listing_id) {
    const { data: listing } = await supabase
      .from('listings')
      .select('pickup_description')
      .eq('id', convo.listing_id)
      .single()
    listingPickup = listing?.pickup_description ?? null

    await supabase
      .from('listings')
      .update({ status: 'sold' })
      .eq('id', convo.listing_id)
      .eq('status', 'pending')
  }
```

- [ ] **Step 2: Update `cancelPurchase` to reopen the listing**

Replace the whole `cancelPurchase` function (currently lines 74-90):

```ts
export async function cancelPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  // Only allowed while still pending — not after seller confirms
  await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('buyer_id', user.id)
    .in('exchange_status', ['requested', 'none'])

  redirect('/profile')
}
```

with:

```ts
export async function cancelPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id, exchange_status')
    .eq('id', conversationId)
    .eq('buyer_id', user.id)
    .maybeSingle()

  // Only allowed while still pending — not after seller confirms
  await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('buyer_id', user.id)
    .in('exchange_status', ['requested', 'none'])

  if (convo?.listing_id && convo.exchange_status === 'requested') {
    await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', convo.listing_id)
      .eq('status', 'pending')
  }

  redirect('/profile')
}
```

- [ ] **Step 3: Add the new `denyPurchase` action**

Append to the end of `app/profile/actions.ts`:

```ts
export async function denyPurchase(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const conversationId = formData.get('conversation_id') as string

  const { data: convo } = await supabase
    .from('conversations')
    .select('listing_id')
    .eq('id', conversationId)
    .eq('seller_id', user.id)
    .eq('exchange_status', 'requested')
    .maybeSingle()

  await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('seller_id', user.id)
    .eq('exchange_status', 'requested')

  if (convo?.listing_id) {
    await supabase
      .from('listings')
      .update({ status: 'active' })
      .eq('id', convo.listing_id)
      .eq('status', 'pending')
  }

  redirect('/profile')
}
```

- [ ] **Step 4: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual check**

No automated test — `app/profile/actions.ts` has zero existing test coverage (it's a server-action file requiring a live Supabase client). Will be exercised manually once Task 7 wires `denyPurchase` into the UI.

- [ ] **Step 6: Commit**

```bash
git add app/profile/actions.ts
git commit -m "feat: flip listing sold on confirm, reopen on deny/cancel, add denyPurchase"
```

---

### Task 5: Listing detail page — acquire the lock, render availability

**Files:**
- Modify: `app/listings/[id]/page.tsx:1-9` (imports)
- Modify: `app/listings/[id]/page.tsx:79-81` (new `avail` variable)
- Modify: `app/listings/[id]/page.tsx:128-179` (`requestPurchase`)
- Modify: `app/listings/[id]/page.tsx:276-317` (footer action rendering)

**Interfaces:**
- Consumes: `getListingAvailability` (Task 2), `addTbrEntry` with `redirect_to` (Task 3).
- Produces: nothing new consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add imports**

At the top of `app/listings/[id]/page.tsx`, add to the existing import list:

```ts
import { getListingAvailability } from '@/lib/listingAvailability'
import type { ListingStatus } from '@/lib/types'
import { addTbrEntry } from '@/lib/actions/tbrEntries'
```

- [ ] **Step 2: Compute `avail` alongside the existing `isPending`**

Find (around line 80):

```ts
  const gradient = coverGradient(listing.id)
  const isPending = searchParams.requested === '1' || myConvoStatus === 'requested'
```

Replace with:

```ts
  const gradient = coverGradient(listing.id)
  const isPending = searchParams.requested === '1' || myConvoStatus === 'requested'
  const avail = getListingAvailability((listing.status ?? 'active') as ListingStatus, {
    isOwner,
    isRequester: myConvoStatus === 'requested',
  })
```

- [ ] **Step 3: Acquire the lock in `requestPurchase`**

Find this block inside `requestPurchase` (currently right after `if (!u) redirect(...)`):

```ts
    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
      const supabase = createSrv()
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) redirect(`/auth/signin?redirect=/listings/${params.id}`)

      // Find or create conversation (without exchange_status so it works before migration)
      let convoId: string
```

Insert the lock attempt between the `if (!u)` line and the `// Find or create conversation` comment:

```ts
    try {
      const { createClient: createSrv } = await import('@/lib/supabase/server')
      const supabase = createSrv()
      const { data: { user: u } } = await supabase.auth.getUser()
      if (!u) redirect(`/auth/signin?redirect=/listings/${params.id}`)

      const { data: locked } = await supabase
        .from('listings')
        .update({ status: 'pending' })
        .eq('id', listing.id)
        .eq('status', 'active')
        .select('id')
      if (!locked || locked.length === 0) {
        redirect(`/listings/${params.id}?purchase_failed=1`)
      }

      // Find or create conversation (without exchange_status so it works before migration)
      let convoId: string
```

(The existing `catch` block below already rethrows `NEXT_REDIRECT`-digested errors and otherwise redirects to `purchase_failed=1`, so this composes with no other changes to the function.)

- [ ] **Step 4: Replace the footer action rendering**

Find the full ternary chain (currently lines 268-317, starting `{isOwner ? (` and ending with the closing `)}` after the Purchase/Message-Seller buttons). Replace it with:

```tsx
            {isOwner ? (
              <Link
                href="/profile"
                className="font-extrabold text-sm"
                style={{ background: '#f3f4f6', color: '#555', padding: '12px 24px', borderRadius: 999 }}
              >
                Manage Listing
              </Link>
            ) : searchParams.purchase_failed === '1' ? (
              <div style={{ background: '#fef2f2', border: '2px solid #fca5a5', color: '#b91c1c', padding: '12px 22px', borderRadius: 16, fontWeight: 800, fontSize: 14 }}>
                ❌ Purchase failed — please try again or message the seller.
              </div>
            ) : (isPending || avail === 'pending-mine') ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
                <div
                  className="font-extrabold text-[14px]"
                  style={{ background: '#fffbeb', border: '2px solid #fcd34d', color: '#92400e', padding: '12px 22px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                  ⏳ Pending — waiting for <strong>{listing.profiles?.username ?? 'seller'}</strong> to confirm
                </div>
                <Link
                  href={`/profile?demo_pending=${params.id}`}
                  className="font-bold text-[12px] hover:underline"
                  style={{ color: '#aaa' }}
                >
                  View in Exchanges tab →
                </Link>
              </div>
            ) : avail === 'pending-locked' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
                <div
                  className="font-extrabold text-[14px]"
                  style={{ background: '#fffbeb', border: '2px solid #fcd34d', color: '#92400e', padding: '12px 22px', borderRadius: 16 }}
                >
                  ⏳ This book is currently pending with another buyer
                </div>
                <form action={addTbrEntry}>
                  <input type="hidden" name="title" value={listing.title} />
                  <input type="hidden" name="author" value={listing.author} />
                  <input type="hidden" name="redirect_to" value={`/listings/${params.id}`} />
                  <button
                    type="submit"
                    className="font-extrabold text-[12px] hover:underline"
                    style={{ background: 'none', border: 'none', color: '#7c3aed', cursor: 'pointer', padding: 0 }}
                  >
                    📚 Add to my TBR — notify me if it reopens
                  </button>
                </form>
              </div>
            ) : avail === 'unavailable' ? (
              <div style={{ background: '#f3f4f6', color: '#888', padding: '12px 22px', borderRadius: 16, fontWeight: 800, fontSize: 14 }}>
                No longer available
              </div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <form action={requestPurchase}>
                  <button
                    type="submit"
                    className="font-extrabold text-base text-white shadow-[0_4px_0_#0f766e] hover:shadow-[0_2px_0_#0f766e] hover:translate-y-0.5 transition-all"
                    style={{ background: '#0d9488', padding: '14px 32px', borderRadius: 999, border: 'none', cursor: 'pointer' }}
                  >
                    🪙 Purchase with 1 Credit
                  </button>
                </form>
                <form action={startConversation}>
                  <button
                    type="submit"
                    className="font-extrabold text-base text-white shadow-[0_4px_0_#c2410c] hover:shadow-[0_2px_0_#c2410c] hover:translate-y-0.5 transition-all"
                    style={{ background: '#f97316', padding: '14px 32px', borderRadius: 999, border: 'none', cursor: 'pointer' }}
                  >
                    💬 Message Seller
                  </button>
                </form>
              </div>
            )}
```

- [ ] **Step 5: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual QA**

Run the dev server (`npm run dev`). With two different logged-in users (e.g. one normal browser window, one incognito) and a Supabase project with the Task 1 migration applied:
1. User A opens a listing they don't own and clicks "Purchase with 1 Credit" → redirected back with the "⏳ Pending — waiting for..." block.
2. User B opens the *same* listing URL directly → should see "⏳ This book is currently pending with another buyer" and an "Add to my TBR" link, **not** a purchase button.
3. As the seller, deny the request (once Task 7 lands the Deny button) or manually set the row back via SQL (`update conversations set exchange_status='requested'... ` / delete + `update listings set status='active'`) to confirm User B's listing view goes back to showing the normal Purchase button.

- [ ] **Step 7: Commit**

```bash
git add "app/listings/[id]/page.tsx"
git commit -m "feat: lock listing on purchase request, show pending/unavailable states"
```

---

### Task 6: Browse page — show pending listings faint and unclickable

**Files:**
- Modify: `app/listings/page.tsx:1-9` (imports)
- Modify: `app/listings/page.tsx:34-70` (`getListings` query filter)
- Modify: `app/listings/page.tsx:72-99` (new `getMyRequestedListingIds`, alongside existing helpers)
- Modify: `app/listings/page.tsx:114-160` (main component: data fetching, `currentUrl`)
- Modify: `app/listings/page.tsx:356-441` (card rendering)

**Interfaces:**
- Consumes: `getListingAvailability` (Task 2), `addTbrEntry` with `redirect_to` (Task 3).
- Produces: nothing new consumed by later tasks — this is a leaf UI task.

- [ ] **Step 1: Add imports**

`app/listings/page.tsx` already has `import type { Listing } from '@/lib/types'` — change that line to also pull in `ListingStatus`:

```ts
import type { Listing, ListingStatus } from '@/lib/types'
```

Then add these two new imports to the list:

```ts
import { getListingAvailability } from '@/lib/listingAvailability'
import { addTbrEntry } from '@/lib/actions/tbrEntries'
```

- [ ] **Step 2: Include pending listings in the Browse query**

In `getListings`, change:

```ts
    let query = supabase
      .from('listings')
      .select('*, profiles(username, city)')
      .eq('status', 'active')
```

to:

```ts
    let query = supabase
      .from('listings')
      .select('*, profiles(username, city)')
      .in('status', ['active', 'pending'])
```

- [ ] **Step 3: Add `getMyRequestedListingIds`**

Add this function next to `getUserSaveContext` (after it):

```ts
async function getMyRequestedListingIds(userId: string | null): Promise<Set<string>> {
  if (!userId) return new Set()
  try {
    const supabase = createClient()
    const { data } = await supabase
      .from('conversations')
      .select('listing_id')
      .eq('buyer_id', userId)
      .eq('exchange_status', 'requested')
    return new Set((data ?? []).map(r => r.listing_id))
  } catch {
    return new Set()
  }
}
```

- [ ] **Step 4: Fetch it and build the current-page URL in the main component**

Find:

```ts
  const [listings, { isLoggedIn, userId, savedIds }] = await Promise.all([
    getListings({ city, title, author, type, genre, condition, sort }),
    getUserSaveContext(),
  ])
  const sellerRatings = await getSellerRatings(listings)
```

Replace with:

```ts
  const [listings, { isLoggedIn, userId, savedIds }] = await Promise.all([
    getListings({ city, title, author, type, genre, condition, sort }),
    getUserSaveContext(),
  ])
  const sellerRatings = await getSellerRatings(listings)
  const myRequestedIds = await getMyRequestedListingIds(userId)

  const currentUrl = (() => {
    const p = new URLSearchParams()
    if (city) p.set('city', city)
    if (title) p.set('title', title)
    if (author) p.set('author', author)
    if (type !== 'all') p.set('type', type)
    if (genre !== 'all') p.set('genre', genre)
    if (condition !== 'any') p.set('condition', condition)
    if (sort !== 'newest') p.set('sort', sort)
    const qs = p.toString()
    return qs ? `/listings?${qs}` : '/listings'
  })()
```

- [ ] **Step 5: Rewrite the card rendering**

Replace the whole `{listings.map(l => { ... })}` block (currently lines 358-440) with:

```tsx
            {listings.map(l => {
              const gradient = coverGradient(l.id)
              const avail = getListingAvailability((l.status ?? 'active') as ListingStatus, {
                isOwner: l.user_id === userId,
                isRequester: myRequestedIds.has(l.id),
              })
              const locked = avail === 'pending-locked'

              const cardInner = (
                <>
                  <div
                    className="relative flex items-center justify-center text-[46px]"
                    style={{ height: 135, background: gradient, ...(locked ? { filter: 'grayscale(1)', opacity: 0.55 } : {}) }}
                  >
                    {l.photo_url
                      ? <Image src={l.photo_url} alt={l.title} fill className="object-cover" />
                      : <span>📚</span>
                    }
                    {!locked && l.user_id !== userId && (
                      <HeartButton listingId={l.id} isLoggedIn={isLoggedIn} initialSaved={savedIds.has(l.id)} />
                    )}
                    {avail === 'active' ? (
                      <span
                        className="absolute text-white font-black"
                        style={{ top: 8, right: 8, padding: '3px 10px', borderRadius: 999, fontSize: 11, background: '#f97316' }}
                      >
                        1 credit
                      </span>
                    ) : (
                      <span
                        className="absolute text-white font-black"
                        style={{ top: 8, right: 8, padding: '3px 10px', borderRadius: 999, fontSize: 11, background: '#f59e0b' }}
                      >
                        ⏳ Pending
                      </span>
                    )}
                    {l.genre && (
                      <span
                        className="absolute font-extrabold"
                        style={{ bottom: 8, left: 8, padding: '2px 8px', borderRadius: 999, fontSize: 10, background: 'rgba(255,255,255,0.85)', color: '#555' }}
                      >
                        {l.genre}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: '12px 14px' }}>
                    <p className="font-black text-[13px] truncate mb-0.5">{l.title}</p>
                    <p className="text-[11px] font-semibold mb-2" style={{ color: '#aaa' }}>{l.author}</p>
                    {l.profiles?.username && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-[11px] font-bold truncate" style={{ color: '#888' }}>{l.profiles.username}</span>
                        <StarRatingBadge rating={sellerRatings[l.user_id] ?? null} sellerId={l.user_id} />
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <span
                        className="font-extrabold text-[10px]"
                        style={{ padding: '2px 7px', borderRadius: 6, background: '#fef9c3', color: '#854d0e', border: '1.5px solid #fde047' }}
                      >
                        {conditionLabel(l.condition)}
                      </span>
                      <span className="font-extrabold text-[10px]" style={{ color: '#f97316' }}>
                        🪙 1 credit
                      </span>
                    </div>
                    {locked && (
                      <form action={addTbrEntry} className="mt-2">
                        <input type="hidden" name="title" value={l.title} />
                        <input type="hidden" name="author" value={l.author} />
                        <input type="hidden" name="redirect_to" value={currentUrl} />
                        <button
                          type="submit"
                          className="w-full font-extrabold text-[11px]"
                          style={{ background: '#f5f3ff', border: '1.5px solid #ddd6fe', color: '#7c3aed', padding: '6px 0', borderRadius: 10, cursor: 'pointer' }}
                        >
                          📚 Add to my TBR
                        </button>
                      </form>
                    )}
                  </div>
                </>
              )

              return locked ? (
                <div
                  key={l.id}
                  className="bg-white border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb] overflow-hidden"
                  style={{ borderRadius: 20 }}
                >
                  {cardInner}
                </div>
              ) : (
                <Link
                  key={l.id}
                  href={`/listings/${l.id}`}
                  className="block bg-white border-2 border-gray-100 shadow-[0_5px_0_#e5e7eb] hover:-translate-y-1 transition-transform overflow-hidden"
                  style={{ borderRadius: 20, textDecoration: 'none', color: 'inherit' }}
                >
                  {cardInner}
                </Link>
              )
            })}
```

- [ ] **Step 6: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual QA**

With the dev server running and two users as in Task 5's manual QA:
1. Confirm Browse shows a normal card for any `active` listing.
2. After User A requests a purchase, reload Browse as User B → the card should be faint/grayscale, show "⏳ Pending", have no click-through (no `<a href>` in the rendered HTML for that card), and show an "Add to my TBR" button that adds the title/author and returns to the same filtered Browse URL.
3. Reload Browse as User A (the requester) → same card should still be a normal clickable link with a "⏳ Pending" badge.
4. Reload Browse as the seller (owner) → same, normal clickable link with the badge.
5. After the seller confirms, reload Browse as anyone → the listing should disappear entirely.

- [ ] **Step 8: Commit**

```bash
git add app/listings/page.tsx
git commit -m "feat: show pending listings faint/unclickable in Browse with TBR quick-add"
```

---

### Task 7: Exchanges tab Deny button + My Listings pending guard

**Files:**
- Modify: `app/profile/DashboardClient.tsx:107-118` (Props type)
- Modify: `app/profile/DashboardClient.tsx:147-157` (`statusStyle`/`statusLabel`)
- Modify: `app/profile/DashboardClient.tsx:165` (destructured props)
- Modify: `app/profile/DashboardClient.tsx:288-308` (My Listings Mark Sold/Re-list toggle)
- Modify: `app/profile/DashboardClient.tsx:428-436` (Exchanges tab seller actions)
- Modify: `app/profile/page.tsx:6` (import)
- Modify: `app/profile/page.tsx:202-203` (prop wiring)

**Interfaces:**
- Consumes: `denyPurchase` from `app/profile/actions.ts` (Task 4).
- Produces: nothing new consumed elsewhere — this is a leaf UI task.

- [ ] **Step 1: Add `denyPurchase` to the Props type**

In `app/profile/DashboardClient.tsx`, find:

```ts
  confirmExchange: (formData: FormData) => Promise<void>
  cancelPurchase: (formData: FormData) => Promise<void>
```

Replace with:

```ts
  confirmExchange: (formData: FormData) => Promise<void>
  cancelPurchase: (formData: FormData) => Promise<void>
  denyPurchase: (formData: FormData) => Promise<void>
```

- [ ] **Step 2: Destructure the new prop**

Find (the component's parameter list, currently one long line):

```ts
export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, updateAction, updateListingStatus, completeExchange, hideExchangeHistory, submitReview, confirmExchange, cancelPurchase, removeSavedListing, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError, isDemo, initialConversationId }: Props) {
```

Replace with (adds `denyPurchase` after `confirmExchange`):

```ts
export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, updateAction, updateListingStatus, completeExchange, hideExchangeHistory, submitReview, confirmExchange, denyPurchase, cancelPurchase, removeSavedListing, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError, isDemo, initialConversationId }: Props) {
```

- [ ] **Step 3: Add the `pending` case to `statusStyle`/`statusLabel`**

Find:

```ts
function statusStyle(status: string) {
  if (status === 'sold')  return { background: '#dbeafe', color: '#1d4ed8' }
  if (status === 'given') return { background: '#f3e8ff', color: '#6b21a8' }
  return { background: '#dcfce7', color: '#166534' }
}

function statusLabel(status: string) {
  if (status === 'sold')  return 'Sold'
  if (status === 'given') return 'Given Away'
  return 'Active'
}
```

Replace with:

```ts
function statusStyle(status: string) {
  if (status === 'sold')    return { background: '#dbeafe', color: '#1d4ed8' }
  if (status === 'given')   return { background: '#f3e8ff', color: '#6b21a8' }
  if (status === 'pending') return { background: '#fffbeb', color: '#92400e' }
  return { background: '#dcfce7', color: '#166534' }
}

function statusLabel(status: string) {
  if (status === 'sold')    return 'Sold'
  if (status === 'given')   return 'Given Away'
  if (status === 'pending') return 'Pending'
  return 'Active'
}
```

- [ ] **Step 4: Hide Mark Sold/Re-list while a listing is pending**

Find, in the My Listings tab:

```tsx
                  <form action={updateListingStatus} className="flex gap-2 shrink-0">
                    <input type="hidden" name="id" value={l.id} />
                    {l.status === 'active' ? (
                      <button name="status" value="sold"
                        className="font-extrabold text-[11px] hover:opacity-80"
                        style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0 }}>
                        Mark Sold
                      </button>
                    ) : (
                      <button name="status" value="active"
                        className="font-extrabold text-[11px] hover:opacity-80"
                        style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer', padding: 0 }}>
                        Re-list
                      </button>
                    )}
                    <button name="status" value="delete"
                      className="font-extrabold text-[11px] hover:opacity-80"
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>
                      Delete
                    </button>
                  </form>
```

Replace with:

```tsx
                  <form action={updateListingStatus} className="flex gap-2 shrink-0">
                    <input type="hidden" name="id" value={l.id} />
                    {l.status === 'pending' ? null : l.status === 'active' ? (
                      <button name="status" value="sold"
                        className="font-extrabold text-[11px] hover:opacity-80"
                        style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0 }}>
                        Mark Sold
                      </button>
                    ) : (
                      <button name="status" value="active"
                        className="font-extrabold text-[11px] hover:opacity-80"
                        style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer', padding: 0 }}>
                        Re-list
                      </button>
                    )}
                    <button name="status" value="delete"
                      className="font-extrabold text-[11px] hover:opacity-80"
                      style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>
                      Delete
                    </button>
                  </form>
```

- [ ] **Step 5: Add the Deny button next to Confirm in the Exchanges tab**

Find:

```tsx
                {/* Seller: confirm a purchase request */}
                {role === 'seller' && status === 'requested' && (
                  <form action={confirmExchange}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] text-white hover:opacity-90"
                      style={{ background: '#0d9488', border: 'none', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 0 #0f766e' }}>
                      ✅ Confirm — Send My Contact Info
                    </button>
                  </form>
                )}
```

Replace with:

```tsx
                {/* Seller: confirm a purchase request */}
                {role === 'seller' && status === 'requested' && (
                  <form action={confirmExchange}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] text-white hover:opacity-90"
                      style={{ background: '#0d9488', border: 'none', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit', boxShadow: '0 2px 0 #0f766e' }}>
                      ✅ Confirm — Send My Contact Info
                    </button>
                  </form>
                )}

                {/* Seller: deny a purchase request */}
                {role === 'seller' && status === 'requested' && (
                  <form action={denyPurchase} onSubmit={e => { if (!confirm('Deny this purchase request?')) e.preventDefault() }}>
                    <input type="hidden" name="conversation_id" value={ex.id} />
                    <button className="font-extrabold text-[12px] hover:opacity-80"
                      style={{ background: '#fff1f2', border: '1.5px solid #fca5a5', color: '#dc2626', padding: '7px 18px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit' }}>
                      ✕ Deny
                    </button>
                  </form>
                )}
```

- [ ] **Step 6: Wire `denyPurchase` through `app/profile/page.tsx`**

In `app/profile/page.tsx`, find:

```ts
import { updateProfile, updateListingStatus, completeExchange, hideExchangeHistory, confirmExchange, cancelPurchase } from './actions'
```

Replace with:

```ts
import { updateProfile, updateListingStatus, completeExchange, hideExchangeHistory, confirmExchange, denyPurchase, cancelPurchase } from './actions'
```

Then find:

```tsx
      confirmExchange={confirmExchange}
      cancelPurchase={cancelPurchase}
```

Replace with:

```tsx
      confirmExchange={confirmExchange}
      denyPurchase={denyPurchase}
      cancelPurchase={cancelPurchase}
```

- [ ] **Step 7: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Manual QA**

In the dev server, as a seller with an incoming request in the Exchanges tab: confirm the "✕ Deny" button appears next to "✅ Confirm", clicking it (after the confirm dialog) removes the request from the list, and reloading Browse/the listing detail page as the original buyer shows it as purchasable again. Also confirm a `pending` listing in My Listings shows the "Pending" badge and has no Mark Sold/Re-list button, only Delete.

- [ ] **Step 9: Commit**

```bash
git add app/profile/DashboardClient.tsx app/profile/page.tsx
git commit -m "feat: add seller Deny action and pending status support in profile dashboard"
```

---

### Task 8: Full regression pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit test suite**

Run: `npx vitest run`
Expected: all existing suites plus the new `lib/listingAvailability.test.ts` pass, no regressions.

- [ ] **Step 2: Run a full production build**

Run: `npm run build`
Expected: builds successfully with no type or lint errors.

- [ ] **Step 3: Walk through the full scenario end-to-end**

Using two logged-in users against a real Supabase instance with Task 1's migration applied:
1. User A requests a book → Browse shows it faint/unclickable to User B, who can add it to their TBR.
2. Seller confirms → the book disappears from Browse for everyone (including User B and the seller's own "My Listings" now shows "Pending"... then "Sold" once confirmed).
3. Repeat with a second book: User A requests, seller denies → the book reopens in Browse (normal, clickable) for everyone, and User B's TBR entry (if they added one in step 1's scenario) shows a match link the next time they open Profile.

If anything in Step 3 doesn't match, return to the relevant task above and fix it before considering this plan complete.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `listings.status` check constraint gains `'pending'` |
| `lib/types.ts` | `ListingStatus` gains `'pending'` |
| `lib/listingAvailability.ts` | New: `getListingAvailability` pure function |
| `lib/listingAvailability.test.ts` | New: unit tests for `getListingAvailability` |
| `lib/actions/tbrEntries.ts` | `addTbrEntry` gains optional `redirect_to` field |
| `app/profile/actions.ts` | `confirmExchange` also sets `listings.status = 'sold'`; `cancelPurchase` reverts the lock; new `denyPurchase` |
| `app/listings/[id]/page.tsx` | `requestPurchase` acquires the lock atomically; footer rendering handles pending-locked/unavailable states with a TBR quick-add |
| `app/listings/page.tsx` | Query includes `pending`; fetches viewer's requested listings; faint/unclickable card rendering with TBR quick-add |
| `app/profile/DashboardClient.tsx` | `statusStyle`/`statusLabel` gain a `pending` case; Mark Sold/Re-list hidden while pending; new Deny button |
| `app/profile/page.tsx` | Imports and passes `denyPurchase` to `DashboardClient` |
