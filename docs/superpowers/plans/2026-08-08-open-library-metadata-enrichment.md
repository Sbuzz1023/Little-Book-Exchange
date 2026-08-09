# Open Library Metadata Enrichment (Genre & ISBN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user picks a book from Open Library on the Post form's main book field, best-effort pre-select the closest matching Genre category and auto-fill the (currently dead) ISBN field — both fully overridable, neither ever blocking submission.

**Architecture:** Extend the already-shipped Open Library integration (`lib/openLibrary.ts`, `lib/actions/openLibrary.ts`, `BookSearchInput` → `PostForm`) rather than building anything new: fetch Open Library's `subject` field alongside what's already requested, map it to one of the app's existing 12 fixed Genre categories via a priority-ordered keyword list (pure, unit-tested function), and expose the result as a new `genre` field on the existing `BookSuggestion` type. `PostForm`'s `selectBook` handler — which already fills title/author/cover/work-key on selection — gains two more lines. ISBN needs no new plumbing beyond wiring up a field that already exists in the DOM but was never connected to state, form submission, or the database.

**Tech Stack:** Next.js 14 (App Router), Supabase (Postgres), TypeScript, Vitest + React Testing Library.

## Global Constraints

- Schema changes are applied by hand in the Supabase SQL Editor — no local migration tooling. A schema task's "test" is a manual verification query, not an automated assertion.
- No server action (`'use server'` file) in this codebase has a unit test — `lib/actions/openLibrary.ts` stays untested; all new logic goes in the already-tested, non-`'use server'` `lib/openLibrary.ts`.
- Scope is the Post form's **main book field only** — bundle rows, the TBR add form, and the Browse filter are explicitly out of scope and must not be touched.
- Genre auto-select only overwrites the Genre picker when a mapping is actually found (`if (book.genre)`) — an unrecognized subject list must leave whatever the user already had selected untouched, never silently resetting to a default.
- ISBN is always set on selection (including to `''` for a suggestion with none), matching how `author` already behaves — consistent with the existing `selectBook` pattern, not a new one.
- `parseListingForm`'s existing `...fields` spread into `createListing`/`updateListing` already carries any new field it returns into the `listings` insert/update automatically — no `app/post/actions.ts` change is needed for `isbn`, mirroring how `ol_work_key`/`cover_url` needed none in the base feature.
- Every existing test whose expected-value shape changes because of a new field on an existing type (`BookSuggestion.genre`, `ParsedListingForm.isbn`) must have that expected value updated additively — add the new field to the expectation, never weaken or remove an existing assertion.

---

### Task 1: Database migration — `listings.isbn`

**Files:**
- Modify: `supabase/schema.sql` (append new migration block at end of file)

**Interfaces:**
- Produces: `listings.isbn` (text, nullable) — read by Task 3 (PostForm/`parseListingForm`) and Task 4 (listing detail page).

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

```sql

-- ── Migration: listing ISBN ─────────────────────────────────────────────────────
ALTER TABLE listings ADD COLUMN IF NOT EXISTS isbn text;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run the migration**

Paste the block into the Supabase SQL Editor and run it. Expected: no errors.

- [ ] **Step 3: Manually verify the schema landed correctly**

```sql
select column_name from information_schema.columns where table_name = 'listings' and column_name = 'isbn';
```
Expected: 1 row.

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add isbn column to listings"
```

---

### Task 2: Genre mapping and subject fetching

