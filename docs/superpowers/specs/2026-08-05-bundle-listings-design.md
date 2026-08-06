# Bundle & Series Listings

**Date:** 2026-08-05
**Status:** Approved
**Depends on:** `2026-08-05-credit-ledger-design.md` (adds `listings.book_count` and the credit-transfer trigger this feature relies on to price bundles correctly)

## Overview

Every listing today is exactly one book: one `title`, one `author`, one purchase, one credit. This feature lets a lister post multiple books together as a single listing — a series, a boxed set, a "clearing out my shelf" bundle — priced at 1 credit per book, with the whole bundle bought and handed over as one unit.

The anti-cheat question this started from ("how do we stop a lister inflating the count") is answered structurally rather than with new verification infrastructure: **itemized entries are the defense.** A lister can't inflate a bundle's price without naming specific, visible fake books — the itemized list is public on the listing before anyone buys, and it's the exact checklist the buyer holds up against the physical books before they ever click the button that finalizes the credit transfer (Section 5).

---

## 1. Data model

```sql
-- ── Migration: bundle & series listings ───────────────────────────────────────

ALTER TABLE listings ADD COLUMN IF NOT EXISTS is_bundle boolean NOT NULL DEFAULT false;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS bundle_name text;

-- listings.title/author remain "book 1" — every existing single-book listing
-- and every piece of code that already reads listing.title/listing.author is
-- untouched. This table holds only the *additional* books in a bundle.
create table if not exists listing_books (
  id uuid default gen_random_uuid() primary key,
  listing_id uuid references listings(id) on delete cascade not null,
  title text not null,
  author text not null,
  position integer not null default 0,
  created_at timestamptz default now()
);

alter table listing_books enable row level security;
create policy "Listing books are viewable by everyone" on listing_books for select using (true);
create policy "Owners can manage their listing's books" on listing_books
  for all using (exists (select 1 from listings l where l.id = listing_id and l.user_id = auth.uid()));

-- Keep listings.book_count (added in the credit-ledger migration) in sync
-- automatically, so nothing downstream — pricing, the onboarding "books
-- posted" count, Browse/detail rendering — ever needs to join or count
-- listing_books itself.
create or replace function sync_listing_book_count()
returns trigger as $$
begin
  update listings set book_count = 1 + (select count(*) from listing_books where listing_id = coalesce(new.listing_id, old.listing_id))
  where id = coalesce(new.listing_id, old.listing_id);
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_listing_books_change on listing_books;
create trigger on_listing_books_change
  after insert or update or delete on listing_books
  for each row execute procedure sync_listing_book_count();
-- ──────────────────────────────────────────────────────────────────────────────
```

---

## 2. Post form (`app/post/PostForm.tsx`)

A toggle at the bottom of the "Book Info" section, styled like the existing Format button-chips so it reads as a deliberate, obvious choice rather than a buried checkbox: **"📚 List as a Bundle / Series"**.

Turning it on reveals a new "Bundle Details" section:

- Optional **Series / Bundle Name** field (e.g. "Harry Potter Complete Series") — the bundle's display headline. Left blank, the listing falls back to displaying book 1's title, same as a normal listing today.
- A repeatable **Additional Book** row per extra book — Title + Author inputs, plus an **"✨ Auto-fill from Book 1"** button that copies the *current* value of the main Title/Author fields into that row (client-side state copy, no server round-trip) — a same-author series then only needs the title changed per row.
- **"+ Add Another Book"** appends a new empty row (auto-filled on click, same as above). Each row has a "✕ Remove" button. Capped at 20 additional books (21 total) — a plain usability limit on the form, not an anti-fraud measure.
- A live running total: **"This bundle: N books · N credits"** — recalculated from the current row count on every add/remove, giving the lister direct visibility into exactly what they're about to charge for.

Genre, Format, Condition, Description, and Photos are unchanged — single, shared fields describing the whole bundle, not per-book.

**Form submission:** additional rows are submitted as indexed fields (`book_title_1`, `book_author_1`, `book_title_2`, …) alongside a hidden `book_rows` count reflecting how many rows are present client-side, so the server-side parser knows how far to iterate without guessing from sparse indices.

---

## 3. Listing creation & editing (`app/post/actions.ts`, `lib/parseListingForm.ts`)

