# Dispute History & Clickable User Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every dispute a real Resolve/Unresolved/Delete lifecycle, surface each user's full dispute history (filed + against, with a tally) inside a clickable user card in the admin panel, and bring the same 3 actions to the main Disputes tab.

**Architecture:** One new pure module (`lib/disputeEnrichment.ts`) derives "who a dispute was filed against" from the conversation it belongs to (no new column) and builds per-user tallies. Two new admin server actions (`adminSetDisputeStatus`, `adminDeleteDispute`) replace the narrower `resolveDispute`. A new shared `DisputeRow` component renders one dispute + its 3 action buttons, reused by both the main Disputes tab and the new per-user card section. `AdminClient.tsx` centralizes the dispute fetch (previously owned solely by `DisputesAdminTab`) and feeds it to both places.

**Tech Stack:** Next.js 14 App Router, React (client components), Supabase (Postgres + RLS + supabase-js), Vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-08-20-dispute-history-and-user-card-design.md`

## Global Constraints

- Delete is a real, permanent row removal — not a soft "dismissed" status.
- Resolved/Unresolved are the existing `disputes.status` field (`'open'` / `'resolved'`) toggling both directions — reopening is a new capability, not a new status value.
- "Filed against" is derived from `conversations.buyer_id`/`seller_id` at read time — no new column, no migration/backfill.
- Both the main Admin → Disputes tab and the new user-card dispute section get the full Resolve/Unresolved/Delete action set.
- The Users table row itself is the click target for opening the user card — the old "Edit ✏️" link is removed, not kept alongside.
- The dispute tally (`N filed · M against`) appears both as a Users-table column and inside the opened card.
- Every dispute action is admin-gated twice: `requireAdmin` in the server action, and the RLS policy at the database level.
- Every dispute action shows its error inline on failure — never a silent no-op (this codebase has shipped this exact bug 3 times before in admin-panel code).
- Delete requires a confirm dialog before it fires (irreversible).

---

## Task 1: SQL migration — admin delete policy for `disputes`

**Files:**
- Modify: `supabase/schema.sql` (append at end of file)

**Interfaces:**
- Produces: RLS policy `"Admins can delete disputes"` on `disputes`, enabling `adminDeleteDispute` (Task 3) to actually delete a row once run against the live database.

- [ ] **Step 1: Append the migration block**

Add this to the very end of `supabase/schema.sql`:

```sql

-- ── Migration: admin can permanently delete a dispute ───────────────────────
-- Run this block in Supabase SQL Editor:

-- No delete policy exists on disputes today — only select/insert/update. This
-- lets an admin permanently remove a dispute that never warranted a real
-- record (filed in error, resolved without needing a lasting trace) —
-- distinct from the existing Resolved/Unresolved status toggle, which keeps
-- the row. Same admin-only shape as the existing "Admins can resolve
-- disputes" update policy.
create policy "Admins can delete disputes" on disputes
  for delete using (exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin = true));
```

- [ ] **Step 2: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add admin delete policy for disputes"
```

---

## Task 2: Dispute enrichment helpers (`lib/disputeEnrichment.ts`)

**Files:**
- Create: `lib/disputeEnrichment.ts`
- Test: `lib/disputeEnrichment.test.ts`

