# Saved Books Persistence

**Date:** 2026-07-10
**Status:** Approved

## Overview

Hearting a listing (via `HeartButton` on `/listings` or `SaveButton` on `/listings/[id]`) currently only flips local UI state — nothing is written to the database, and the Dashboard's "Saved Books" tab is a static empty-state placeholder. This feature persists saves to Supabase, shows them in the Dashboard, and lets a user unsave from either the listing card or the Dashboard.

Persistence requires a real Supabase account row to attach the save to. Demo-mode sessions (the `lbe_demo_user` cookie fallback, no real `auth.users` row) cannot persist saves — when a demo-only session tries to save, the server action redirects them to real sign-in, the same way `requestPurchase` already does for unauthenticated purchase attempts.

---

## Data

### New table: `saved_listings`

```sql
create table if not exists saved_listings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  listing_id uuid references listings(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, listing_id)
);

alter table saved_listings enable row level security;

create policy "Users can view own saved listings" on saved_listings
  for select to authenticated using (auth.uid() = user_id);

create policy "Users can save listings" on saved_listings
  for insert to authenticated with check (auth.uid() = user_id);

create policy "Users can unsave own listings" on saved_listings
  for delete to authenticated using (auth.uid() = user_id);
```

This SQL is handed to the user to run in the Supabase SQL editor once the implementation is complete (same handoff as the address-privacy migration).

---

## Server Actions — `lib/actions/savedListings.ts`

New file, `'use server'`. Three exports:

```ts
saveListing(listingId: string, redirectTo: string): Promise<void>
unsaveListing(listingId: string, redirectTo: string): Promise<void>
removeSavedListing(formData: FormData): Promise<void>
```

- `saveListing`/`unsaveListing` are called **directly** (not via `<form action>`) from `HeartButton`/`SaveButton` — Next 14 App Router supports invoking an imported `'use server'` function as a plain async call from a Client Component event handler. Both:
  1. Fetch the current Supabase user via `supabase.auth.getUser()`.
  2. If no user, `redirect('/auth/signin?redirect=' + redirectTo)`.
  3. Otherwise upsert (`saveListing`) or delete (`unsaveListing`) the `saved_listings` row for `(user.id, listingId)`. `saveListing` uses `.upsert(..., { onConflict: 'user_id,listing_id', ignoreDuplicates: true })` so a double-click can't throw a unique-constraint error.
  4. `revalidatePath(redirectTo)` and `revalidatePath('/profile')` so the listing page and Dashboard reflect the change on next visit.
- `removeSavedListing(formData)` is a FormData-shaped wrapper used by a plain `<form>` "Unsave" button in the Dashboard's Saved Books tab (matches the existing `updateListingStatus` form-action convention there). Reads `listing_id` from the form, calls the same delete logic as `unsaveListing`, then `redirect('/profile')`.

---

## Component Changes

### `components/HeartButton.tsx`

Add two required props: `listingId: string`, `initialSaved: boolean`. `useState` is seeded from `initialSaved` instead of always `false`.

On click, if `isLoggedIn` is true (existing gate, unchanged):
1. Optimistically flip local `saved` state.
2. Call `saveListing(listingId, window.location.pathname)` if now saved, else `unsaveListing(listingId, window.location.pathname)`.
3. If the call throws (a real error, not the `redirect()` control-flow exception — Next's action runtime handles that transparently and navigates the browser), revert the optimistic flip.

If `isLoggedIn` is false, unchanged: redirect to sign-in, no state change, no server call.

### `components/SaveButton.tsx`

Same additions — `initialSaved: boolean` prop (it already has `listingId`), same click behavior as `HeartButton`, same optimistic-flip-then-persist pattern. Button text still reflects `saved` state (`Save` / `Saved ✓`).

---

## Page Wiring

### `app/listings/page.tsx`

After computing `isLoggedIn`, also fetch the real user (if any) and their saved listing IDs in the same `Promise.all`:

```ts
async function getSavedListingIds(): Promise<Set<string>> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new Set()
    const { data } = await supabase.from('saved_listings').select('listing_id').eq('user_id', user.id)
    return new Set((data ?? []).map(r => r.listing_id))
  } catch {
    return new Set()
  }
}
```

Pass `listingId={l.id}` and `initialSaved={savedIds.has(l.id)}` to each `HeartButton` (currently only `isLoggedIn` is passed).

### `app/listings/[id]/page.tsx`

Already fetches `user` in the initial `Promise.all`. Add one more query alongside it (or right after) to check if this listing is already saved:

```ts
let initialSaved = false
if (user) {
  const { data: saved } = await supabase
    .from('saved_listings').select('id').eq('user_id', user.id).eq('listing_id', params.id).maybeSingle()
  initialSaved = !!saved
}
```

Pass `initialSaved={initialSaved}` to `SaveButton` (it already receives `listingId` and `isLoggedIn`).

---

## Dashboard "Saved Books" Tab

### `app/profile/page.tsx`

For the real-user (non-demo) branch, fetch saved listings alongside the existing `listings`/`exchanges` queries:

```ts
const { data: savedRows } = await supabase
  .from('saved_listings').select('listing_id').eq('user_id', user.id)
const savedIds = (savedRows ?? []).map(r => r.listing_id)
let savedListings: any[] = []
if (savedIds.length > 0) {
  const { data: sl } = await supabase
    .from('listings').select('id, title, author, photo_url, condition, price, status').in('id', savedIds)
  savedListings = sl ?? []
}
```

Demo-mode branch: `savedListings = []` (no persistence for demo, per spec).

Pass `savedListings` to `DashboardClient` and `removeSavedListing` as its action prop.

### `app/profile/DashboardClient.tsx`

- Add `savedListings: SavedListing[]` and `removeSavedListing: (formData: FormData) => Promise<void>` to `Props`, with:
  ```ts
  type SavedListing = {
    id: string
    title: string
    author: string
    photo_url?: string | null
    condition: string
    price?: number | null
    status: string
  }
  ```
- Replace the static empty-state block under `{activeTab === 'saved' && ...}` with: if `savedListings.length === 0`, keep the existing empty-state message; otherwise render a list matching the "My Listings" row style — thumbnail, title (`Link` to `/listings/{id}`), author, condition, and a "💔 Unsave" button:
  ```tsx
  <form action={removeSavedListing}>
    <input type="hidden" name="listing_id" value={l.id} />
    <button className="font-extrabold text-[11px] hover:opacity-80"
      style={{ background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer', padding: 0 }}>
      💔 Unsave
    </button>
  </form>
  ```

---

## Out of Scope

- Demo-mode persistence (redirects to real sign-in instead, per the decision above).
- "Recently unsaved" undo affordance.
- Any notification when a saved listing sells or is removed by its owner.
- Showing save counts to sellers.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | Add `saved_listings` table + RLS (handed to user as SQL to run in Supabase) |
| `lib/actions/savedListings.ts` | New file — `saveListing`, `unsaveListing`, `removeSavedListing` |
| `components/HeartButton.tsx` | Add `listingId`, `initialSaved` props; persist on click |
| `components/SaveButton.tsx` | Add `initialSaved` prop; persist on click |
| `app/listings/page.tsx` | Fetch saved listing IDs for current user; pass to `HeartButton` |
| `app/listings/[id]/page.tsx` | Fetch saved status for this listing; pass to `SaveButton` |
| `app/profile/page.tsx` | Fetch saved listings for Dashboard; pass to `DashboardClient` |
| `app/profile/DashboardClient.tsx` | Render Saved Books list with Unsave button |
