# Exchange Completion, Sold/Bought History, and Seller Ratings

**Date:** 2026-07-13
**Status:** Approved

## Overview

Today, when a seller clicks "📦 Mark Picked Up" or a buyer clicks "📚 I Got It!" on a `confirmed` exchange, `notifyPickedUp` (`app/profile/actions.ts`) only posts a "📚 Book picked up! Thanks so much!" message into the conversation thread. Nothing else happens: `conversations.exchange_status` stays `'confirmed'` forever, the row never leaves the active "Sold"/"Bought" lists in the Exchanges tab, and the listing itself is never marked `sold`.

This feature makes that click actually finish the transaction:

1. The exchange is marked complete and moves out of the active lists into a new **History** section (still inside the Exchanges tab), split into Sold and Bought and labeled accordingly, with a per-user delete option.
2. The listing automatically flips to `sold`.
3. The buyer gets the option (not required) to leave a 1–5 star rating + optional text review of the seller, from that History row. The seller's aggregate rating is shown next to their name anywhere it appears to a buyer, and is clickable through to a full list of that seller's reviews.
4. The Admin panel's existing Reviews tab and Users tab review count — both currently hardcoded mock data — get wired up to the real table.

---

## 1. Data model

Append to `supabase/schema.sql` as a new migration block, following the file's existing "Migration: ..." convention:

```sql
-- ── Migration: exchange completion, history, and seller ratings ──────────────

-- 1. Exchanges can now be marked complete
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_exchange_status_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_exchange_status_check
  CHECK (exchange_status IN ('none', 'requested', 'confirmed', 'completed'));

-- 2. Per-user history hide (the shared conversation row survives; each side can
-- hide their own copy independently without affecting the other party)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS buyer_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS seller_hidden boolean NOT NULL DEFAULT false;

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

The `unique` constraint on `conversation_id` is what makes a rating one-time per exchange — once submitted, `submitReview` will fail (and the UI won't offer the button again, see Section 3).

---

## 2. Completion flow (`app/profile/actions.ts`)

`notifyPickedUp` is renamed `completeExchange` since it now does real work rather than just posting a message:

```ts
export async function completeExchange(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')
  const conversationId = formData.get('conversation_id') as string

  await supabase.from('conversations')
    .update({ exchange_status: 'completed' })
    .eq('id', conversationId)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    body: '📚 Book picked up! Thanks so much!',
  })

  redirect('/profile?tab=exchanges')
}
```

(The listing flip to `sold` happens inside the DB trigger from Section 1 — this action doesn't touch `listings` at all.)

New action, called by the History row's ✕ button:

```ts
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

