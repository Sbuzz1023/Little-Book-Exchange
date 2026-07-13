# Edit Listing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a listing's owner edit its details from an "Edit" link in My Listings, reusing the existing post form pre-filled with current values.

**Architecture:** Extract the shared field-parsing logic from `createListing` into a pure, testable `parseListingForm` helper. Add a new `updateListing` server action that reuses it plus photo-fallback logic. Extend `PostForm` with optional `initialValues`/`submitLabel` props so it drives both posting and editing. New route `app/listings/[id]/edit/page.tsx` fetches the listing, enforces ownership, and renders the form. A new "Edit" link in the dashboard's My Listings row points there.

**Tech Stack:** Next.js 14 App Router (Server Components + Server Actions), Supabase (`@supabase/ssr`), Vitest + React Testing Library.

## Global Constraints

- Full form parity: title, author, format, genre, condition, description, pickup spot, and all 3 photo slots must all be editable.
- Only the listing's owner may view or save the edit page — enforced both in the page (redirect non-owners) and in the server action (`.eq('user_id', user.id)` on the update).
- A photo slot that receives no new upload during an edit must keep its existing URL, never be nulled out.
- On successful save, redirect to `/profile?tab=listings`.
- Removing/clearing an already-uploaded photo is out of scope — only replacement is supported.
- No changes to `year`, `isbn`, or `language` fields (already unpersisted today; untouched by this work).

---

### Task 1: Extract `parseListingForm` and refactor `createListing` to use it

**Files:**
- Create: `lib/parseListingForm.ts`
- Test: `lib/parseListingForm.test.ts`
- Modify: `app/post/actions.ts:1-68`

**Interfaces:**
- Produces: `parseListingForm(formData: FormData): ParsedListingForm` where
  ```ts
  type ParsedListingForm = {
    title: string
    author: string
    condition: string
    price: number | null
    description: string | null
    genre: string | null
    format: string | null
    pickup_description: string | null
  }
  ```
  Later tasks (`updateListing` in Task 2) call this directly.

- [ ] **Step 1: Write the failing test**

Create `lib/parseListingForm.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseListingForm } from './parseListingForm'

function makeFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return fd
}

describe('parseListingForm', () => {
  it('parses required fields', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1' })
    const result = parseListingForm(fd)
    expect(result.title).toBe('Dune')
    expect(result.author).toBe('Frank Herbert')
    expect(result.condition).toBe('Good')
    expect(result.price).toBe(1)
  })

  it('defaults price to null when blank', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '' })
    expect(parseListingForm(fd).price).toBeNull()
  })

  it('truncates description to 500 chars', () => {
    const long = 'x'.repeat(600)
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1', description: long })
    expect(parseListingForm(fd).description?.length).toBe(500)
  })

  it('defaults description to null when blank', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1', description: '' })
    expect(parseListingForm(fd).description).toBeNull()
  })

  it('defaults genre, format, pickup_description to null when absent', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1' })
    const result = parseListingForm(fd)
    expect(result.genre).toBeNull()
    expect(result.format).toBeNull()
    expect(result.pickup_description).toBeNull()
  })

  it('passes through genre, format, pickup_description when present', () => {
    const fd = makeFormData({
      title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1',
      genre: 'Sci-Fi', format: 'Hardcover', pickup_description: 'side gate',
    })
    const result = parseListingForm(fd)
    expect(result.genre).toBe('Sci-Fi')
    expect(result.format).toBe('Hardcover')
    expect(result.pickup_description).toBe('side gate')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/parseListingForm.test.ts`
