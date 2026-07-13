# Multi-Photo Listings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A listing supports up to 3 photos (cover + 2 more), uploaded via three labeled slots on the Post a Book form, and browsable on the listing detail page via clickable thumbnails that swap the main image.

**Architecture:** `listings` gains two nullable columns (`photo_url_2`, `photo_url_3`) alongside the existing `photo_url`. The post form's single upload box becomes a reusable `PhotoUploadSlot` rendered three times; the server action uploads up to three files to the existing `book-photos` storage bucket. The listing detail page's inline hero `<Image>` is replaced by a new `PhotoGallery` client component that owns the main image box (including today's `HeartButton`/price-badge overlay, passed in as children) plus a conditional thumbnail strip below it.

**Tech Stack:** Next.js 14 App Router, React 18, Supabase (`@supabase/ssr`, Storage).

## Global Constraints

- All three photo slots stay optional — no `required` attribute, matching today's single-photo behavior. `createListing` already handles a missing file gracefully; extend that, don't change it.
- Storage upload path convention stays `${user.id}/${Date.now()}-N.${ext}` (the existing `${user.id}/${Date.now()}.${ext}` pattern plus a per-slot suffix `-1`/`-2`/`-3` so three files uploaded in the same request never collide).
- The `listings.photo_url_2` / `photo_url_3` migration must be added to `supabase/schema.sql` as a new idempotent block, but **run manually by the user in the Supabase SQL Editor** — no application code can run DDL against the live project. Task 2's manual verification is scoped accordingly (see that task).
- No changes to `components/BookCard.tsx`, `app/listings/page.tsx` (browse grid), Dashboard "My Listings" thumbnails, or `lib/mock-data.ts` — they continue to show only `photo_url` (the cover). Out of scope per spec.
- No edit-listing flow — photos are set only at posting time, matching every other listing field today. Out of scope per spec.
- This codebase has no existing test coverage for large form/page components like `PostForm.tsx` or `app/listings/[id]/page.tsx` (no `PostForm.test.tsx`, no `page.test.tsx` anywhere in the repo) — follow that established precedent: verify these tasks via `npm run build` / `npx tsc --noEmit` plus manual browser verification, not new unit tests.

---

## File Structure

- Modify `app/post/PostForm.tsx` — add a `PhotoUploadSlot` sub-component; replace the single upload box with three (Cover Photo large, Photo 2 / Photo 3 small, side-by-side).
- Modify `app/post/actions.ts` — add an `uploadPhoto` helper; upload up to 3 files instead of 1; insert `photo_url_2` / `photo_url_3`.
- Modify `supabase/schema.sql` — add the idempotent migration block for the two new columns.
- Create `app/listings/[id]/PhotoGallery.tsx` — client component: main image (with `HeartButton`/badge passed as children) + conditional thumbnail strip.
- Modify `app/listings/[id]/page.tsx` — replace the inline hero `<Image>` block with `<PhotoGallery>`; drop the now-unused `Image` import.

---

### Task 1: Three photo upload slots on the post form

**Files:**
- Modify: `app/post/PostForm.tsx`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: form fields named `photo`, `photo_2`, `photo_3` (each an optional `<input type="file">`) submitted in the same `<form action={action}>` — Task 2's `createListing` reads these three field names from `FormData`.

- [ ] **Step 1: Add a `PhotoUploadSlot` component**

In `app/post/PostForm.tsx`, find:

```tsx
function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label
      className="block mb-1.5"
      style={{ fontSize: 12, fontWeight: 900, color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px' }}
    >
      {children}
      {optional && <span style={{ color: '#bbb', fontWeight: 600, fontSize: 11, textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>(optional)</span>}
    </label>
  )
}
```

Replace with (adds the new component directly after `FieldLabel`):

```tsx
function FieldLabel({ children, optional }: { children: React.ReactNode; optional?: boolean }) {
  return (
    <label
      className="block mb-1.5"
      style={{ fontSize: 12, fontWeight: 900, color: '#444', textTransform: 'uppercase', letterSpacing: '0.5px' }}
    >
      {children}
      {optional && <span style={{ color: '#bbb', fontWeight: 600, fontSize: 11, textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>(optional)</span>}
    </label>
  )
}

function PhotoUploadSlot({
  name, label, preview, onChange, size,
}: {
  name: string
  label: string
  preview: string | null
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  size: 'large' | 'small'
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      style={{
        border: `2.5px dashed ${preview ? '#0d9488' : '#fed7aa'}`,
        borderRadius: 14,
        padding: preview ? 0 : (size === 'large' ? 28 : 16),
        textAlign: 'center',
        cursor: 'pointer',
        background: preview ? '#000' : '#fffbf0',
        position: 'relative',
        overflow: 'hidden',
        minHeight: preview ? (size === 'large' ? 180 : 100) : undefined,
      }}
      onClick={() => inputRef.current?.click()}
    >
      {preview ? (
        <>
          <img
            src={preview}
            alt={`${label} preview`}
            style={{ width: '100%', maxHeight: size === 'large' ? 260 : 140, objectFit: 'contain', display: 'block' }}
          />
          <div style={{
            position: 'absolute', bottom: 8, right: 8,
            background: 'rgba(0,0,0,0.6)', color: '#fff',
            padding: '4px 10px', borderRadius: 999,
            fontSize: 11, fontWeight: 700,
          }}>
            📸 Change
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: size === 'large' ? 36 : 22, marginBottom: 8 }}>📸</div>
          <p className="text-[14px] font-bold" style={{ color: '#aaa' }}>
            <span style={{ color: '#f97316', fontWeight: 800 }}>Click to upload</span> {label}
          </p>
          {size === 'large' && (
            <p className="text-[12px] font-semibold mt-1.5" style={{ color: '#aaa' }}>JPG or PNG · Max 5MB</p>
          )}
        </>
      )}
      <input
        ref={inputRef}
        name={name}
        type="file"
        accept="image/*"
        onChange={onChange}
        className="absolute inset-0 opacity-0 cursor-pointer"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Replace the single preview state with three, and add a shared change-handler factory**

Find:

```tsx
  const [description, setDescription] = useState('')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) { setPhotoPreview(null); return }
    const url = URL.createObjectURL(file)
    setPhotoPreview(url)
  }
