# Listings Pause / My Listings Active-Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** My Listings shows only active + paused listings (pending/sold/given move fully to the Exchanges tab, unchanged there), with Edit/Pause/Delete on active rows and Edit/Resume/Delete on paused rows.

**Architecture:** Add `'paused'` as a new value in the existing `listings.status` column (same shape as the earlier `'pending'` addition) via a documented SQL migration the user runs manually in the Supabase SQL Editor. No new server action — the existing generic `updateListingStatus` action already writes whatever `status` value a form submits. Browse and the listing detail page require zero code changes because both already treat any non-`active`/non-`pending` status as unavailable/hidden by construction. The only real code change is splitting My Listings' rendering in `app/profile/DashboardClient.tsx` into two filtered groups.

**Tech Stack:** Next.js App Router, React Server/Client Components, Supabase (Postgres + RLS), TypeScript, Vitest + React Testing Library.

## Global Constraints

- Migration must be additive only (`DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT`), matching the exact pattern already used for every prior migration in `supabase/schema.sql` — never destructive.
- No new server action — reuse `updateListingStatus` (`app/profile/actions.ts:29`) exactly as-is.
- `'given'` is confirmed dead code (no path in the app ever sets it) — do not add new handling for it, only preserve its existing display in `statusStyle`/`statusLabel`.
- Follow existing codebase pattern: no new unit tests for `app/listings/page.tsx` or `app/listings/[id]/page.tsx` (neither has any test file today, and neither needs code changes for this feature).

---

### Task 1: Data model — migration + type

**Files:**
- Modify: `supabase/schema.sql` (append new migration block at end of file)
- Modify: `lib/types.ts:10`

**Interfaces:**
- Produces: `ListingStatus` type now includes `'paused'` as a valid value, consumed by `lib/listingAvailability.ts` (no change needed there — it already treats any non-`active`/non-`pending` status as `'unavailable'`) and by any other code importing `ListingStatus` from `lib/types.ts`.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

Add this at the very end of the file, matching the exact style of every prior migration block in the file:

```sql

-- ── Migration: paused listings ────────────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_status_check;
ALTER TABLE listings ADD CONSTRAINT listings_status_check
  CHECK (status IN ('active', 'pending', 'sold', 'given', 'paused'));
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Update `ListingStatus` in `lib/types.ts`**

Change line 10 from:
```ts
export type ListingStatus = 'active' | 'pending' | 'sold' | 'given'
```
to:
```ts
export type ListingStatus = 'active' | 'pending' | 'sold' | 'given' | 'paused'
```

- [ ] **Step 3: Verify the type change compiles cleanly**

Run: `npx tsc --noEmit`
Expected: same pre-existing errors as before this change (in `app/profile/HistorySection.test.tsx` and two `Set` iteration errors — all unrelated to this file, already present on `master`), and no *new* errors mentioning `lib/types.ts` or `ListingStatus`.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql lib/types.ts
git commit -m "feat: add paused status to listings data model"
```

**Note for whoever runs this in production:** the SQL block from Step 1 must be run manually in the Supabase SQL Editor (Project → SQL Editor) before Task 2's UI changes are deployed — the app itself has no automated migration runner, consistent with every prior migration in this codebase.

---

### Task 2: My Listings — active/paused split with Pause/Resume/Delete

**Files:**
- Modify: `app/profile/DashboardClient.tsx:151-163` (`statusStyle`/`statusLabel`)
- Modify: `app/profile/DashboardClient.tsx:278-359` (the `activeTab === 'listings'` block)
- Test: `app/profile/DashboardClient.test.tsx`

**Interfaces:**
- Consumes: `updateListingStatus(formData: FormData) => Promise<void>` (existing prop, unchanged signature) — form fields `id` (listing id) and `status` (new value: `'paused'`, `'active'`, or `'delete'`).
- Consumes: the local `Listing` type already defined in this file (`app/profile/DashboardClient.tsx:13-21`) — `{ id, title, author, price?, condition, status, photo_url? }`. No change to this type; `status` is already a loose `string`.
- Produces: no new exports — this is a self-contained rendering change within the default-exported `DashboardClient` component.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to the end of `app/profile/DashboardClient.test.tsx` (after the existing closing `})` of the current `describe('DashboardClient — notification badges and highlighting', ...)` block, as a sibling top-level block):

