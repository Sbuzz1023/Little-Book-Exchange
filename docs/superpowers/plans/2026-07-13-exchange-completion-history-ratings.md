# Exchange Completion, Sold/Bought History, and Seller Ratings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When either party marks a book picked up, actually complete the exchange (flip the listing to `sold`, move the exchange into a per-user History list split by Sold/Bought), and let the buyer optionally leave a 1–5 star + text rating of the seller that's visible anywhere the seller's name appears.

**Architecture:** A DB migration adds a `'completed'` exchange status, per-user history-hide flags on `conversations`, a `security definer` trigger that flips the listing to `sold` on completion (avoiding a buyer-facing UPDATE grant on listings), and a new `reviews` table (one row per completed exchange, buyer → seller only). Server actions are extended/added in `app/profile/actions.ts` and a new `lib/actions/reviews.ts`. UI-wise, a new `HistorySection` component holds the History card (extracted out of the already-750-line `DashboardClient.tsx`), a new shared `StarRating` component renders the read-only badge and the interactive picker, and a new `/sellers/[id]/reviews` page lists a seller's reviews. The Admin panel's Reviews tab and Users tab review count — both currently mock data — get wired to the real table.

**Tech Stack:** Next.js 14 (App Router), React 18, Supabase (`@supabase/ssr`), TypeScript, Vitest + Testing Library.

## Global Constraints

- No semicolons at statement ends, matching every existing file in this codebase — don't introduce them in new code.
- This codebase's established convention (see `app/profile/page.tsx`'s own comment) is to avoid nested Supabase joins and instead do separate batched lookups (`.in('id', [...])`) — follow this in every new query added by this plan.
- Server actions in this codebase (`app/profile/actions.ts`, `lib/actions/savedListings.ts`, `lib/actions/tbrEntries.ts`) are not unit tested — only pure logic (`validateLocationInput.ts`) and client components (`HeartButton`, `MessagesTab`, `PostForm`) have test files. Follow this: tasks that only touch a server action file end in manual verification, not a fabricated test.
- **Deviation from the written spec, found during planning:** the spec's Section 4 named `components/BookCard.tsx` as a display location for the rating badge. That component is dead code — nothing in the app renders it (`app/listings/page.tsx`, the actual Browse page, inlines its own duplicate card JSX instead of using `BookCard`). Task 10 below edits the real inline card in `app/listings/page.tsx`, not `BookCard.tsx`. `BookCard.tsx` is left untouched (not in scope to fix or delete unrelated dead code).

---

### Task 1: Database migration

**Files:**
- Modify: `supabase/schema.sql` (append new migration block at the end of the file)

**Interfaces:**
- Produces: `conversations.exchange_status` now allows `'completed'`; `conversations.buyer_hidden`, `conversations.seller_hidden`, `conversations.completed_at` columns; a `conversations` UPDATE RLS policy for participants; a `complete_exchange_marks_listing_sold` trigger; the `reviews` table with its RLS policies.

This project has no migration runner — `schema.sql` is a running log of blocks meant to be pasted into the Supabase SQL Editor by hand (see the existing "Migration: admin location editing..." block). This task follows that exact convention.

- [ ] **Step 1: Append the migration block**

Add this to the end of `supabase/schema.sql`:

```sql

-- ── Migration: exchange completion, history, and seller ratings ──────────────

-- 1. Exchanges can now be marked complete
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_exchange_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_exchange_status_check
  CHECK (exchange_status IN ('none', 'requested', 'confirmed', 'completed'));

-- 2. Per-user history hide (the shared conversation row survives; each side can
-- hide their own copy independently without affecting the other party), and a
-- timestamp for when the exchange actually completed (History's "date" column
-- needs this — created_at is when the conversation started, not when it ended).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS buyer_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- 3. Conversations never had an UPDATE policy — confirmExchange, the new
-- completion action, and the hide action all need one.
create policy "Participants can update conversations" on conversations
  for update using (auth.uid() = buyer_id or auth.uid() = seller_id);

-- 4. Auto-complete the listing when the exchange completes. A trigger (not an
-- RLS policy letting buyers UPDATE listings directly) because RLS can't be
-- scoped to a single column — a buyer-facing listings UPDATE policy would let
-- a buyer rewrite the seller's title/price/description too. security definer
-- mirrors the existing prevent_is_admin_self_grant trigger's approach.
create or replace function complete_exchange_marks_listing_sold()
returns trigger as $$
begin
  if new.exchange_status = 'completed' and old.exchange_status is distinct from 'completed' then
    update listings set status = 'sold' where id = new.listing_id;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists mark_listing_sold_on_completion on conversations;
create trigger mark_listing_sold_on_completion after update on conversations
  for each row execute procedure complete_exchange_marks_listing_sold();

-- 5. Seller ratings (one per completed exchange, buyer -> seller only)
create table if not exists reviews (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null unique,
  seller_id uuid references profiles(id) on delete cascade not null,
  reviewer_id uuid references profiles(id) on delete cascade not null,
  rating int not null check (rating between 1 and 5),
  text text,
  flagged boolean not null default false,
  created_at timestamptz default now()
);

alter table reviews enable row level security;

create policy "Reviews are viewable by everyone" on reviews for select using (true);

create policy "Buyers can review a completed exchange" on reviews
  for insert with check (
    auth.uid() = reviewer_id and
    exists (
      select 1 from conversations c
      where c.id = conversation_id
      and c.buyer_id = auth.uid()
      and c.seller_id = reviews.seller_id
      and c.exchange_status = 'completed'
    )
  );

create policy "Admins can moderate reviews" on reviews
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create policy "Admins can delete reviews" on reviews
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run it**

Paste the block into the Supabase SQL Editor for this project (`qlctujyuupighlvzryva`) and run it. This can't be done from this codebase/session — there's no service-role key or DB connection string checked in (same limitation encountered re-establishing admin access earlier), only the anon key in `.env.local`. Ask your human partner to run it, or run it yourself if you have SQL Editor access.

- [ ] **Step 3: Verify the migration applied**

Run against the anon REST endpoint (works because `reviews` is publicly selectable and `conversations`' new columns are visible to a schema-level query even though row access is still RLS-gated — an empty `200` response means the columns/table exist; a `400`/`42703` error means they don't):

```bash
curl -s "https://qlctujyuupighlvzryva.supabase.co/rest/v1/conversations?select=buyer_hidden,seller_hidden,completed_at&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"

curl -s "https://qlctujyuupighlvzryva.supabase.co/rest/v1/reviews?select=id,rating,flagged&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"
```

Expected: both return `[]` (or rows), not a `400` schema-cache error.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add exchange completion, history, and reviews schema"
```

---

### Task 2: `averageRating` helper

**Files:**
- Create: `lib/reviewAverages.ts`
- Test: `lib/reviewAverages.test.ts`

**Interfaces:**
- Produces: `averageRating(ratings: number[]): { average: number; count: number } | null` — used by Task 6 (profile page), Task 10 (Browse page), Task 11 (listing detail page), Task 12 (seller reviews page).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { averageRating } from './reviewAverages'

