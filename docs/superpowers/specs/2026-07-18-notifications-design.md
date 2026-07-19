# Notifications — Phase 1 (In-App)

**Date:** 2026-07-18
**Status:** Approved

## Overview

Little Book Exchange has no notification system today. Five events already happen with no signal to the affected user beyond stumbling onto them in the Dashboard: a new chat message, a purchase request on your listing, a seller's confirm/deny decision, a book you're waiting for (TBR) becoming available, and a pickup/exchange completion.

This is Phase 1: **in-app only** — badge counts and row highlighting inside the existing Dashboard, no email or SMS. Phase 2 (a separate spec, out of scope here) will add real email/SMS delivery through the same data model, respecting the `profiles.contact_preference` field that already exists but is currently unused for anything but display.

There is no dropdown/feed UI. Notifications surface as:
1. A total-unread badge on the `Dashboard` link in `Nav.tsx`.
2. Per-tab unread badges on the Exchanges, TBR, and Messages tabs in `DashboardClient.tsx`.
3. A highlight on the specific row/item each notification is about.

---

## Data Model

### `notifications` table (new)

```sql
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,  -- recipient
  type text not null check (type in ('message', 'purchase_request', 'purchase_decision', 'tbr_match', 'pickup')),
  entity_id uuid not null,  -- conversations.id for message/purchase_request/purchase_decision/pickup; tbr_entries.id for tbr_match
  title text not null,
  body text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

create policy "Users can view their own notifications" on notifications
  for select using (auth.uid() = user_id);

create policy "Users can mark their own notifications read" on notifications
  for update using (auth.uid() = user_id);

-- No insert policy for authenticated users: rows are written only by the
-- triggers below (which run as the function owner and bypass RLS) or by
-- create_notification() (security definer). A regular client can never
-- forge a notification into someone else's feed.
```

`entity_id` is what lets a tab find "does this specific row have an unread notification" without parsing `link` strings.

### `messages.kind` (new column)

```sql
alter table messages add column kind text not null default 'chat'
  check (kind in ('chat', 'purchase_request', 'confirmation', 'pickup'));
```

Three existing insert call sites gain one field each:
- `requestPurchase` (`app/listings/[id]/page.tsx`): `kind: 'purchase_request'`
- `confirmExchange` (`app/profile/actions.ts`): `kind: 'confirmation'`
- `completeExchange` (`app/profile/actions.ts`): `kind: 'pickup'`

Ordinary chat sends from `MessagesTab.tsx` are untouched — they default to `'chat'`.

### `profiles` — 5 new preference booleans

```sql
alter table profiles
  add column notify_message boolean not null default true,
  add column notify_purchase_request boolean not null default true,
  add column notify_purchase_decision boolean not null default true,
  add column notify_tbr_match boolean not null default true,
  add column notify_pickup boolean not null default true;
```

Matches the existing flat-boolean style already used for `share_address` / `share_pickup`, rather than a separate preferences table or a jsonb blob.

---

## Event → Notification Wiring

### 1. Messages trigger (covers `message`, `purchase_request`, `purchase_decision`-confirmed, `pickup`)

`AFTER INSERT ON messages`, `FOR EACH ROW`:

1. Look up the message's conversation (`buyer_id`, `seller_id`) and determine the *other* participant (not `NEW.sender_id`) — that's the recipient.
2. Map `NEW.kind` → notification `type`: `chat`→`message`, `purchase_request`→`purchase_request`, `confirmation`→`purchase_decision`, `pickup`→`pickup`.
3. Check the recipient's matching `profiles.notify_*` flag; skip the insert if disabled.
4. Insert into `notifications` with `entity_id = NEW.conversation_id`, `title`/`body` derived from the message context (sender name + listing title where available).
5. Wrap the body in a `begin ... exception when others then raise warning ...` block so a notification bug can never roll back the message send itself.

This single trigger is why 4 of the 5 event types need **zero changes** to `MessagesTab.tsx` or the realtime subscription — they're already message inserts.

### 2. Listings trigger (covers `tbr_match`)

`AFTER INSERT OR UPDATE ON listings`, `FOR EACH ROW WHEN (NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active'))`:

1. Reimplements `tbrMatchPattern` (`lib/tbrMatch.ts`) as a plpgsql regex: `(^|\W)` + escaped value + `(\W|$)`, matched with `~*` against title/author/city, plus an exact `state` check — same rule the Profile page already uses via `regexIMatch`.
2. For every `tbr_entries` row that matches and whose `user_id != NEW.user_id`, and whose owner has `notify_tbr_match = true`, insert a notification (`entity_id = tbr_entries.id`).

Firing on **any** transition to `'active'`, not just creation, means this covers a listing reopening via `denyPurchase`'s direct `status` update *or* `cancelPurchase`'s `reopen_listing()` RPC — both paths converge on the same row-level trigger regardless of which code path changed the status. This is exactly the "notify me if it reopens" promise already sitting unbuilt in the TBR UI copy.

### 3. `denyPurchase` — explicit call (covers `purchase_decision`-denied)

The one event with no message insert to hook: `denyPurchase` deletes the conversation row outright rather than posting to it. Add a single call to a small RPC:

```sql
create or replace function create_notification(
  p_user_id uuid, p_type text, p_entity_id uuid, p_title text, p_body text
) returns void as $$
begin
  insert into notifications (user_id, type, entity_id, title, body)
  select p_user_id, p_type, p_entity_id, p_title, p_body
  where exists (
    select 1 from profiles
    where id = p_user_id
    and case p_type
      when 'purchase_decision' then notify_purchase_decision
      else true
    end
  );
exception when others then
  raise warning 'create_notification failed: %', sqlerrm;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function create_notification(uuid, text, uuid, text, text) to authenticated;
```

`denyPurchase` calls this once, before the conversation delete, passing the buyer's id and `entity_id = conversationId`. Wrapped in the same try/catch pattern `requestPurchase` already uses around `reopen_listing`.

---

## Read State & Highlighting

Exchange rows have no per-row expand/collapse today — everything about a row renders inline as soon as its tab is open. So "viewed" is tab-level for Exchanges/TBR, and item-level only for Messages, where selecting a specific conversation is already a real interaction:

| Type | Tab | Clears when |
|---|---|---|
| `message` | Messages | That specific conversation is selected/opened in the thread pane |
| `purchase_decision` | Exchanges | The Exchanges tab is opened (clears all currently-unread `purchase_decision`/`pickup` notifications at once) |
| `pickup` | Exchanges | Same as above |
| `tbr_match` | TBR | The TBR tab is opened (clears all currently-unread `tbr_match` notifications at once) |
| `purchase_request` | Exchanges | **Not** on tab view — only when the seller clicks Confirm or Deny |

For `message`/`purchase_decision`/`pickup`/`tbr_match`, the clear is a direct client-side Supabase update (`update notifications set read = true where entity_id = ... and user_id = auth.uid()`), fired from the same components that already do client-side writes — `DashboardClient.tsx`'s tab-switch handler for Exchanges/TBR, `MessagesTab.tsx`'s conversation-select handler for Messages — rather than a new server action, matching the pattern `MessagesTab.tsx` already uses for sending messages.

`purchase_request` is handled differently on both ends, deliberately:
- `confirmExchange` and `denyPurchase` (server actions in `app/profile/actions.ts`) each mark the request's notification read as part of what they already do (one extra `update ... where entity_id = conversationId and type = 'purchase_request'`).
- The Exchanges tab's row highlight itself is **not** driven by the notification's `read` flag — it's driven directly by `exchange_status === 'requested'` (seller's row only — that's who has the pending action). This is belt-and-suspenders: even if the notification write silently failed, the highlight can't drift out of sync with the actual unresolved state, and a seller can't make a pending request "look handled" by merely glancing at the tab.

**Note:** badge counts are computed once, server-side, when `/profile` loads. Clearing a highlight happens instantly (client-side), but the numeric badge on the Nav bar and tab buttons won't visually decrement until the next navigation or page refresh — there's no global realtime count store in Phase 1. Acceptable given the scope; revisit only if it proves confusing in practice.

## Badge Counts