Expected: FAIL — `Failed to resolve import "./parseListingForm"` (module doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/parseListingForm.ts`:

```ts
const DESCRIPTION_MAX_LENGTH = 500

export type ParsedListingForm = {
  title: string
  author: string
  condition: string
  price: number | null
  description: string | null
  genre: string | null
  format: string | null
  pickup_description: string | null
}

export function parseListingForm(formData: FormData): ParsedListingForm {
  const priceRaw = formData.get('price') as string
  const price = priceRaw && priceRaw.trim() !== '' ? parseFloat(priceRaw) : null
  return {
    title:       formData.get('title')       as string,
    author:      formData.get('author')      as string,
    condition:   formData.get('condition')   as string,
    price,
    description: ((formData.get('description') as string) || '').slice(0, DESCRIPTION_MAX_LENGTH) || null,
    genre:       (formData.get('genre')       as string) || null,
    format:      (formData.get('format')      as string) || null,
    pickup_description: (formData.get('pickup_description') as string) || null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/parseListingForm.test.ts`
Expected: PASS — all 6 tests green.

- [ ] **Step 5: Refactor `createListing` to use `parseListingForm`**

In `app/post/actions.ts`, remove the top-level `const DESCRIPTION_MAX_LENGTH = 500` (line 6) and add the import:

```ts
import { parseListingForm } from '@/lib/parseListingForm'
```

Replace this block inside `createListing`:

```ts
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

with:

```ts
    const fields = parseListingForm(formData)

    const { data: listing, error } = await supabase.from('listings').insert({
      user_id: user!.id,
      ...fields,
      photo_url,
      photo_url_2,
      photo_url_3,
      city: prof?.city ?? '',
    }).select('id').single()
```

- [ ] **Step 6: Run the full test suite to confirm no regressions**

Run: `npx vitest run`
Expected: PASS — every existing test file still green, plus the new `parseListingForm.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add lib/parseListingForm.ts lib/parseListingForm.test.ts app/post/actions.ts
git commit -m "refactor: extract parseListingForm from createListing"
```

---

### Task 2: Add `updateListing` server action

**Files:**
- Modify: `app/post/actions.ts`

**Interfaces:**
- Consumes: `parseListingForm(formData: FormData): ParsedListingForm` (Task 1), `uploadPhoto(supabase, userId, formData, fieldName, slot): Promise<string | null>` (already defined at the top of this file).
- Produces: `updateListing(listingId: string, formData: FormData): Promise<void>` — a server action taking a bound leading `listingId` argument, called by the edit page in Task 4 via `.bind(null, listing.id)`.

- [ ] **Step 1: Add the action**

Append to `app/post/actions.ts`:

```ts
export async function updateListing(listingId: string, formData: FormData) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) redirect('/auth/signin')

    const { data: existing } = await supabase
      .from('listings').select('photo_url, photo_url_2, photo_url_3')
      .eq('id', listingId).eq('user_id', user.id).single()
    if (!existing) redirect('/profile?tab=listings')

    const [photo_url, photo_url_2, photo_url_3] = await Promise.all([
      uploadPhoto(supabase, user.id, formData, 'photo', 1),
      uploadPhoto(supabase, user.id, formData, 'photo_2', 2),
      uploadPhoto(supabase, user.id, formData, 'photo_3', 3),
    ])

    const fields = parseListingForm(formData)

    const { error } = await supabase.from('listings').update({
      ...fields,
      photo_url:   photo_url   ?? existing.photo_url,
      photo_url_2: photo_url_2 ?? existing.photo_url_2,
      photo_url_3: photo_url_3 ?? existing.photo_url_3,
    }).eq('id', listingId).eq('user_id', user.id)

    if (error) redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(error.message)}`)
    redirect('/profile?tab=listings')
  } catch (err: any) {
    if (err?.digest?.startsWith('NEXT_REDIRECT')) throw err
    const msg = err?.message || String(err) || 'Unknown error'
    console.error('updateListing error:', err)
    redirect(`/listings/${listingId}/edit?error=${encodeURIComponent(msg)}`)
  }
}
```

This mirrors `createListing`'s existing try/catch-and-redirect-with-error pattern immediately above it in the same file.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by `app/post/actions.ts` (pre-existing unrelated errors in the repo, if any, are not this task's concern — confirm by checking that any reported errors are in files you didn't touch).

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no regressions (this action has no dedicated unit test since it talks to Supabase directly; it's exercised end-to-end in Task 6).

- [ ] **Step 4: Commit**

```bash
git add app/post/actions.ts
git commit -m "feat: add updateListing server action"
```

---

### Task 3: Add `initialValues`/`submitLabel` support to `PostForm`

**Files:**
- Modify: `app/post/PostForm.tsx:22-149`
- Test: `app/post/PostForm.test.tsx` (new)

**Interfaces:**
- Produces: `PostForm` accepts two new optional props:
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
  submitLabel?: string
  ```
  Consumed by the edit page in Task 4.

- [ ] **Step 1: Write the failing test**