```

Replace with:

```tsx
  const [description, setDescription] = useState('')
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photo2Preview, setPhoto2Preview] = useState<string | null>(null)
  const [photo3Preview, setPhoto3Preview] = useState<string | null>(null)

  function makePhotoHandler(setPreview: (url: string | null) => void) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) { setPreview(null); return }
      setPreview(URL.createObjectURL(file))
    }
  }
```

- [ ] **Step 3: Replace the single photo box with three slots**

Find:

```tsx
        {/* Photo */}
        <SectionHeading emoji="📸" title="Photo" />

        <div
          style={{
            border: `2.5px dashed ${photoPreview ? '#0d9488' : '#fed7aa'}`,
            borderRadius: 14,
            padding: photoPreview ? 0 : 28,
            textAlign: 'center',
            cursor: 'pointer',
            background: photoPreview ? '#000' : '#fffbf0',
            marginBottom: 16,
            position: 'relative',
            overflow: 'hidden',
            minHeight: photoPreview ? 180 : undefined,
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {photoPreview ? (
            <>
              <img
                src={photoPreview}
                alt="Book preview"
                style={{ width: '100%', maxHeight: 260, objectFit: 'contain', display: 'block' }}
              />
              <div style={{
                position: 'absolute', bottom: 8, right: 8,
                background: 'rgba(0,0,0,0.6)', color: '#fff',
                padding: '4px 10px', borderRadius: 999,
                fontSize: 11, fontWeight: 700,
              }}>
                📸 Change photo
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📸</div>
              <p className="text-[14px] font-bold" style={{ color: '#aaa' }}>
                <span style={{ color: '#f97316', fontWeight: 800 }}>Click to upload</span> a photo of your book
              </p>
              <p className="text-[12px] font-semibold mt-1.5" style={{ color: '#aaa' }}>JPG or PNG · Max 5MB</p>
            </>
          )}
          <input
            ref={fileInputRef}
            name="photo"
            type="file"
            accept="image/*"
            onChange={handlePhotoChange}
            className="absolute inset-0 opacity-0 cursor-pointer"
            style={{ width: '100%', height: '100%' }}
          />
        </div>
```

Replace with:

```tsx
        {/* Photo */}
        <SectionHeading emoji="📸" title="Photo" />

        <div style={{ marginBottom: 12 }}>
          <PhotoUploadSlot
            name="photo"
            label="a cover photo of your book"
            preview={photoPreview}
            onChange={makePhotoHandler(setPhotoPreview)}
            size="large"
          />
        </div>

        <div className="grid grid-cols-2 gap-3" style={{ marginBottom: 16 }}>
          <PhotoUploadSlot
            name="photo_2"
            label="Photo 2"
            preview={photo2Preview}
            onChange={makePhotoHandler(setPhoto2Preview)}
            size="small"
          />
          <PhotoUploadSlot
            name="photo_3"
            label="Photo 3"
            preview={photo3Preview}
            onChange={makePhotoHandler(setPhoto3Preview)}
            size="small"
          />
        </div>
```

- [ ] **Step 4: Verify the app builds**

Run: `npm run build`
Expected: build succeeds with no new errors (this repo has 2 pre-existing unrelated `TS2802` errors in `app/profile/page.tsx` — confirm those are the only ones via `npx tsc --noEmit` too).

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev`, then in a browser (signed in via demo mode — set the `lbe_demo_user` cookie or sign in with any credentials):
1. Visit `/post`. Expected: one large "Cover Photo" upload box, then a row of two smaller boxes labeled "Photo 2" and "Photo 3" below it.
2. Click the cover box, choose an image file. Expected: preview appears in the box, "📸 Change" overlay shown, same as today's single-photo behavior.
3. Click "Photo 2", choose a different image file. Expected: preview appears in that smaller box independently of the cover.
4. Click "Photo 3", choose a third image file. Expected: same, independent preview.
5. Confirm you can leave Photo 2 and/or Photo 3 empty and the form doesn't block submission (they're optional).

- [ ] **Step 6: Commit**

```bash
git add app/post/PostForm.tsx
git commit -m "feat: add Photo 2 and Photo 3 upload slots to the post form"
```

---

### Task 2: Upload and persist up to 3 photos

**Files:**
- Modify: `app/post/actions.ts`
- Modify: `supabase/schema.sql`

**Interfaces:**
- Consumes: form fields `photo`, `photo_2`, `photo_3` from Task 1.
- Produces: `listings` rows with `photo_url`, `photo_url_2`, `photo_url_3` populated (each nullable). Task 3 reads all three columns from the listing detail page's existing `select('*', ...)` fetch.

- [ ] **Step 1: Add the schema migration block**

In `supabase/schema.sql`, find the end of the "address privacy toggles" migration block:

```sql
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS pickup_description text;
-- ──────────────────────────────────────────────────────────────────────────────
```

Replace with (adds a new migration block right after it):

```sql
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS pickup_description text;
-- ──────────────────────────────────────────────────────────────────────────────

-- ── Migration: multi-photo listings ───────────────────────────────────────────
-- Run this block in Supabase SQL Editor:
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS photo_url_2 text,
  ADD COLUMN IF NOT EXISTS photo_url_3 text;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Add an `uploadPhoto` helper and upload all three slots**

In `app/post/actions.ts`, find:

```tsx
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const DESCRIPTION_MAX_LENGTH = 500

export async function createListing(formData: FormData) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin')

    const { data: prof } = await supabase.from('profiles').select('city').eq('id', user!.id).single()

    let photo_url: string | null = null
    const file = formData.get('photo') as File
    console.log('Photo file:', file?.name, 'size:', file?.size, 'type:', file?.type)
    if (file && file.size > 0) {
      const ext = file.name.split('.').pop()
      const path = `${user!.id}/${Date.now()}.${ext}`
      const { data: upload, error: uploadError } = await supabase.storage.from('book-photos').upload(path, file)
      console.log('Upload result:', upload, 'error:', uploadError)
      if (upload) {
        const { data: { publicUrl } } = supabase.storage.from('book-photos').getPublicUrl(path)
        photo_url = publicUrl
      }
    }

    const priceRaw = formData.get('price') as string
    const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null

    const { data: listing, error } = await supabase.from('listings').insert({
      user_id: user!.id,
      title:       formData.get('title')       as string,
      author:      formData.get('author')      as string,
      condition:   formData.get('condition')   as string,
      price,
      description: ((formData.get('description') as string) || '').slice(0, DESCRIPTION_MAX_LENGTH) || null,
      genre:       (formData.get('genre')       as string) || null,
      format:      (formData.get('format')      as string) || null,
      photo_url,
      city: prof?.city ?? '',
      pickup_description: (formData.get('pickup_description') as string) || null,
    }).select('id').single()
```

Replace with:

```tsx
'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

const DESCRIPTION_MAX_LENGTH = 500

async function uploadPhoto(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  formData: FormData,
  fieldName: string,
  slot: number,
): Promise<string | null> {
  const file = formData.get(fieldName) as File
  if (!file || file.size === 0) return null
  const ext = file.name.split('.').pop()
  const path = `${userId}/${Date.now()}-${slot}.${ext}`
  const { data: upload, error: uploadError } = await supabase.storage.from('book-photos').upload(path, file)
  if (uploadError) { console.error(`Upload error (${fieldName}):`, uploadError); return null }
  if (!upload) return null
  const { data: { publicUrl } } = supabase.storage.from('book-photos').getPublicUrl(path)
  return publicUrl
}

export async function createListing(formData: FormData) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin')

    const { data: prof } = await supabase.from('profiles').select('city').eq('id', user!.id).single()

    const [photo_url, photo_url_2, photo_url_3] = await Promise.all([
      uploadPhoto(supabase, user!.id, formData, 'photo', 1),
      uploadPhoto(supabase, user!.id, formData, 'photo_2', 2),
      uploadPhoto(supabase, user!.id, formData, 'photo_3', 3),
    ])

    const priceRaw = formData.get('price') as string
    const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null

    const { data: listing, error } = await supabase.from('listings').insert({
      user_id: user!.id,
      title:       formData.get('title')       as string,
      author:      formData.get('author')      as string,
      condition:   formData.get('condition')   as string,
      price,
      description: ((formData.get('description') as string) || '').slice(0, DESCRIPTION_MAX_LENGTH) || null,
      genre:       (formData.get('genre')       as string) || null,
      format:      (formData.get('format')      as string) || null,
      photo_url,
      photo_url_2,
      photo_url_3,
      city: prof?.city ?? '',
      pickup_description: (formData.get('pickup_description') as string) || null,
    }).select('id').single()
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: build succeeds. Run `npx tsc --noEmit` too — expect only the same 2 pre-existing unrelated errors in `app/profile/page.tsx`, nothing new in `app/post/actions.ts`.

- [ ] **Step 4: Manually verify what's verifiable now**

The `photo_url_2` / `photo_url_3` columns do not exist on the live Supabase database until the SQL from Step 1 is run there manually (same situation as the still-pending "address privacy toggles" migration). Until then, inserting those two fields will make the whole `.insert()` call fail with a "column does not exist" error, breaking listing creation entirely — so verify in this order:

1. Run `npm run dev`, sign in (demo mode), go to `/post`, fill in the required fields, upload only a cover photo (leave Photo 2 / Photo 3 empty), submit.
   - **If you have NOT yet run the Step 1 SQL against your live Supabase project:** expect this to fail with a `column "photo_url_2" of relation "listings" does not exist` error (visible on the `/post?error=...` redirect). This confirms the code is correctly attempting to write the new columns — it is expected to fail until the migration runs, not a bug in this task.
   - **If you HAVE already run the Step 1 SQL:** expect success — redirected to the new listing's detail page, cover photo displayed exactly as before.
2. If you ran the migration: repeat the post flow uploading all 3 photos. Expected: listing created successfully; note the listing's `id` for Task 3's manual verification.

- [ ] **Step 5: Commit**

```bash
git add app/post/actions.ts supabase/schema.sql
git commit -m "feat: upload and persist up to 3 listing photos"
```

---

### Task 3: Photo gallery on the listing detail page

**Files:**
- Create: `app/listings/[id]/PhotoGallery.tsx`
- Modify: `app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: `listing.photo_url` / `photo_url_2` / `photo_url_3` from Task 2's schema (already available via the page's existing `select('*', ...)` fetch — no query change needed).
- Produces: nothing consumed by later tasks (final task).

```ts
export default function PhotoGallery(props: {
  photos: string[]      // non-null photo URLs, cover first
  alt: string
  gradient: string
  children?: React.ReactNode   // rendered inside the main image box (HeartButton + price badge)
}): JSX.Element
```

- [ ] **Step 1: Create `PhotoGallery.tsx`**

Create `app/listings/[id]/PhotoGallery.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Image from 'next/image'

export default function PhotoGallery({
  photos, alt, gradient, children,
}: {
  photos: string[]
  alt: string
  gradient: string
  children?: React.ReactNode
}) {
  const [activeIndex, setActiveIndex] = useState(0)
  const active = photos[activeIndex] ?? null

  return (
    <>
      <div
        className="relative flex items-center justify-center text-[100px]"
        style={{ height: 280, background: gradient }}
      >
        {active ? (
          <Image src={active} alt={alt} fill className="object-contain" />
        ) : (
          <span>📚</span>
        )}
        {children}
      </div>

      {photos.length > 1 && (
        <div className="flex gap-2 px-5 py-3" style={{ background: '#fff', borderBottom: '2px solid #f3f4f6' }}>
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setActiveIndex(i)}
              className="relative shrink-0 overflow-hidden"
              style={{
                width: 56, height: 56, borderRadius: 10,
                border: i === activeIndex ? '2.5px solid #f97316' : '2.5px solid #e5e7eb',
                cursor: 'pointer', padding: 0, background: '#fff',
              }}
            >
              <Image src={url} alt={`${alt} photo ${i + 1}`} fill className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Wire it into the listing detail page**

In `app/listings/[id]/page.tsx`, find the import block:

```tsx
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Image from 'next/image'
import Link from 'next/link'
import HeartButton from '@/components/HeartButton'
import { MOCK_LISTINGS, MOCK_CONVERSATIONS, MOCK_USER_ID } from '@/lib/mock-data'
```

Replace with (drops the now-unused `Image` import, adds `PhotoGallery`):

```tsx
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import Link from 'next/link'
import HeartButton from '@/components/HeartButton'
import PhotoGallery from './PhotoGallery'
import { MOCK_LISTINGS, MOCK_CONVERSATIONS, MOCK_USER_ID } from '@/lib/mock-data'
```

Then find the Cover block:

```tsx
      <div className="bg-white rounded-[28px] overflow-hidden border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        {/* Cover */}
        <div
          className="relative flex items-center justify-center text-[100px]"
          style={{ height: 280, background: gradient }}
        >
          {listing.photo_url ? (
            <Image src={listing.photo_url} alt={listing.title} fill className="object-contain" />
          ) : (
            <span>📚</span>
          )}
          {!isOwner && (
            <HeartButton listingId={listing.id} isLoggedIn={isLoggedIn} initialSaved={initialSaved} />
          )}
          <span
            className="absolute top-5 right-5 px-5 py-2 rounded-full text-base font-black"
            style={{
              background: '#f97316',
              color: '#fff',
            }}
          >
            1 credit
          </span>
        </div>
```

Replace with:

```tsx
      <div className="bg-white rounded-[28px] overflow-hidden border-2 border-gray-100 shadow-[0_8px_0_#e5e7eb]">
        {/* Cover */}
        <PhotoGallery
          photos={[listing.photo_url, listing.photo_url_2, listing.photo_url_3].filter(Boolean)}
          alt={listing.title}
          gradient={gradient}
        >
          {!isOwner && (
            <HeartButton listingId={listing.id} isLoggedIn={isLoggedIn} initialSaved={initialSaved} />
          )}
          <span
            className="absolute top-5 right-5 px-5 py-2 rounded-full text-base font-black"
            style={{
              background: '#f97316',
              color: '#fff',
            }}
          >
            1 credit
          </span>
        </PhotoGallery>
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build`
Expected: build succeeds. Run `npx tsc --noEmit` — expect only the same 2 pre-existing unrelated errors, nothing new.

- [ ] **Step 4: Manually verify in the browser — single photo (regression check)**

Run: `npm run dev`, visit any existing listing that has exactly one photo (every listing in the database today, since the new columns didn't exist before this feature). Expected: renders identically to before this change — one photo, no thumbnail strip, `HeartButton` and "1 credit" badge in their usual positions.

- [ ] **Step 5: Manually verify the multi-photo interaction**

Since no real listing has more than one photo yet (blocked on the Task 2 migration being run + a fresh post with all 3 slots filled), verify the gallery's *interaction logic* directly via a script that opens any listing detail page and simulates a 3-photo array:

```js
// Run with: node verify-gallery.mjs (after `npm run dev`, adjust BASE port if needed)
import { chromium } from 'playwright'
const BASE = 'http://localhost:3001' // check actual dev server port
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 900, height: 800 } })
await context.addCookies([{ name: 'lbe_demo_user', value: 'testuser', domain: 'localhost', path: '/' }])
const page = await context.newPage()
await page.goto(`${BASE}/listings`, { waitUntil: 'networkidle' })
const href = await page.locator('a[href^="/listings/"]').first().getAttribute('href')
await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' })

// Simulate a 3-photo gallery by checking the thumbnail strip appears when given >1 photo.
// Since real data only has 1 photo, this step just confirms Step 4's single-photo case
// renders with NO thumbnail strip (already covered above). To exercise the click-to-swap
// interaction, temporarily edit PhotoGallery's photos prop to a hardcoded 3-item test
// array in a scratch copy, or wait until Task 2's migration is run and a real 3-photo
// listing exists, then repeat this script against that listing's URL and:
//   1. Screenshot before clicking a thumbnail
//   2. Click the second thumbnail
//   3. Screenshot after — confirm the main image changed and the second thumbnail now
//      has the orange active border
await browser.close()
```

If the Task 2 migration has already been run and a real 3-photo listing exists (from Task 2 Step 4.2), skip the scratch-array approach and just point this script at that listing's real URL — click the second and third thumbnails, screenshot after each click, and confirm the main image visibly changes and the active border moves to the clicked thumbnail.

- [ ] **Step 6: Commit**

```bash
git add "app/listings/[id]/PhotoGallery.tsx" "app/listings/[id]/page.tsx"
git commit -m "feat: add clickable photo gallery to the listing detail page"
```

---

## Full Verification Check

- [ ] Run: `npm run test:run` — expect all existing tests still passing (this feature adds no new automated tests, per the Global Constraints precedent).
- [ ] Run: `npm run build` and `npx tsc --noEmit` — expect only the 2 pre-existing unrelated errors in `app/profile/page.tsx`.
- [ ] Confirm with the user whether they've run the Task 2 Step 1 SQL migration yet — if not, remind them it's required for `photo_url_2` / `photo_url_3` to actually persist.