**Files:**
- Modify: `lib/openLibrary.ts`
- Modify: `lib/openLibrary.test.ts`
- Modify: `lib/actions/openLibrary.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `mapSubjectsToGenre(subjects: string[]): string | null` (exported from `lib/openLibrary.ts`) and `BookSuggestion.genre: string | null` (new field on the existing type) — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

Append to `lib/openLibrary.test.ts` (inside or alongside the existing `describe('normalizeSearchResults', ...)` block — add a new top-level `describe` for the mapping function, and extend two existing cases):

```typescript
describe('mapSubjectsToGenre', () => {
  it('maps Children\'s subjects', () => {
    expect(mapSubjectsToGenre(['Juvenile fiction', 'Picture books'])).toBe("Children's")
  })

  it('maps Mystery subjects', () => {
    expect(mapSubjectsToGenre(['Detective and mystery stories'])).toBe('Mystery')
  })

  it('maps Sci-Fi subjects ahead of the generic Fiction match', () => {
    // Real Open Library data for "Children of Dune" includes both "Fiction" and
    // "Science Fiction" — Sci-Fi must win, not the generic Fiction bucket.
    expect(mapSubjectsToGenre(['Fiction', 'Science Fiction', 'American literature'])).toBe('Sci-Fi')
  })

  it('maps Romance subjects', () => {
    expect(mapSubjectsToGenre(['Romance', 'Love stories'])).toBe('Romance')
  })

  it('maps Biography subjects ahead of a co-occurring History subject', () => {
    // Real Open Library data for "Steve Jobs" (Walter Isaacson) includes both
    // "History" and "Biography" — Biography must win regardless of array order.
    expect(mapSubjectsToGenre(['History', 'Biography', 'Businesspeople'])).toBe('Biography')
  })

  it('maps Self-Help subjects', () => {
    expect(mapSubjectsToGenre(['Self-help techniques', 'Personal growth'])).toBe('Self-Help')
  })

  it('maps Cooking subjects', () => {
    expect(mapSubjectsToGenre(['Cooking', 'Cookbooks'])).toBe('Cooking')
  })

  it('maps Art subjects', () => {
    expect(mapSubjectsToGenre(['Art', 'Design'])).toBe('Art')
  })

  it('maps History subjects', () => {
    expect(mapSubjectsToGenre(['History', 'Historical events'])).toBe('History')
  })

  it('maps Non-Fiction subjects', () => {
    expect(mapSubjectsToGenre(['Non-fiction'])).toBe('Non-Fiction')
  })

  it('maps generic Fiction subjects when nothing more specific matches', () => {
    expect(mapSubjectsToGenre(['Fiction', 'American fiction'])).toBe('Fiction')
  })

  it('returns null when no keyword matches', () => {
    expect(mapSubjectsToGenre(['Reading Level-Grade 9', 'Large type books'])).toBeNull()
  })

  it('returns null for an empty subject list', () => {
    expect(mapSubjectsToGenre([])).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(mapSubjectsToGenre(['SCIENCE FICTION'])).toBe('Sci-Fi')
  })
})
```

Update the import line at the top of the file to include the new function:
```typescript
import { normalizeSearchResults, isValidCoverUrl, mapSubjectsToGenre } from './openLibrary'
```

Update the existing `'maps a full Open Library doc to a BookSuggestion'` test — add `subject` to the input doc and `genre` to the expected output:
```typescript
it('maps a full Open Library doc to a BookSuggestion', () => {
  const result = normalizeSearchResults([{
    title: 'Dune',
    author_name: ['Frank Herbert'],
    first_publish_year: 1965,
    isbn: ['9780441013593', '0441013597'],
    cover_i: 12345,
    key: '/works/OL893415W',
    subject: ['Science Fiction'],
  }])
  expect(result).toEqual([{
    title: 'Dune',
    author: 'Frank Herbert',
    year: 1965,
    isbn: '9780441013593',
    coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
    workKey: '/works/OL893415W',
    genre: 'Sci-Fi',
  }])
})
```

Update the existing `'defaults year and isbn to null when missing'` test (this doc has no `subject` field either — add a `genre` assertion):
```typescript
it('defaults year, isbn, and genre to null when missing', () => {
  const result = normalizeSearchResults([{ title: 'Dune', key: '/works/OL1W' }])
  expect(result[0].year).toBeNull()
  expect(result[0].isbn).toBeNull()
  expect(result[0].genre).toBeNull()
})
```
(Rename from `'defaults year and isbn to null when missing'` to `'defaults year, isbn, and genre to null when missing'`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/openLibrary.test.ts`
Expected: FAIL — `mapSubjectsToGenre` is not exported; the two updated `normalizeSearchResults` tests fail on the missing `genre` key.

- [ ] **Step 3: Write the implementation**

Replace `lib/openLibrary.ts` in full:

```typescript
export type BookSuggestion = {
  title: string
  author: string
  year: number | null
  isbn: string | null
  coverUrl: string | null
  workKey: string
  genre: string | null
}

export type OpenLibraryDoc = {
  title?: string
  author_name?: string[]
  first_publish_year?: number
  isbn?: string[]
  cover_i?: number
  key?: string
  subject?: string[]
}

const COVER_URL_PATTERN = /^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-[SML]\.jpg$/

export function isValidCoverUrl(url: string): boolean {
  return COVER_URL_PATTERN.test(url)
}

// Priority-ordered: checked top to bottom, first keyword match wins. Order matters —
// e.g. a book tagged with both "Fiction" and "Science fiction" must resolve to Sci-Fi,
// so Sci-Fi is checked well before the generic Fiction catch-all at the bottom.
const GENRE_KEYWORDS: [string, string[]][] = [
  ["Children's", ['juvenile', "children's stories", 'picture books']],
  ['Mystery', ['mystery', 'detective', 'thriller', 'crime']],
  ['Sci-Fi', ['science fiction', 'fantasy']],
  ['Romance', ['romance', 'love stories']],
  ['Biography', ['biography', 'autobiography']],
  ['Self-Help', ['self-help', 'self help', 'personal growth']],
  ['Cooking', ['cooking', 'cookery', 'cookbooks']],
  ['Art', ['art', 'design', 'photography']],
  ['History', ['history', 'historical']],
  ['Non-Fiction', ['non-fiction', 'nonfiction']],
  ['Fiction', ['fiction']],
]

export function mapSubjectsToGenre(subjects: string[]): string | null {
  const joined = subjects.join(' | ').toLowerCase()
  for (const [genre, keywords] of GENRE_KEYWORDS) {
    if (keywords.some(kw => joined.includes(kw))) return genre
  }
  return null
}

export function normalizeSearchResults(docs: OpenLibraryDoc[]): BookSuggestion[] {
  return docs
    .filter((d): d is OpenLibraryDoc & { title: string; key: string } => !!d.title && !!d.key)
    .map(d => ({
      title: d.title,
      author: d.author_name?.[0] ?? '',
      year: d.first_publish_year ?? null,
      isbn: d.isbn?.[0] ?? null,
      coverUrl: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      workKey: d.key,
      genre: mapSubjectsToGenre(d.subject ?? []),
    }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/openLibrary.test.ts`
