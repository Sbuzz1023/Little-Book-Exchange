# Multi-Photo Listings

**Date:** 2026-07-12
**Status:** Approved

## Overview

A listing currently supports exactly one photo (`listings.photo_url`), uploaded via a single upload box on the Post a Book form and shown as the sole hero image on the listing detail page. This adds two more optional photo slots per listing — a cover photo (unchanged) plus two additional photos — uploaded via three distinct labeled slots on the post form, and browsable on the listing detail page via a thumbnail strip that swaps the main image on click.

Editing a listing's photos after posting is out of scope — no edit-listing flow exists today for any field, and this doesn't add one. Browse-page cards and Dashboard listing thumbnails continue to show only the cover photo (`photo_url`); the extra photos are only visible on the listing detail page.

---

## Schema Migration

`listings` needs two more nullable columns, matching every other field on that table (flat columns, no arrays, no join table — this codebase's schema has no arrays anywhere, and a fixed cap of 3 doesn't need one).

Add to `supabase/schema.sql` as a new idempotent migration block (following the existing "address privacy toggles" / "TBR list" pattern in that file):

```sql
-- ── Migration: multi-photo listings ───────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS photo_url_2 text,
  ADD COLUMN IF NOT EXISTS photo_url_3 text;
-- ──────────────────────────────────────────────────────────────────────────────
```

**This SQL must be run manually in the Supabase SQL Editor** — same as the still-pending "address privacy toggles" migration from earlier. No application code can run DDL against the live project.

The listing detail page's fetch already does `select('*', ...)` (`app/listings/[id]/page.tsx`), so no query changes are needed there to pick up the new columns once they exist.

---

## Post Form (`app/post/PostForm.tsx`)

Extract the existing single photo-upload box (dashed border, click-to-upload, preview-with-"Change photo"-overlay) into a reusable `PhotoUploadSlot` component parameterized by:
- `name` (form field name: `photo`, `photo_2`, `photo_3`)
- `label` (box copy: "Cover Photo" vs "Photo 2" / "Photo 3")
- `size` (`'large'` for the cover — current dimensions unchanged — vs `'small'` for the other two)

Render three slots under the existing "📸 Photo" section heading:
- Cover Photo: same size/prominence as today's single box.
- Photo 2 and Photo 3: smaller, side-by-side in a two-column row below the cover slot.

All three remain optional, matching today's behavior (no `required` attribute, `createListing` already handles a missing file gracefully). Each slot manages its own local preview state independently (three `useState<string | null>` instances, mirroring the existing `photoPreview` pattern).

---

## Server Action (`app/post/actions.ts`)

`createListing` currently uploads one file (`formData.get('photo')`) to the `book-photos` storage bucket and sets `photo_url`. Extend this to upload up to three files the same way — one upload call per present file (`photo`, `photo_2`, `photo_3`), each getting its own storage path built from the existing `${user.id}/${Date.now()}.${ext}` pattern plus a fixed per-slot suffix so the three paths never collide when uploaded in the same request: `${user.id}/${Date.now()}-1.${ext}` for the cover, `-2` for Photo 2, `-3` for Photo 3. Insert `photo_url`, `photo_url_2`, `photo_url_3` (each `null` if that slot wasn't filled).

---

## Listing Detail Page (`app/listings/[id]/page.tsx` + new `app/listings/[id]/PhotoGallery.tsx`)

The detail page (a server component) currently renders the hero image directly:
```tsx
<Image src={listing.photo_url} alt={listing.title} fill className="object-contain" />
```

Replace this with a new client component `PhotoGallery`, since swapping the displayed photo needs interactive state the page itself doesn't have:

```tsx
<PhotoGallery photos={[listing.photo_url, listing.photo_url_2, listing.photo_url_3].filter(Boolean)} alt={listing.title} />
```

`PhotoGallery` renders:
- The main photo box, same size/position/`object-contain` styling as today's hero image, showing whichever photo is currently selected (starts at index 0 — the cover).
- If `photos.length > 1`: a row of small clickable thumbnails below the main box (using the same `object-cover` thumbnail treatment as the rest of the app's grids). Clicking a thumbnail sets it as the main image. The currently-selected thumbnail gets a visible highlight (border/ring) so it's clear which photo is showing.
- If `photos.length <= 1`: renders exactly as today — just the main box, no thumbnail row. This covers every existing listing (all of which have at most a cover photo today) and any future listing posted with only a cover photo.
- If `photos.length === 0`: the existing 📚 placeholder emoji, unchanged.

---

## Out of Scope

- No edit-listing flow — photos can only be set at posting time, matching every other listing field today.
- No reordering/deleting individual photos after posting.
- Browse-page cards (`components/BookCard.tsx`), the `/listings` grid, and Dashboard "My Listings" thumbnails — unchanged, continue to show only `photo_url` (the cover).
- No change to file-size/type validation (still client-side copy only: "JPG or PNG · Max 5MB", no enforcement change).
- No change to demo-mode mock data (`lib/mock-data.ts`) — mock listings keep a single `photo_url`; the gallery gracefully renders as single-photo for them.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | Add idempotent migration block for `listings.photo_url_2` / `photo_url_3` (must be run manually against the live project) |
| `app/post/PostForm.tsx` | Extract `PhotoUploadSlot` component; render Cover Photo (large) + Photo 2 / Photo 3 (small, side-by-side) |
| `app/post/actions.ts` | Upload up to 3 files instead of 1; insert `photo_url_2` / `photo_url_3` |
| `app/listings/[id]/PhotoGallery.tsx` *(new)* | Client component: main photo + conditional thumbnail strip, click-to-swap |
| `app/listings/[id]/page.tsx` | Replace inline hero `<Image>` with `<PhotoGallery>`, passing the non-null photo URLs |
