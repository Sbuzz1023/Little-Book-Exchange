# Move Messages Into the Dashboard

**Date:** 2026-07-12
**Status:** Approved

## Overview

Messaging currently lives at the standalone `/messages` and `/messages/[id]` routes, reached via a "Messages" link in `Nav.tsx`. This moves messaging into the Dashboard (`/profile`) as a 7th tab alongside Listings, Exchanges, TBR, Saved, Wallet, and Profile — selected the same way as the other six (client-side state, no navigation) — and removes the standalone routes and the nav link entirely.

The Exchanges tab's "💬 Message" button and the listing page's "Message Seller" action both currently send the user to `/messages/[id]`; both are rerouted to land on the Messages tab with the right conversation pre-selected.

---

## Data Flow

`app/profile/page.tsx` already fetches every conversation the user is party to (as `exchanges`), avoiding joins for RLS safety — buyer/seller/listing rows are fetched separately and merged in. It does **not** currently include the messages themselves.

Extend that fetch: after building `exchanges`, query `messages` for all conversation IDs in one call and attach each conversation's messages to its row:

```ts
const { data: msgRows } = await supabase
  .from('messages').select('*')
  .in('conversation_id', merged.map(r => r.id))
  .order('created_at', { ascending: true })
const msgsByConvo: Record<string, any[]> = {}
for (const m of msgRows ?? []) (msgsByConvo[m.conversation_id] ??= []).push(m)
// then, per row: messages: msgsByConvo[row.id] ?? []
```

Demo mode needs no change — `MOCK_CONVERSATIONS` already embeds `messages` per conversation, and `exchanges = [...MOCK_CONVERSATIONS]` in the demo branch already carries them through.

The Messages tab reuses this same `exchanges` array as its conversation list — it is not a second data source. `DashboardClient` already computes `userId` from `profile?.id` for the Exchanges tab; the Messages tab uses the same value to tell "mine" from "theirs".

---

## New Component: `app/profile/MessagesTab.tsx` (client)

Props:

```ts
{
  exchanges: Exchange[]        // same type already used by the Exchanges tab, now includes `messages`
  userId: string
  isDemo: boolean
  selectedId: string | null
  onSelectId: (id: string | null) => void
}
```

Renders a fixed-height panel (~550px) with its own internal scrolling, in two panes:

- **List pane** (left, ~260px) — one row per conversation: other party's name/avatar, listing title, last message preview, relative timestamp. Ports the rendering from the old `ConversationSidebar.tsx`, swapping its `<Link href="/messages/{id}">` + `usePathname` active-check for `onClick={() => onSelectId(convo.id)}` + `selectedId === convo.id`.
- **Thread pane** (right, remaining width) — header (other party + listing), scrollable message bubbles, composer. Ports the rendering and behavior from the old `[id]/page.tsx`: local message state seeded from `exchanges.find(e => e.id === selectedId).messages`, optimistic append for demo sends, real Supabase insert + realtime `postgres_changes` subscription (scoped to `selectedId`) for live sends otherwise.
- **Empty state** — when `selectedId` is `null`, thread pane shows the existing "Select a conversation" placeholder (ported from `messages/page.tsx`).

Responsive collapse below `768px`: list pane is full-width and visible when `selectedId === null`; thread pane is full-width and visible (with a "‹ Back" control that calls `onSelectId(null)`) when a conversation is selected. Same visual behavior as today's `MessagesShell`, just state-driven instead of route-driven.

---

## `DashboardClient.tsx` Changes

- `Tab` type gains `'messages'`.
- `TABS` gains a 7th entry (💬, "Messages", "Chat with neighbors") with its own color, matching the existing per-tab color/bg/border/shadow pattern.
- Tab grid: `grid-cols-3 md:grid-cols-6` → `grid-cols-4 md:grid-cols-7`.
- New state: `const [selectedConversationId, setSelectedConversationId] = useState<string | null>(initialConversationId ?? null)`.
- New props: `initialConversationId?: string | null` (in addition to the existing `defaultTab`).
- The Exchanges tab's per-row "💬 Message" button changes from `<Link href={\`/messages/${ex.id}\`}>` to a `<button onClick={() => { setActiveTab('messages'); setSelectedConversationId(ex.id) }}>`, same visual styling.
- New render block: `activeTab === 'messages'` renders `<MessagesTab exchanges={exchanges} userId={profile?.id ?? ''} isDemo={isDemo} selectedId={selectedConversationId} onSelectId={setSelectedConversationId} />`.
- New prop `isDemo: boolean`, passed through from `profile/page.tsx` (it already computes this for its own query branching).

---

## Rerouting the "Message Seller" Flow

`app/listings/[id]/page.tsx`'s `startConversation` server action currently has 4 `redirect(\`/messages/${id}\`)` call sites (demo match, existing conversation, newly-created conversation, catch-all fallback). Each becomes:

```ts
redirect(`/profile?tab=messages&conversation=${id}`)
```

`app/profile/page.tsx` reads `searchParams.tab` and `searchParams.conversation`:
- `defaultTab` becomes `searchParams.tab === 'messages' ? 'messages' : (searchParams.demo_pending ? 'exchanges' : 'listings')` (existing `demo_pending` behavior unchanged).
- New `initialConversationId = searchParams.conversation ?? null`, passed to `DashboardClient`.

---

## Cleanup

- Delete `app/messages/` entirely: `page.tsx`, `layout.tsx`, `MessagesShell.tsx`, `ConversationSidebar.tsx`, `LockScroll.tsx`, `[id]/page.tsx`.
- `components/Nav.tsx`: remove the "Messages" desktop link and the "💬 Messages" mobile menu link.
- `middleware.ts`: remove `'/messages'` from `protectedPaths` (the route no longer exists; `/profile` is already protected).

## Out of Scope

- No unread-message badges/counts on the Messages tab icon (none exist today either).
- No change to the realtime subscription mechanism itself — ported as-is from `[id]/page.tsx`.
- No change to how demo mode is detected (`lbe_demo_user` cookie / missing `NEXT_PUBLIC_SUPABASE_URL`) — reused from existing logic, computed server-side once in `profile/page.tsx` and passed down.

---

## Files Changed

| File | Change |
|---|---|
| `app/profile/page.tsx` | Fetch + attach `messages` per conversation onto `exchanges`; read `tab`/`conversation` search params; compute and pass `isDemo` and `initialConversationId` |
| `app/profile/DashboardClient.tsx` | Add `'messages'` tab (type, `TABS` entry, 4/7-col grid); lift `selectedConversationId` state; Exchanges tab's Message button switches tabs instead of navigating; render `MessagesTab` |
| `app/profile/MessagesTab.tsx` *(new)* | Two-pane (list + thread) messages UI, ported from `app/messages/*`, driven by props/local state instead of routing |
| `app/listings/[id]/page.tsx` | `startConversation`'s 4 redirect targets point to `/profile?tab=messages&conversation=...` instead of `/messages/...` |
| `components/Nav.tsx` | Remove desktop + mobile "Messages" links |
| `middleware.ts` | Remove `/messages` from `protectedPaths` |
| `app/messages/*` | Deleted (`page.tsx`, `layout.tsx`, `MessagesShell.tsx`, `ConversationSidebar.tsx`, `LockScroll.tsx`, `[id]/page.tsx`) |