Expected: PASS (all previous tests plus the 14 new `mapSubjectsToGenre` cases).

- [ ] **Step 5: Add `subject` to the Open Library query**

In `lib/actions/openLibrary.ts`, change the `fields` list in the query URL:
```typescript
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(trimmed)}&fields=title,author_name,first_publish_year,isbn,cover_i,key,subject&limit=8`
```
(Only the `fields` parameter changes — adds `,subject` before `&limit=8`. No test for this file, per Global Constraints.)

- [ ] **Step 6: Run the full test suite once**

Run: `npx vitest run`
Expected: PASS, no regressions (in particular, no other file constructs a `BookSuggestion` object literal that would now be missing the required `genre` field — the type is only ever produced by `normalizeSearchResults`, so this should be a non-issue, but confirm `tsc --noEmit` shows no new errors too).

- [ ] **Step 7: Commit**

```bash
git add lib/openLibrary.ts lib/openLibrary.test.ts lib/actions/openLibrary.ts
git commit -m "feat: add mapSubjectsToGenre and fetch Open Library subject data"
```

---

### Task 3: Post form — genre auto-select and ISBN capture

**Files:**
- Modify: `app/post/PostForm.tsx`
- Modify: `app/post/PostForm.test.tsx`
- Modify: `lib/parseListingForm.ts`
- Modify: `lib/parseListingForm.test.ts`
- Modify: `app/listings/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `BookSuggestion.genre`/`.isbn` (Task 2).
- Produces: `ParsedListingForm.isbn: string | null`; `PostForm`'s `initialValues.isbn?: string | null`.

- [ ] **Step 1: Write the failing test for `parseListingForm`'s new field**

Append to `lib/parseListingForm.test.ts`, inside (or alongside) the existing `describe('parseListingForm — Open Library fields', ...)` block:

```typescript
  it('parses isbn when present', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1', isbn: '9780441013593' })
    expect(parseListingForm(fd).isbn).toBe('9780441013593')
  })

  it('defaults isbn to null when absent or blank', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1' })
    expect(parseListingForm(fd).isbn).toBeNull()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/parseListingForm.test.ts`
Expected: FAIL — the returned object has no `isbn` key, so `parseListingForm(fd).isbn` is `undefined`, not `'9780441013593'`/`null`.

- [ ] **Step 3: Extend `parseListingForm` to read `isbn`**

