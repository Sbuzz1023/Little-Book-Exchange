# Dual Pickup Confirmation, 48-Hour Auto-Complete, and Disputes

**Date:** 2026-08-14
**Status:** Approved

## Overview

Today, exchange completion is a single, one-sided action: once a seller confirms a purchase request (`exchange_status: 'confirmed'`), only the **seller** has a "📦 Mark Picked Up" button, and clicking it instantly sets `exchange_status: 'completed'` — which fires the existing credit-transfer trigger and marks the listing sold. The buyer has no equivalent action and no say in when the exchange is considered done.

This feature replaces that single-sided click with a two-sided confirmation:

- Both the seller ("Mark Picked Up") and the buyer ("Got It") get their own confirm button once `exchange_status` reaches `'confirmed'`.
- Whoever confirms first, the other party is notified and has **48 hours** to confirm on their end.
- If both confirm within 48 hours, the exchange completes immediately (credit transfers as it already does today).
- If only one confirms and 48 hours pass, the exchange **auto-completes anyway** — credits still transfer, nobody is left in limbo.
- A **Dispute** button sits next to both confirm buttons. Filing a dispute sends a message straight to the admin and **freezes** that exchange (no auto-complete, no credit transfer) until the admin resolves it.
- History gains a visible "⏱️ Auto-completed" tag distinguishing that outcome from a normal both-confirmed completion, plus the same unread-highlight treatment active exchange rows already get.

Nothing about *how* credits move changes — the existing `complete_exchange_marks_listing_sold()` trigger already fires automatically the instant `exchange_status` flips to `'completed'`, regardless of what causes that flip. This feature is entirely about *when and how* that flip is allowed to happen.

---

## Data Model

### `conversations` — 3 new columns

```sql
alter table conversations
  add column if not exists seller_picked_up_at timestamptz,
  add column if not exists buyer_picked_up_at timestamptz,
  add column if not exists completion_type text check (completion_type in ('manual', 'auto_timeout'));
```

`seller_picked_up_at`/`buyer_picked_up_at` are set once, the first time that party confirms — never overwritten. `completion_type` is set only when `resolve_pickup()` (below) actually completes the exchange, recording which path it took. Both stay `null` for exchanges that were completed under the old single-click flow (before this migration) or that end in `'declined'` — the History UI only shows the tag when `completion_type = 'auto_timeout'`.

### `disputes` (new table)

```sql
create table if not exists disputes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  reporter_id uuid references profiles(id) not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table disputes enable row level security;

create policy "Participants and admins can view disputes" on disputes
  for select using (
    exists (select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id))
    or exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
  );

create policy "A participant can file a dispute on their own exchange" on disputes
  for insert with check (
    reporter_id = auth.uid()
    and exists (select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.buyer_id, c.seller_id))
  );

create policy "Admins can resolve disputes" on disputes
  for update using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));

create index if not exists disputes_conversation_idx on disputes (conversation_id);
create index if not exists disputes_open_idx on disputes (status) where status = 'open';
```

One open dispute per conversation is the expected case; nothing technically prevents a second, but the UI only offers the button while no open dispute already exists for that conversation, so this shouldn't happen in practice.

### `resolve_pickup()` — the single source of truth for "is this exchange done yet?"

This is the one place completion logic lives. It's called from three places (a confirm-button click, the cron job, and admin resolving a dispute) so none of them duplicate the eligibility rules.

