# Edit Listing

**Date:** 2026-07-13
**Status:** Approved

## Overview

The My Listings tab (`DashboardClient.tsx`) currently lets a lister Mark Sold / Re-list or Delete a listing, but has no way to edit its details. This adds an "Edit" action next to those, opening a new `/listings/[id]/edit` page that reuses the existing `PostForm` UI pre-filled with the listing's current values, saving through a new `updateListing` server action.

Scope: full form parity with posting a new book (title, author, format, genre, condition, description, pickup spot, and all 3 photo slots). Only the listing's owner can access the edit page or save changes. On save, the user returns to `/profile?tab=listings`.

---

## Route: `app/listings/[id]/edit/page.tsx` (new)

Server component, modeled on `app/post/page.tsx`:

- `createClient()`, `supabase.auth.getUser()` — if no user, `redirect('/auth/signin?redirect=/listings/[id]/edit')`.
- Fetch the listing: `supabase.from('listings').select('*').eq('id', params.id).single()`.
- If no listing, `notFound()`.
- If `listing.user_id !== user.id`, redirect to `/listings/${params.id}` (not their listing — send them to the public detail page instead of erroring).
- Render `<PostForm initialValues={...} action={updateListing.bind(null, listing.id)} error={...} />` (see below for `initialValues` shape and the `bind` rationale).

---

## `PostForm` Changes (`app/post/PostForm.tsx`)

Add an optional prop:

```ts
initialValues?: {
  title: string
  author: string
  condition: string
  genre: string
  format: string
  description: string | null
  pickup_description: string | null
  photo_url: string | null
  photo_url_2: string | null
  photo_url_3: string | null
}
submitLabel?: string // defaults to "Post My Book →"
```

- All `useState` initializers read from `initialValues` when present (`useState(initialValues?.title ?? '')`, etc.) instead of hardcoded defaults.
- `photoPreview`/`photo2Preview`/`photo3Preview` initialize from `initialValues?.photo_url` etc., so existing photos render as previews (with the existing "📸 Change" overlay) instead of the empty upload prompt.
- Submit button text uses `submitLabel ?? 'Post My Book →'`.
- No other behavioral change — validation, genre/format pickers, description counter, etc. all work identically for both modes.

`app/post/page.tsx`'s existing call site is unaffected (no `initialValues`, default label).

---

## Server Action: `updateListing` (`app/post/actions.ts`)

```ts
export async function updateListing(listingId: string, formData: FormData) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const { data: existing } = await supabase
    .from('listings').select('photo_url, photo_url_2, photo_url_3')
    .eq('id', listingId).eq('user_id', user.id).single()
  if (!existing) redirect('/profile')

  const [photo_url, photo_url_2, photo_url_3] = await Promise.all([
    uploadPhoto(supabase, user.id, formData, 'photo', 1),
    uploadPhoto(supabase, user.id, formData, 'photo_2', 2),
    uploadPhoto(supabase, user.id, formData, 'photo_3', 3),
  ])

  const priceRaw = formData.get('price') as string
  const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null

  const { error } = await supabase.from('listings').update({
    title:       formData.get('title')       as string,
    author:      formData.get('author')      as string,
    condition:   formData.get('condition')   as string,
    price,
    description: ((formData.get('description') as string) || '').slice(0, DESCRIPTION_MAX_LENGTH) || null,
    genre:       (formData.get('genre')       as string) || null,
    format:      (formData.get('format')      as string) || null,
    photo_url:   photo_url   ?? existing.photo_url,
    photo_url_2: photo_url_2 ?? existing.photo_url_2,
    photo_url_3: photo_url_3 ?? existing.photo_url_3,
    pickup_description: (formData.get('pickup_description') as string) || null,
  }).eq('id', listingId).eq('user_id', user.id)

  if (error) redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(error.message)}`)
  redirect('/profile?tab=listings')
}
```

Key points:
- `uploadPhoto` is already generic (takes `supabase`, `userId`, `formData`, field name, slot) — reused as-is, no changes needed to it.
- Because `uploadPhoto` returns `null` when no new file was chosen, falling back to `existing.photo_url*` prevents clearing a photo the user didn't touch. A user can't remove a photo outright in this pass (out of scope — see below).
- Ownership is enforced twice: the `existing` lookup is scoped to `user_id`, and the final `update` is scoped to `user_id` again (defense in depth, consistent with `updateListingStatus`'s existing pattern).
- `listingId` arrives via `.bind(null, listing.id)` on the page (server actions support bound leading args), so `PostForm` doesn't need any changes to how it calls `action`.

---

## `DashboardClient.tsx` Changes

In the My Listings row's action group (next to Mark Sold/Re-list and Delete), add:

```tsx
<Link href={`/listings/${l.id}/edit`}
  className="font-extrabold text-[11px] hover:opacity-80"
  style={{ color: '#888' }}>
  Edit
</Link>
```

Placed first in the group (Edit, then Mark Sold/Re-list, then Delete), matching left-to-right "safe → destructive" ordering already used elsewhere in the dashboard.

---

## Error Handling

- Not logged in → redirect to sign-in (both the edit page and the action).
- Listing doesn't exist → `notFound()`.
- Listing exists but isn't yours → redirect to the public listing page (mirrors how a non-owner would normally land there).
- Update fails (DB error) → redirect back to the edit page with `?error=`, rendered by the same `error` prop `PostForm` already supports.

## Out of Scope

- Removing/clearing an already-uploaded photo (can only be replaced, not deleted, in this pass).
- Editing a sold/inactive listing is still allowed (no status-based restriction) — Mark Sold and Edit are independent actions.
- No changes to `year`, `isbn`, or `language` fields — these already exist in `PostForm` but aren't persisted by `createListing` today either; that gap is untouched here.

## Files Changed

| File | Change |
|---|---|
| `app/listings/[id]/edit/page.tsx` *(new)* | Fetch listing, enforce auth/ownership, render `PostForm` pre-filled with `initialValues` and `updateListing` bound to the listing id |
| `app/post/PostForm.tsx` | Add optional `initialValues` and `submitLabel` props; state initializers and photo previews read from them when present |
| `app/post/actions.ts` | Add `updateListing(listingId, formData)` server action |
| `app/profile/DashboardClient.tsx` | Add "Edit" link in the My Listings row, next to Mark Sold/Re-list and Delete |