- Nav `Dashboard` badge: `select count(*) from notifications where user_id = auth.uid() and read = false`.
- Per-tab badges (Exchanges/TBR/Messages): same query grouped by the `type`→tab mapping above. Computed server-side in `app/profile/page.tsx` alongside the existing `exchanges`/`tbrEntries` fetches, passed down as props — no new client-side polling.

## Settings

Five checkboxes added to the existing Profile tab, next to `share_address`/`share_pickup`: "Notify me about — new messages / purchase requests / purchase decisions / TBR matches / pickup confirmations." Saved through the existing `updateProfile` action, which already writes flat boolean columns the same way.

## Demo Mode

`isDemo` sessions (no Supabase env, or `lbe_demo_user` cookie) get zero badges/highlights — no mock notification rows are introduced. `MOCK_CONVERSATIONS` already gives demo users a working Messages tab; badges are a real-data-only feature for Phase 1, same as most other write-driven Dashboard state.

## Error Handling

- Both triggers swallow their own exceptions (`raise warning`, no re-raise) so a notification bug can never block a message send or a listing status change — the primary action always succeeds.
- `create_notification()` does the same for `denyPurchase`'s explicit call.
- No insert policy on `notifications` for `authenticated` — all writes are trigger- or RPC-sourced, so RLS can't be bypassed by a malicious client forging notifications into another user's feed.

## Testing

- The plpgsql regex in the listings trigger is built from the same rule as `tbrMatchPattern` (`lib/tbrMatch.ts`, already covered by `lib/tbrMatch.test.ts`) — any change to one must be mirrored in the other; note this in a comment at both call sites.
- Manual QA via dev server: trigger each of the 5 events as two test accounts, verify badge counts, row highlights, and that toggling a preference off in Settings actually suppresses that type.
- No automated test harness exists in this repo for Postgres triggers/RLS; none is being added here (matches the project's existing testing scope — pure-logic `.test.ts` files only).

## Out of Scope (Phase 1)

- Real email/SMS delivery (Phase 2 — separate spec, reuses this data model and the `contact_preference` field).
- Per-event channel picker — Phase 1 has nothing to deliver externally yet, so channel choice doesn't matter until Phase 2.
- A notification feed/dropdown UI — replaced entirely by badges + row highlighting per this spec.
- Deleting/dismissing notifications independent of "read."
- Toast pop-ups for new notifications while the user is active in the app.
- Rate limiting / de-duplication of repeated TBR-match notifications (e.g., a listing flapping active/pending/active repeatedly would notify the same TBR owner each time) — acceptable for Phase 1 given how rarely that happens today.

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `notifications` table + RLS; `messages.kind` column; 5 `profiles.notify_*` columns; `messages` AFTER INSERT trigger; `listings` AFTER INSERT/UPDATE trigger; `create_notification()` RPC |
| `app/listings/[id]/page.tsx` | `requestPurchase`'s message insert gains `kind: 'purchase_request'` |
| `app/profile/actions.ts` | `confirmExchange`'s message insert gains `kind: 'confirmation'`; `completeExchange`'s gains `kind: 'pickup'`; `confirmExchange` and `denyPurchase` each mark the request's notification read; `denyPurchase` also calls `create_notification()` |
| `app/profile/page.tsx` | Fetch unread counts (total + per-tab) and per-row unread `entity_id` lists; pass down as props |
| `app/layout.tsx` | Fetch total unread count alongside the existing profile lookup; pass to `Nav` |
| `components/Nav.tsx` | `Dashboard` link gets a total-unread badge |
| `app/profile/DashboardClient.tsx` | Exchanges/TBR/Messages tabs get per-tab unread badges; tab-switch handlers for Exchanges/TBR mark their notifications read client-side; rows gain highlight styling driven by unread `entity_id` lists (Exchanges' pending-request highlight driven by `exchange_status` instead) |
| `app/profile/MessagesTab.tsx` | Conversation-select handler marks that conversation's `message` notifications read client-side; list rows gain highlight styling for unread conversations |
| `app/profile/actions.ts` (`updateProfile`) | Accepts and persists the 5 new `notify_*` checkboxes |
| `app/profile/ProfileCard.tsx` | 5 new notification-preference checkboxes, alongside the existing `share_address`/`share_pickup` checkboxes |