In `lib/parseListingForm.ts`, add `isbn: string | null` to the `ParsedListingForm` type, and add one line to the returned object in `parseListingForm`:
```typescript
    isbn: (formData.get('isbn') as string) || null,
```
(Place it after the `cover_url` line, matching the field's position in the form.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/parseListingForm.test.ts`
Expected: PASS (all previous tests plus the 2 new ones).

- [ ] **Step 5: Make the ISBN field controlled in `PostForm.tsx`**

Add state, right after the existing `coverUrl` state line:
```typescript
  const [isbn, setIsbn] = useState(initialValues?.isbn ?? '')
```

Add `isbn?: string | null` to `Props['initialValues']`, alongside the existing `ol_work_key`/`cover_url` fields.

Replace the ISBN input:
```tsx
          <div>
            <FieldLabel optional>ISBN</FieldLabel>
            <input name="isbn" type="text" value={isbn} onChange={e => setIsbn(e.target.value)} placeholder="978-..." style={inputStyle} />
          </div>
```

- [ ] **Step 6: Update `selectBook` to set genre and ISBN**

```typescript
  function selectBook(book: BookSuggestion) {
    setTitle(book.title)
    setAuthor(book.author)
    setOlWorkKey(book.workKey)
    setCoverUrl(book.coverUrl)
    if (book.genre) setGenre(book.genre)
    setIsbn(book.isbn ?? '')
  }
```

- [ ] **Step 7: Pass `isbn` through the edit page**

In `app/listings/[id]/edit/page.tsx`, add one line to the `initialValues` object passed to `PostForm` (alongside the existing `ol_work_key`/`cover_url` lines):
```typescript
          isbn: listing.isbn,
```

- [ ] **Step 8: Run the existing PostForm test suite to confirm no regressions**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: PASS — the ISBN field's `placeholder="978-..."` is unchanged, so no existing query breaks; it's simply now a controlled input.

- [ ] **Step 9: Write new failing tests for genre/ISBN auto-fill**

Append to `app/post/PostForm.test.tsx`, inside the existing `describe('PostForm — Open Library integration', ...)` block (it already has the `DUNE` fixture and `noopSearch` pattern established — reuse them):

```typescript
  it('selecting a suggestion with a mapped genre pre-selects that Genre button', async () => {
    const SCI_FI_BOOK: BookSuggestion = {
      title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: '9780441013593',
      coverUrl: null, workKey: '/works/OL893415W', genre: 'Sci-Fi',
    }
    const search = vi.fn().mockResolvedValue([SCI_FI_BOOK])
    render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    const option = await within(await screen.findByRole('listbox')).findByRole('button')
    fireEvent.click(option)

    expect(screen.getByText('🚀 Sci-Fi / Fantasy').closest('button')).toHaveStyle({ background: '#fff7ed' })
  })

  it('selecting a suggestion with no genre match leaves the current Genre selection untouched', async () => {
    const UNMAPPED_BOOK: BookSuggestion = {
      title: 'Some Book', author: 'Someone', year: null, isbn: null,
      coverUrl: null, workKey: '/works/OL999W', genre: null,
    }
    const search = vi.fn().mockResolvedValue([UNMAPPED_BOOK])
    render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Some Book' } })
    const option = await within(await screen.findByRole('listbox')).findByRole('button')
    fireEvent.click(option)

    // Default genre ('Fiction') is untouched -- still selected, since UNMAPPED_BOOK.genre is null
    expect(screen.getByText('📚 Fiction').closest('button')).toHaveStyle({ background: '#fff7ed' })
  })

  it('selecting a suggestion fills the ISBN field', async () => {
    const search = vi.fn().mockResolvedValue([{
      title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: '9780441013593',
      coverUrl: null, workKey: '/works/OL893415W', genre: null,
    }])
    render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    const option = await within(await screen.findByRole('listbox')).findByRole('button')
    fireEvent.click(option)

    expect(screen.getByPlaceholderText('978-...')).toHaveValue('9780441013593')
  })
```

Also update the file's `DUNE` fixture (used by earlier, already-passing tests) to include `genre: null` — it's a required field on `BookSuggestion` now:
```typescript
const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W', genre: null,
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: PASS (all existing tests plus the 3 new ones).

- [ ] **Step 11: Run the full test suite once**

Run: `npx vitest run`
Expected: PASS, no regressions.

- [ ] **Step 12: Commit**

```bash
git add app/post/PostForm.tsx app/post/PostForm.test.tsx lib/parseListingForm.ts lib/parseListingForm.test.ts "app/listings/[id]/edit/page.tsx"
git commit -m "feat: auto-select genre and capture ISBN when a book is picked from Open Library"
```

---

### Task 4: Show ISBN on the listing detail page

**Files:**
- Modify: `app/listings/[id]/page.tsx`

**Interfaces:**
- Consumes: `listings.isbn` (Task 1).

- [ ] **Step 1: Add an ISBN badge**

In the "Badges" section (the `<div className="flex gap-2.5 flex-wrap mb-5">` block containing the condition/genre/city badges), add a new conditional badge after the genre one:

```tsx
            {listing.isbn && (
              <span
                className="text-[13px] font-extrabold"
                style={{ padding: '8px 16px', borderRadius: 12, background: '#f3f4f6', color: '#555' }}
              >
                ISBN {listing.isbn}
              </span>
            )}
```

- [ ] **Step 2: Manually verify**

This file has no automated test (page-level data-fetching convention). Verify manually: post a listing by picking an Open Library suggestion with an ISBN, confirm the badge appears on its detail page; post one without picking a suggestion (or edit the ISBN field blank), confirm no badge renders.

- [ ] **Step 3: Commit**

```bash
git add "app/listings/[id]/page.tsx"
git commit -m "feat: show ISBN badge on listing detail page when present"
```

---

## Post-Plan Verification

- [ ] Run the full test suite once: `npx vitest run`
- [ ] Expected: PASS, no failures, no unexpected skips.
