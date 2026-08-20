# Dispute History & Clickable User Card

**Date:** 2026-08-20
**Status:** Approved

## Overview

Today, `disputes` (added by the not-yet-deployed dual-pickup-confirmation feature) has no admin history view — the only place a dispute is visible is `DisputesAdminTab`'s open-only triage list, with just Resolve + Message. There's no way to see a given user's dispute track record, no tally of how often they've filed or been the subject of one, and no way to walk back a dispute that shouldn't have counted (filed in error, resolved by mistake, or genuinely didn't warrant action).

Separately, the admin Users table only opens a user's full info ("Edit User" modal) via a small "Edit ✏️" link in the last column.

This feature adds:

1. **Three actions on every dispute**: **Resolve** (status → `resolved`), **Unresolved** (status → `open`, a reopen capability that doesn't exist today), and **Delete** (permanent removal — for a dispute that never warranted a real record).
2. **A dispute history section inside each user's card** — every dispute this user filed or was the subject of, each labeled "Filed by this user" / "Filed against this user", with the same 3 actions available inline.
3. **A dispute tally** — `N filed · M against` — shown both as a new column in the Users table and inside the user's card.
4. **The whole Users table row becomes the click target** for opening the user's card, replacing the "Edit ✏️" link.
5. **`DisputesAdminTab` gains an All/Open/Resolved filter** and the same Unresolved + Delete actions, so it stops being open-only.

## Data Model

### `disputes` — one new RLS policy, no column changes

"Filed against" is derived, not stored: a dispute's `conversation_id` already links to `conversations.buyer_id`/`seller_id`, so the non-reporter participant is always computable. No new column, no migration/backfill risk — and moot in practice, since the migration that creates `disputes` (2026-08-14, dual pickup confirmation) still hasn't been run in production.

```sql
-- Admins can permanently delete a dispute (e.g. filed in error / doesn't
-- warrant a record). No delete policy exists today. Same admin-only shape as
-- the existing "Admins can resolve disputes" update policy.
create policy "Admins can delete disputes" on disputes
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));
```

No change to the existing "Admins can resolve disputes" update policy — it already permits setting `status` to either `'open'` or `'resolved'`, so reopening a dispute needs no new policy.

## Server Actions (`lib/actions/admin.ts`)

### `adminSetDisputeStatus(disputeId, status: 'open' | 'resolved')`

Replaces the current narrower `resolveDispute`. `requireAdmin`, then:

- Updates `status`, stamping `resolved_at = now()` when moving to `'resolved'`, clearing it back to `null` when moving to `'open'`.
- Only when resolving (not reopening), best-effort calls `resolve_pickup(conversation_id)` afterward — same pattern the current `resolveDispute` uses, so an otherwise-eligible exchange can complete immediately once its blocking dispute clears.
- Reopening deliberately does **not** touch the underlying exchange — `resolve_pickup()` already checks live for any `status = 'open'` dispute on the conversation, so re-blocking is automatic with no extra code.

### `adminDeleteDispute(disputeId)`

`requireAdmin`, reads the dispute's `conversation_id` and `status` first, then deletes the row. If the deleted dispute was `'open'`, best-effort calls `resolve_pickup(conversation_id)` afterward (deleting a frivolous open dispute can unblock a stuck exchange, same reasoning as resolving one).

Both actions return `{ ok: boolean; error?: string }`, matching every other action in this file — callers show the error inline rather than failing silently (this file's own `adminUpdateUserCredits` already sets that precedent).

## Components

### New: `app/admin/DisputeRow.tsx` (shared)

One dispute's rendered card: book title, "Filed by {reporter} against {other party}" (or the user-card's contextual "Filed by this user" / "Filed against this user" variant — see below), message, filed date, a status badge, and the 3 action buttons:

- **✓ Resolve** — shown when `status === 'open'`
- **↺ Unresolved** — shown when `status === 'resolved'`
- **🗑️ Delete** — always shown, gated behind `window.confirm('Permanently delete this dispute? This cannot be undone.')` since it's irreversible

Props: the enriched dispute object, a `context: 'admin-tab' | 'user-card'` flag (controls the label text), and an `onChanged` callback the parent uses to refetch/update local state after any action. Used by both `DisputesAdminTab` and the new user-card section so the button logic and styling live in one place.

### `app/admin/AdminClient.tsx` — centralized dispute fetch

A new `useEffect` (alongside the existing `profiles` fetch) loads **all** `disputes` rows (no status filter), the `conversations` they reference (`id, listing_id, buyer_id, seller_id`), the `listings` (for book titles), and the `profiles` (for names) needed to resolve everything — the same shape `DisputesAdminTab.load()` already builds, just centralized and unfiltered by status.

From that, derive:
- `enrichedDisputes: EnrichedDispute[]` — `{ id, message, status, created_at, resolved_at, conversationId, reporterId, reporterName, otherPartyId, otherPartyName, bookTitle }`
- `disputeTally: Record<userId, { filed: number; against: number }>` — built by walking `enrichedDisputes` once

Both are passed down to `UsersTab` (table column + card) and `DisputesAdminTab` (list), replacing `DisputesAdminTab`'s own independent fetch.

### `UsersTab` — row click + tally column + card disputes section

- New "Disputes" column in the table: renders `disputeTally[u.id]` as `"{filed} filed · {against} against"`, or `—` if both are 0.
- The row itself (`<tr>`) gets the click handler that calls `openEdit(u)`; the "Edit ✏️" `<td>`/link is removed.
- Inside the existing modal, a new "🚩 Disputes" section is appended after the stats grid: the tally repeated as a header, then each of this user's disputes (filed by or against them, filtered from `enrichedDisputes`) rendered via `DisputeRow` with `context="user-card"`. Empty state: "No disputes."
- Dispute actions inside the card take effect immediately via the server actions above (not part of the modal's own Save/Cancel local-state flow) and call the parent's refetch on success so the table's tally column and the card update together.

### `DisputesAdminTab` — filter + upgraded actions

- Gains an All/Open/Resolved filter, same visual pattern as `ReviewsTab`'s All/Flagged toggle, defaulting to **Open** so day-to-day triage is unchanged.
- Drops its own `load()`/local fetch; receives `enrichedDisputes` as a prop instead.
- Each row renders via `DisputeRow` with `context="admin-tab"` (existing "Buyer: X · Seller: Y" framing), plus the existing "💬 Message" button stays as-is alongside it.

## Error Handling & Edge Cases

- Every dispute action shows an inline error on failure rather than silently no-op'ing — this project has hit exactly this bug 3 times before in admin-panel code (swallowed `.select()...maybeSingle()` errors, a false-success broadcast send); `DisputeRow` surfaces `result.error` next to the failed button instead of assuming success.
- Delete is guarded twice: a `window.confirm` in the UI, and the new admin-only RLS policy at the database level (defense in depth — the button is admin-gated in the UI, but the DB enforces it independently).
- If a dispute's conversation, listing, or profile can't be resolved (orphaned data), fall back to "Unknown" — same convention `DisputesAdminTab` already uses today.
- Reopening a resolved dispute automatically re-blocks that exchange's completion (live check in `resolve_pickup()`, not a cached flag) — worth remembering as a real behavior change on the exchange side, not just an admin-panel cosmetic toggle.

## Testing Plan

- `adminSetDisputeStatus`: admin gate, both status directions, `resolved_at` set/cleared correctly, `resolve_pickup` called only when resolving (not reopening).
- `adminDeleteDispute`: admin gate, row actually removed, `resolve_pickup` called only when the deleted dispute was open.
- Tally derivation: given a fixed set of disputes/conversations, filed vs. against counts come out right, including a user who appears on both sides across different disputes.
- `DisputeRow`: each of the 3 buttons calls the right action with the right args; delete respects the confirm gate; error from a failed action renders inline.
- Users table: row click opens the card (Edit link is gone), tally column renders correctly including the `—` empty case.
- `DisputesAdminTab`: All/Open/Resolved filter shows the right subset.

**Known gap, flagged up front:** matching this project's recurring pattern for admin-panel features, this won't get a live click-through with a real admin account as part of this work (requires a real Supabase admin + a second test account, same gap noted for every `/admin` feature so far). Automated tests + `tsc` clean is the bar for "done" here; a live walkthrough is a separate ask.

## Rejected Alternatives

- **Explicit `respondent_id` column on `disputes`**, set at file-time. Rejected: redundant with data already derivable from `conversations`, and would need a migration + (hypothetically) a backfill, for zero query-time benefit at this app's scale.
- **Soft "dismissed" status instead of real delete.** Rejected per explicit instruction — delete must be a real, permanent removal, distinct from (and in addition to) the Resolved/Unresolved status toggle.