`role` comes from which column (`ExchangeRow`'s `role` prop) rendered the button, so the action always flips the correct side's flag without needing to look anything up first.

---

## 3. History UI (`app/profile/DashboardClient.tsx`)

- `Exchange` type gains `'completed'` to the `exchange_status` union, plus `buyer_hidden: boolean`, `seller_hidden: boolean`, and (for Bought rows) the seller's aggregate rating: `sellerRating: { average: number; count: number } | null` and whether this exchange already has a review: `reviewed: boolean`.
- The existing active "Sold ($n)" and "Bought" cards filter to `exchange_status !== 'completed'`, same as today otherwise.
- A new **History** card renders below both, listing every exchange with `exchange_status === 'completed'` for this user that isn't hidden on their side (`role === 'seller' ? !ex.seller_hidden : !ex.buyer_hidden`), newest-first:
  - **Sold rows:** thumbnail, title/author, buyer's name, an orange "Sold" tag, completion date, ✕ delete (calls `hideExchangeHistory` with `role=seller`).
  - **Bought rows:** thumbnail, title/author, seller's name with a `<StarRating average count>` badge next to it (clickable → `/sellers/[seller_id]/reviews`), a teal "Bought" tag, completion date, ✕ delete (`role=buyer`), and:
    - if `!reviewed`: a "⭐ Rate Seller" button opening a rating modal (star picker 1–5 + optional textarea, submits via `submitReview`, see Section 4)
    - if `reviewed`: a static "You rated ★★★★★" line instead

`app/profile/page.tsx` needs `buyer_hidden, seller_hidden` added to the conversations `select(...)`, and for each Bought exchange, a lookup into `reviews` (by `conversation_id`, to set `reviewed`) and an aggregate rating query for the seller (`select rating` where `seller_id = X`, averaged in JS) — batched as one `.in('seller_id', [...sellerIds])` query rather than one per row, consistent with how the page already batches listing/profile/message lookups for the exchanges list.

---

## 4. Rating & review system

New shared component `components/StarRating.tsx` with two small exports:
- `<StarRatingBadge average={4.8} count={12} />` — read-only `★ 4.8 (12)`-style badge; renders nothing if `count === 0` (no badge for zero reviews — avoids implying a bad rating when there's simply no data).
- `<StarRatingPicker value={n} onChange={...} />` — interactive 1–5 star buttons, used inside the rating modal.

New action `lib/actions/reviews.ts`:

```ts
'use server'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

export async function submitReview(formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in.' }

  const conversationId = formData.get('conversation_id') as string
  const sellerId = formData.get('seller_id') as string
  const rating = Number(formData.get('rating'))
  const text = (formData.get('text') as string)?.trim() || null

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

export async function adminUpdateReview(id: string, text: string) {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }
  const { error } = await supabase.from('reviews').update({ text, flagged: false }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}

export async function adminDeleteReview(id: string) {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }
  const { error } = await supabase.from('reviews').delete().eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}
```

`submitReview` is called from a client-side rating modal in `DashboardClient.tsx` (needs the structured `{ ok, error }` result to show inline feedback, unlike the other profile actions which just `redirect()`).

**Display locations** (everywhere a seller's name shows to a buyer):
- `components/BookCard.tsx` — currently shows city/condition but no seller name at all; this adds the seller's username + `<StarRatingBadge>`. `BookCard` stays presentational — it takes a new optional `sellerRating` prop rather than fetching anything itself. `app/listings/page.tsx` (Browse) is the one that batch-fetches aggregate ratings for every seller among the visible listings (one grouped query, same batching approach as Section 3) and passes the right one into each `<BookCard>`.
- `app/listings/[id]/page.tsx` — next to the existing "Listed by **{username}**" line.
- `DashboardClient.tsx` Exchanges/History (Section 3) and `MessagesTab.tsx`'s thread header, next to the other party's name when that party is the seller.

**Pre-existing type gap:** `lib/types.ts`'s `Profile` type only declares `{ id, name, city, created_at }` — no `username`, even though `profiles.username` is already queried and rendered at several call sites today (e.g. `app/listings/[id]/page.tsx`'s "Listed by" line), just through loosely-typed (`any`) data rather than the `Profile` type. `BookCard` is strictly typed via `Listing`/`Profile` from `lib/types.ts`, so referencing `listing.profiles?.username` there needs `username` added to `Profile` first.

**Review list page**, new: `app/sellers/[id]/reviews/page.tsx` — server component, fetches all reviews where `seller_id = params.id` (joined separately with `profiles` for reviewer names, matching this codebase's established no-nested-joins convention), renders newest-first: reviewer name, stars, text if present, date. No pagination at this scale.

---

## 5. Admin integration (`app/admin/AdminClient.tsx`)

- `MOCK_REVIEWS`/`useState(MOCK_REVIEWS)` is replaced with a `useEffect` fetch, following the exact pattern the Users tab already uses (`supabase.from(...).select(...).then(({ data }) => setReviews(...))`):
  1. Fetch `reviews` (`id, rating, text, flagged, created_at, seller_id, reviewer_id, conversation_id`).
  2. Batch-fetch the referenced `profiles` (both `seller_id` and `reviewer_id`) for usernames.
  3. Batch-fetch the referenced `conversations` → `listing_id`, then `listings` → `title`, for the "book" column the ReviewsTab UI already displays.
  4. Map into the same shape `ReviewsTab` already consumes (`reviewer`, `book`, `rating`, `text`, `date`, `flagged`), so `ReviewsTab`'s own JSX is untouched.
- `ReviewsTab`'s existing edit/delete/un-flag handlers call `adminUpdateReview`/`adminDeleteReview` (Section 4) instead of the local `setReviews` state mutation they use today (state still updates locally afterward for immediate UI feedback, same as `toggleAdmin` does for the Users tab).
- The Users tab's per-user `reviews: 0` placeholder becomes a real count — computed client-side from the same fetched `reviews` array grouped by `seller_id`, same as `booksPosted`/`booksSold` are already left as placeholders elsewhere in that tab today (this feature only fixes the `reviews` column, per Out of Scope).

**Note:** there is currently no user-facing way to actually set `flagged = true` — nothing in this feature adds a "report this review" button anywhere. The admin moderation UI (edit/un-flag/delete) is fully wired and functional, but until a report flow exists, no review will ever arrive pre-flagged the way the old mock data was. This is called out explicitly rather than silently building unreachable moderation UI.

---

## Out of Scope

- Buyers editing or deleting their own submitted review after the fact (admin-only edit/delete, matching what `ReviewsTab` already supports).
- Seller replies/responses to a review.
- A user-facing "report review" flow that sets `flagged = true` (see the note in Section 5).
- Notifying or cancelling other buyers with open requests on a listing when it auto-flips to `sold` via the new trigger — existing manual "Mark Sold" in My Listings already doesn't do this either, so this stays consistent.
- Rating the book itself — confirmed explicitly this is a seller/user rating only.
- Filling in the Admin Users tab's other still-placeholder columns (`booksPosted`, `booksSold`, `booksBought`, `credits`, `status`, `bio`) — only the `reviews` column is in scope here.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `exchange_status` gains `'completed'`; `conversations` gains `buyer_hidden`/`seller_hidden` + an UPDATE RLS policy; new `complete_exchange_marks_listing_sold` trigger; new `reviews` table + RLS |
| `app/profile/actions.ts` | `notifyPickedUp` → `completeExchange` (sets `exchange_status = 'completed'`); new `hideExchangeHistory` |
| `app/profile/page.tsx` | Selects `buyer_hidden`/`seller_hidden`; batch-fetches per-exchange `reviewed` flag and per-seller aggregate ratings for Bought rows |
| `app/profile/DashboardClient.tsx` | `Exchange` type additions; active Sold/Bought lists filter out completed; new History card (Sold/Bought labeled, per-row delete, rate/rated state); rating modal |
| `app/profile/MessagesTab.tsx` | Thread header shows `<StarRatingBadge>` next to the other party's name when they're the seller |
| `components/StarRating.tsx` | New: `StarRatingBadge` (read-only) and `StarRatingPicker` (interactive) |
| `lib/types.ts` | `Profile` gains a `username` field |
| `components/BookCard.tsx` | Adds seller username + `StarRatingBadge` (via new optional `sellerRating` prop) to the card footer |
| `app/listings/page.tsx` | Batch-fetches aggregate seller ratings for visible listings, passes into each `BookCard` |
| `app/listings/[id]/page.tsx` | Adds `StarRatingBadge` next to "Listed by {username}" |
| `app/sellers/[id]/reviews/page.tsx` | New: full review list for a seller |
| `lib/actions/reviews.ts` | New: `submitReview`, `adminUpdateReview`, `adminDeleteReview` |
| `app/admin/AdminClient.tsx` | `MOCK_REVIEWS` replaced with a real fetch; edit/delete/un-flag call the new admin actions; Users tab `reviews` count becomes real |
