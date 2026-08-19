# Admin Messaging (Email / Message) and Support Contact

**Date:** 2026-08-19
**Status:** Approved

## Overview

Today, the admin panel can only *email* users (`EmailsAdminTab` → Compose/Templates/Resend), and the in-app messenger (`conversations`/`messages`) only exists between a listing's buyer and seller — there's no way for an admin to message a user in-app, and no way for a user to reach admin at all except filing a dispute on a specific exchange.

This feature adds:

1. **Admin → user messaging**, living alongside email in a renamed **"Email / Message"** admin tab. Admin picks a target the same way email already does (all users / one user / filtered by city+state), picks Email or Message, and — for messages only — chooses whether the send is a one-shot announcement or opens a real, repliable conversation.
2. **An admin Inbox** to view and reply to those conversations later.
3. **A "Message" button on each open dispute** that jumps straight to Email/Message with the reporter pre-selected and replies pre-enabled.
4. **A "Contact Support" entry point** on the Profile page, opening the user's own support conversation in their existing Messages tab, with the support email shown alongside as a plain fallback.

Admin messages appear in the user's existing Messages tab, merged in with their book-exchange conversations — not a separate inbox. This is achieved by extending the existing `conversations`/`messages` tables rather than building a parallel messaging system (see [Rejected Alternatives](#rejected-alternatives)).

---

## Data Model

### `conversations` — relax + 3 new columns

```sql
alter table conversations alter column listing_id drop not null;
alter table conversations alter column buyer_id drop not null;
alter table conversations alter column seller_id drop not null;

alter table conversations
  add column if not exists type text not null default 'exchange' check (type in ('exchange', 'admin')),
  add column if not exists user_id uuid references profiles(id) on delete cascade,
  add column if not exists repliable boolean not null default true;

-- type='exchange' rows are unaffected: listing_id/buyer_id/seller_id are still
-- always populated by every existing code path, just no longer DB-enforced.
-- type='admin' rows leave listing_id/buyer_id/seller_id null and use user_id
-- instead — the one non-admin participant. "Which admin" is deliberately not
-- tracked on the conversation; any admin may read/reply (see RLS below),
-- matching how the Disputes tab already works (any admin resolves any dispute).
```

The existing `unique(listing_id, buyer_id)` constraint is untouched — Postgres treats `NULL` as distinct from `NULL` in unique constraints, so any number of `type='admin'` rows (both columns always `NULL`) can coexist without colliding.

**Broadcast/selected-user sends fan out into one `conversations` row per recipient** — even for "all users" — matching the "individual 1:1 threads" decision. This keeps every downstream piece (RLS, `notify_on_message`, the realtime subscription, `MessagesTab` rendering) working unmodified per-recipient instead of inventing a group-thread concept. At this app's scale (low hundreds of users) the row count is a non-issue.

### `conversations` RLS — new policies for `type='admin'`

```sql
create policy "Admin conversation visible to its user or any admin" on conversations
  for select using (
    type = 'exchange'
    or (type = 'admin' and (user_id = auth.uid() or exists (
      select 1 from profiles p where p.id = auth.uid() and p.is_admin = true
    )))
  );
```

This is an additional `for select` policy alongside the existing "Participants can view conversations" one — Postgres RLS `OR`s multiple permissive policies together, so exchange-type visibility is unchanged.

```sql
create policy "Admins or a user can start an admin conversation" on conversations
  for insert with check (
    type = 'admin' and (
      exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
      or user_id = auth.uid()
    )
  );
```

A user creating their own support conversation must set `user_id = auth.uid()` themselves — enforced above. The existing "Buyers can create conversations" policy is untouched and still governs `type='exchange'` inserts.

### `messages` RLS — new policy for `type='admin'` conversations

```sql
create policy "Admin conversation messages: admin always, user if repliable" on messages
  for insert with check (
    exists (
      select 1 from conversations c
      where c.id = conversation_id and c.type = 'admin'
      and (
        exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true)
        or (c.repliable = true and c.user_id = auth.uid())
      )
    )
  );

create policy "Admin conversation messages viewable by participant or admin" on messages
  for select using (
    exists (
      select 1 from conversations c
      where c.id = conversation_id and c.type = 'admin'
      and (c.user_id = auth.uid() or exists (
        select 1 from profiles p where p.id = auth.uid() and p.is_admin = true
      ))
    )
  );
```