`parseListingForm` gains a sibling helper, `parseBundleBooks(formData)`, reading `book_rows` and looping `book_title_{i}`/`book_author_{i}`, trimming and dropping any row where both fields are empty (so an accidentally-added-then-untouched row doesn't create a garbage entry).

- **`createListing`:** after the existing `listings` insert (now also carrying `is_bundle`, `bundle_name`), if `is_bundle` and `parseBundleBooks` returns at least one valid row, bulk-insert them into `listing_books` with the new listing's id and each row's array index as `position`. If `is_bundle` was submitted but zero valid additional rows exist, the listing is saved as a normal single-book listing — the toggle is silently ignored rather than surfacing a validation error for what's really just an empty/unused control.
- **`updateListing`:** replaces the listing's `listing_books` wholesale (delete all existing rows for that `listing_id`, then re-insert from the submitted form) rather than diffing — matches how `updateListing` already overwrites every other field unconditionally on every save, no new pattern introduced.

`listings.book_count` needs no manual handling in either action — the trigger from Section 1 keeps it correct automatically as `listing_books` rows are written.

---

## 4. Buyer-facing display

- **Browse card** (`app/listings/page.tsx`, `components/BookCard.tsx`): the flat `🪙 1 credit` badge becomes `📚 Bundle · {book_count} books · {book_count} credits` when `is_bundle`; the card's title becomes `bundle_name` when set, falling back to `listing.title` (book 1) otherwise — zero display change for the ~100% of listings that aren't bundles.
- **Detail page** (`app/listings/[id]/page.tsx`): fetches `listing_books` for the listing (one extra query, only when `is_bundle`) and renders a **"📚 Books in this Bundle"** section listing book 1 (existing `title`/`author`, unchanged fields) followed by every additional book — this list *is* the buyer's pickup-time verification checklist (Section 5). The purchase button reads "🪙 Purchase Bundle for {book_count} Credits" instead of "🪙 Purchase with 1 Credit".

---

## 5. Anti-cheat — how this actually stops abuse

Layered on mechanisms the app already relies on elsewhere, not new infrastructure:

1. **Itemized entries are the primary defense.** Padding a bundle's price means publicly naming specific fake books before anyone will buy it — much more visible and much more awkward to fabricate convincingly than typing a bigger number into a count field.
2. **Credits only move at the buyer's own "I Got It!" click** (`completeExchange`, per the credit-ledger design's Section 1 trigger) — by that point the buyer is physically holding the books and has the itemized list from Section 4 in hand to check off against them. Nothing forces that confirmation if the count or titles don't match; the buyer can message the seller to sort it out, or simply never click it, leaving the listing `pending` until the seller resolves it or the buyer cancels (existing `cancelPurchase` flow, unchanged).
3. **Public seller reviews** (already built, `2026-07-13-exchange-completion-history-ratings-design.md`) are the accountability backstop for anyone who confirms anyway and gets burned — a 1-star "bundle was short 2 books" review is visible on the seller's profile everywhere their name appears.
4. **Admin** already has full credit-editing (adjust either party's balance to correct a bad trade) and account-suspension tools for repeat offenders — no new admin surface needed for this feature.

---

## Out of Scope

- Automated photo- or vision-based count verification — not feasible without real computer-vision infrastructure, far beyond what this app needs.
- A formal buyer-initiated dispute/refund workflow — no such flow exists anywhere in the app yet (matches the same call-out in the reviews feature); the existing decline-to-confirm + review + admin-adjustment path is the whole safety net.
- Partial/per-book purchase of a bundle — a bundle is bought and handed over as one atomic unit for its full credit cost, same single-`requestPurchase`/single-`conversations`-row structure as today. Splitting a bundle into independently-purchasable books would be a materially different, larger feature.
- Per-book photos or per-book condition — both stay single, shared fields for the whole bundle, per the earlier design decision.
- Editing a bundle's book list while a purchase request is in flight — mirrors the existing "editing a pending listing" out-of-scope call-out from the pending-transaction-lock feature; not new behavior introduced here.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `listings` gains `is_bundle`/`bundle_name`; new `listing_books` table + RLS; trigger keeps `listings.book_count` in sync with `listing_books` |
| `app/post/PostForm.tsx` | New "List as a Bundle / Series" toggle; Bundle Details section (name field, repeatable book rows with auto-fill, running total) |
| `lib/parseListingForm.ts` | New `parseBundleBooks(formData)` helper |
| `app/post/actions.ts` | `createListing` bulk-inserts `listing_books` when applicable; `updateListing` replaces them wholesale on save |
| `app/listings/page.tsx`, `components/BookCard.tsx` | Bundle badge (`N books · N credits`) and `bundle_name` headline fallback |
| `app/listings/[id]/page.tsx` | Fetches and renders the itemized "Books in this Bundle" list; purchase button copy reflects `book_count` |