describe('averageRating', () => {
  it('returns null for an empty list', () => {
    expect(averageRating([])).toBeNull()
  })

  it('returns the exact average and count for a single rating', () => {
    expect(averageRating([5])).toEqual({ average: 5, count: 1 })
  })

  it('rounds the average to one decimal place', () => {
    expect(averageRating([5, 4, 4])).toEqual({ average: 4.3, count: 3 })
  })

  it('handles a full mix of ratings', () => {
    expect(averageRating([1, 2, 3, 4, 5])).toEqual({ average: 3, count: 5 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/reviewAverages.test.ts`
Expected: FAIL — `Cannot find module './reviewAverages'`

- [ ] **Step 3: Implement**

```ts
export type RatingSummary = { average: number; count: number }

export function averageRating(ratings: number[]): RatingSummary | null {
  if (ratings.length === 0) return null
  const sum = ratings.reduce((a, b) => a + b, 0)
  return { average: Math.round((sum / ratings.length) * 10) / 10, count: ratings.length }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/reviewAverages.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/reviewAverages.ts lib/reviewAverages.test.ts
git commit -m "feat: add averageRating helper for seller ratings"
```

---

### Task 3: `StarRating` component

**Files:**
- Create: `components/StarRating.tsx`
- Test: `components/StarRating.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `StarRatingBadge({ rating: { average: number; count: number } | null, sellerId?: string })` — read-only badge, renders nothing when `rating` is `null` or `rating.count === 0`, wraps in a `next/link` to `/sellers/{sellerId}/reviews` when `sellerId` is given. `StarRatingPicker({ value: number, onChange: (n: number) => void })` — five clickable 1–5 star buttons. Used by Task 7 (`HistorySection`), Task 9 (`MessagesTab`), Task 10 (Browse page), Task 11 (listing detail page).

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { StarRatingBadge, StarRatingPicker } from './StarRating'

describe('StarRatingBadge', () => {
  it('renders nothing when rating is null', () => {
    const { container } = render(<StarRatingBadge rating={null} />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing when count is 0', () => {
    const { container } = render(<StarRatingBadge rating={{ average: 0, count: 0 }} />)
    expect(container.textContent).toBe('')
  })

  it('shows the average and count', () => {
    const { container } = render(<StarRatingBadge rating={{ average: 4.8, count: 12 }} />)
    expect(container.textContent).toContain('4.8')
    expect(container.textContent).toContain('12')
  })

  it('links to the seller reviews page when sellerId is given', () => {
    const { container } = render(<StarRatingBadge rating={{ average: 4.8, count: 12 }} sellerId="seller-1" />)
    const link = container.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/sellers/seller-1/reviews')
  })

  it('renders without a link when sellerId is omitted', () => {
    const { container } = render(<StarRatingBadge rating={{ average: 4.8, count: 12 }} />)
    expect(container.querySelector('a')).toBeNull()
  })
})

describe('StarRatingPicker', () => {
  it('highlights stars up to the current value', () => {
    const { container } = render(<StarRatingPicker value={3} onChange={vi.fn()} />)
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons).toHaveLength(5)
    expect(buttons[2].style.color).toBe('rgb(245, 158, 11)')
    expect(buttons[3].style.color).toBe('rgb(229, 231, 235)')
  })

  it('calls onChange with the clicked star value', () => {
    const onChange = vi.fn()
    const { container } = render(<StarRatingPicker value={3} onChange={onChange} />)
    const buttons = Array.from(container.querySelectorAll('button'))
    fireEvent.click(buttons[4])
    expect(onChange).toHaveBeenCalledWith(5)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run components/StarRating.test.tsx`
Expected: FAIL — `Cannot find module './StarRating'`

- [ ] **Step 3: Implement**

```tsx
import Link from 'next/link'

export function StarRatingBadge({
  rating, sellerId,
}: {
  rating: { average: number; count: number } | null
  sellerId?: string
}) {
  if (!rating || rating.count === 0) return null

  const content = (
    <span className="font-extrabold text-[11px] whitespace-nowrap" style={{ color: '#f59e0b' }}>
      ★ {rating.average.toFixed(1)} <span style={{ color: '#aaa', fontWeight: 700 }}>({rating.count})</span>
    </span>
  )

  if (!sellerId) return content

  return (
    <Link href={`/sellers/${sellerId}/reviews`} style={{ textDecoration: 'none' }} className="hover:underline">
      {content}
    </Link>
  )
}

export function StarRatingPicker({
  value, onChange,
}: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            fontSize: 28, lineHeight: 1,
            color: n <= value ? '#f59e0b' : '#e5e7eb',
          }}
        >
          ★
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run components/StarRating.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add components/StarRating.tsx components/StarRating.test.tsx
git commit -m "feat: add StarRatingBadge and StarRatingPicker components"
```

---

### Task 4: Complete the exchange and hide history (`app/profile/actions.ts`)

**Files:**
- Modify: `app/profile/actions.ts:38-49` (the existing `notifyPickedUp` function)

**Interfaces:**
- Produces: `completeExchange(formData: FormData): Promise<void>` (replaces `notifyPickedUp` — reads `conversation_id`), `hideExchangeHistory(formData: FormData): Promise<void>` (reads `conversation_id`, `role`). Both consumed by Task 6 (`page.tsx`) and Task 8 (`DashboardClient.tsx`)/Task 7 (`HistorySection.tsx`).

Depends on: Task 1 (needs `exchange_status = 'completed'` to be a legal value, and the `buyer_hidden`/`seller_hidden` columns + participant UPDATE policy).

No unit test for this file — matches this codebase's existing convention (see Global Constraints). Verified manually via the dev server after Task 8 wires the UI.

- [ ] **Step 1: Replace `notifyPickedUp` with `completeExchange`**

In `app/profile/actions.ts`, replace the existing `notifyPickedUp` function (lines 38-49):

```ts
export async function notifyPickedUp(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: '📚 Book picked up! Thanks so much!',
  })
  redirect('/profile?tab=exchanges')
}
```

with:

```ts
export async function completeExchange(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string

  await supabase.from('conversations')
    .update({ exchange_status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', conversationId)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: '📚 Book picked up! Thanks so much!',
  })

  redirect('/profile?tab=exchanges')
}

export async function hideExchangeHistory(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string
  const role = formData.get('role') as 'buyer' | 'seller'

  await supabase.from('conversations')
    .update(role === 'seller' ? { seller_hidden: true } : { buyer_hidden: true })
    .eq('id', conversationId)
    .eq(role === 'seller' ? 'seller_id' : 'buyer_id', user.id)

  redirect('/profile?tab=exchanges')
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: new errors only in `app/profile/page.tsx` and `app/profile/DashboardClient.tsx` (they still reference `notifyPickedUp`, which no longer exists) — those are fixed in Tasks 6 and 8. No errors in `app/profile/actions.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add app/profile/actions.ts
git commit -m "feat: complete exchanges on pickup, add hideExchangeHistory"
```

---

### Task 5: Review server actions (`lib/actions/reviews.ts`)

**Files:**
- Create: `lib/actions/reviews.ts`

**Interfaces:**
- Consumes: `requireAdmin(supabase)` from `lib/actions/libraryLocations.ts` (already exported there).
- Produces: `submitReview(formData: FormData): Promise<{ ok: boolean; error?: string }>` (reads `conversation_id`, `seller_id`, `rating`, `text`), `adminUpdateReview(id: string, text: string): Promise<{ ok: boolean; error?: string }>`, `adminDeleteReview(id: string): Promise<{ ok: boolean; error?: string }>`. Consumed by Task 6 (`page.tsx`, passes `submitReview` through), Task 7 (`HistorySection.tsx` calls `submitReview`), Task 13 (`AdminClient.tsx` calls the two admin functions).

Depends on: Task 1 (the `reviews` table and its RLS policies must exist).

No unit test — matches this codebase's convention for server action files (Global Constraints). `submitReview` is exercised indirectly by Task 7's `HistorySection` test (which mocks it), and manually verified end-to-end after Task 8.

- [ ] **Step 1: Implement**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

export async function submitReview(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const conversationId = formData.get('conversation_id') as string
  const sellerId = formData.get('seller_id') as string
  const rating = Number(formData.get('rating'))
  const text = ((formData.get('text') as string) || '').trim() || null

  const { error } = await supabase.from('reviews').insert({
    conversation_id: conversationId,
    seller_id: sellerId,
    reviewer_id: user.id,
    rating,
    text,
  })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function adminUpdateReview(id: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { error } = await supabase.from('reviews').update({ text, flagged: false }).eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function adminDeleteReview(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { error } = await supabase.from('reviews').delete().eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from this file (it's not consumed anywhere yet, so no downstream breakage either).

- [ ] **Step 3: Commit**

```bash
git add lib/actions/reviews.ts
git commit -m "feat: add submitReview and admin review moderation actions"
```

---

### Task 6: Wire reviews and hidden flags into the profile page (`app/profile/page.tsx`)

**Files:**
- Modify: `app/profile/page.tsx:6` (imports), `app/profile/page.tsx:144-160` (the `exchanges = merged.map(...)` block), `app/profile/page.tsx:173-193` (the `<DashboardClient>` props)

**Interfaces:**
- Consumes: `completeExchange`, `hideExchangeHistory` (Task 4), `submitReview` (Task 5), `averageRating` (Task 2).
- Produces: `DashboardClient` now receives `completeExchange`, `hideExchangeHistory`, `submitReview` props, and each item in the `exchanges` array now carries `buyer_hidden`, `seller_hidden`, `completed_at`, `sellerRating`, `reviewed` (all already present on the raw `conversations` row via the existing `select('*')` except the last two, which are computed here). Consumed by Task 8 (`DashboardClient.tsx`).

Depends on: Tasks 1, 2, 4, 5.

No unit test — this file has no existing test coverage (matches convention; it's a server component doing data-fetching, like every other `page.tsx` in this codebase). Verified manually in Task 8 once the UI can display the result.

- [ ] **Step 1: Update the action imports**

Replace line 6:

```ts
import { updateProfile, updateListingStatus, notifyPickedUp, confirmExchange, cancelPurchase } from './actions'
```

with:

```ts
import { updateProfile, updateListingStatus, completeExchange, hideExchangeHistory, confirmExchange, cancelPurchase } from './actions'
import { submitReview } from '@/lib/actions/reviews'
import { averageRating } from '@/lib/reviewAverages'
```

- [ ] **Step 2: Batch-fetch reviewed status and seller ratings**

Right after the `messages` fetch and before `exchanges = merged.map((row: any) => {` (i.e. right after the line building `mm` at what is currently line 142, still inside the `if (merged.length > 0) {` block), insert:

```ts
        // Reviews: which completed exchanges already have a buyer review, and
        // each seller's aggregate rating across all their completed sales
        const completedIds = merged.filter((r: any) => r.exchange_status === 'completed').map((r: any) => r.id)
        const { data: reviewedRows } = completedIds.length > 0
          ? await supabase.from('reviews').select('conversation_id').in('conversation_id', completedIds)
          : { data: [] as any[] }
        const reviewedSet = new Set((reviewedRows ?? []).map((r: any) => r.conversation_id))

        const sellerIds = [...new Set(merged.map((r: any) => r.seller_id))]
        const { data: ratingRows } = await supabase.from('reviews').select('seller_id, rating').in('seller_id', sellerIds)
        const ratingsBySeller: Record<string, number[]> = {}
        for (const r of ratingRows ?? []) (ratingsBySeller[r.seller_id] ??= []).push(r.rating)
```

- [ ] **Step 3: Add the new fields to the mapped exchange objects**

The existing `exchanges = merged.map((row: any) => { ... return { ...row, exchange_status: ..., listings: ..., buyer: ..., seller: {...}, messages: mm[row.id] ?? [] } })` block — add two fields to the returned object, right after `messages: mm[row.id] ?? [],`:

```ts
            messages: mm[row.id] ?? [],
            sellerRating: averageRating(ratingsBySeller[row.seller_id] ?? []),
            reviewed: reviewedSet.has(row.id),
```

(`buyer_hidden`, `seller_hidden`, `completed_at` already flow through automatically via the `...row` spread — the conversations query uses `select('*')`, so no separate change is needed for those three.)

- [ ] **Step 4: Update the `DashboardClient` props**

Replace:

```tsx
      updateListingStatus={updateListingStatus}
      notifyPickedUp={notifyPickedUp}
      confirmExchange={confirmExchange}
```

with:

```tsx
      updateListingStatus={updateListingStatus}
      completeExchange={completeExchange}
      hideExchangeHistory={hideExchangeHistory}
      submitReview={submitReview}
      confirmExchange={confirmExchange}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: errors remaining only in `app/profile/DashboardClient.tsx` (still expects the old `notifyPickedUp` prop name and doesn't know the new `Exchange` fields yet) — fixed in Task 8.

- [ ] **Step 6: Commit**

```bash
git add app/profile/page.tsx
git commit -m "feat: fetch review status and seller ratings for the profile page"
```

---

### Task 7: `HistorySection` component

**Files:**
- Create: `app/profile/HistorySection.tsx`
- Test: `app/profile/HistorySection.test.tsx`

**Interfaces:**
- Consumes: `StarRatingBadge`, `StarRatingPicker` (Task 3); calls `hideExchangeHistory` and `submitReview` (Tasks 4, 5) via the props passed in (not imported directly — same pattern as `MessagesTab`, which takes its actions as props from `DashboardClient`).
- Produces: `export default function HistorySection(props: { exchanges: HistoryExchange[]; userId: string; hideExchangeHistory: (formData: FormData) => Promise<void>; submitReview: (formData: FormData) => Promise<{ ok: boolean; error?: string }> })`, and `export type HistoryExchange = { id, listing_id, buyer_id, seller_id, exchange_status, completed_at, listings, buyer, seller, buyer_hidden, seller_hidden, sellerRating, reviewed }`. Consumed by Task 8 (`DashboardClient.tsx`).

- [ ] **Step 1: Write the failing tests**

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import HistorySection, { type HistoryExchange } from './HistorySection'

const baseExchange: HistoryExchange = {
  id: 'convo-1',
  listing_id: 'listing-1',
  buyer_id: 'me',
  seller_id: 'them-1',
  exchange_status: 'completed',
  completed_at: '2026-07-10T12:00:00.000Z',
  listings: { title: 'The Hobbit', author: 'J.R.R. Tolkien', photo_url: null },
  buyer: { username: 'me', name: 'Me' },
  seller: { username: 'them1', name: 'Neighbor One' },
  buyer_hidden: false,
  seller_hidden: false,
  sellerRating: { average: 4.5, count: 8 },
  reviewed: false,
}

describe('HistorySection', () => {
  let hideExchangeHistory: ReturnType<typeof vi.fn>
  let submitReview: ReturnType<typeof vi.fn>

  beforeEach(() => {
    hideExchangeHistory = vi.fn(() => Promise.resolve())
    submitReview = vi.fn(() => Promise.resolve({ ok: true }))
  })

  it('shows an empty state with no completed exchanges', () => {
    const { container } = render(
      <HistorySection exchanges={[]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('No completed exchanges yet')
  })

  it('labels a row "Bought" when the user was the buyer, and shows the seller\'s rating', () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Bought')
    expect(container.textContent).toContain('Neighbor One')
    expect(container.textContent).toContain('4.5')
  })

  it('labels a row "Sold" when the user was the seller, and never shows a rate button', () => {
    const soldExchange: HistoryExchange = { ...baseExchange, buyer_id: 'them-2', seller_id: 'me', buyer: { username: 'them2', name: 'Neighbor Two' } }
    const { container } = render(
      <HistorySection exchanges={[soldExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Sold')
    expect(container.textContent).not.toContain('Rate Seller')
  })

  it('excludes a completed exchange the current user has hidden on their own side', () => {
    const hidden: HistoryExchange = { ...baseExchange, buyer_hidden: true }
    const { container } = render(
      <HistorySection exchanges={[hidden]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('No completed exchanges yet')
  })

  it('shows "Rate Seller" for an unreviewed Bought row, and "Rated" for a reviewed one', () => {
    const { container, rerender } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Rate Seller')

    rerender(
      <HistorySection exchanges={[{ ...baseExchange, reviewed: true }]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    expect(container.textContent).toContain('Rated')
  })

  it('opens a rating modal and submits the chosen star count and text', async () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Rate Seller'))!)

    const starButtons = Array.from(container.querySelectorAll('button[aria-label$="stars"], button[aria-label$="star"]'))
    fireEvent.click(starButtons[1]) // 2 stars

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Good seller' } })

    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Submit Rating'))!)

    await waitFor(() => expect(submitReview).toHaveBeenCalled())
    const sentFormData = submitReview.mock.calls[0][0] as FormData
    expect(sentFormData.get('conversation_id')).toBe('convo-1')
    expect(sentFormData.get('seller_id')).toBe('them-1')
    expect(sentFormData.get('rating')).toBe('2')
    expect(sentFormData.get('text')).toBe('Good seller')
  })

  it('shows "Rated" immediately after a successful submission without waiting for a reload', async () => {
    const { container } = render(
      <HistorySection exchanges={[baseExchange]} userId="me" hideExchangeHistory={hideExchangeHistory} submitReview={submitReview} />
    )
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Rate Seller'))!)
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Submit Rating'))!)
    await waitFor(() => expect(container.textContent).toContain('Rated'))
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run app/profile/HistorySection.test.tsx`
Expected: FAIL — `Cannot find module './HistorySection'`

- [ ] **Step 3: Implement**

```tsx
'use client'

import { useState } from 'react'
import { StarRatingBadge, StarRatingPicker } from '@/components/StarRating'

const COVER_GRADIENTS = [
  'linear-gradient(145deg, #fde68a, #fca5a5)',
  'linear-gradient(145deg, #99f6e4, #bfdbfe)',
  'linear-gradient(145deg, #fca5a5, #fda4af)',
  'linear-gradient(145deg, #c4b5fd, #93c5fd)',
  'linear-gradient(145deg, #6ee7b7, #fde68a)',
  'linear-gradient(145deg, #fdba74, #fb7185)',
  'linear-gradient(145deg, #a5f3fc, #6ee7b7)',
  'linear-gradient(145deg, #ddd6fe, #fca5a5)',
]

function coverGradient(id: string) {
  const sum = id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return COVER_GRADIENTS[sum % COVER_GRADIENTS.length]
}

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export type HistoryExchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  exchange_status: string
  completed_at: string | null
  listings: { title: string; author: string; photo_url?: string | null }
  buyer: { username?: string | null; name?: string | null }
  seller: { username?: string | null; name?: string | null }
  buyer_hidden: boolean
  seller_hidden: boolean
  sellerRating: { average: number; count: number } | null
  reviewed: boolean
}

const cardStyle = {
  background: '#fff',
  borderRadius: 20,
  padding: 24,
  border: '2px solid #f3f4f6',
  boxShadow: '0 6px 0 #e5e7eb',
} as React.CSSProperties

export default function HistorySection({
  exchanges, userId, hideExchangeHistory, submitReview,
}: {
  exchanges: HistoryExchange[]
  userId: string
  hideExchangeHistory: (formData: FormData) => Promise<void>
  submitReview: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
}) {
  const [ratingTarget, setRatingTarget] = useState<HistoryExchange | null>(null)
  const [stars, setStars] = useState(5)
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewedOverride, setReviewedOverride] = useState<Record<string, boolean>>({})

  const completed = exchanges
    .filter(e => {
      if (e.exchange_status !== 'completed') return false
      if (e.seller_id === userId) return !e.seller_hidden
      if (e.buyer_id === userId) return !e.buyer_hidden
      return false
    })
    .sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))

  function openRating(ex: HistoryExchange) {
    setRatingTarget(ex)
    setStars(5)
    setText('')
    setError(null)
  }

  async function handleSubmitReview(e: React.FormEvent) {
    e.preventDefault()
    if (!ratingTarget) return
    setSubmitting(true)
    setError(null)
    const formData = new FormData()
    formData.set('conversation_id', ratingTarget.id)
    formData.set('seller_id', ratingTarget.seller_id)
    formData.set('rating', String(stars))
    formData.set('text', text)
    const result = await submitReview(formData)
    setSubmitting(false)
    if (result.ok) {
      setReviewedOverride(prev => ({ ...prev, [ratingTarget.id]: true }))
      setRatingTarget(null)
    } else {
      setError(result.error ?? 'Could not submit review.')
    }
  }

  return (
    <div style={cardStyle}>
      <div className="font-extrabold text-[11px] mb-4"
        style={{ textTransform: 'uppercase', letterSpacing: '0.8px', padding: '7px 12px', borderRadius: 10, background: '#f3f4f6', color: '#555', display: 'inline-block' }}>
        📜 History ({completed.length})
      </div>

      {completed.length === 0 ? (
        <div className="text-center py-6 font-bold text-[13px]" style={{ color: '#ccc' }}>No completed exchanges yet</div>
      ) : (
        completed.map(ex => {
          const role = ex.seller_id === userId ? 'seller' : 'buyer'
          const other = role === 'seller' ? ex.buyer : ex.seller
          const otherName = other?.name || other?.username || 'Neighbor'
          const reviewed = ex.reviewed || !!reviewedOverride[ex.id]

          return (
            <div key={ex.id} className="flex items-center gap-3" style={{ padding: '12px 0', borderBottom: '2px solid #f3f4f6' }}>
              <div className="relative shrink-0 overflow-hidden" style={{ width: 42, height: 42, borderRadius: 10, background: coverGradient(ex.listing_id) }}>
                {ex.listings?.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ex.listings.photo_url} alt={ex.listings.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span className="flex items-center justify-center w-full h-full text-[18px]">📚</span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-black text-[13px] truncate">{ex.listings?.title ?? 'Unknown'}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-[12px]" style={{ color: '#aaa' }}>
                    {role === 'seller' ? 'Sold to' : 'Bought from'} <strong style={{ color: '#555' }}>{otherName}</strong>
                  </p>
                  {role === 'buyer' && <StarRatingBadge rating={ex.sellerRating} sellerId={ex.seller_id} />}
                </div>
                <p className="font-semibold text-[11px]" style={{ color: '#ccc' }}>{formatDate(ex.completed_at)}</p>
              </div>

              <span className="font-extrabold text-[10px] whitespace-nowrap shrink-0"
                style={{ padding: '3px 10px', borderRadius: 999, background: role === 'seller' ? '#fff7ed' : '#f0fdfa', color: role === 'seller' ? '#f97316' : '#0d9488' }}>
                {role === 'seller' ? 'Sold' : 'Bought'}
              </span>

              {role === 'buyer' && (
                reviewed ? (
                  <span className="font-bold text-[11px] shrink-0" style={{ color: '#aaa' }}>Rated</span>
                ) : (
                  <button type="button" onClick={() => openRating(ex)}
                    className="font-extrabold text-[11px] hover:opacity-80 shrink-0"
                    style={{ background: 'none', border: 'none', color: '#f97316', cursor: 'pointer', padding: 0 }}>
                    ⭐ Rate Seller
                  </button>
                )
              )}

              <form action={hideExchangeHistory} className="shrink-0">
                <input type="hidden" name="conversation_id" value={ex.id} />
                <input type="hidden" name="role" value={role} />
                <button className="font-extrabold text-[11px] hover:opacity-80"
                  style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>
                  ✕
                </button>
              </form>
            </div>
          )
        })
      )}

      {ratingTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <form onSubmit={handleSubmitReview} style={{ background: '#fff', borderRadius: 20, padding: 24, width: 360, maxWidth: '90vw' }}>
            <h3 className="font-display text-[18px] mb-3">
              Rate {ratingTarget.seller?.name || ratingTarget.seller?.username || 'Seller'}
            </h3>
            <StarRatingPicker value={stars} onChange={setStars} />
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Optional comment..."
              className="w-full border-2 border-gray-100 rounded-xl font-semibold text-[13px] mt-3"
              style={{ padding: 10, minHeight: 70 }}
            />
            {error && <p className="font-bold text-[12px] mt-2" style={{ color: '#dc2626' }}>{error}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setRatingTarget(null)} className="font-extrabold text-[13px]"
                style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="font-extrabold text-[13px] text-white"
                style={{ background: '#f97316', padding: '9px 20px', borderRadius: 999, border: 'none', cursor: 'pointer' }}>
                {submitting ? 'Submitting...' : 'Submit Rating'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run app/profile/HistorySection.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add app/profile/HistorySection.tsx app/profile/HistorySection.test.tsx
git commit -m "feat: add HistorySection with per-user delete and seller rating"
```

---

### Task 8: Integrate History into the Exchanges tab (`app/profile/DashboardClient.tsx`)

**Files:**
- Modify: `app/profile/DashboardClient.tsx:1-10` (imports), `:40-74` (`Exchange` type), `:96-110` (`Props` type), `:157` (component signature), `:308-496` (the Exchanges tab section)

**Interfaces:**
- Consumes: `HistorySection`, `HistoryExchange` (Task 7).
- Produces: the rendered Exchanges tab now shows completed items in History instead of the active lists.

Depends on: Tasks 6, 7.

No unit test — `DashboardClient.tsx` has no existing test file (matches convention; it's the same situation as `AdminClient.tsx` and every other large tab-switching client component in this app). Verified manually via the dev server (Step 6 below).

- [ ] **Step 1: Import `HistorySection`**

Add near the top of `app/profile/DashboardClient.tsx`, alongside the other imports:

```ts
import HistorySection, { type HistoryExchange } from './HistorySection'
```

- [ ] **Step 2: Widen the `Exchange` type**

Replace the existing `Exchange` type (lines 40-74):

```ts
type Exchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  exchange_status: 'none' | 'requested' | 'confirmed'
  listings: { ... }
  buyer: { ... }
  seller: { ... }
  messages: { id: string; body: string; sender_id: string; created_at: string }[]
}
```

with (only the `exchange_status` line and the four new fields change — everything else stays identical):

```ts
type Exchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  exchange_status: 'none' | 'requested' | 'confirmed' | 'completed'
  completed_at: string | null
  buyer_hidden: boolean
  seller_hidden: boolean
  sellerRating: { average: number; count: number } | null
  reviewed: boolean
  listings: {
    title: string
    author: string
    photo_url?: string | null
    city?: string | null
    state?: string | null
    pickup_description?: string | null
  }
  buyer: {
    username?: string | null
    name?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
  }
  seller: {
    username?: string | null
    name?: string | null
    city?: string | null
    state?: string | null
    phone?: string | null
    address?: string | null
    address_unit?: string | null
    share_address?: boolean | null
    pickup_description?: string | null
    share_pickup?: boolean | null
  }
  messages: { id: string; body: string; sender_id: string; created_at: string }[]
}
```

- [ ] **Step 3: Update the `Props` type**

Replace:

```ts
  updateListingStatus: (formData: FormData) => Promise<void>
  notifyPickedUp: (formData: FormData) => Promise<void>
  confirmExchange: (formData: FormData) => Promise<void>
```

with:

```ts
  updateListingStatus: (formData: FormData) => Promise<void>
  completeExchange: (formData: FormData) => Promise<void>
  hideExchangeHistory: (formData: FormData) => Promise<void>
  submitReview: (formData: FormData) => Promise<{ ok: boolean; error?: string }>
  confirmExchange: (formData: FormData) => Promise<void>
```

- [ ] **Step 4: Update the component signature**

Replace:

```tsx
export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, updateAction, updateListingStatus, notifyPickedUp, confirmExchange, cancelPurchase, removeSavedListing, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError, isDemo, initialConversationId }: Props) {
```

with:

```tsx
export default function DashboardClient({ profile, listings, exchanges, savedListings, tbrEntries, updateAction, updateListingStatus, completeExchange, hideExchangeHistory, submitReview, confirmExchange, cancelPurchase, removeSavedListing, addTbrEntry, removeTbrEntry, success, defaultTab, queryError, tbrError, isDemo, initialConversationId }: Props) {
```

- [ ] **Step 5: Filter completed exchanges out of the active lists, rename the button actions, and render `HistorySection`**

In the Exchanges tab section, replace:

```tsx
        const sold   = exchanges.filter(e => e.seller_id === userId)
        const bought = exchanges.filter(e => e.buyer_id  === userId)
```

with:

```tsx
        const sold   = exchanges.filter(e => e.seller_id === userId && e.exchange_status !== 'completed')
        const bought = exchanges.filter(e => e.buyer_id  === userId && e.exchange_status !== 'completed')
```

Replace both occurrences of `<form action={notifyPickedUp}>` (the seller "Mark Picked Up" button and the buyer "I Got It!" button) with `<form action={completeExchange}>`.

Then, right after the closing `</div>` of the "Coming In" (Bought) card and before the closing `</div>` of the outer `flex flex-col` wrapper — i.e. immediately before the final `)` that closes the `return (` for this section — add:

```tsx
            {/* History */}
            <HistorySection
              exchanges={exchanges as HistoryExchange[]}
              userId={userId}
              hideExchangeHistory={hideExchangeHistory}
              submitReview={submitReview}
            />
```

- [ ] **Step 6: Manually verify**

Run: `npm run dev`, sign in as a user with a `confirmed` exchange (or use the demo cookie flow), open `/profile?tab=exchanges`, and:
1. Confirm the active Sold/Bought cards still show in-progress exchanges as before.
2. Click "Mark Picked Up" (as seller) or "I Got It!" (as buyer) on a `confirmed` exchange.
3. Confirm the row disappears from the active list and reappears under History, labeled Sold or Bought.
4. As the buyer, click "⭐ Rate Seller", submit a rating, and confirm it flips to "Rated".
5. Click ✕ on a History row and confirm it disappears from your view.
6. Reload `/profile?tab=listings` and confirm the listing tied to that exchange now shows "Sold".

Expected: all six behaviors work as described.

- [ ] **Step 7: Commit**

```bash
git add app/profile/DashboardClient.tsx
git commit -m "feat: move completed exchanges into History in the Exchanges tab"
```

---

### Task 9: Seller rating badge in the Messages thread header (`app/profile/MessagesTab.tsx`)

**Files:**
- Modify: `app/profile/MessagesTab.tsx:9-18` (`MessagesTabExchange` type), `:225-233` (thread header)
- Modify: `app/profile/MessagesTab.test.tsx` (extend the `exchanges` fixture and add two tests)

**Interfaces:**
- Consumes: `StarRatingBadge` (Task 3).
- Produces: `MessagesTabExchange` gains an optional `sellerRating` field.

- [ ] **Step 1: Extend the fixture and write the failing tests**

In `app/profile/MessagesTab.test.tsx`, update the `exchanges` array (add `sellerRating` to `convo-2`, which is the conversation where `userId="me"` is the buyer and the other party is the seller):

```tsx
const exchanges: MessagesTabExchange[] = [
  {
    id: 'convo-1', listing_id: 'listing-1', buyer_id: 'them-1', seller_id: 'me',
    listings: { title: 'The Hobbit', author: 'J.R.R. Tolkien' },
    buyer: { name: 'Neighbor A' }, seller: { name: 'Me' },
    messages: [
      { id: 'm1', body: 'Is this still available?', sender_id: 'them-1', created_at: '2026-07-01T10:00:00.000Z' },
      { id: 'm2', body: 'Yes!', sender_id: 'me', created_at: '2026-07-01T10:05:00.000Z' },
    ],
  },
  {
    id: 'convo-2', listing_id: 'listing-2', buyer_id: 'me', seller_id: 'them-2',
    listings: { title: 'Sapiens', author: 'Yuval Noah Harari' },
    buyer: { name: 'Me' }, seller: { name: 'Neighbor B' },
    messages: [],
    sellerRating: { average: 4.5, count: 8 },
  },
]
```

Add these two tests at the end of the `describe('MessagesTab', ...)` block:

```tsx
  it('shows the seller\'s rating badge next to their name when the other party is the seller', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-2" onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain('4.5')
    expect(container.textContent).toContain('(8)')
  })

  it('does not show a rating badge when the other party is the buyer, not the seller', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-1" onSelectId={vi.fn()} />
    )
    expect(container.textContent).not.toContain('★')
  })
```

- [ ] **Step 2: Run it to verify the new tests fail**

Run: `npx vitest run app/profile/MessagesTab.test.tsx`
Expected: FAIL — the first new test fails because no rating badge is rendered yet (`toContain('4.5')` fails); the second passes trivially (nothing to fix yet, but leave both as-is — implementing Step 3 makes both correct).

- [ ] **Step 3: Implement**

Add the import at the top of `app/profile/MessagesTab.tsx`:

```ts
import { StarRatingBadge } from '@/components/StarRating'
```

Update the `MessagesTabExchange` type (lines 9-18) to add one field:

```ts
export type MessagesTabExchange = {
  id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  listings: { title: string; author: string; photo_url?: string | null }
  buyer: { username?: string | null; name?: string | null }
  seller: { username?: string | null; name?: string | null }
  sellerRating?: { average: number; count: number } | null
  messages: MessageRow[]
}
```

Replace the thread header's name line:

```tsx
              <div>
                <p style={{ fontWeight: 900, fontSize: 16, color: '#1a1a1a', lineHeight: 1.2 }}>{otherNameFor(convo, userId)}</p>
```

with:

```tsx
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <p style={{ fontWeight: 900, fontSize: 16, color: '#1a1a1a', lineHeight: 1.2 }}>{otherNameFor(convo, userId)}</p>
                  {convo.seller_id !== userId && <StarRatingBadge rating={convo.sellerRating ?? null} sellerId={convo.seller_id} />}
                </div>
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run app/profile/MessagesTab.test.tsx`
Expected: PASS (all tests, including the 2 new ones)

- [ ] **Step 5: Commit**

```bash
git add app/profile/MessagesTab.tsx app/profile/MessagesTab.test.tsx
git commit -m "feat: show seller rating badge in the Messages thread header"
```

---

### Task 10: Seller username and rating badge on the Browse page (`app/listings/page.tsx`)

**Files:**
- Modify: `lib/types.ts:1-6` (`Profile` type)
- Modify: `app/listings/page.tsx:1-8` (imports), `:32-68` (`getListings`), `:117-120` (data fetching), `:389-412` (the inline listing card)

**Interfaces:**
- Consumes: `averageRating` (Task 2), `StarRatingBadge` (Task 3).
- Produces: each Browse card shows the seller's username + rating badge.

Depends on: Tasks 2, 3. See the Global Constraints note — this task edits the real inline card markup in `app/listings/page.tsx`, not the unused `components/BookCard.tsx`.

No unit test — this page has no existing test file (matches convention for `page.tsx` server components in this codebase). Verified manually (Step 5).

- [ ] **Step 1: Add `username` to the shared `Profile` type**

`profiles.username` is already queried and rendered elsewhere in the app (e.g. `app/listings/[id]/page.tsx`'s "Listed by" line) through loosely-typed (`any`) data — but `app/listings/page.tsx` uses the strict `Listing`/`Profile` types from `lib/types.ts`, which don't declare `username` yet. Update `lib/types.ts`:

```ts
export type Profile = {
  id: string
  name: string
  username?: string
  city: string
  created_at: string
}
```

- [ ] **Step 2: Batch-fetch seller ratings for the visible listings**

In `app/listings/page.tsx`, add the imports:

```ts
import { averageRating } from '@/lib/reviewAverages'
```

Add a new function right after `getUserSaveContext` (after line 81):

```ts
async function getSellerRatings(listings: Listing[]): Promise<Record<string, { average: number; count: number } | null>> {
  const sellerIds = [...new Set(listings.map(l => l.user_id))]
  if (sellerIds.length === 0) return {}
  try {
    const supabase = createClient()
    const { data } = await supabase.from('reviews').select('seller_id, rating').in('seller_id', sellerIds)
    const bySeller: Record<string, number[]> = {}
    for (const r of data ?? []) (bySeller[r.seller_id] ??= []).push(r.rating)
    const result: Record<string, { average: number; count: number } | null> = {}
    for (const id of sellerIds) result[id] = averageRating(bySeller[id] ?? [])
    return result
  } catch {
    return {}
  }
}
```

Update the `Promise.all` call (lines 117-120):

```ts
  const [listings, { isLoggedIn, userId, savedIds }] = await Promise.all([
    getListings({ city, title, author, type, genre, condition, sort }),
    getUserSaveContext(),
  ])
```

to also fetch ratings, keyed off the listings just fetched:

```ts
  const [listings, { isLoggedIn, userId, savedIds }] = await Promise.all([
    getListings({ city, title, author, type, genre, condition, sort }),
    getUserSaveContext(),
  ])
  const sellerRatings = await getSellerRatings(listings)
```

- [ ] **Step 3: Show the seller's username + rating badge on each card**

Add the import:

```ts
import { StarRatingBadge } from '@/components/StarRating'
```

Replace the card body (lines 389-412):

```tsx
                  <div style={{ padding: '12px 14px' }}>
                    <p className="font-black text-[13px] truncate mb-0.5">{l.title}</p>
                    <p className="text-[11px] font-semibold mb-2" style={{ color: '#aaa' }}>{l.author}</p>
                    <div className="flex items-center justify-between">
```

with:

```tsx
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
```

(leave the rest of that `<div className="flex items-center justify-between">...</div>` block unchanged)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`, open `/listings`, and confirm each card shows the seller's username. For a seller with at least one review (create one via Task 8's flow first), confirm the `★ x.x (n)` badge appears and clicking it navigates to `/sellers/{id}/reviews` (built in Task 12 — expect a 404 until then, that's fine to note and move on).

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts app/listings/page.tsx
git commit -m "feat: show seller username and rating badge on Browse cards"
```

---

### Task 11: Seller rating badge on the listing detail page (`app/listings/[id]/page.tsx`)

**Files:**
- Modify: `app/listings/[id]/page.tsx:1-7` (imports), `:32-54` (data fetching), `:253-256` ("Listed by" line)

**Interfaces:**
- Consumes: `averageRating` (Task 2), `StarRatingBadge` (Task 3).

Depends on: Tasks 2, 3.

No unit test — this page has no existing test file. Verified manually (Step 4).

- [ ] **Step 1: Fetch the seller's aggregate rating**

Add the imports:

```ts
import { averageRating } from '@/lib/reviewAverages'
import { StarRatingBadge } from '@/components/StarRating'
```

In the main `try` block (lines 37-51), after `listing = l`, `user = u`, add a rating fetch. The full updated block:

```ts
  let listing: any = null
  let user: any = null
  let myConvoStatus: string | null = null
  let sellerRating: { average: number; count: number } | null = null

  try {
    const supabase = createClient()
    const [{ data: l }, { data: { user: u } }] = await Promise.all([
      supabase.from('listings').select('*, profiles(id, username, city)').eq('id', params.id).single(),
      supabase.auth.getUser(),
    ])
    listing = l
    user = u
    if (u) {
      const { data: c } = await supabase
        .from('conversations').select('exchange_status')
        .eq('listing_id', params.id).eq('buyer_id', u.id).maybeSingle()
      myConvoStatus = c?.exchange_status ?? null
    }
    const sellerId = (l?.profiles as any)?.id ?? l?.user_id
    if (sellerId) {
      const { data: ratingRows } = await supabase.from('reviews').select('rating').eq('seller_id', sellerId)
      sellerRating = averageRating((ratingRows ?? []).map((r: any) => r.rating))
    }
  } catch {
    const mock = MOCK_LISTINGS.find(l => l.id === params.id)
    if (mock) listing = { ...mock, profiles: mock.profiles }
  }
```

- [ ] **Step 2: Show the badge next to "Listed by"**

Replace:

```tsx
            <p className="font-semibold text-[14px]" style={{ color: '#888' }}>
              Listed by <strong style={{ color: '#1a1a1a', fontWeight: 900 }}>{listing.profiles?.username ?? 'a neighbor'}</strong>
            </p>
```

with:

```tsx
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-[14px]" style={{ color: '#888' }}>
                Listed by <strong style={{ color: '#1a1a1a', fontWeight: 900 }}>{listing.profiles?.username ?? 'a neighbor'}</strong>
              </p>
              <StarRatingBadge rating={sellerRating} sellerId={(listing.profiles as any)?.id ?? listing.user_id} />
            </div>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify**

Run: `npm run dev`, open a listing detail page (`/listings/{id}`) for a seller with at least one review, confirm the badge appears next to "Listed by" and links to `/sellers/{id}/reviews`.

- [ ] **Step 5: Commit**

```bash
git add app/listings/[id]/page.tsx
git commit -m "feat: show seller rating badge on the listing detail page"
```

---

### Task 12: Seller reviews page (`app/sellers/[id]/reviews/page.tsx`)

**Files:**
- Create: `app/sellers/[id]/reviews/page.tsx`

**Interfaces:**
- Consumes: `averageRating` (Task 2).

Depends on: Task 2.

No unit test — matches the no-test convention for `page.tsx` server components. Verified manually (Step 2).

- [ ] **Step 1: Implement**

```tsx
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { averageRating } from '@/lib/reviewAverages'

export default async function SellerReviewsPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: seller } = await supabase
    .from('profiles').select('id, username, name').eq('id', params.id).single()
  if (!seller) notFound()

  const { data: reviewRows } = await supabase
    .from('reviews')
    .select('id, rating, text, created_at, reviewer_id')
    .eq('seller_id', params.id)
    .order('created_at', { ascending: false })

  const reviewerIds = [...new Set((reviewRows ?? []).map((r: any) => r.reviewer_id))]
  const { data: reviewerRows } = reviewerIds.length > 0
    ? await supabase.from('profiles').select('id, username, name').in('id', reviewerIds)
    : { data: [] as any[] }
  const reviewerMap: Record<string, string> = {}
  for (const p of reviewerRows ?? []) reviewerMap[p.id] = p.username || p.name || 'Neighbor'

  const summary = averageRating((reviewRows ?? []).map((r: any) => r.rating))

  return (
    <div className="max-w-[600px] mx-auto px-4 py-10">
      <Link href="/listings" className="text-bk-orange font-bold text-[14px] inline-block mb-6 hover:underline">
        ← Back to listings
      </Link>

      <h1 className="font-display text-[28px] mb-1" style={{ color: '#1a1a1a' }}>
        {seller.username || seller.name || 'Neighbor'}'s Reviews
      </h1>
      <p className="font-bold text-[14px] mb-8" style={{ color: '#aaa' }}>
        {summary ? `★ ${summary.average.toFixed(1)} average from ${summary.count} review${summary.count !== 1 ? 's' : ''}` : 'No reviews yet'}
      </p>

      {(reviewRows ?? []).length === 0 ? (
        <div className="text-center py-10 font-bold text-[14px]" style={{ color: '#aaa' }}>No reviews yet.</div>
      ) : (
        <div className="flex flex-col" style={{ gap: 16 }}>
          {(reviewRows ?? []).map((r: any) => (
            <div key={r.id} className="bg-white border-2 border-gray-100 rounded-2xl p-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-black text-[13px]">{reviewerMap[r.reviewer_id] ?? 'Neighbor'}</span>
                <span className="font-semibold text-[11px]" style={{ color: '#ccc' }}>
                  {new Date(r.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
              <div className="mb-2">
                {[1, 2, 3, 4, 5].map(s => (
                  <span key={s} style={{ color: s <= r.rating ? '#f59e0b' : '#e5e7eb', fontSize: 15 }}>★</span>
                ))}
              </div>
              {r.text && <p className="font-semibold text-[13px]" style={{ color: '#555' }}>{r.text}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Manually verify**

Run: `npm run dev`, submit at least one review via the Task 8 flow, then open `/sellers/{seller_id}/reviews` and confirm the reviewer name, stars, text, and date all render, and the average/count line at the top is correct.

- [ ] **Step 3: Commit**

```bash
git add app/sellers
git commit -m "feat: add seller reviews list page"
```

---

### Task 13: Wire the Admin Reviews tab to real data (`app/admin/AdminClient.tsx`)

**Files:**
- Modify: `app/admin/AdminClient.tsx:1-13` (imports, remove `MOCK_REVIEWS`), `:56` (`Review` type), `:428-447` (`ReviewsTab`'s handlers), `:552-583` (state + fetch effects)

**Interfaces:**
- Consumes: `adminUpdateReview`, `adminDeleteReview` (Task 5).

Depends on: Task 5.

No unit test — `AdminClient.tsx` has no existing test file. Verified manually (Step 6).

- [ ] **Step 1: Remove the mock data and add real imports**

Delete the `MOCK_REVIEWS` constant (lines 6-13) entirely.

Add to the imports at the top:

```ts
import { adminUpdateReview, adminDeleteReview } from '@/lib/actions/reviews'
```

- [ ] **Step 2: Replace the `Review` type**

Replace:

```ts
type Review = typeof MOCK_REVIEWS[0]
```

with:

```ts
type Review = {
  id: string
  reviewer: string
  book: string
  rating: number
  text: string
  date: string
  flagged: boolean
}
```

- [ ] **Step 3: Fetch real reviews on mount**

Replace:

```ts
  const [reviews, setReviews] = useState(MOCK_REVIEWS)
```

with:

```ts
  const [reviews, setReviews] = useState<Review[]>([])
```

Add a new `useEffect`, alongside the existing users/location-reports ones (after the `pendingLocationReports` effect, still inside `AdminClient`):

```ts
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('reviews')
      .select('id, rating, text, flagged, created_at, seller_id, reviewer_id, conversation_id')
      .order('created_at', { ascending: false })
      .then(async ({ data }) => {
        if (!data || data.length === 0) return

        const profileIds = [...new Set(data.flatMap(r => [r.seller_id, r.reviewer_id]))]
        const { data: profileRows } = await supabase.from('profiles').select('id, username, name').in('id', profileIds)
        const pm: Record<string, string> = {}
        for (const p of profileRows ?? []) pm[p.id] = (p as any).username || (p as any).name || 'Unknown'

        const convoIds = [...new Set(data.map(r => r.conversation_id))]
        const { data: convoRows } = await supabase.from('conversations').select('id, listing_id').in('id', convoIds)
        const listingIdByConvo: Record<string, string> = {}
        for (const c of convoRows ?? []) listingIdByConvo[c.id] = c.listing_id

        const listingIds = [...new Set(Object.values(listingIdByConvo))]
        const { data: listingRows } = listingIds.length > 0
          ? await supabase.from('listings').select('id, title').in('id', listingIds)
          : { data: [] as any[] }
        const titleByListing: Record<string, string> = {}
        for (const l of listingRows ?? []) titleByListing[l.id] = l.title

        setReviews(data.map(r => ({
          id: r.id,
          reviewer: pm[r.reviewer_id] ?? 'Unknown',
          book: titleByListing[listingIdByConvo[r.conversation_id]] ?? 'Unknown',
          rating: r.rating,
          text: r.text ?? '',
          date: r.created_at ? r.created_at.slice(0, 10) : '',
          flagged: r.flagged,
        })))
      })
  }, [])
```

- [ ] **Step 4: Make the Users tab's review count real**

In the users-fetching `useEffect` (the one selecting from `profiles`), the mapped object currently hardcodes `reviews: 0`. Since that effect and the new reviews effect both run on mount independently, compute the per-seller count separately and merge it in where the Users tab is rendered. Replace:

```tsx
          {tab === 'users'     && <UsersTab users={users} setUsers={setUsers} toggleAdmin={toggleAdmin} />}
```

with:

```tsx
          {tab === 'users'     && (
            <UsersTab
              users={users.map(u => ({ ...u, reviews: reviewCountBySeller[u.id] ?? 0 }))}
              setUsers={setUsers}
              toggleAdmin={toggleAdmin}
            />
          )}
```

For `reviewCountBySeller` to exist, the reviews `useEffect` in Step 3 needs to also store the raw seller_id per review (it already fetches `seller_id` in the initial `select`, it's just not retained in the mapped `Review` shape). Add a second state, `reviewSellerIds`, right next to `reviews`:

```ts
  const [reviewSellerIds, setReviewSellerIds] = useState<string[]>([])
```

In the same `.then(async ({ data }) => { ... })` callback from Step 3, right before the final `setReviews(...)` call, add:

```ts
        setReviewSellerIds(data.map(r => r.seller_id))
```

Then, right before the `return (` in `AdminClient`, alongside the existing `flaggedReviews`/`badge` helpers, add:

```ts
  const reviewCountBySeller = reviewSellerIds.reduce<Record<string, number>>((acc, id) => {
    acc[id] = (acc[id] ?? 0) + 1
    return acc
  }, {})
```

- [ ] **Step 5: Wire the ReviewsTab handlers to the real actions**

In `ReviewsTab`, replace:

```ts
  function saveEdit() {
    if (!editTarget) return
    setReviews(prev => prev.map(r => r.id === editTarget.id ? { ...r, text: editText, flagged: false } : r))
    setEditTarget(null)
  }

  function deleteReview(id: string) {
    setReviews(prev => prev.filter(r => r.id !== id))
  }

  function unflag(id: string) {
    setReviews(prev => prev.map(r => r.id === id ? { ...r, flagged: false } : r))
  }
```

with:

```ts
  async function saveEdit() {
    if (!editTarget) return
    const result = await adminUpdateReview(editTarget.id, editText)
    if (result.ok) {
      setReviews(prev => prev.map(r => r.id === editTarget.id ? { ...r, text: editText, flagged: false } : r))
      setEditTarget(null)
    }
  }

  async function deleteReview(id: string) {
    const result = await adminDeleteReview(id)
    if (result.ok) setReviews(prev => prev.filter(r => r.id !== id))
  }

  async function unflag(id: string) {
    const result = await adminUpdateReview(id, reviews.find(r => r.id === id)?.text ?? '')
    if (result.ok) setReviews(prev => prev.map(r => r.id === id ? { ...r, flagged: false } : r))
  }
```

- [ ] **Step 6: Manually verify**

Run: `npm run dev`, sign in as an admin (re-established earlier), submit at least one review as a buyer (Task 8's flow), then open `/admin` → Reviews tab and confirm:
1. The real review appears (reviewer name, book title, rating, text, date).
2. Editing the text and saving persists (reload the page and re-check).
3. Deleting a review removes it (reload and confirm it's gone).
4. The Users tab's "Reviews" column shows the correct count for the seller who received it.

- [ ] **Step 7: Commit**

```bash
git add app/admin/AdminClient.tsx
git commit -m "feat: wire Admin Reviews tab and Users review count to real data"
```

---

## Self-Review

**Spec coverage:**
- §1 Data model (`'completed'` status, hidden flags, trigger, `reviews` table) → Task 1. ✓ (plus `completed_at`, added during planning — needed for History's "date" display, doesn't contradict the spec.)
- §2 Completion flow (`completeExchange`, `hideExchangeHistory`) → Task 4. ✓
- §3 History UI (filtering, Sold/Bought labeling, per-row delete, rate/rated state) → Tasks 6, 7, 8. ✓
- §4 Rating & review system (submission, display everywhere a seller's name shows, review list page) → Tasks 3, 5, 7, 9, 10, 11, 12. ✓ (display location adjusted from `BookCard.tsx` to `app/listings/page.tsx`'s real inline card — see Global Constraints note.)
- §5 Admin integration (real Reviews tab, real Users review count) → Task 13. ✓
- Out of Scope items — none of them have a task, confirmed. ✓

**Placeholder scan:** no TBD/TODO markers; every step has complete, runnable code.

**Type consistency:** `HistoryExchange` (Task 7) matches the fields Task 6 adds to each `exchanges` row (`sellerRating`, `reviewed`) plus what's already on the raw `conversations` row (`buyer_hidden`, `seller_hidden`, `completed_at`) — cross-checked against Task 8's widened `Exchange` type, which carries the same fields. `submitReview`'s return type (`{ ok: boolean; error?: string }`, Task 5) matches what Task 7's `HistorySection` expects and what Task 6 threads through as a prop. `StarRatingBadge`'s `rating` prop shape (`{ average: number; count: number } | null`, Task 3) matches what `averageRating` (Task 2) returns and what Tasks 7, 9, 10, 11 all pass into it.
