# Pending Transaction Lock for Listings

**Date:** 2026-07-17
**Status:** Approved

## Overview

Today, `listings.status` is only `active | sold | given`, and Browse (`app/listings/page.tsx`) only filters out non-`active` listings. Nothing locks a listing when a buyer requests it: each buyer gets their own `conversations` row (unique per `listing_id, buyer_id`), so two different buyers can each independently set their own conversation's `exchange_status` to `'requested'` on the same listing, and Browse never reflects it either way. Worse, `listings.status` doesn't flip to `sold` until the exchange is fully **completed** (pickup confirmed) — not when the seller confirms the request — so even a single buyer's request stays purchasable by everyone else all the way through "seller confirmed, contact info sent."

This feature closes that gap:

1. The first buyer to request a book locks it — `listings.status` becomes `'pending'`.
2. Browse still shows the book (faint, unclickable) so other users know it exists and can add it to their TBR list, but they can no longer request or purchase it.
3. When the seller confirms, the listing leaves Browse entirely (`status` → `'sold'`).
4. When the seller denies (new action) or the buyer cancels, the listing reopens (`status` → `'active'`) — the existing TBR match feature already surfaces this to interested users the next time they open Profile, with no new notification plumbing required.

---

## 1. Data model & locking

```sql
-- ── Migration: pending transaction lock ───────────────────────────────────────
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'pending', 'sold', 'given'));
-- ──────────────────────────────────────────────────────────────────────────────
```

- **Request** (`requestPurchase`, `app/listings/[id]/page.tsx`): before creating/reusing the conversation, atomically attempt the lock:
  ```ts
  const { data: locked, error } = await supabase
    .from('listings')
    .update({ status: 'pending' })
    .eq('id', listing.id)
    .eq('status', 'active')
    .select('id')
  if (!locked || locked.length === 0) {
    redirect(`/listings/${params.id}?purchase_failed=1`)
  }
  ```
  This is a single conditional `UPDATE ... WHERE status = 'active'` — atomic at the database level, so two near-simultaneous requests can't both succeed (whichever commits first wins; the second sees 0 rows affected). Only on success does the existing conversation create/reuse + `exchange_status='requested'` + message-insert logic run, unchanged.
- **Confirm** (`confirmExchange`, `app/profile/actions.ts`): in addition to the existing `exchange_status='confirmed'` update, also sets `listings.status = 'sold'` (scoped `.eq('id', convo.listing_id)`, looked up the same way the function already looks up `listingPickup`). This is the "leaves Browse" moment. `'sold'` is used regardless of free/paid — `'given'` turns out to have no code path that ever sets it today (`complete_exchange_marks_listing_sold` also only ever sets `'sold'`), so this stays consistent with existing behavior rather than introducing new branching.
- **Deny** (new `denyPurchase` action in `app/profile/actions.ts`, mirrors `cancelPurchase`):
  ```ts
  export async function denyPurchase(formData: FormData) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin')
    const conversationId = formData.get('conversation_id') as string

    const { data: convo } = await supabase
      .from('conversations').select('listing_id')
      .eq('id', conversationId).eq('seller_id', user.id).eq('exchange_status', 'requested')
      .maybeSingle()

    await supabase.from('conversations').delete()
      .eq('id', conversationId).eq('seller_id', user.id).eq('exchange_status', 'requested')

    if (convo?.listing_id) {
      await supabase.from('listings').update({ status: 'active' }).eq('id', convo.listing_id).eq('status', 'pending')
    }

    redirect('/profile')
  }
  ```
  Deletes the conversation outright (matching how `cancelPurchase` already behaves for buyer-initiated cancellation) and reverts the listing lock.
- **Cancel** (existing `cancelPurchase`): gains the same listing-reopen step, but only when the deleted conversation's `exchange_status` was `'requested'` — a plain `'none'` messaging thread (from "💬 Message Seller") never locked the listing, so nothing to revert. Needs a pre-delete lookup of `listing_id` + `exchange_status`, then the same `.update({ status: 'active' }).eq('status', 'pending')` guarded revert `denyPurchase` uses above.

---

## 2. Reopening → TBR as the notification path

No new notification system is built. `app/profile/page.tsx` already runs, for every `tbr_entries` row, a whole-word regex match against `listings` filtered to `.eq('status', 'active')`. Once `denyPurchase`/`cancelPurchase` flips a listing back to `'active'`, the very next time an interested user opens Profile, their TBR entry shows the existing "match found" link — identical to how it already surfaces any other newly-active listing. Nothing in this section needs new code beyond the status flip itself.

What's new is a fast path *into* TBR from Browse, since a user browsing a pending book today has no reason to have pre-added it:

- `lib/actions/tbrEntries.ts`'s `addTbrEntry` gains an optional `redirect_to` form field, defaulting to `/profile` (every existing call site — the Profile TBR form — is unaffected since it doesn't set this field):
  ```ts
  const redirectTo = ((formData.get('redirect_to') as string) || '/profile')
  // ...
  redirect(redirectTo)
  ```
- The new Browse quick-add button (Section 3) submits `title`, `author`, and `redirect_to` set to the current `/listings` URL (including its query string), so adding to TBR doesn't lose the user's filters.
- **Known limitation, intentionally not solved here:** neither the existing manual TBR form nor this new quick-add button de-duplicates repeated entries for the same title/author — a user could click "Add to my TBR" multiple times and get multiple rows. This is a pre-existing gap, not introduced by this feature, and out of scope.