Additional permissive policies alongside the existing exchange-only ones — same OR-combination behavior as above. A user can never insert into a `repliable = false` admin conversation, at the database level, regardless of what the client UI does.

### `notify_on_message()` — extend recipient logic

```sql
v_recipient := case
  when v_conv.type = 'admin' then (case when new.sender_id = v_conv.user_id then null else v_conv.user_id end)
  when new.sender_id = v_conv.buyer_id then v_conv.seller_id
  else v_conv.buyer_id
end;

if v_recipient is null then
  return new;
end if;
```

(Inserted before the existing `select ... into v_pref` lookup, which already tolerates nothing further changing.) When an admin sends into a `type='admin'` conversation, the user gets a normal `'message'` notification exactly like today. When the *user* sends (an initial support request, or a reply), no notification is generated — admins are expected to check the new Inbox sub-tab rather than get a notification per user reply. This mirrors the existing Disputes tab, which also has no notification-driven admin alert today.

---

## Admin Panel

### Tab rename + mode toggle

`AdminClient.tsx`'s tab label changes from **"Emails"** to **"Email / Message"** (tab id can stay `emails` — only the label shown changes). `EmailComposeTab.tsx` gains a mode toggle at the top:

```
[ Email ]  [ Message ]
```

Both modes reuse the exact same targeting UI already there (All Users / One User / Filtered Group) and the same `BroadcastTarget` type/resolution (`resolveBroadcastRecipients`) — no new targeting code. What "selected users" from the original ask maps to: the existing **Filtered Group** (by city/state) plus repeated **One User** sends; there is no new arbitrary multi-checkbox picker, per the "use the same functions as email" direction.

When **Message** is selected:
- Subject field hides (messages have no subject).
- A new checkbox appears: **"Allow replies (start a conversation)"** — unchecked by default (one-shot announcement).
- The confirm dialog's copy changes from "email N people" to "message N people," and — when replies are allowed — notes "N separate conversations will be started."
- Send calls a new action, `sendBroadcastMessage(target, body, repliable)`, instead of `sendBroadcastEmail`.

`lib/actions/emailAdmin.ts` gains:

```ts
export async function sendBroadcastMessage(
  target: BroadcastTarget, body: string, repliable: boolean
): Promise<{ ok: boolean; sent: number; failed: number; error?: string }>
```

Mirrors `sendBroadcastEmail`'s shape and error handling (same `requireAdmin` check, same "recipient-lookup failure must not report false success" fix from the email-foundation work), but for each recipient: find-or-create their `type='admin', user_id=recipient.id, repliable` conversation, then insert one `messages` row (`sender_id = admin.userId`, `kind: 'chat'`). "Find" reuses an existing open conversation for that user only when one already exists with the *same* `repliable` value the admin selected this time — a new one-shot announcement shouldn't silently land in an old repliable thread or vice versa; if none matches, a new conversation is created. No `email_log`-style audit table for messages — `messages`/`conversations` rows already are the record.

### New "Inbox" sub-tab

`EmailsAdminTab.tsx`'s `SubTab` type gains `'inbox'` (4th button: Compose / Templates / Resend / Inbox). The new `AdminInboxTab.tsx` component:

- Queries `conversations` where `type = 'admin'`, ordered by most recent message, joined with the `profiles` row for `user_id` (to show the user's name) and `messages`.
- Renders with the **same list + thread visual structure as `MessagesTab`** (conversation list on the left, thread on the right) — extracting no shared component for this first pass; a small, admin-flavored copy is acceptable here since the audiences (admin vs. end-user) and available actions differ enough that forcing a shared component would need its own prop-driven branching. If a third consumer of this pattern shows up later, that's the trigger to extract one.
- Reply box is enabled unconditionally (admin can always send into any `type='admin'` conversation, per the RLS above) — even a `repliable = false` thread can receive a *further* admin message; it just still can't receive a user reply. Sending a follow-up on a `repliable=false` thread does not flip it to repliable.
- No unread-count badge on the Inbox sub-tab itself in this pass (out of scope, see below) — admins are expected to check it periodically, same as Disputes today.

### Disputes tab — "Message" button

`DisputesAdminTab.tsx`'s existing dispute card gains a "💬 Message" button next to "✓ Resolve". Clicking it navigates to the Email/Message tab (`AdminClient.tsx` already owns the `tab` state — the button calls a callback passed down, same shape as `LocationsAdminTab`'s `onPendingCountChange`) with:

- `subTab = 'compose'`
- mode = Message
- target = One User, pre-filled to `dispute.reporter_id` (already fetched by `DisputesAdminTab`'s existing `load()`)
- "Allow replies" pre-checked

Admin can still change any of these before sending — this only pre-fills, it doesn't lock the form.

---

## User-Facing Messages Tab

### Type updates

`MessagesTab.tsx`'s `MessagesTabExchange` type:

```ts
export type MessagesTabExchange = {
  id: string
  type?: 'exchange' | 'admin'   // defaults to 'exchange' for backward compat with existing callers
  listing_id?: string | null
  buyer_id?: string | null
  seller_id?: string | null
  repliable?: boolean
  created_at: string
  listings?: { title: string; author: string; photo_url?: string | null } | null
  buyer?: { username?: string | null; name?: string | null }
  seller?: { username?: string | null; name?: string | null }
  sellerRating?: { average: number; count: number } | null
  messages: MessageRow[]
}
```

`otherNameFor()` and the list/thread header rendering: when `convo.type === 'admin'`, short-circuit to a fixed identity — **"📣 Little Book Exchange Team"** — instead of resolving `buyer`/`seller`. This applies whether the thread started as an admin broadcast/single-send or as a user-initiated support request; both are the same `type='admin'` shape and read identically from the user's side (there is no "Support" vs. "Team" distinction — one consistent identity, matching the "who replies" ambiguity already accepted for the Inbox).

The listing line (`📚 {ex.listings?.title}` / the "View →" link) is skipped entirely for `type === 'admin'` rows — there's no listing to show.

### Disabled input for non-repliable threads

In the thread view, where the message `<form>` currently always renders, guard it:

```tsx
{convo.type === 'admin' && convo.repliable === false ? (
  <div style={{ /* same padding/border as the form it replaces */ }}>
    🔒 Announcement — replies aren't enabled
  </div>
) : (
  <form onSubmit={send}>...</form>
)}
```

### `app/profile/page.tsx` — fetch admin conversations too

Alongside the existing two queries (`buyer_id = user.id`, `seller_id = user.id`), add a third:

```ts
supabase.from('conversations').select('*').eq('type', 'admin').eq('user_id', user.id).order('created_at', { ascending: false })
```

Merge all three result sets before building the `MessagesTabExchange[]` array (no dedup needed — `type='admin'` rows can never also match a buyer/seller query, since their `buyer_id`/`seller_id` are `null`). For `type='admin'` rows, the per-row shape building skips the `listings`/`buyer`/`seller` lookups entirely (there's nothing to join) and carries `repliable` straight through.

---

## Contact Support (Profile page)

New section in `ProfileCard.tsx`, following the existing section pattern (see the "Notifications" section for the visual template):

```
🛟 Support
[ Message Support ]     support@littlebookexchange.com
```

- **"Message Support"** button: calls a new server action, `startSupportConversation()` (in `app/profile/actions.ts`), which finds the caller's existing `type='admin', user_id=auth.uid()` conversation with the *smallest* `repliable=true` footprint (i.e., prefers reusing an existing repliable thread over creating a new one — a user shouldn't accumulate a new support thread every time they click the button) or creates one (`repliable: true`, no initial message — an empty thread the user then types into, same empty-state UX `MessagesTab` already renders for "No messages yet. Say hello!"). Then redirects to `/profile?tab=messages&conversation={id}` (the Messages tab already supports a `selectedId`-driven deep link pattern via `onSelectId`/URL — reuses it, doesn't reinvent it).
- **Email fallback**: a plain `mailto:support@littlebookexchange.com` link next to the button — no new form, no new send path. (The actual support inbox address is an env-var/config decision at deploy time, matching how `EMAIL_FROM_ADDRESS` already works — not hardcoded in the component.)

---

## Rejected Alternatives

- **Parallel `admin_conversations`/`admin_messages` tables.** Keeps exchange-conversation RLS/triggers untouched, but doubles the realtime-subscription and notification plumbing, and forces `MessagesTab` to merge two differently-shaped data sources into one list. More total code for no behavioral gain.
- **A separate lightweight `announcements` table for one-shot sends only**, skipping `conversations`/`messages` for those. Would reduce row count on a large broadcast, but the approved UX for a one-shot message is a real thread bubble with input disabled — structurally a conversation either way — so this would still need `MessagesTab` to understand two shapes for what renders identically. Not worth it at this app's user scale.

## Error Handling

- `sendBroadcastMessage` mirrors `sendBroadcastEmail`'s established fix: a recipient-lookup failure returns `ok: false` with the real error, never a false `{ sent: 0, failed: 0 }` success that would wipe the admin's draft.
- Per-recipient conversation-create/message-insert failures inside the broadcast loop are caught per-recipient (matching `sendBroadcastEmail`'s per-recipient try shape) and counted into `failed` rather than aborting the whole batch.
- The `messages` RLS insert policy is the real enforcement boundary for "no replies on a non-repliable thread" — the disabled input in `MessagesTab` is a UX courtesy, not the actual guard, so a crafted request still can't insert.

## Testing

- `sendBroadcastMessage`: unit tests mirroring the existing `EmailComposeTab`/broadcast test shape — recipient resolution reused verbatim (already tested), plus new coverage for repliable-vs-not conversation creation and the find-or-create/no-cross-contamination-between-repliable-states rule.
- `MessagesTab.test.tsx`: new cases for `type === 'admin'` rendering — fixed "Little Book Exchange Team" identity, no listing line, disabled-input state when `repliable === false`.
- `AdminInboxTab.tsx`: no automated test in this first pass, consistent with `DisputesAdminTab`'s precedent (no test file today) — verified manually via the dev server.
- Migration smoke check: after applying the SQL, confirm an existing exchange conversation still loads/sends normally (relaxing `NOT NULL` and adding new columns must not change any `type='exchange'` behavior) — same "don't break what's live" bar as the dual-pickup-confirmation migration.
- End-to-end manual QA: admin sends a one-shot broadcast to "All Users" → confirm every recipient sees a disabled-input announcement bubble; admin sends a repliable message to one user → user replies → reply shows up in the admin Inbox; a user clicks "Message Support" → sends a message → admin sees and replies from Inbox; a dispute's "Message" button → recipient and reply-enabled are pre-filled correctly.

## Out of Scope

- An unread-count badge on the admin Inbox sub-tab (or its own admin-panel-wide badge) — admins check it manually for now, matching the existing Disputes tab's no-notification precedent.
- A true arbitrary multi-user checkbox picker ("selected users" beyond one user or a city/state filter) — deferred; Filtered Group covers the realistic cases today.
- Any change to `resolve_pickup()`, disputes resolution, or credit/exchange logic — this feature only adds a message affordance around disputes, it doesn't touch how they're resolved.
- A shared list+thread component extracted from `MessagesTab`/`AdminInboxTab` — revisit if a third consumer appears.
- Configurable/multiple support-inbox admins, ticket assignment, or read/unread-per-admin tracking on Inbox threads — any admin can see and reply to any thread; that's the whole model for v1.

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `conversations` gains `type`/`user_id`/`repliable`, relaxed `NOT NULL`s, 2 new RLS policies; `messages` gains 2 new RLS policies; `notify_on_message()` updated |
| `lib/actions/emailAdmin.ts` | New `sendBroadcastMessage(target, body, repliable)` |
| `app/admin/EmailComposeTab.tsx` | Email/Message mode toggle, conditional subject field, "Allow replies" checkbox, calls new action in Message mode |
| `app/admin/EmailsAdminTab.tsx` | New `'inbox'` sub-tab wired in |
| `app/admin/AdminInboxTab.tsx` | New — admin's message-thread list + reply view |
| `app/admin/DisputesAdminTab.tsx` | "💬 Message" button per dispute, navigates to Email/Message pre-filled |
| `app/admin/AdminClient.tsx` | Tab label "Emails" → "Email / Message"; callback plumbing for the Dispute-to-Message navigation |
| `app/profile/MessagesTab.tsx` | `type='admin'` rendering: fixed identity, no listing line, disabled-input non-repliable state |
| `app/profile/page.tsx` | Third conversations query (`type='admin'`, `user_id`), merged into the existing exchanges array |
| `app/profile/actions.ts` | New `startSupportConversation()` |
| `app/profile/ProfileCard.tsx` | New "🛟 Support" section: Message Support button + support email link |