**Interfaces:**
- Produces: `enrichDisputes(disputes: RawDispute[], conversations: ConversationParticipants[], listingTitles: Record<string, string>, userNames: Record<string, string>): EnrichedDispute[]`; `buildDisputeTally(disputes: EnrichedDispute[]): Record<string, DisputeTally>`; types `RawDispute`, `ConversationParticipants`, `EnrichedDispute`, `DisputeTally`. Consumed by Task 3 (type only), Task 4 (`EnrichedDispute` type), Task 5 (both functions, in `AdminClient.tsx`'s fetch effect), Task 6 (`buildDisputeTally`).

- [ ] **Step 1: Write the failing tests**

Create `lib/disputeEnrichment.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { enrichDisputes, buildDisputeTally, type RawDispute, type ConversationParticipants } from './disputeEnrichment'

const conversations: ConversationParticipants[] = [
  { id: 'convo-1', listing_id: 'listing-1', buyer_id: 'buyer-1', seller_id: 'seller-1' },
  { id: 'convo-2', listing_id: 'listing-2', buyer_id: 'buyer-2', seller_id: 'seller-2' },
]

const listingTitles = { 'listing-1': 'Dune', 'listing-2': 'Sapiens' }
const userNames = { 'buyer-1': 'Alex', 'seller-1': 'Sam', 'buyer-2': 'Jordan', 'seller-2': 'Robin' }

describe('enrichDisputes', () => {
  it('resolves the other party as whichever participant is not the reporter', () => {
    const disputes: RawDispute[] = [
      { id: 'd1', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'Never showed up', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const [enriched] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(enriched.otherPartyId).toBe('seller-1')
    expect(enriched.otherPartyName).toBe('Sam')
    expect(enriched.reporterName).toBe('Alex')
    expect(enriched.bookTitle).toBe('Dune')
  })

  it('resolves the other party correctly when the seller is the reporter', () => {
    const disputes: RawDispute[] = [
      { id: 'd2', conversation_id: 'convo-2', reporter_id: 'seller-2', message: 'Buyer never confirmed', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const [enriched] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(enriched.otherPartyId).toBe('buyer-2')
    expect(enriched.otherPartyName).toBe('Jordan')
  })

  it('falls back to Unknown when a conversation, listing, or name cannot be found', () => {
    const disputes: RawDispute[] = [
      { id: 'd3', conversation_id: 'missing-convo', reporter_id: 'ghost-user', message: 'orphaned', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const [enriched] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(enriched.otherPartyId).toBeNull()
    expect(enriched.otherPartyName).toBe('Unknown')
    expect(enriched.reporterName).toBe('Unknown')
    expect(enriched.bookTitle).toBe('Unknown book')
  })

  it('passes status, timestamps, and message through unchanged', () => {
    const disputes: RawDispute[] = [
      { id: 'd4', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'Resolved amicably', status: 'resolved', created_at: '2026-08-01T00:00:00.000Z', resolved_at: '2026-08-02T00:00:00.000Z' },
    ]
    const [enriched] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(enriched.status).toBe('resolved')
    expect(enriched.resolvedAt).toBe('2026-08-02T00:00:00.000Z')
    expect(enriched.message).toBe('Resolved amicably')
  })
})

describe('buildDisputeTally', () => {
  it('counts filed and against separately per user', () => {
    const disputes: RawDispute[] = [
      { id: 'd1', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'a', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
      { id: 'd2', conversation_id: 'convo-1', reporter_id: 'seller-1', message: 'b', status: 'open', created_at: '2026-08-02T00:00:00.000Z', resolved_at: null },
    ]
    const enriched = enrichDisputes(disputes, conversations, listingTitles, userNames)
    const tally = buildDisputeTally(enriched)
    // buyer-1 filed d1 (against seller-1) and is the target of d2 (filed by seller-1)
    expect(tally['buyer-1']).toEqual({ filed: 1, against: 1 })
    expect(tally['seller-1']).toEqual({ filed: 1, against: 1 })
  })

  it('omits a user with no disputes entirely', () => {
    const disputes: RawDispute[] = [
      { id: 'd1', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'a', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const enriched = enrichDisputes(disputes, conversations, listingTitles, userNames)
    const tally = buildDisputeTally(enriched)
    expect(tally['buyer-2']).toBeUndefined()
  })

  it('does not credit an "against" count when the conversation could not be resolved', () => {
    const disputes: RawDispute[] = [
      { id: 'd1', conversation_id: 'missing-convo', reporter_id: 'ghost-user', message: 'orphaned', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const enriched = enrichDisputes(disputes, conversations, listingTitles, userNames)
    const tally = buildDisputeTally(enriched)
    expect(tally['ghost-user']).toEqual({ filed: 1, against: 0 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/disputeEnrichment.test.ts --exclude ".claude/**"`
Expected: FAIL — `disputeEnrichment.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `lib/disputeEnrichment.ts`:

```ts
export type DisputeStatus = 'open' | 'resolved'

export type RawDispute = {
  id: string
  conversation_id: string
  reporter_id: string
  message: string
  status: DisputeStatus
  created_at: string
  resolved_at: string | null
}

export type ConversationParticipants = {
  id: string
  listing_id: string | null
  buyer_id: string
  seller_id: string
}

export type EnrichedDispute = {
  id: string
  conversationId: string
  message: string
  status: DisputeStatus
  createdAt: string
  resolvedAt: string | null
  reporterId: string
  reporterName: string
  otherPartyId: string | null
  otherPartyName: string
  bookTitle: string
}

export function enrichDisputes(
  disputes: RawDispute[],
  conversations: ConversationParticipants[],
  listingTitles: Record<string, string>,
  userNames: Record<string, string>
): EnrichedDispute[] {
  const convoMap: Record<string, ConversationParticipants> = {}
  for (const c of conversations) convoMap[c.id] = c

  return disputes.map(d => {
    const convo = convoMap[d.conversation_id]
    const otherPartyId = convo
      ? (d.reporter_id === convo.buyer_id ? convo.seller_id : convo.buyer_id)
      : null

    return {
      id: d.id,
      conversationId: d.conversation_id,
      message: d.message,
      status: d.status,
      createdAt: d.created_at,
      resolvedAt: d.resolved_at,
      reporterId: d.reporter_id,
      reporterName: userNames[d.reporter_id] ?? 'Unknown',
      otherPartyId,
      otherPartyName: otherPartyId ? (userNames[otherPartyId] ?? 'Unknown') : 'Unknown',
      bookTitle: convo?.listing_id ? (listingTitles[convo.listing_id] ?? 'Unknown book') : 'Unknown book',
    }
  })
}

export type DisputeTally = { filed: number; against: number }

export function buildDisputeTally(disputes: EnrichedDispute[]): Record<string, DisputeTally> {
  const tally: Record<string, DisputeTally> = {}

  function bump(userId: string, key: keyof DisputeTally) {
    if (!tally[userId]) tally[userId] = { filed: 0, against: 0 }
    tally[userId][key]++
  }

  for (const d of disputes) {
    bump(d.reporterId, 'filed')
    if (d.otherPartyId) bump(d.otherPartyId, 'against')
  }

  return tally
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/disputeEnrichment.test.ts --exclude ".claude/**"`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/disputeEnrichment.ts lib/disputeEnrichment.test.ts
git commit -m "feat: add dispute enrichment and tally helpers"
```

---

## Task 3: Admin server actions — `adminSetDisputeStatus`, `adminDeleteDispute`

**Files:**
- Modify: `lib/actions/admin.ts` (add two functions after `adminUpdateUserCredits`; leave `resolveDispute` in place for now — Task 5 removes it once its last caller is rewritten)
- Test: `lib/actions/admin.test.ts`

**Interfaces:**
- Consumes: `requireAdmin(supabase): Promise<{ ok: true; userId: string } | { ok: false; error: string }>` from `./libraryLocations` (existing).
- Produces: `adminSetDisputeStatus(disputeId: string, status: 'open' | 'resolved'): Promise<{ ok: boolean; error?: string }>`; `adminDeleteDispute(disputeId: string): Promise<{ ok: boolean; error?: string }>`. Consumed by Task 4 (`DisputeRow`).

- [ ] **Step 1: Write the failing tests**

Create `lib/actions/admin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { adminSetDisputeStatus, adminDeleteDispute } from './admin'

const requireAdminMock = vi.fn()
vi.mock('./libraryLocations', () => ({
  requireAdmin: (...args: unknown[]) => requireAdminMock(...args),
}))

let selectSingleResult: { data: any; error: unknown }
let updateResult: { error: unknown }
let deleteResult: { error: unknown }

const singleMock = vi.fn(() => Promise.resolve(selectSingleResult))
const selectEqMock = vi.fn(() => ({ single: singleMock }))
const selectMock = vi.fn(() => ({ eq: selectEqMock }))

const updateEqMock = vi.fn(() => Promise.resolve(updateResult))
const updateMock = vi.fn(() => ({ eq: updateEqMock }))

const deleteEqMock = vi.fn(() => Promise.resolve(deleteResult))
const deleteMock = vi.fn(() => ({ eq: deleteEqMock }))

const fromMock = vi.fn(() => ({ select: selectMock, update: updateMock, delete: deleteMock }))
const rpcMock = vi.fn(() => Promise.resolve({ data: null, error: null }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ from: fromMock, rpc: rpcMock }),
}))

describe('adminSetDisputeStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminMock.mockResolvedValue({ ok: true, userId: 'admin-1' })
    selectSingleResult = { data: { conversation_id: 'convo-1' }, error: null }
    updateResult = { error: null }
  })

  it('rejects a non-admin caller', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: 'Not authorized.' })
    const result = await adminSetDisputeStatus('dispute-1', 'resolved')
    expect(result).toEqual({ ok: false, error: 'Not authorized.' })
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('resolves a dispute, stamping resolved_at and calling resolve_pickup', async () => {
    const result = await adminSetDisputeStatus('dispute-1', 'resolved')
    expect(result).toEqual({ ok: true })
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'resolved', resolved_at: expect.any(String) }))
    expect(rpcMock).toHaveBeenCalledWith('resolve_pickup', { p_conversation_id: 'convo-1' })
  })

  it('reopens a dispute, clearing resolved_at and NOT calling resolve_pickup', async () => {
    const result = await adminSetDisputeStatus('dispute-1', 'open')
    expect(result).toEqual({ ok: true })
    expect(updateMock).toHaveBeenCalledWith({ status: 'open', resolved_at: null })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns an error when the dispute cannot be found', async () => {
    selectSingleResult = { data: null, error: { message: 'not found' } }
    const result = await adminSetDisputeStatus('missing', 'resolved')
    expect(result).toEqual({ ok: false, error: 'Dispute not found.' })
  })

  it('returns an error when the update fails', async () => {
    updateResult = { error: { message: 'db exploded' } }
    const result = await adminSetDisputeStatus('dispute-1', 'resolved')
    expect(result).toEqual({ ok: false, error: 'db exploded' })
  })
})

describe('adminDeleteDispute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAdminMock.mockResolvedValue({ ok: true, userId: 'admin-1' })
    selectSingleResult = { data: { conversation_id: 'convo-1', status: 'open' }, error: null }
    deleteResult = { error: null }
  })

  it('rejects a non-admin caller', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, error: 'Not authorized.' })
    const result = await adminDeleteDispute('dispute-1')
    expect(result).toEqual({ ok: false, error: 'Not authorized.' })
    expect(deleteMock).not.toHaveBeenCalled()
  })

  it('deletes an open dispute and calls resolve_pickup afterward', async () => {
    const result = await adminDeleteDispute('dispute-1')
    expect(result).toEqual({ ok: true })
    expect(deleteMock).toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledWith('resolve_pickup', { p_conversation_id: 'convo-1' })
  })

  it('deletes a resolved dispute and does NOT call resolve_pickup', async () => {
    selectSingleResult = { data: { conversation_id: 'convo-1', status: 'resolved' }, error: null }
    const result = await adminDeleteDispute('dispute-1')
    expect(result).toEqual({ ok: true })
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns an error when the delete fails', async () => {
    deleteResult = { error: { message: 'db exploded' } }
    const result = await adminDeleteDispute('dispute-1')
    expect(result).toEqual({ ok: false, error: 'db exploded' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/actions/admin.test.ts --exclude ".claude/**"`
Expected: FAIL — `adminSetDisputeStatus`/`adminDeleteDispute` are not exported yet.

- [ ] **Step 3: Write the implementation**

In `lib/actions/admin.ts`, insert after `adminUpdateUserCredits` (before the existing `resolveDispute`):

```ts
export async function adminSetDisputeStatus(disputeId: string, status: 'open' | 'resolved'): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data: dispute, error: fetchError } = await supabase
    .from('disputes')
    .select('conversation_id')
    .eq('id', disputeId)
    .single()
  if (fetchError || !dispute) return { ok: false, error: 'Dispute not found.' }

  const { error } = await supabase
    .from('disputes')
    .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
    .eq('id', disputeId)
  if (error) return { ok: false, error: error.message }

  // Only resolving can complete an exchange; reopening must never trigger
  // completion. resolve_pickup() re-blocks automatically next time it runs
  // anyway, since it checks live for any open dispute — no extra code needed
  // on the reopen path.
  if (status === 'resolved') {
    await supabase.rpc('resolve_pickup', { p_conversation_id: dispute.conversation_id })
  }

  return { ok: true }
}

export async function adminDeleteDispute(disputeId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data: dispute, error: fetchError } = await supabase
    .from('disputes')
    .select('conversation_id, status')
    .eq('id', disputeId)
    .single()
  if (fetchError || !dispute) return { ok: false, error: 'Dispute not found.' }

  const { error } = await supabase
    .from('disputes')
    .delete()
    .eq('id', disputeId)
  if (error) return { ok: false, error: error.message }

  // Deleting a frivolous OPEN dispute can immediately unblock a stuck
  // exchange, same reasoning as resolving one. A resolved dispute is already
  // non-blocking, so no need to call this again.
  if (dispute.status === 'open') {
    await supabase.rpc('resolve_pickup', { p_conversation_id: dispute.conversation_id })
  }

  return { ok: true }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/actions/admin.test.ts --exclude ".claude/**"`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/actions/admin.ts lib/actions/admin.test.ts
git commit -m "feat: add adminSetDisputeStatus and adminDeleteDispute actions"
```

---

## Task 4: Shared `DisputeRow` component

**Files:**
- Create: `app/admin/DisputeRow.tsx`
- Test: `app/admin/DisputeRow.test.tsx`

**Interfaces:**
- Consumes: `EnrichedDispute` type (Task 2); `adminSetDisputeStatus`, `adminDeleteDispute` (Task 3).
- Produces: default export `DisputeRow(props: { dispute: EnrichedDispute; context: 'admin-tab' | 'user-card'; cardUserId?: string; onChanged: () => void; onMessageReporter?: (userId: string) => void })`. Consumed by Task 5 (`DisputesAdminTab`) and Task 6 (`UsersTab`'s card).

- [ ] **Step 1: Write the failing tests**

Create `app/admin/DisputeRow.test.tsx`:

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DisputeRow from './DisputeRow'
import { adminSetDisputeStatus, adminDeleteDispute } from '@/lib/actions/admin'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

vi.mock('@/lib/actions/admin', () => ({
  adminSetDisputeStatus: vi.fn(),
  adminDeleteDispute: vi.fn(),
}))

const openDispute: EnrichedDispute = {
  id: 'd1', conversationId: 'c1', message: 'Book never showed up', status: 'open',
  createdAt: '2026-08-01T00:00:00.000Z', resolvedAt: null,
  reporterId: 'u1', reporterName: 'Alex', otherPartyId: 'u2', otherPartyName: 'Sam', bookTitle: 'Dune',
}
const resolvedDispute: EnrichedDispute = { ...openDispute, id: 'd2', status: 'resolved', resolvedAt: '2026-08-02T00:00:00.000Z' }

describe('DisputeRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adminSetDisputeStatus).mockResolvedValue({ ok: true })
    vi.mocked(adminDeleteDispute).mockResolvedValue({ ok: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('shows Resolve for an open dispute and calls the action on click', async () => {
    const onChanged = vi.fn()
    const { getByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={onChanged} />)
    fireEvent.click(getByText('✓ Resolve'))
    await waitFor(() => expect(adminSetDisputeStatus).toHaveBeenCalledWith('d1', 'resolved'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('shows Unresolved for a resolved dispute and calls the action on click', async () => {
    const onChanged = vi.fn()
    const { getByText } = render(<DisputeRow dispute={resolvedDispute} context="admin-tab" onChanged={onChanged} />)
    fireEvent.click(getByText('↺ Unresolved'))
    await waitFor(() => expect(adminSetDisputeStatus).toHaveBeenCalledWith('d2', 'open'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('deletes after confirming, and calls onChanged', async () => {
    const onChanged = vi.fn()
    const { getByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={onChanged} />)
    fireEvent.click(getByText('🗑️ Delete'))
    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => expect(adminDeleteDispute).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('does not delete when the confirm dialog is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { getByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={vi.fn()} />)
    fireEvent.click(getByText('🗑️ Delete'))
    expect(adminDeleteDispute).not.toHaveBeenCalled()
  })

  it('shows an inline error and does not call onChanged when an action fails', async () => {
    vi.mocked(adminSetDisputeStatus).mockResolvedValue({ ok: false, error: 'Something broke.' })
    const onChanged = vi.fn()
    const { getByText, findByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={onChanged} />)
    fireEvent.click(getByText('✓ Resolve'))
    expect(await findByText('Something broke.')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('shows the reporter/other-party framing and a Message button in admin-tab context', () => {
    const onMessageReporter = vi.fn()
    const { getByText, container } = render(
      <DisputeRow dispute={openDispute} context="admin-tab" onChanged={vi.fn()} onMessageReporter={onMessageReporter} />
    )
    expect(container.textContent).toContain('Reported by Alex against Sam')
    fireEvent.click(getByText('💬 Message'))
    expect(onMessageReporter).toHaveBeenCalledWith('u1')
  })

  it('labels "Filed by this user" when the card owner is the reporter, and hides the Message button', () => {
    const { container, queryByText } = render(
      <DisputeRow dispute={openDispute} context="user-card" cardUserId="u1" onChanged={vi.fn()} />
    )
    expect(container.textContent).toContain('Filed by this user')
    expect(queryByText('💬 Message')).toBeNull()
  })

  it('labels "Filed against this user" when the card owner is the other party', () => {
    const { container } = render(
      <DisputeRow dispute={openDispute} context="user-card" cardUserId="u2" onChanged={vi.fn()} />
    )
    expect(container.textContent).toContain('Filed against this user')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/admin/DisputeRow.test.tsx --exclude ".claude/**"`
Expected: FAIL — `./DisputeRow` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `app/admin/DisputeRow.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { adminSetDisputeStatus, adminDeleteDispute } from '@/lib/actions/admin'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

export default function DisputeRow({
  dispute,
  context,
  cardUserId,
  onChanged,
  onMessageReporter,
}: {
  dispute: EnrichedDispute
  context: 'admin-tab' | 'user-card'
  cardUserId?: string
  onChanged: () => void
  onMessageReporter?: (userId: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true)
    setError(null)
    const result = await action()
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'Something went wrong.')
      return
    }
    onChanged()
  }

  function handleDelete() {
    if (!window.confirm('Permanently delete this dispute? This cannot be undone.')) return
    run(() => adminDeleteDispute(dispute.id))
  }

  const framing = context === 'admin-tab'
    ? `Reported by ${dispute.reporterName} against ${dispute.otherPartyName}`
    : dispute.reporterId === cardUserId ? 'Filed by this user' : 'Filed against this user'

  return (
    <div style={{ background: '#fff', border: '2px solid #fecdd3', borderRadius: 16, padding: 16 }}>
      <p className="font-black text-[14px]">{dispute.bookTitle}</p>
      <p className="font-semibold text-[12px]" style={{ color: '#aaa' }}>
        {framing} · Filed {new Date(dispute.createdAt).toLocaleDateString()} ·{' '}
        <span style={{ color: dispute.status === 'open' ? '#dc2626' : '#059669' }}>
          {dispute.status === 'open' ? 'Open' : 'Resolved'}
        </span>
      </p>
      <p className="font-semibold text-[13px] mt-2" style={{ color: '#444' }}>{dispute.message}</p>
      {error && <p className="font-bold text-[12px] mt-2" style={{ color: '#e11d48' }}>{error}</p>}
      <div className="flex gap-2 mt-3">
        {dispute.status === 'open' && (
          <button type="button" disabled={busy} onClick={() => run(() => adminSetDisputeStatus(dispute.id, 'resolved'))}
            className="font-extrabold text-[12px] text-white"
            style={{ background: '#059669', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            ✓ Resolve
          </button>
        )}
        {dispute.status === 'resolved' && (
          <button type="button" disabled={busy} onClick={() => run(() => adminSetDisputeStatus(dispute.id, 'open'))}
            className="font-extrabold text-[12px] text-white"
            style={{ background: '#f59e0b', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            ↺ Unresolved
          </button>
        )}
        <button type="button" disabled={busy} onClick={handleDelete}
          className="font-extrabold text-[12px] text-white"
          style={{ background: '#dc2626', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
          🗑️ Delete
        </button>
        {onMessageReporter && (
          <button type="button" onClick={() => onMessageReporter(dispute.reporterId)}
            className="font-extrabold text-[12px] text-white"
            style={{ background: '#0ea5e9', padding: '7px 18px', borderRadius: 999, border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
            💬 Message
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/admin/DisputeRow.test.tsx --exclude ".claude/**"`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add app/admin/DisputeRow.tsx app/admin/DisputeRow.test.tsx
git commit -m "feat: add shared DisputeRow component"
```

---

## Task 5: `DisputesAdminTab` goes props-driven + `AdminClient` disputes fetch

**Files:**
- Modify: `app/admin/DisputesAdminTab.tsx` (full rewrite — drops its own fetch, takes props, adds All/Open/Resolved filter, uses `DisputeRow`)
- Modify: `app/admin/AdminClient.tsx` (add centralized disputes fetch effect + `refetchDisputes`; update the `DisputesAdminTab` render call site)
- Modify: `lib/actions/admin.ts` (remove now-unused `resolveDispute`)
- Test: `app/admin/DisputesAdminTab.test.tsx`

**Interfaces:**
- Consumes: `EnrichedDispute`, `enrichDisputes` (Task 2); `DisputeRow` (Task 4).
- Produces: `DisputesAdminTab(props: { disputes: EnrichedDispute[]; onChanged: () => void; onMessageReporter: (userId: string) => void })`; on `AdminClient`, new state `enrichedDisputes: EnrichedDispute[]` and function `refetchDisputes(): void`. Both consumed by Task 6 (`UsersTab`'s tally column + card).

- [ ] **Step 1: Write the failing tests**

Create `app/admin/DisputesAdminTab.test.tsx`:

```tsx
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DisputesAdminTab from './DisputesAdminTab'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

vi.mock('./DisputeRow', () => ({
  default: ({ dispute }: { dispute: EnrichedDispute }) => <div data-testid={`dispute-${dispute.id}`}>{dispute.message}</div>,
}))

const disputes: EnrichedDispute[] = [
  { id: 'd-open', conversationId: 'c1', message: 'Book never showed up', status: 'open', createdAt: '2026-08-01T00:00:00.000Z', resolvedAt: null, reporterId: 'u1', reporterName: 'Alex', otherPartyId: 'u2', otherPartyName: 'Sam', bookTitle: 'Dune' },
  { id: 'd-resolved', conversationId: 'c2', message: 'Resolved amicably', status: 'resolved', createdAt: '2026-08-02T00:00:00.000Z', resolvedAt: '2026-08-03T00:00:00.000Z', reporterId: 'u2', reporterName: 'Sam', otherPartyId: 'u1', otherPartyName: 'Alex', bookTitle: 'Sapiens' },
]

describe('DisputesAdminTab', () => {
  it('defaults to showing only open disputes', () => {
    const { getByTestId, queryByTestId } = render(<DisputesAdminTab disputes={disputes} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByTestId('dispute-d-open')).toBeTruthy()
    expect(queryByTestId('dispute-d-resolved')).toBeNull()
  })

  it('shows resolved disputes when the Resolved filter is selected', () => {
    const { getByText, getByTestId, queryByTestId } = render(<DisputesAdminTab disputes={disputes} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    fireEvent.click(getByText('Resolved'))
    expect(getByTestId('dispute-d-resolved')).toBeTruthy()
    expect(queryByTestId('dispute-d-open')).toBeNull()
  })

  it('shows every dispute when the All filter is selected', () => {
    const { getByText, getByTestId } = render(<DisputesAdminTab disputes={disputes} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    fireEvent.click(getByText('All'))
    expect(getByTestId('dispute-d-open')).toBeTruthy()
    expect(getByTestId('dispute-d-resolved')).toBeTruthy()
  })

  it('shows an empty state when no disputes match the filter', () => {
    const { getByText } = render(<DisputesAdminTab disputes={[]} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByText('No open disputes.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/admin/DisputesAdminTab.test.tsx --exclude ".claude/**"`
Expected: FAIL — current `DisputesAdminTab` still requires an `onMessageReporter`-only prop and fetches its own data; it doesn't render `DisputeRow` or expose a filter yet.

- [ ] **Step 3: Rewrite `DisputesAdminTab.tsx`**

Replace the entire contents of `app/admin/DisputesAdminTab.tsx`:

```tsx
// app/admin/DisputesAdminTab.tsx
'use client'
import { useMemo, useState } from 'react'
import DisputeRow from './DisputeRow'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

type Filter = 'open' | 'resolved' | 'all'

export default function DisputesAdminTab({
  disputes,
  onChanged,
  onMessageReporter,
}: {
  disputes: EnrichedDispute[]
  onChanged: () => void
  onMessageReporter: (userId: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('open')

  const shown = useMemo(() => {
    const sorted = [...disputes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    if (filter === 'all') return sorted
    return sorted.filter(d => d.status === filter)
  }, [disputes, filter])

  return (
    <div>
      <div className="flex gap-2 mb-3">
        {(['open', 'resolved', 'all'] as const).map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full font-extrabold text-[12px] border-2 transition-colors ${filter === f ? 'bg-bk-orange border-bk-orange text-white' : 'bg-white border-[#e2e8f0] text-[#64748b]'}`}>
            {f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'All'}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>No {filter === 'all' ? '' : filter} disputes.</p>
      ) : (
        <div className="flex flex-col" style={{ gap: 12 }}>
          {shown.map(d => (
            <DisputeRow key={d.id} dispute={d} context="admin-tab" onChanged={onChanged} onMessageReporter={onMessageReporter} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run `DisputesAdminTab` tests to verify they pass**

Run: `npx vitest run app/admin/DisputesAdminTab.test.tsx --exclude ".claude/**"`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire the centralized disputes fetch into `AdminClient.tsx`**

In `app/admin/AdminClient.tsx`:

Add to the imports at the top (alongside the existing `import DisputesAdminTab from './DisputesAdminTab'`):

```tsx
import { enrichDisputes, type EnrichedDispute, type RawDispute, type ConversationParticipants } from '@/lib/disputeEnrichment'
```

Add new state right after the existing `hasTabCount` ref declaration (`const hasTabCount = useRef(false)`):

```tsx
  const [enrichedDisputes, setEnrichedDisputes] = useState<EnrichedDispute[]>([])
  const [disputesVersion, setDisputesVersion] = useState(0)
```

Add a new effect immediately after the existing `reviews` fetch `useEffect` (the one ending `}, [])` right before `function handleTabPendingCountChange`):

```tsx
  useEffect(() => {
    const supabase = createClient()
    let cancelled = false

    async function loadDisputes() {
      const { data: rows } = await supabase
        .from('disputes')
        .select('id, conversation_id, reporter_id, message, status, created_at, resolved_at')
        .order('created_at', { ascending: false })

      if (!rows || rows.length === 0) {
        if (!cancelled) setEnrichedDisputes([])
        return
      }

      const convoIds = Array.from(new Set(rows.map(r => r.conversation_id)))
      const { data: convos } = await supabase
        .from('conversations').select('id, listing_id, buyer_id, seller_id').in('id', convoIds)

      const listingIds = Array.from(new Set((convos ?? []).map(c => c.listing_id).filter(Boolean)))
      const { data: listings } = listingIds.length > 0
        ? await supabase.from('listings').select('id, title').in('id', listingIds)
        : { data: [] as { id: string; title: string }[] }
      const listingTitles: Record<string, string> = {}
      for (const l of listings ?? []) listingTitles[l.id] = l.title

      const userIds = Array.from(new Set([
        ...rows.map(r => r.reporter_id),
        ...(convos ?? []).flatMap(c => [c.buyer_id, c.seller_id]),
      ]))
      const { data: profileRows } = await supabase.from('profiles').select('id, username').in('id', userIds)
      const userNames: Record<string, string> = {}
      for (const p of profileRows ?? []) userNames[p.id] = p.username || 'Unknown'

      if (!cancelled) {
        setEnrichedDisputes(enrichDisputes(rows as RawDispute[], (convos ?? []) as ConversationParticipants[], listingTitles, userNames))
      }
    }

    loadDisputes()
    return () => { cancelled = true }
  }, [disputesVersion])

  function refetchDisputes() {
    setDisputesVersion(v => v + 1)
  }
```

Update the `disputes` tab render call site (replace `{tab === 'disputes'  && <DisputesAdminTab onMessageReporter={handleMessageReporter} />}`):

```tsx
          {tab === 'disputes'  && (
            <DisputesAdminTab
              disputes={enrichedDisputes}
              onChanged={refetchDisputes}
              onMessageReporter={handleMessageReporter}
            />
          )}
```

- [ ] **Step 6: Remove the now-unused `resolveDispute` from `lib/actions/admin.ts`**

Delete the `resolveDispute` function (it was only ever imported by the old `DisputesAdminTab.tsx`, which no longer calls it after Step 3):

```ts
export async function resolveDispute(disputeId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data: dispute, error: fetchError } = await supabase
    .from('disputes')
    .select('conversation_id')
    .eq('id', disputeId)
    .single()
  if (fetchError || !dispute) return { ok: false, error: 'Dispute not found.' }

  const { error } = await supabase
    .from('disputes')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('id', disputeId)
  if (error) return { ok: false, error: error.message }

  // Best-effort: if the exchange is otherwise eligible (both had already
  // confirmed, or the 48h window already passed while the dispute sat open),
  // this completes it immediately. If not, it resolves later via a confirm
  // click or the next cron run — resolveDispute doesn't need to know which.
  await supabase.rpc('resolve_pickup', { p_conversation_id: dispute.conversation_id })

  return { ok: true }
}
```

- [ ] **Step 7: Confirm nothing else references `resolveDispute`**

Run: `grep -rn "resolveDispute" app lib` (or use your editor's search)
Expected: no matches outside of `docs/superpowers/plans/2026-08-14-dual-pickup-confirmation.md` and `docs/superpowers/specs/2026-08-14-dual-pickup-confirmation-design.md` (historical plan/spec text — leave those untouched).

- [ ] **Step 8: Run the full test suite for touched files**

Run: `npx vitest run app/admin/DisputesAdminTab.test.tsx lib/actions/admin.test.ts --exclude ".claude/**"`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/admin/DisputesAdminTab.tsx app/admin/DisputesAdminTab.test.tsx app/admin/AdminClient.tsx lib/actions/admin.ts
git commit -m "feat: make DisputesAdminTab props-driven with a status filter, wire centralized disputes fetch"
```

---

## Task 6: `UsersTab` — clickable row, dispute tally column, card dispute history

**Files:**
- Modify: `app/admin/AdminClient.tsx` (export `UsersTab`, add tally column + row click + card disputes section; wire its render call site)
- Test: `app/admin/AdminClient.test.tsx`

**Interfaces:**
- Consumes: `buildDisputeTally` (Task 2); `DisputeRow` (Task 4); `enrichedDisputes` state + `refetchDisputes` (Task 5, already present in `AdminClient`).
- Produces: exported `UsersTab(props: { users: User[]; setUsers: ...; toggleAdmin: ...; disputeTally: Record<string, { filed: number; against: number }>; enrichedDisputes: EnrichedDispute[]; onDisputesChanged: () => void })`; exported `formatDisputeTally(t?: { filed: number; against: number }): string`.

- [ ] **Step 1: Write the failing tests**

Create `app/admin/AdminClient.test.tsx`:

```tsx
import { useState } from 'react'
import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { UsersTab, formatDisputeTally } from './AdminClient'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

vi.mock('@/lib/actions/admin', () => ({
  adminUpdateUserCredits: vi.fn(() => Promise.resolve({ ok: true })),
}))

vi.mock('./DisputeRow', () => ({
  default: ({ dispute, context, cardUserId }: { dispute: EnrichedDispute; context: string; cardUserId?: string }) => (
    <div data-testid={`dispute-${dispute.id}`}>{context}:{cardUserId ?? ''}</div>
  ),
}))

const baseUser = {
  joined: '2026-01-01', booksPosted: 0, booksSold: 0, booksBought: 0, credits: 0,
  status: 'active', city: 'Chicago', state: 'IL', bio: '', reviews: 0, is_admin: false,
}

const users = [
  { ...baseUser, id: 'u1', username: 'Alex', email: 'alex@example.com' },
  { ...baseUser, id: 'u2', username: 'Sam', email: 'sam@example.com' },
  { ...baseUser, id: 'u3', username: 'Jordan', email: 'jordan@example.com' },
]

const disputes: EnrichedDispute[] = [
  { id: 'd1', conversationId: 'c1', message: 'Never showed up', status: 'open', createdAt: '2026-08-01T00:00:00.000Z', resolvedAt: null, reporterId: 'u1', reporterName: 'Alex', otherPartyId: 'u2', otherPartyName: 'Sam', bookTitle: 'Dune' },
]

const disputeTally = { u1: { filed: 1, against: 0 }, u2: { filed: 0, against: 1 } }

function Harness() {
  const [state, setState] = useState(users)
  return (
    <UsersTab
      users={state}
      setUsers={setState}
      toggleAdmin={vi.fn()}
      disputeTally={disputeTally}
      enrichedDisputes={disputes}
      onDisputesChanged={vi.fn()}
    />
  )
}

function rowFor(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll('tbody tr')).find(r => r.textContent?.includes(name))!
}

describe('formatDisputeTally', () => {
  it('renders an em dash when there are no disputes', () => {
    expect(formatDisputeTally(undefined)).toBe('—')
    expect(formatDisputeTally({ filed: 0, against: 0 })).toBe('—')
  })

  it('renders the filed/against counts', () => {
    expect(formatDisputeTally({ filed: 2, against: 1 })).toBe('2 filed · 1 against')
  })
})

describe('UsersTab', () => {
  it('shows the dispute tally column for each user, and an em dash for a user with none', () => {
    const { container } = render(<Harness />)
    expect(container.textContent).toContain('1 filed · 0 against')
    expect(container.textContent).toContain('0 filed · 1 against')
    expect(rowFor(container, 'Jordan').textContent).toContain('—')
  })

  it('no longer shows an Edit link', () => {
    const { container } = render(<Harness />)
    expect(container.textContent).not.toContain('Edit ✏️')
  })

  it('opens the user card when the row is clicked', () => {
    const { container, getByText } = render(<Harness />)
    fireEvent.click(rowFor(container, 'Alex'))
    expect(getByText('Edit User')).toBeTruthy()
  })

  it('toggling status inside a row updates status but does not open the card', () => {
    const { container, queryByText, getByText } = render(<Harness />)
    fireEvent.click(getByText('● Active'))
    expect(queryByText('Edit User')).toBeNull()
    expect(getByText('● Suspended')).toBeTruthy()
  })

  it('toggling admin inside a row calls toggleAdmin but does not open the card', () => {
    const toggleAdmin = vi.fn()
    const { queryByText, getByText } = render(
      <UsersTab users={users} setUsers={vi.fn()} toggleAdmin={toggleAdmin} disputeTally={disputeTally} enrichedDisputes={disputes} onDisputesChanged={vi.fn()} />
    )
    fireEvent.click(getByText('○ User'))
    expect(queryByText('Edit User')).toBeNull()
    expect(toggleAdmin).toHaveBeenCalledWith('u1', false)
  })

  it("shows this user's filed disputes in the card, correctly labeled", () => {
    const { container, getByText, getByTestId } = render(<Harness />)
    fireEvent.click(rowFor(container, 'Alex'))
    expect(getByText('🚩 Disputes')).toBeTruthy()
    expect(container.textContent).toContain('1 filed · 0 against')
    expect(getByTestId('dispute-d1').textContent).toBe('user-card:u1')
  })

  it("shows disputes filed against a user in their card", () => {
    const { container, getByTestId } = render(<Harness />)
    fireEvent.click(rowFor(container, 'Sam'))
    expect(getByTestId('dispute-d1').textContent).toBe('user-card:u2')
  })

  it('shows "No disputes." for a user with none', () => {
    const { container, getByText } = render(<Harness />)
    fireEvent.click(rowFor(container, 'Jordan'))
    expect(getByText('No disputes.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/admin/AdminClient.test.tsx --exclude ".claude/**"`
Expected: FAIL — `UsersTab`/`formatDisputeTally` are not exported from `AdminClient.tsx` yet, and the table still has an Edit link instead of a tally column / row click.

- [ ] **Step 3: Add `buildDisputeTally` and `DisputeRow` imports**

In `app/admin/AdminClient.tsx`, update the import added in Task 5 to also bring in `buildDisputeTally`:

```tsx
import { enrichDisputes, buildDisputeTally, type EnrichedDispute, type RawDispute, type ConversationParticipants } from '@/lib/disputeEnrichment'
```

Add alongside the other component imports:

```tsx
import DisputeRow from './DisputeRow'
```

- [ ] **Step 4: Add the `disputeTally` derived value**

Add near the other derived values (`flaggedReviews`, `reviewCountBySeller`), inside the `AdminClient` component body:

```tsx
  const disputeTally = useMemo(() => buildDisputeTally(enrichedDisputes), [enrichedDisputes])
```

- [ ] **Step 5: Replace the `UsersTab` function**

Replace the entire existing `UsersTab` function (from the `// ─── Users tab ───` comment through its closing `}`, just before the `// ─── Reviews tab ───` comment) with:

```tsx
// ─── Users tab ───────────────────────────────────────────────────────────────

export function formatDisputeTally(t?: { filed: number; against: number }): string {
  if (!t || (t.filed === 0 && t.against === 0)) return '—'
  return `${t.filed} filed · ${t.against} against`
}

export function UsersTab({
  users,
  setUsers,
  toggleAdmin,
  disputeTally,
  enrichedDisputes,
  onDisputesChanged,
}: {
  users: User[]
  setUsers: React.Dispatch<React.SetStateAction<User[]>>
  toggleAdmin: (id: string, current: boolean) => void
  disputeTally: Record<string, { filed: number; against: number }>
  enrichedDisputes: EnrichedDispute[]
  onDisputesChanged: () => void
}) {
  const [search, setSearch] = useState('')
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [form, setForm] = useState<User | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const filtered = useMemo(() =>
    users.filter(u =>
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.city.toLowerCase().includes(search.toLowerCase())
    ), [users, search])

  function openEdit(u: User) { setEditTarget(u); setForm({ ...u }); setSaveError(null) }

  async function saveEdit() {
    if (!form) return
    // Credits are the one field that actually persists (everything else in this
    // modal is local-state-only by design). If the write fails, say so instead
    // of showing the new balance as if it saved.
    if (editTarget && form.credits !== editTarget.credits) {
      const result = await adminUpdateUserCredits(form.id, form.credits)
      if (!result.ok) {
        setSaveError(result.error ?? 'Failed to update credits.')
        return
      }
    }
    setSaveError(null)
    setUsers(prev => prev.map(u => u.id === form.id ? form : u))
    setEditTarget(null)
  }

  function toggleStatus(u: User) {
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, status: x.status === 'active' ? 'suspended' : 'active' } : x))
  }

  const userDisputes = form
    ? enrichedDisputes.filter(d => d.reporterId === form.id || d.otherPartyId === form.id)
    : []
  const cardTally = form ? (disputeTally[form.id] ?? { filed: 0, against: 0 }) : { filed: 0, against: 0 }

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-[22px] text-[#1e293b]">Users <span className="text-[#94a3b8] font-bold text-[16px] ml-1">({users.length})</span></h2>
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search users…"
          className="border-2 border-[#e2e8f0] rounded-xl px-3 py-2 font-bold text-[13px] focus:outline-none focus:border-bk-orange w-[220px]"
        />
      </div>

      <div className="bg-white rounded-2xl border border-[#f1f5f9] shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#f1f5f9] bg-[#f8fafc]">
                {['User','City','State','Books','Sold','Bought','Credits','Reviews','Disputes','Status','Admin'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-extrabold text-[#94a3b8] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} onClick={() => openEdit(u)} style={{ cursor: 'pointer' }}
                  className="border-b border-[#f8fafc] hover:bg-[#fafafa] transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-black text-[13px] text-[#1e293b]">{u.username}</div>
                    <div className="text-[11px] text-[#94a3b8] font-semibold">{u.email}</div>
                    <div className="text-[10px] text-[#cbd5e1] font-semibold">Joined {u.joined}</div>
                  </td>
                  <td className="px-4 py-3 text-[12px] font-semibold text-[#64748b] whitespace-nowrap">{u.city}</td>
                  <td className="px-4 py-3 text-[12px] font-semibold text-[#64748b] whitespace-nowrap">{u.state}</td>
                  <td className="px-4 py-3 text-[13px] font-extrabold text-[#f97316] text-center">{u.booksPosted}</td>
                  <td className="px-4 py-3 text-[13px] font-extrabold text-[#0d9488] text-center">{u.booksSold}</td>
                  <td className="px-4 py-3 text-[13px] font-extrabold text-[#8b5cf6] text-center">{u.booksBought}</td>
                  <td className="px-4 py-3 text-[13px] font-extrabold text-[#f59e0b] text-center">{u.credits}</td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-[#64748b] text-center">{u.reviews}</td>
                  <td className="px-4 py-3 text-[12px] font-semibold text-[#64748b] text-center whitespace-nowrap">{formatDisputeTally(disputeTally[u.id])}</td>
                  <td className="px-4 py-3">
                    <button onClick={(e) => { e.stopPropagation(); toggleStatus(u) }}
                      className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full ${u.status === 'active' ? 'bg-[#ecfdf5] text-[#059669]' : 'bg-[#fef2f2] text-[#dc2626]'}`}>
                      {u.status === 'active' ? '● Active' : '● Suspended'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={(e) => { e.stopPropagation(); toggleAdmin(u.id, u.is_admin) }}
                      className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full transition-colors ${u.is_admin ? 'bg-[#f97316] text-white' : 'bg-[#f1f5f9] text-[#94a3b8] hover:bg-[#fed7aa] hover:text-[#c2410c]'}`}>
                      {u.is_admin ? '★ Admin' : '○ User'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="py-12 text-center text-[#94a3b8] font-bold text-[14px]">No users match your search</div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      {editTarget && form && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-3xl w-full max-w-[480px] p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-[20px] text-[#1e293b]">Edit User</h2>
              <button onClick={() => setEditTarget(null)} className="text-[#94a3b8] hover:text-[#475569] text-[22px] font-black leading-none">×</button>
            </div>

            <div className="space-y-4 mb-5">
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Username</label>
                <input value={form.username} onChange={e => setForm(f => f && ({ ...f, username: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Email</label>
                <input value={form.email} onChange={e => setForm(f => f && ({ ...f, email: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">City</label>
                <input value={form.city} onChange={e => setForm(f => f && ({ ...f, city: e.target.value }))}
                  className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange" />
              </div>
              <div>
                <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Bio</label>
                <textarea value={form.bio} onChange={e => setForm(f => f && ({ ...f, bio: e.target.value }))}
                  rows={2} className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-semibold text-[14px] focus:outline-none focus:border-bk-orange resize-none" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Credits 🪙</label>
                  <input type="number" value={form.credits} min={0} onChange={e => setForm(f => f && ({ ...f, credits: parseInt(e.target.value)||0 }))}
                    className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-black text-[15px] focus:outline-none focus:border-bk-orange text-[#8b5cf6]" />
                </div>
                <div>
                  <label className="block text-[12px] font-extrabold text-[#475569] mb-1 uppercase tracking-wide">Status</label>
                  <select value={form.status} onChange={e => setForm(f => f && ({ ...f, status: e.target.value }))}
                    className="w-full border-2 border-[#e2e8f0] rounded-xl px-3 py-2.5 font-bold text-[14px] focus:outline-none focus:border-bk-orange bg-white">
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
            </div>

            {/* User stats */}
            <div className="bg-[#f8fafc] rounded-xl p-4 mb-5 grid grid-cols-4 gap-3 text-center">
              <div>
                <div className="text-[20px] font-black text-bk-orange">{form.booksPosted}</div>
                <div className="text-[10px] font-bold text-[#94a3b8] uppercase">Posted</div>
              </div>
              <div>
                <div className="text-[20px] font-black text-[#0d9488]">{form.booksSold}</div>
                <div className="text-[10px] font-bold text-[#94a3b8] uppercase">Sold</div>
              </div>
              <div>
                <div className="text-[20px] font-black text-[#8b5cf6]">{form.booksBought}</div>
                <div className="text-[10px] font-bold text-[#94a3b8] uppercase">Bought</div>
              </div>
              <div>
                <div className="text-[20px] font-black text-[#64748b]">{form.reviews}</div>
                <div className="text-[10px] font-bold text-[#94a3b8] uppercase">Reviews</div>
              </div>
            </div>

            {/* Disputes */}
            <div className="mb-5">
              <h3 className="font-black text-[14px] text-[#1e293b] mb-2">
                🚩 Disputes <span className="text-[#94a3b8] font-bold text-[12px] ml-1">({cardTally.filed} filed · {cardTally.against} against)</span>
              </h3>
              {userDisputes.length === 0 ? (
                <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>No disputes.</p>
              ) : (
                <div className="flex flex-col" style={{ gap: 12 }}>
                  {userDisputes.map(d => (
                    <DisputeRow key={d.id} dispute={d} context="user-card" cardUserId={form.id} onChanged={onDisputesChanged} />
                  ))}
                </div>
              )}
            </div>

            {saveError && (
              <p data-testid="user-save-error" className="font-bold text-[12px] mb-3" style={{ color: '#e11d48' }}>{saveError}</p>
            )}

            <div className="flex gap-3">
              <button onClick={() => setEditTarget(null)}
                className="flex-1 border-2 border-[#e2e8f0] rounded-xl py-3 font-extrabold text-[14px] text-[#64748b]">Cancel</button>
              <button onClick={saveEdit}
                className="flex-1 bg-bk-orange text-white rounded-xl py-3 font-extrabold text-[14px] shadow-[0_3px_0_#c2410c]">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Update the `UsersTab` render call site**

Replace the existing call (`{tab === 'users' && (<UsersTab users={...} setUsers={setUsers} toggleAdmin={toggleAdmin} />)}`) with:

```tsx
          {tab === 'users'     && (
            <UsersTab
              users={users.map(u => ({ ...u, reviews: reviewCountBySeller[u.id] ?? 0 }))}
              setUsers={setUsers}
              toggleAdmin={toggleAdmin}
              disputeTally={disputeTally}
              enrichedDisputes={enrichedDisputes}
              onDisputesChanged={refetchDisputes}
            />
          )}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run app/admin/AdminClient.test.tsx --exclude ".claude/**"`
Expected: PASS (10 tests)

- [ ] **Step 8: Run the whole suite and typecheck**

Run: `npx vitest run --exclude ".claude/**"`
Expected: PASS, no new failures beyond the pre-existing, unrelated ones already documented (43 pre-existing `tsc` errors — a project-wide `TS2802` gap and one `HistorySection.test.tsx` typing issue — noted in this project's history; don't chase those here).

Run: `npx tsc --noEmit`
Expected: no NEW errors introduced by this feature's files (`disputeEnrichment.ts`, `admin.ts`, `DisputeRow.tsx`, `DisputesAdminTab.tsx`, `AdminClient.tsx`).

- [ ] **Step 9: Commit**

```bash
git add app/admin/AdminClient.tsx app/admin/AdminClient.test.tsx
git commit -m "feat: clickable user row opens card with dispute history and tally"
```

---

## Known, Deliberately Out-of-Scope Gap

Matching this project's recurring pattern for admin-panel features (noted for every prior `/admin` feature), this plan does **not** include a live click-through with a real Supabase admin account — that requires a live admin + a second test account and is a separate ask. Automated tests passing + a clean `tsc --noEmit` (beyond the pre-existing unrelated errors) is the bar for "done" here.