---

## 3. Browse rendering (`app/listings/page.tsx`)

- `getListings`'s query changes from `.eq('status', 'active')` to `.in('status', ['active', 'pending'])`. `sold`/`given` remain excluded exactly as today.
- Alongside the existing `getUserSaveContext` (which fetches `savedIds`), also fetch the viewer's own requested listings: `select listing_id from conversations where buyer_id = userId and exchange_status = 'requested'`, into a `myRequestedIds: Set<string>`.
- Per-card rendering:
  - `status === 'active'` → unchanged.
  - `status === 'pending'` and (`l.user_id === userId` or `myRequestedIds.has(l.id)`) → still a normal clickable `<Link>`, with a small "⏳ Pending" badge added (same visual treatment as the existing genre tag) instead of/alongside the price tag.
  - `status === 'pending'` and neither of the above → rendered as a plain `<div>` (no `Link`, so unclickable), the cover image desaturated (`opacity`/`grayscale` filter), the price tag replaced with an "⏳ Pending" badge, and a small inline form: a "+ Add to my TBR" button that posts `title`, `author`, and `redirect_to` to `addTbrEntry`.

---

## 4. Listing detail page (`app/listings/[id]/page.tsx`)

Today, the purchase button's visibility depends only on `myConvoStatus`/search params — it never looks at `listing.status` at all. That means a stale tab or a direct link to a now-pending-or-sold listing still shows "Purchase with 1 Credit" / "Message Seller" to an outsider. This is the actual backstop against the double-purchase bug (the atomic `UPDATE ... WHERE status='active'` in Section 1 is what ultimately prevents the double purchase even if this UI gap weren't closed, but the copy should make the state clear rather than let someone hit `purchase_failed` after the fact):

- If `listing.status !== 'active'` and the viewer is neither the owner nor the requester (`myConvoStatus !== 'requested'`), hide the Purchase and Message-Seller buttons. In their place:
  - if `listing.status === 'pending'`: an "⏳ This book is currently pending with another buyer" notice + the same "+ Add to my TBR" mini-form from Section 3.
  - if `listing.status === 'sold'`: a plain "No longer available" notice — no TBR prompt, since it's genuinely gone rather than reopening. There's no prior pattern for this in the app to match (this state was previously unreachable in the UI), so this is new copy.
- Owner and requester views are unchanged (owner still sees "Manage Listing"; the requester still sees the existing "⏳ Pending — waiting for {seller} to confirm" block).

---

## 5. Seller-side guard (`app/profile/DashboardClient.tsx`, My Listings tab)

The manual "Mark Sold" / "Re-list" toggle (`updateListingStatus`, independent of the request/confirm flow) currently shows one of those two buttons for every listing based on `status === 'active'`. Since `'pending'` is now a value that toggle's `statusStyle`/`statusLabel` will render, both buttons are hidden while `status === 'pending'` — a seller shouldn't be able to silently rip a listing out from under an in-flight request through that separate control. They confirm or deny through the Exchanges tab instead, which already has the requested-row UI (Section 6 adds the Deny button there).

`statusStyle`/`statusLabel` (`app/profile/DashboardClient.tsx`) each get a `pending` case (e.g. amber, "Pending").

---

## 6. Exchanges tab — Deny button (`app/profile/DashboardClient.tsx`)

Next to the existing seller "✅ Confirm — Send My Contact Info" button (shown when `role === 'seller' && status === 'requested'`), add a "✕ Deny" button, styled like the existing buyer "✕ Cancel Request" button, submitting to the new `denyPurchase` action with the same confirm-dialog pattern (`onSubmit={e => { if (!confirm('Deny this purchase request?')) e.preventDefault() }}`).

---

## Out of Scope

- Editing a pending listing's price/title/photos via the edit page while a request is in flight.
- De-duplicating repeated TBR entries (manual form or new quick-add) — pre-existing gap, not introduced here.
- Any new notification infrastructure (toast, badge, email) — reopening surfaces exclusively through the existing TBR match-on-Profile-visit behavior.
- Queueing a second buyer's interest so they're auto-notified/promoted if the first request is denied, beyond what the existing TBR match already provides.
- Changing what happens at final pickup completion (`completeExchange`) — it already sets `exchange_status = 'completed'`; this feature only moves the `listings.status = 'sold'` flip earlier, to confirmation time, via `confirmExchange` directly rather than the existing DB trigger.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `listings.status` check constraint gains `'pending'` |
| `app/listings/[id]/page.tsx` | `requestPurchase` does the atomic lock; purchase/message buttons hidden for non-owner/non-requester when `status !== 'active'`, replaced with a pending/sold notice (+ TBR quick-add when pending) |
| `app/listings/page.tsx` | Query includes `pending`; fetches viewer's `myRequestedIds`; pending cards render faint/unclickable (or normal+badged for owner/requester) with a TBR quick-add form |
| `app/profile/actions.ts` | `confirmExchange` also sets `listings.status = 'sold'`; new `denyPurchase`; `cancelPurchase` reverts `listings.status` to `'active'` when it was locked |
| `lib/actions/tbrEntries.ts` | `addTbrEntry` gains optional `redirect_to` field |
| `app/profile/DashboardClient.tsx` | `statusStyle`/`statusLabel` gain a `pending` case; Mark Sold/Re-list hidden while `pending`; new Deny button next to Confirm |

