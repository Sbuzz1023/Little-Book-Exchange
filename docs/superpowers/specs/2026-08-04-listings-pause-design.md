# Pause a Listing / My Listings Shows Active Only

**Date:** 2026-08-04
**Status:** Approved

## Overview

Today, the My Listings tab (`app/profile/DashboardClient.tsx`, `activeTab === 'listings'`) shows every listing a user has ever posted, regardless of status — active, pending, sold, and given all appear in the same flat list, each with a status badge and a "Mark Sold" / "Re-list" / "Reset to Active" / "Delete" action row. Meanwhile the Exchanges tab already tracks the seller's in-flight and completed transactions independently (Sold/Bought sections for active exchanges, History for completed/declined ones), so a sold or pending listing effectively shows up in two places today.

This feature does two things:

1. **My Listings narrows to listings the owner can actually still act on** — `active` and a new `paused` status — with `pending`/`sold`/`given` listings removed from this tab entirely (they remain fully visible via Exchanges, unchanged).
2. **Adds a `paused` status**, giving a seller a way to temporarily pull a listing out of Browse without deleting it or going through the sold/given flow, and bring it back later.

---

## 1. Data model

```sql
-- ── Migration: paused listings ────────────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'pending', 'sold', 'given', 'paused'));
-- ──────────────────────────────────────────────────────────────────────────────
```

Same shape as the existing `pending-transaction-lock` migration that added `'pending'`. No other schema changes — `paused` is just a new value for the existing `listings.status` column.

`pending`/`sold`/`given` are mutually exclusive with `paused` in practice (a listing mid-transaction can't be paused), so a single enum value is sufficient; no separate boolean column is needed.

---

## 2. Browse page (`app/listings/page.tsx`)

No code changes. `getListings`'s query already does `.in('status', ['active', 'pending'])` — `'paused'` is simply never added to that list, so paused listings are automatically excluded from Browse results, the same mechanism that already hides `sold`/`given` listings today.

---

## 3. Listing detail page (`app/listings/[id]/page.tsx`)

A non-owner who navigates directly to a paused listing's URL sees the same "No longer available" notice already used for `status === 'sold'` (added in the pending-transaction-lock feature) — reusing that existing copy/branch rather than adding new wording, since from an outsider's perspective a paused listing is equally unavailable.

Concretely, the existing condition:
```tsx
if (listing.status === 'sold') { /* "No longer available" notice */ }
```
becomes:
```tsx
if (listing.status === 'sold' || listing.status === 'paused') { /* "No longer available" notice */ }
```

The owner's own view is unaffected — `isOwner` already bypasses these status-gated notices and shows the normal "Manage Listing" link regardless of status, same as today.

---

## 4. My Listings tab (`app/profile/DashboardClient.tsx`, `activeTab === 'listings'`)

- Split `listings` into two groups: `active = listings.filter(l => l.status === 'active')` and `paused = listings.filter(l => l.status === 'paused')`. Listings with `status` of `pending`, `sold`, or `given` are filtered out of this tab entirely (they're still in the `listings` prop from `page.tsx` — this tab just no longer renders them).
- Header count reflects `active.length + paused.length` posted books (rather than all of `listings.length`), keeping the "+ Post a Book" button as-is.
- **Active section**: same row layout/styling as today (cover thumbnail, title/author/condition, status badge, Edit link). Action row becomes exactly two buttons: **Pause** (`updateListingStatus` with `status=paused`) and **Delete** (`status=delete`, unchanged). The existing "Mark Sold"/"Reset to Active"/"Re-list" buttons are removed from this tab — marking sold now only happens through the Exchanges tab's confirm flow (`confirmExchange`), consistent with the pending-transaction-lock feature's design intent that `listings.status` transitions to `sold` at confirmation time, not through this manual toggle.
- **Paused section**: rendered below Active, in its own card with a heading styled like the Exchanges tab's "📤 Sold (N)" / "📥 Bought (N)" sub-headers — e.g. **"⏸️ Paused (N)"**. Same row layout. Action row: **Resume** (`status=active`) and **Delete**. If `paused.length === 0`, this section is omitted entirely (no empty-state card), keeping the tab uncluttered when nothing's paused.
- Empty state (no active and no paused listings at all) keeps today's "No listings yet. Post your first book!" message.
- `statusStyle`/`statusLabel` gain a `paused` case (e.g. gray/neutral, "Paused") for the status badge shown on each paused row — though since the Paused section itself is already visually distinct via its heading, this badge is mostly redundant there; it's still added for consistency with how every other status renders one, and in case a paused listing's card is ever shown in a context without the section heading.

---

## 5. Server action (`app/profile/actions.ts`)

No changes. `updateListingStatus` already accepts any `status` string from the submitted form and writes it directly (`supabase.from('listings').update({ status }).eq('id', id).eq('user_id', user!.id)`) — Pause and Resume are just new button values (`paused`, `active`) posting to this existing action, the same way Mark Sold/Re-list do today.

---

## 6. Testing

- `app/profile/DashboardClient.test.tsx`: new tests covering —
  - An `active`-status listing renders in the main list with Pause + Delete buttons (no Mark Sold/Re-list).
  - A `paused`-status listing renders in the "⏸️ Paused" section with Resume + Delete buttons.
  - A `pending`/`sold`/`given`-status listing renders in neither section (My Listings tab doesn't show it at all).
  - The Paused section is omitted when there are no paused listings.
- No new tests for `app/listings/page.tsx` or `app/listings/[id]/page.tsx` — consistent with the existing codebase pattern of not unit-testing these server components (verified manually instead, same as the mobile-filters-default fix).

---

## Out of Scope

- Any change to how a listing becomes `sold` — still exclusively through the Exchanges tab's confirm flow (`confirmExchange`), unaffected here. (Note: this feature *does* remove the manual "Mark Sold"/"Re-list"/"Reset to Active" self-service toggle from My Listings, per Section 4 — that's an intentional part of this change, not something left alone. `'given'` is confirmed dead code today — no path in the app ever sets it — so its removal from this toggle has no real-world effect.)
- Editing a listing while `pending` — already out of scope per the pending-transaction-lock feature, unaffected here.
- Any Browse-side indication that a paused listing exists (unlike `pending`, which shows faint/unclickable so interested buyers can still find it) — paused listings are invisible to everyone but the owner, full stop, since pausing is a deliberate "take this off the market for now" action rather than a transaction in progress.
- Bulk pause/resume actions, or a dedicated "Paused" top-level dashboard tab — the in-tab section is sufficient for the expected number of paused listings per user.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `listings.status` check constraint gains `'paused'` |
| `app/listings/[id]/page.tsx` | Non-owner "No longer available" notice now also covers `status === 'paused'`, alongside existing `'sold'` |
| `app/profile/DashboardClient.tsx` | My Listings splits into Active/Paused sections, excludes pending/sold/given; `statusStyle`/`statusLabel` gain a `paused` case; Mark Sold/Re-list/Reset-to-Active buttons removed from this tab in favor of Pause/Resume |
| `app/profile/DashboardClient.test.tsx` | New tests for the Active/Paused split and status filtering |