Create `app/post/PostForm.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PostForm from './PostForm'

describe('PostForm', () => {
  it('renders empty fields and the default submit label with no initialValues', () => {
    render(<PostForm action={vi.fn()} />)
    expect(screen.getByPlaceholderText('e.g. The Great Gatsby')).toHaveValue('')
    expect(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald')).toHaveValue('')
    expect(screen.getByText('Post My Book →')).toBeInTheDocument()
  })

  it('pre-fills fields from initialValues', () => {
    render(
      <PostForm
        action={vi.fn()}
        initialValues={{
          title: 'Dune',
          author: 'Frank Herbert',
          condition: 'Fair',
          genre: 'Sci-Fi',
          format: 'Hardcover',
          description: 'Great copy',
          pickup_description: 'side gate',
          photo_url: 'https://example.com/photo1.jpg',
          photo_url_2: null,
          photo_url_3: null,
        }}
      />
    )
    expect(screen.getByPlaceholderText('e.g. The Great Gatsby')).toHaveValue('Dune')
    expect(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald')).toHaveValue('Frank Herbert')
    expect(screen.getByPlaceholderText(/Any notes/)).toHaveValue('Great copy')
    expect(screen.getByPlaceholderText(/overrides your profile default/)).toHaveValue('side gate')
    expect(screen.getByDisplayValue('Fair — some wear')).toBeInTheDocument()
    const photo1 = screen.getByAltText('a cover photo of your book preview') as HTMLImageElement
    expect(photo1.src).toBe('https://example.com/photo1.jpg')
  })

  it('uses a custom submit label when provided', () => {
    render(<PostForm action={vi.fn()} submitLabel="Save Changes" />)
    expect(screen.getByText('Save Changes')).toBeInTheDocument()
    expect(screen.queryByText('Post My Book →')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: FAIL on the second test — fields render empty/default because `PostForm` doesn't accept `initialValues` yet (TypeScript prop error and/or assertion failures).

- [ ] **Step 3: Implement `initialValues`/`submitLabel` in `PostForm`**

In `app/post/PostForm.tsx`, change the `Props` type (currently at line 22):

```ts
type Props = {
  city?: string
  action: (formData: FormData) => Promise<void>
  error?: string
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
  submitLabel?: string
}
```

Change the component signature (currently `export default function PostForm({ city, action, error }: Props) {` at line 130):

```ts
export default function PostForm({ city, action, error, initialValues, submitLabel }: Props) {
```

Change the `useState` initializers immediately below it:

```ts
  const [genre, setGenre] = useState(initialValues?.genre ?? 'Fiction')
  const [format, setFormat] = useState(initialValues?.format ?? 'Paperback')
  const [title, setTitle] = useState(initialValues?.title ?? '')
  const [author, setAuthor] = useState(initialValues?.author ?? '')
  const [condition, setCondition] = useState(initialValues?.condition ?? 'Good')
  const [description, setDescription] = useState(initialValues?.description ?? '')
  const [photoPreview, setPhotoPreview] = useState<string | null>(initialValues?.photo_url ?? null)
  const [photo2Preview, setPhoto2Preview] = useState<string | null>(initialValues?.photo_url_2 ?? null)
  const [photo3Preview, setPhoto3Preview] = useState<string | null>(initialValues?.photo_url_3 ?? null)
```

Change the pickup spot `<input>` (currently uncontrolled, no `defaultValue`) to seed from `initialValues`:

```tsx
          <input
            name="pickup_description"
            type="text"
            defaultValue={initialValues?.pickup_description ?? ''}
            placeholder="e.g. front porch, side gate — overrides your profile default"
            style={inputStyle}
          />
```

Change the submit button text (currently the literal string `Post My Book →`):

```tsx
          {submitLabel ?? 'Post My Book →'}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no regressions in other component tests.

- [ ] **Step 6: Commit**

```bash
git add app/post/PostForm.tsx app/post/PostForm.test.tsx
git commit -m "feat: add initialValues/submitLabel props to PostForm"
```

---

### Task 4: Add the edit listing page

**Files:**
- Create: `app/listings/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `PostForm` (Task 3) with its new `initialValues`/`submitLabel` props; `updateListing(listingId, formData)` (Task 2).

- [ ] **Step 1: Create the page**

Create `app/listings/[id]/edit/page.tsx`:

```tsx
import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import PostForm from '@/app/post/PostForm'
import { updateListing } from '@/app/post/actions'

export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { error?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/signin?redirect=/listings/${params.id}/edit`)

  const { data: listing } = await supabase.from('listings').select('*').eq('id', params.id).single()
  if (!listing) notFound()
  if (listing.user_id !== user.id) redirect(`/listings/${params.id}`)

  return (
    <div className="max-w-[600px] mx-auto px-4 py-6 md:px-8 md:py-10">
      <h1 className="font-display text-[30px] text-bk-orange mb-1">Edit Listing</h1>
      <p className="font-bold text-[14px] mb-7" style={{ color: '#aaa' }}>
        Update the details for <strong style={{ color: '#2d2d2d' }}>{listing.title}</strong>
      </p>
      <PostForm
        action={updateListing.bind(null, listing.id)}
        submitLabel="Save Changes"
        error={searchParams.error ? decodeURIComponent(searchParams.error) : undefined}
        initialValues={{
          title: listing.title,
          author: listing.author,
          condition: listing.condition,
          genre: listing.genre ?? 'Fiction',
          format: listing.format ?? 'Paperback',
          description: listing.description,
          pickup_description: listing.pickup_description,
          photo_url: listing.photo_url,
          photo_url_2: listing.photo_url_2,
          photo_url_3: listing.photo_url_3,
        }}
      />
    </div>
  )
}
```

There is no automated test for this file — no other `page.tsx` in the repo has one (they're all thin Server Components wiring auth + a Supabase fetch to a client component). It's verified manually in Task 6.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors from `app/listings/[id]/edit/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "app/listings/[id]/edit/page.tsx"
git commit -m "feat: add edit listing page"
```

---

### Task 5: Add the "Edit" link to My Listings

**Files:**
- Modify: `app/profile/DashboardClient.tsx:253-296`

- [ ] **Step 1: Add the link**

In the My Listings row (inside the `listings.map(l => (...))` block), immediately before the existing `<form action={updateListingStatus} ...>`, add:

```tsx
                  <Link href={`/listings/${l.id}/edit`}
                    className="font-extrabold text-[11px] hover:opacity-80 shrink-0"
                    style={{ color: '#888' }}>
                    Edit
                  </Link>
```

So the row's trailing markup reads Edit link, then the Mark Sold/Re-list + Delete form — left-to-right, safe-to-destructive, matching the existing ordering convention elsewhere in this dashboard. `Link` is already imported at the top of this file (line 4).

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — no regressions (no existing test covers `DashboardClient`, so this just confirms nothing else broke).

- [ ] **Step 3: Commit**

```bash
git add app/profile/DashboardClient.tsx
git commit -m "feat: add Edit link to My Listings"
```

---

### Task 6: Manual end-to-end verification

**No files changed** — this task drives the running app in a browser to confirm the whole feature works together, since server actions and Server Components that talk to real Supabase aren't covered by the unit tests above.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (background/separate terminal)
Expected: `Ready` on `http://localhost:3000` (or the next available port).

- [ ] **Step 2: Verify the owner path**

Sign in as an account that owns at least one listing. Go to `/profile`, My Listings tab. Confirm an "Edit" link now appears next to Mark Sold/Re-list and Delete. Click it — confirm it lands on `/listings/<id>/edit` with every field (title, author, format, genre, condition, description, pickup spot, and photo 1/2/3 previews) pre-filled with that listing's current values, and the submit button reads "Save Changes".

- [ ] **Step 3: Verify a save with no photo changes**

Change the title and description only (leave photos untouched), submit. Confirm you land on `/profile?tab=listings`, the listing's title/description reflect the change, and — open the listing's public detail page — its existing photo(s) are still present (not cleared).

- [ ] **Step 4: Verify a save with a photo change**

Edit the same listing again, replace Photo 1 with a different image, submit. Confirm the public listing page now shows the new photo, and photos 2/3 (if previously set) are unchanged.

- [ ] **Step 5: Verify non-owner access is blocked**

While signed in as a different account, manually navigate to `/listings/<id>/edit` for a listing you don't own. Confirm you're redirected to that listing's public detail page (`/listings/<id>`), not the edit form.

- [ ] **Step 6: Verify signed-out access is blocked**

Sign out, navigate directly to `/listings/<id>/edit` for any listing. Confirm you're redirected to `/auth/signin`.

---

## Self-Review

**Spec coverage:** Route + ownership checks (Task 4), `PostForm` `initialValues`/`submitLabel` (Task 3), `updateListing` action with photo-fallback (Task 2), Edit link placement/ordering (Task 5), redirect-to-listings-tab on save (Task 2/4), error handling for not-logged-in/not-found/not-owner/DB-error (Tasks 2 & 4) — all covered. Out-of-scope items (photo removal, `year`/`isbn`/`language`) are untouched by every task, as intended.

**Placeholders:** None — every step has runnable code and exact commands.

**Type consistency:** `ParsedListingForm`'s field names (`title`, `author`, `condition`, `price`, `description`, `genre`, `format`, `pickup_description`) match what `createListing`'s insert and `updateListing`'s update both spread in. `PostForm`'s `initialValues` shape matches exactly what `EditListingPage` passes in Task 4. `updateListing(listingId, formData)`'s bound-argument signature matches `updateListing.bind(null, listing.id)` in Task 4.