```sql
create or replace function resolve_pickup(p_conversation_id uuid, p_actor_id uuid default null)
returns text as $$
declare
  v_conv conversations%rowtype;
  v_completion_type text;
  v_book_title text;
begin
  select * into v_conv from conversations where id = p_conversation_id for update;
  if not found or v_conv.exchange_status <> 'confirmed' then
    return 'not_applicable';
  end if;

  if exists (select 1 from disputes where conversation_id = p_conversation_id and status = 'open') then
    return 'blocked_dispute';
  end if;

  if v_conv.buyer_picked_up_at is not null and v_conv.seller_picked_up_at is not null then
    v_completion_type := 'manual';
  elsif v_conv.buyer_picked_up_at is not null or v_conv.seller_picked_up_at is not null then
    if now() < coalesce(v_conv.buyer_picked_up_at, v_conv.seller_picked_up_at) + interval '48 hours' then
      return 'waiting';
    end if;
    v_completion_type := 'auto_timeout';
  else
    return 'waiting';
  end if;

  update conversations
  set exchange_status = 'completed', completed_at = now(), completion_type = v_completion_type
  where id = p_conversation_id;

  select title into v_book_title from listings where id = v_conv.listing_id;

  if v_completion_type = 'manual' and p_actor_id is not null then
    -- A real message from whoever's confirmation just closed this out — the
    -- existing notify_on_message trigger notifies the OTHER party
    -- automatically, same mechanism already used for every other message-
    -- driven notification. No duplicate direct-insert needed here.
    insert into messages (conversation_id, sender_id, body, kind)
    values (p_conversation_id, p_actor_id, '✅ Exchange completed — thanks for confirming pickup!', 'pickup');
  else
    -- Auto-timeout (or a manual completion with no live actor, e.g. an admin
    -- resolving a dispute after both had already confirmed): there's no
    -- single natural "sender," and BOTH parties need to know, so notify both
    -- directly instead of relying on the messages trigger (which only ever
    -- notifies one side). Respects each recipient's own notify_pickup
    -- preference, same as every other direct-insert notification path.
    insert into notifications (user_id, type, entity_id, title, body)
    select id, 'pickup', p_conversation_id, 'Exchange auto-completed',
      '⏱️ ' || coalesce(v_book_title, 'Your exchange') || ' auto-completed after 48 hours.'
    from profiles where id in (v_conv.buyer_id, v_conv.seller_id) and notify_pickup = true;
  end if;

  return 'completed_' || v_completion_type;
exception when others then
  raise warning 'resolve_pickup failed: %', sqlerrm;
  return 'error';
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

grant execute on function resolve_pickup(uuid, uuid) to authenticated, service_role;
```

Return values (`'waiting'`, `'blocked_dispute'`, `'completed_manual'`, `'completed_auto_timeout'`, `'not_applicable'`, `'error'`) let every caller react appropriately without re-deriving the logic themselves — e.g. `markPickedUp` only posts its own "please confirm your side" message when the result is `'waiting'`.

---

## Event Flow

### 1. First confirmation (`markPickedUp` — replaces the old seller-only `completeExchange`)

One server action, usable by either role:

1. Auth check; look up the conversation to determine whether the caller is `buyer_id` or `seller_id`.
2. Set that party's own timestamp column — guarded by `exchange_status = 'confirmed'` and the column currently being `null` (so a double-click can't re-fire anything).
3. If the update actually changed a row, call `resolve_pickup(conversationId, p_actor_id: userId)`.
4. If the result is `'waiting'` (this was the first confirmation, not the second), post the "please confirm your side" message ourselves: *"📦 {name} marked this picked up! Please confirm on your end within 48 hours."* (`kind: 'pickup'`) — the existing `notify_on_message` trigger turns this into a real notification for the other party automatically, respecting their `notify_pickup` preference exactly as today.
5. If the result is `'completed_manual'`, `resolve_pickup` already posted its own closing message and this action does nothing further.

### 2. The 48-hour timeout (cron)

A new route, `app/api/cron/resolve-pickups/route.ts`:

1. Verifies the request carries Vercel's cron secret header (standard pattern — rejects anything else with 401).
2. Queries `conversations` where `exchange_status = 'confirmed'` and at least one of the two timestamps is set.
3. Calls `resolve_pickup(id)` (no `p_actor_id` — nobody's actively acting) for each; ones that aren't actually due yet just come back `'waiting'` and are skipped.

Configured via `vercel.json`'s `crons` array, running once a day — matching what you confirmed is acceptable (48 hours plus up to a day of slack until the next check).

### 3. Dispute

New server action `fileDispute(conversationId, message)`:

1. Auth check; confirm the caller is a participant in the conversation.
2. Insert into `disputes`.
3. Email every admin (`profiles.is_admin = true`) via the existing `sendEmail()` helper — subject like *"Dispute filed: {book title}"*, body includes the message and both parties' names.
4. Return success so the UI can show "We've notified the admin team" and close the popup.

While a dispute is `'open'`, `resolve_pickup` always returns `'blocked_dispute'` and does nothing — no completion, no credit transfer, regardless of timestamps or how much time has passed.

### 4. Admin resolves a dispute

New action `resolveDispute(disputeId)` in the admin actions file:

1. `requireAdmin` check (existing helper).
2. Update that dispute's `status = 'resolved'`, `resolved_at = now()`.
3. Call `resolve_pickup(conversationId)` — if the exchange is otherwise eligible (both confirmed, or the 48-hour window already passed while the dispute sat open), it completes right then; if not, it just goes back to normal waiting and resolves later via a confirm click or the next cron run.

Resolving a dispute deliberately doesn't try to pick a winner or move credits itself — if you need to actually intervene (refund, adjust a balance), that's the existing admin credit-adjustment tool, used separately and manually.

---

## UI Changes

**Exchanges tab, `confirmed`-status rows (both roles):**

- Seller sees "📦 Mark Picked Up" (existing button, now non-instant).
- Buyer sees a new "✅ Got It" button in the same spot the "Ready for Pick Up" info box already occupies.
- Both see "🚩 Dispute" next to their confirm button, opening the same style of popup built earlier this session (message textarea, Submit/Cancel/X-close).
- Once *you've* confirmed but the other party hasn't yet, your own button becomes a disabled "✅ You confirmed — waiting for {name}" state instead of disappearing, with a small note on when it auto-completes ("auto-completes in ~48 hours if they don't respond").
- Once a dispute is open on that exchange, both confirm buttons and the Dispute button are replaced with "⚠️ Dispute pending review" — prevents confusing double-actions while it's frozen.

**History section:**

- The existing Sold/Bought/Declined badge gains a sibling "⏱️ Auto-completed" tag when `completion_type = 'auto_timeout'`.
- Rows tied to an unread `'pickup'`-type notification get the same subtle highlight style the active Exchanges rows already use (`unreadEntityIds.decisionOrPickup`, extended to also apply inside `HistorySection`, not just the active-list `ExchangeRow`).

**Admin panel:**

- New **Disputes** tab, same pattern as the existing Users/Locations/Emails tabs: lists open disputes (book title, both parties' names, their message, filed date) with a Resolve button.

---

## Error Handling

- `resolve_pickup()` wraps its body in `exception when others` (matching every other trigger/RPC in this schema) — a bug here can never leave a conversation stuck mid-transaction or roll back the timestamp update that got it there.
- `markPickedUp`'s own message insert only fires after `resolve_pickup` returns `'waiting'`, so a crash between the two can't double-post.
- The cron route checks the shared secret before doing anything, and iterates conversations independently — one failing `resolve_pickup` call (caught internally, returns `'error'`) doesn't stop the rest from being checked.
- `fileDispute`'s admin email is sent via the existing `sendEmail()` helper, which already handles/logs its own failures — a failed email doesn't block the dispute record itself from being saved (the dispute existing is what actually freezes the exchange; the email is a convenience alert on top).

## Testing

- `resolve_pickup`'s branching logic (manual vs. auto-timeout vs. still-waiting vs. blocked-by-dispute) is SQL, verified manually via the SQL Editor (matching this project's established convention — no automated harness for Postgres functions/triggers).
- `markPickedUp` and `fileDispute` are server actions — no automated test, consistent with every other action in `app/profile/actions.ts` today; verified manually via the dev server with two test accounts.
- Any pure logic extracted for the History tag / highlight rendering gets a normal `.test.tsx` the same way existing `DashboardClient`/`HistorySection` UI logic does.
- End-to-end manual QA (two accounts): confirm as seller only → wait/manually backdate a timestamp in SQL Editor to simulate 48h passing → run the cron route locally → confirm auto-complete, both notified, History tag shows. Separately: confirm as both parties promptly → confirm immediate completion, single notification to the first confirmer only. Separately: file a dispute mid-window → confirm the 48-hour deadline does NOT fire while open → resolve as admin → confirm it completes on the next natural trigger.

## Out of Scope

- A full conversation viewer inside the admin Disputes tab — the dispute message plus both parties' names is enough to know who to reach out to; building a read-only chat viewer for admins is a separate, later ask if it turns out to be needed.
- Admin picking a "winner" or auto-adjusting credits when resolving a dispute — resolving just unblocks the normal flow; manual credit intervention uses the existing, separate admin credit tool.
- Tighter-than-daily timing on the 48-hour window — would need a paid Vercel plan for more frequent cron; explicitly not needed per this project's guidance.
- Any change to the credit-transfer mechanics themselves (`complete_exchange_marks_listing_sold()`) — untouched; this feature only changes what triggers `exchange_status → 'completed'`.

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `conversations` gains 3 columns; new `disputes` table + RLS; `resolve_pickup()` function |
| `app/api/cron/resolve-pickups/route.ts` | New — cron endpoint, secret-protected |
| `vercel.json` | New or modified — registers the daily cron schedule |
| `app/profile/actions.ts` | `completeExchange` replaced by unified `markPickedUp`; new `fileDispute` |
| `lib/actions/admin.ts` | New `resolveDispute` action |
| `app/profile/DashboardClient.tsx` | Seller/buyer confirm buttons, waiting state, Dispute button + popup, dispute-pending state |
| `app/profile/HistorySection.tsx` | Auto-completed tag; unread-highlight support; `completion_type` on `HistoryExchange` type |
| `app/profile/page.tsx` | Pass `unreadEntityIds` through to `HistorySection` |
| `app/admin/AdminClient.tsx` (or a new `DisputesAdminTab.tsx`) | New Disputes tab, matching the existing tab pattern |