```tsx
describe('DashboardClient — My Listings active/paused split', () => {
  const activeListing = {
    id: 'listing-active', title: 'Dune', author: 'Frank Herbert',
    price: null, condition: 'good', status: 'active', photo_url: null,
  }
  const pausedListing = {
    id: 'listing-paused', title: 'Neuromancer', author: 'William Gibson',
    price: null, condition: 'fair', status: 'paused', photo_url: null,
  }
  const pendingListing = {
    id: 'listing-pending', title: 'Snow Crash', author: 'Neal Stephenson',
    price: null, condition: 'good', status: 'pending', photo_url: null,
  }
  const soldListing = {
    id: 'listing-sold', title: 'The Hobbit', author: 'J.R.R. Tolkien',
    price: null, condition: 'good', status: 'sold', photo_url: null,
  }

  it('shows an active listing with Pause and Delete, not Mark Sold or Re-list', () => {
    render(<DashboardClient {...baseProps} listings={[activeListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.getByText('Dune')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark Sold' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Re-list' })).not.toBeInTheDocument()
  })

  it('shows a paused listing in the Paused section with Resume and Delete', () => {
    render(<DashboardClient {...baseProps} listings={[pausedListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.getByText(/Paused \(1\)/)).toBeInTheDocument()
    expect(screen.getByText('Neuromancer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('does not show pending or sold listings in My Listings at all', () => {
    render(<DashboardClient {...baseProps} listings={[pendingListing, soldListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.queryByText('Snow Crash')).not.toBeInTheDocument()
    expect(screen.queryByText('The Hobbit')).not.toBeInTheDocument()
    expect(screen.getByText(/No active listings/)).toBeInTheDocument()
  })

  it('omits the Paused section when there are no paused listings', () => {
    render(<DashboardClient {...baseProps} listings={[activeListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.queryByText(/Paused/)).not.toBeInTheDocument()
  })

  it('shows the true lifetime count in the header even when some listings are hidden from this tab', () => {
    render(<DashboardClient {...baseProps} listings={[activeListing, soldListing]} exchanges={[]} defaultTab="listings" />)
    expect(screen.getByText('2 books posted')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run app/profile/DashboardClient.test.tsx --reporter=verbose`
Expected: the 5 new tests FAIL (the "Pause"/"Resume" buttons and "Paused" section don't exist yet; pending/sold listings still render today). The pre-existing tests in the file should still PASS.

- [ ] **Step 3: Update `statusStyle`/`statusLabel`**

In `app/profile/DashboardClient.tsx`, replace:
```tsx
function statusStyle(status: string) {
  if (status === 'sold')    return { background: '#dbeafe', color: '#1d4ed8' }
  if (status === 'given')   return { background: '#f3e8ff', color: '#6b21a8' }
  if (status === 'pending') return { background: '#fffbeb', color: '#92400e' }
  return { background: '#dcfce7', color: '#166534' }
}

function statusLabel(status: string) {
  if (status === 'sold')    return 'Sold'
  if (status === 'given')   return 'Given Away'
  if (status === 'pending') return 'Pending'
  return 'Active'
}
```
with:
```tsx
function statusStyle(status: string) {
  if (status === 'sold')    return { background: '#dbeafe', color: '#1d4ed8' }
  if (status === 'given')   return { background: '#f3e8ff', color: '#6b21a8' }
  if (status === 'pending') return { background: '#fffbeb', color: '#92400e' }
  if (status === 'paused')  return { background: '#f3f4f6', color: '#4b5563' }
  return { background: '#dcfce7', color: '#166534' }
}

function statusLabel(status: string) {
  if (status === 'sold')    return 'Sold'
  if (status === 'given')   return 'Given Away'
  if (status === 'pending') return 'Pending'
  if (status === 'paused')  return 'Paused'
  return 'Active'
}
```

- [ ] **Step 4: Replace the My Listings tab block**

In `app/profile/DashboardClient.tsx`, replace the entire block from `{activeTab === 'listings' && (` through its matching closing `)}` (currently lines 278-359) with:

```tsx
      {activeTab === 'listings' && (() => {
        const active = listings.filter(l => l.status === 'active')
        const paused = listings.filter(l => l.status === 'paused')

        const ListingRow = ({ l, action }: { l: Listing; action: 'pause' | 'resume' }) => (
          <div className="flex items-center gap-3" style={{ padding: '12px 0', borderBottom: '2px solid #f3f4f6' }}>
            <div className="relative shrink-0 overflow-hidden"
              style={{ width: 42, height: 42, borderRadius: 10, background: coverGradient(l.id) }}>
              {l.photo_url ? (
                <Image src={l.photo_url} alt={l.title} fill className="object-cover" />
              ) : (
                <span className="flex items-center justify-center w-full h-full text-[20px]">📚</span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <Link href={`/listings/${l.id}`} className="font-black text-[14px] truncate block hover:text-bk-orange transition-colors">
                {l.title}
              </Link>
              <p className="font-semibold text-[12px]" style={{ color: '#aaa' }}>
                {l.author} · 1 credit · {l.condition}
              </p>
            </div>
            <span className="font-extrabold text-[11px] whitespace-nowrap shrink-0"
              style={{ padding: '3px 10px', borderRadius: 999, ...statusStyle(l.status) }}>
              {statusLabel(l.status)}
            </span>
            <Link href={`/listings/${l.id}/edit`}
              className="font-extrabold text-[11px] hover:opacity-80 shrink-0"
              style={{ color: '#888' }}>
              Edit
            </Link>
            <form action={updateListingStatus} className="flex gap-2 shrink-0">
              <input type="hidden" name="id" value={l.id} />
              {action === 'pause' ? (
                <button name="status" value="paused"
                  className="font-extrabold text-[11px] hover:opacity-80"
                  style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', padding: 0 }}>
                  Pause
                </button>
              ) : (
                <button name="status" value="active"
                  className="font-extrabold text-[11px] hover:opacity-80"
                  style={{ background: 'none', border: 'none', color: '#16a34a', cursor: 'pointer', padding: 0 }}>
                  Resume
                </button>
              )}
              <button name="status" value="delete"
                className="font-extrabold text-[11px] hover:opacity-80"
                style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: 0 }}>
                Delete
              </button>
            </form>
          </div>
        )

        return (
          <div className="flex flex-col" style={{ gap: 16 }}>
            <div style={cardStyle}>
              <div className="flex items-center justify-between mb-4">
                <p className="font-bold text-[13px]" style={{ color: '#aaa' }}>
                  {listings.length} book{listings.length !== 1 ? 's' : ''} posted
                </p>
                <Link
                  href="/post"
                  className="text-white font-extrabold text-[13px] shadow-[0_3px_0_#0f766e]"
                  style={{ background: '#0d9488', padding: '9px 20px', borderRadius: 999 }}
                >
                  + Post a Book
                </Link>
              </div>

              {listings.length === 0 ? (
                <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
                  No listings yet.{' '}
                  <Link href="/post" className="text-bk-orange font-extrabold hover:underline">Post your first book!</Link>
                </div>
              ) : active.length === 0 ? (
                <div className="text-center py-8 font-bold text-[14px]" style={{ color: '#aaa' }}>
                  No active listings.{' '}
                  <Link href="/post" className="text-bk-orange font-extrabold hover:underline">Post a book!</Link>
                </div>
              ) : (
                <div>
                  {active.map(l => <ListingRow key={l.id} l={l} action="pause" />)}
                </div>
              )}
            </div>

            {paused.length > 0 && (
              <div style={cardStyle}>
                <div className="font-extrabold text-[11px] mb-4"
                  style={{ textTransform: 'uppercase', letterSpacing: '0.8px', padding: '7px 12px', borderRadius: 10, background: '#f3f4f6', color: '#4b5563', display: 'inline-block' }}>
                  ⏸️ Paused ({paused.length})
                </div>
                <div>
                  {paused.map(l => <ListingRow key={l.id} l={l} action="resume" />)}
                </div>
              </div>
            )}
          </div>
        )
      })()}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run app/profile/DashboardClient.test.tsx --reporter=verbose`
Expected: all tests PASS, including the 5 new ones and every pre-existing test in the file.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: all test files pass (112 pre-existing + 5 new = 117 total).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: identical output to Task 1 Step 3 — no new errors introduced by this task.

- [ ] **Step 8: Commit**

```bash
git add app/profile/DashboardClient.tsx app/profile/DashboardClient.test.tsx
git commit -m "feat: split My Listings into active/paused, add Pause/Resume actions"
```

---

## After Both Tasks

- Push the branch and open a PR (same flow as prior fixes on this project: branch → commit → push → `gh pr create` → review → `gh pr merge --squash --delete-branch`).
- **Before merging**, remind the user the Task 1 Step 1 SQL migration must be run manually in the Supabase SQL Editor — merging the code without running it means `updateListingStatus` writing `status='paused'` will fail the DB check constraint (existing rows are fine; only new pause attempts would error).
