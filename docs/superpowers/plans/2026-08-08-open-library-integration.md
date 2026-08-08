# Open Library Book Metadata Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick a real, identified book (via the free Open Library Search API) when posting a listing, adding a TBR entry, or filtering Browse — instead of free-typing text — storing a stable Open Library work key + cover image alongside the existing title/author, and using that key for exact TBR-to-listing matching instead of today's regex text guess.

**Architecture:** A single reusable `BookSearchInput` component (debounced type-ahead over a thin server-action proxy to Open Library) drops into the existing Title fields on the Post form (including bundle rows), the TBR add form, and the Browse filter bar — each field still behaves as plain free text if a suggestion is never picked, so nothing is ever blocked by a missing book or a third-party outage. A new nullable `ol_work_key`/`cover_url` column pair on `listings`, `listing_books`, and `tbr_entries` carries the verified identity through to TBR matching (`app/profile/page.tsx`, exact key match ahead of the existing regex fallback) and Browse filtering (`app/listings/page.tsx`, exact key match ahead of the existing `ilike` fallback).

**Tech Stack:** Next.js 14 (App Router), Supabase (Postgres), TypeScript, Vitest + React Testing Library. No new npm dependencies — the Open Library integration is a plain `fetch` call, no SDK.

## Global Constraints

- Schema changes are applied by hand in the Supabase SQL Editor — no local migration tooling. A schema task's "test" is a manual verification query, not an automated assertion (matches the convention from `docs/superpowers/plans/2026-08-06-bundle-listings.md`).
- No server action (`'use server'` file) in this codebase has a unit test — that convention holds here too. All testable logic (response normalization, match-strategy decisions) lives in plain, non-`'use server'` modules that the server action or page thinly wraps.
- `components/BookCard.tsx` is confirmed dead code (no file in this repo imports it) — no task touches it. The real Browse cards are inline JSX in `app/listings/page.tsx`.
- Every `BookSearchInput` usage accepts an optional `search` prop purely as a test seam (dependency injection, matching how every existing test in this codebase injects a `vi.fn()` instead of mocking modules) — it defaults to the real `searchBooks` server action in production. This is how every wiring task stays testable without `vi.mock`.
- Cover images are always hotlinked (`<img>` or `next/image` pointing at `covers.openlibrary.org`), never downloaded or re-hosted.
- `next/image` requires `covers.openlibrary.org` in `next.config.mjs`'s `images.remotePatterns` before any `<Image>` (not plain `<img>`) can point at it — Task 12 adds this.
- A picked suggestion's `ol_work_key`/`cover_url` must be cleared the moment the user edits the title or author text afterward by hand — an edited field is no longer guaranteed to describe the picked book.

---

### Task 1: Database migration — Open Library columns

**Files:**
- Modify: `supabase/schema.sql` (append new migration block at end of file)

**Interfaces:**
- Produces: `listings.ol_work_key` (text, nullable), `listings.cover_url` (text, nullable), `listing_books.ol_work_key` (text, nullable), `listing_books.cover_url` (text, nullable), `tbr_entries.ol_work_key` (text, nullable), `tbr_entries.cover_url` (text, nullable) — every later task reads/writes these.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

```sql

-- ── Migration: Open Library book metadata ───────────────────────────────────────
ALTER TABLE listings      ADD COLUMN IF NOT EXISTS ol_work_key text;
ALTER TABLE listings      ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE listing_books ADD COLUMN IF NOT EXISTS ol_work_key text;
ALTER TABLE listing_books ADD COLUMN IF NOT EXISTS cover_url text;
ALTER TABLE tbr_entries   ADD COLUMN IF NOT EXISTS ol_work_key text;
ALTER TABLE tbr_entries   ADD COLUMN IF NOT EXISTS cover_url text;
-- ──────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Run the migration**

Paste the block into the Supabase SQL Editor and run it. Expected: no errors.

- [ ] **Step 3: Manually verify the schema landed correctly**

```sql
select table_name, column_name from information_schema.columns
where table_name in ('listings', 'listing_books', 'tbr_entries')
  and column_name in ('ol_work_key', 'cover_url')
order by table_name, column_name;
```
Expected: 6 rows (2 columns × 3 tables).

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "feat: add Open Library work key + cover columns to listings, listing_books, tbr_entries"
```

---

### Task 2: Open Library response normalizer (pure, tested)

**Files:**
- Create: `lib/openLibrary.ts`
- Test: `lib/openLibrary.test.ts`

**Interfaces:**
- Produces: `BookSuggestion` type (`{ title: string; author: string; year: number | null; isbn: string | null; coverUrl: string | null; workKey: string }`) and `normalizeSearchResults(docs: OpenLibraryDoc[]): BookSuggestion[]` — consumed by Task 3's server action and by every component/test that needs a `BookSuggestion` shape.

- [ ] **Step 1: Write the failing test**

```typescript
// lib/openLibrary.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeSearchResults } from './openLibrary'

describe('normalizeSearchResults', () => {
  it('maps a full Open Library doc to a BookSuggestion', () => {
    const result = normalizeSearchResults([{
      title: 'Dune',
      author_name: ['Frank Herbert'],
      first_publish_year: 1965,
      isbn: ['9780441013593', '0441013597'],
      cover_i: 12345,
      key: '/works/OL893415W',
    }])
    expect(result).toEqual([{
      title: 'Dune',
      author: 'Frank Herbert',
      year: 1965,
      isbn: '9780441013593',
      coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
      workKey: '/works/OL893415W',
    }])
  })

  it('defaults author to an empty string when author_name is missing', () => {
    const result = normalizeSearchResults([{ title: 'Anonymous Work', key: '/works/OL1W' }])
    expect(result[0].author).toBe('')
  })

  it('defaults year and isbn to null when missing', () => {
    const result = normalizeSearchResults([{ title: 'Dune', key: '/works/OL1W' }])
    expect(result[0].year).toBeNull()
    expect(result[0].isbn).toBeNull()
  })

  it('defaults coverUrl to null when cover_i is missing', () => {
    const result = normalizeSearchResults([{ title: 'Dune', key: '/works/OL1W' }])
    expect(result[0].coverUrl).toBeNull()
  })

  it('drops a doc missing a title', () => {
    const result = normalizeSearchResults([{ key: '/works/OL1W' } as any])
    expect(result).toEqual([])
  })

  it('drops a doc missing a key', () => {
    const result = normalizeSearchResults([{ title: 'Dune' } as any])
    expect(result).toEqual([])
  })

  it('maps multiple docs in order', () => {
    const result = normalizeSearchResults([
      { title: 'Dune', key: '/works/OL1W' },
      { title: 'Dune Messiah', key: '/works/OL2W' },
    ])
    expect(result.map(r => r.title)).toEqual(['Dune', 'Dune Messiah'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/openLibrary.test.ts`
Expected: FAIL — `Cannot find module './openLibrary'`.

- [ ] **Step 3: Write the implementation**

```typescript
// lib/openLibrary.ts
export type BookSuggestion = {
  title: string
  author: string
  year: number | null
  isbn: string | null
  coverUrl: string | null
  workKey: string
}

export type OpenLibraryDoc = {
  title?: string
  author_name?: string[]
  first_publish_year?: number
  isbn?: string[]
  cover_i?: number
  key?: string
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
    }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/openLibrary.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/openLibrary.ts lib/openLibrary.test.ts
git commit -m "feat: add Open Library search result normalizer"
```

---

### Task 3: Open Library search server action

**Files:**
- Create: `lib/actions/openLibrary.ts`

**Interfaces:**
- Consumes: `normalizeSearchResults` and `BookSuggestion` from `lib/openLibrary.ts` (Task 2).
- Produces: `searchBooks(query: string): Promise<BookSuggestion[]>` — the default `search` implementation every `BookSearchInput` usage falls back to.

- [ ] **Step 1: Write the server action**

Per Global Constraints, server actions aren't unit tested in this codebase — this file is a thin `fetch` wrapper around the already-tested `normalizeSearchResults`.

```typescript
// lib/actions/openLibrary.ts
'use server'

import { normalizeSearchResults, type BookSuggestion } from '@/lib/openLibrary'

export async function searchBooks(query: string): Promise<BookSuggestion[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const contact = process.env.OPEN_LIBRARY_CONTACT_EMAIL || 'contact@example.com'
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(trimmed)}&fields=title,author_name,first_publish_year,isbn,cover_i,key&limit=8`

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': `LittleBookExchange/1.0 (contact: ${contact})` },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = await res.json()
    return normalizeSearchResults(data.docs ?? [])
  } catch (err) {
    console.error('Open Library search failed:', err)
    return []
  }
}
```

- [ ] **Step 2: Add the contact env var**

Add to `.env.local` (already gitignored, matching how `NEXT_PUBLIC_SUPABASE_URL` etc. are set locally):

```
OPEN_LIBRARY_CONTACT_EMAIL=sean.buczynski@yahoo.com
```

This raises Open Library's rate limit from 1 req/sec to 3 req/sec (per their published API guidelines) by identifying the app in the `User-Agent` header. Its absence never breaks anything — `searchBooks` falls back to a placeholder contact string.

- [ ] **Step 3: Manually verify against the real API**

Run: `node -e "process.env.OPEN_LIBRARY_CONTACT_EMAIL='test@example.com'; fetch('https://openlibrary.org/search.json?q=dune&fields=title,author_name,first_publish_year,isbn,cover_i,key&limit=3', {headers:{'User-Agent':'LittleBookExchange/1.0 (contact: test@example.com)'}}).then(r=>r.json()).then(d=>console.log(JSON.stringify(d.docs, null, 2)))"`

Expected: JSON array of ~3 docs, each with `title`, `key`, and most with `cover_i`. Confirms the query shape and headers work before any UI wires into it.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/openLibrary.ts
git commit -m "feat: add searchBooks server action proxying Open Library's Search API"
```

---

### Task 4: Shared `BookSearchInput` component

**Files:**
- Create: `components/BookSearchInput.tsx`
- Test: `components/BookSearchInput.test.tsx`

**Interfaces:**
- Consumes: `BookSuggestion` from `lib/openLibrary.ts`, `searchBooks` from `lib/actions/openLibrary.ts` (as the default `search`).
- Produces: `<BookSearchInput name value onChange onSelect placeholder? required? className? style? search? />` — a drop-in replacement for a plain `<input>` (same `name`/`value`/`onChange`/`placeholder`/`required`/`className`/`style` contract), consumed by Tasks 7, 8, 9, and 11.

- [ ] **Step 1: Write the failing test**

```tsx
// components/BookSearchInput.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BookSearchInput from './BookSearchInput'
import type { BookSuggestion } from '@/lib/openLibrary'

const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W',
}

describe('BookSearchInput', () => {
  it('renders as a plain text input with the given value and placeholder', () => {
    render(<BookSearchInput name="title" value="Dune" onChange={() => {}} onSelect={() => {}} placeholder="e.g. Dune" />)
    expect(screen.getByPlaceholderText('e.g. Dune')).toHaveValue('Dune')
  })

  it('calls onChange as the user types, without waiting for the debounce', () => {
    const onChange = vi.fn()
    render(<BookSearchInput name="title" value="" onChange={onChange} onSelect={() => {}} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Du' } })
    expect(onChange).toHaveBeenCalledWith('Du')
  })

  it('does not call search for input shorter than 2 characters', async () => {
    const search = vi.fn().mockResolvedValue([])
    render(<BookSearchInput name="title" value="" onChange={() => {}} onSelect={() => {}} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'D' } })
    await new Promise(r => setTimeout(r, 350))
    expect(search).not.toHaveBeenCalled()
  })

  it('calls search after the debounce once 2+ characters are typed, and shows a suggestion', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    render(<BookSearchInput name="title" value="" onChange={() => {}} onSelect={() => {}} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dune' } })
    await waitFor(() => expect(search).toHaveBeenCalledWith('Dune'), { timeout: 1000 })
    expect(await screen.findByText(/Dune/)).toBeInTheDocument()
  })

  it('calls onSelect with the picked suggestion and closes the dropdown', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const onSelect = vi.fn()
    render(<BookSearchInput name="title" value="" onChange={() => {}} onSelect={onSelect} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dune' } })
    const option = await screen.findByText(/Dune — Frank Herbert/)
    fireEvent.click(option)
    expect(onSelect).toHaveBeenCalledWith(DUNE)
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })

  it('shows nothing when search resolves with no results', async () => {
    const search = vi.fn().mockResolvedValue([])
    render(<BookSearchInput name="title" value="" onChange={() => {}} onSelect={() => {}} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Zzzznotabook' } })
    await waitFor(() => expect(search).toHaveBeenCalled())
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run components/BookSearchInput.test.tsx`
Expected: FAIL — `Cannot find module './BookSearchInput'`.

- [ ] **Step 3: Write the implementation**

```tsx
// components/BookSearchInput.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import type { BookSuggestion } from '@/lib/openLibrary'
import { searchBooks } from '@/lib/actions/openLibrary'

type Props = {
  name: string
  value: string
  onChange: (value: string) => void
  onSelect: (book: BookSuggestion) => void
  placeholder?: string
  required?: boolean
  className?: string
  style?: React.CSSProperties
  search?: (query: string) => Promise<BookSuggestion[]>
}

const DEBOUNCE_MS = 300

export default function BookSearchInput({
  name, value, onChange, onSelect, placeholder, required, className, style,
  search = searchBooks,
}: Props) {
  const [suggestions, setSuggestions] = useState<BookSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  function handleChange(next: string) {
    onChange(next)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (next.trim().length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const thisRequest = ++requestIdRef.current
    debounceRef.current = setTimeout(async () => {
      const results = await search(next)
      if (thisRequest !== requestIdRef.current) return // a newer keystroke superseded this request
      setSuggestions(results)
      setOpen(results.length > 0)
    }, DEBOUNCE_MS)
  }

  function handleSelect(book: BookSuggestion) {
    setSuggestions([])
    setOpen(false)
    onSelect(book)
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        name={name}
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        required={required}
        className={className}
        autoComplete="off"
        style={style}
      />
      {open && (
        <ul
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
            background: '#fff', border: '2px solid #fed7aa', borderRadius: 12,
            marginTop: 4, maxHeight: 260, overflowY: 'auto', listStyle: 'none',
            padding: 4, boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
          }}
        >
          {suggestions.map(s => (
            <li key={s.workKey}>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()} // keep focus so onBlur doesn't close the list before onClick fires
                onClick={() => handleSelect(s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '6px 8px', background: 'none', border: 'none', cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit', borderRadius: 8,
                }}
              >
                {s.coverUrl ? (
                  <img src={s.coverUrl} alt="" style={{ width: 26, height: 38, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                ) : (
                  <span style={{ width: 26, height: 38, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>📖</span>
                )}
                <span style={{ fontSize: 13 }}>
                  <strong>{s.title}</strong>
                  {s.author && <span style={{ color: '#888' }}> — {s.author}</span>}
                  {s.year && <span style={{ color: '#bbb' }}> ({s.year})</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run components/BookSearchInput.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add components/BookSearchInput.tsx components/BookSearchInput.test.tsx
git commit -m "feat: add shared BookSearchInput autocomplete component"
```

---

### Task 5: TBR exact-match strategy helper (pure, tested)

**Files:**
- Modify: `lib/tbrMatch.ts`
- Modify: `lib/tbrMatch.test.ts`

**Interfaces:**
- Produces: `TbrMatchStrategy` type (`{ mode: 'exact'; workKey: string } | { mode: 'text'; titlePattern: string | null; authorPattern: string | null } | { mode: 'none' }`) and `buildTbrMatchStrategy(entry: { title: string; author: string; ol_work_key: string | null }): TbrMatchStrategy` — consumed by Task 10.

- [ ] **Step 1: Write the failing test**

Append to `lib/tbrMatch.test.ts`:

```typescript
import { tbrMatchPattern, isTooGenericToMatch, buildTbrMatchStrategy } from './tbrMatch'

describe('buildTbrMatchStrategy', () => {
  it('returns exact mode with the work key when ol_work_key is set', () => {
    const strategy = buildTbrMatchStrategy({ title: 'Dune', author: 'Frank Herbert', ol_work_key: '/works/OL893415W' })
    expect(strategy).toEqual({ mode: 'exact', workKey: '/works/OL893415W' })
  })

  it('ignores title/author entirely when ol_work_key is set', () => {
    // Even a generic-only title shouldn't fall through to text mode if a key is present.
    const strategy = buildTbrMatchStrategy({ title: 'the', author: '', ol_work_key: '/works/OL1W' })
    expect(strategy.mode).toBe('exact')
  })

  it('returns text mode with both patterns when no key and both fields are usable', () => {
    const strategy = buildTbrMatchStrategy({ title: 'Dune', author: 'Frank Herbert', ol_work_key: null })
    expect(strategy).toEqual({
      mode: 'text',
      titlePattern: tbrMatchPattern('Dune'),
      authorPattern: tbrMatchPattern('Frank Herbert'),
    })
  })

  it('returns text mode with only the usable pattern when the other is generic or blank', () => {
    const strategy = buildTbrMatchStrategy({ title: 'the', author: 'Frank Herbert', ol_work_key: null })
    expect(strategy).toEqual({
      mode: 'text',
      titlePattern: null,
      authorPattern: tbrMatchPattern('Frank Herbert'),
    })
  })

  it('returns none mode when no key and neither field is usable', () => {
    const strategy = buildTbrMatchStrategy({ title: 'the', author: '', ol_work_key: null })
    expect(strategy).toEqual({ mode: 'none' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/tbrMatch.test.ts`
Expected: FAIL — `buildTbrMatchStrategy is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `lib/tbrMatch.ts`:

```typescript
export type TbrMatchStrategy =
  | { mode: 'exact'; workKey: string }
  | { mode: 'text'; titlePattern: string | null; authorPattern: string | null }
  | { mode: 'none' }

export function buildTbrMatchStrategy(entry: {
  title: string
  author: string
  ol_work_key: string | null
}): TbrMatchStrategy {
  if (entry.ol_work_key) return { mode: 'exact', workKey: entry.ol_work_key }

  const titleUsable = !!entry.title && !isTooGenericToMatch(entry.title)
  const authorUsable = !!entry.author && !isTooGenericToMatch(entry.author)
  if (!titleUsable && !authorUsable) return { mode: 'none' }

  return {
    mode: 'text',
    titlePattern: titleUsable ? tbrMatchPattern(entry.title) : null,
    authorPattern: authorUsable ? tbrMatchPattern(entry.author) : null,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/tbrMatch.test.ts`
Expected: PASS (all previous tests plus the 5 new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/tbrMatch.ts lib/tbrMatch.test.ts
git commit -m "feat: add buildTbrMatchStrategy — exact ol_work_key match ahead of text fallback"
```

---

### Task 6: Extend `parseListingForm`/`parseBundleBooks` with Open Library fields

**Files:**
- Modify: `lib/parseListingForm.ts`
- Modify: `lib/parseListingForm.test.ts`

**Interfaces:**
- Produces: `ParsedListingForm` gains `ol_work_key: string | null; cover_url: string | null`. `parseBundleBooks` returns `{ title: string; author: string; ol_work_key: string | null; cover_url: string | null }[]`. Consumed by Task 7 (main book, via the existing `...fields` spread in `app/post/actions.ts` — no further change needed there) and Task 8 (bundle rows).

- [ ] **Step 1: Write the failing tests**

Append to `lib/parseListingForm.test.ts`:

```typescript
describe('parseListingForm — Open Library fields', () => {
  it('parses ol_work_key and cover_url when present', () => {
    const fd = makeFormData({
      title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1',
      ol_work_key: '/works/OL893415W', cover_url: 'https://covers.openlibrary.org/b/id/1-M.jpg',
    })
    const result = parseListingForm(fd)
    expect(result.ol_work_key).toBe('/works/OL893415W')
    expect(result.cover_url).toBe('https://covers.openlibrary.org/b/id/1-M.jpg')
  })

  it('defaults ol_work_key and cover_url to null when absent or blank', () => {
    const fd = makeFormData({ title: 'Dune', author: 'Frank Herbert', condition: 'Good', price: '1' })
    const result = parseListingForm(fd)
    expect(result.ol_work_key).toBeNull()
    expect(result.cover_url).toBeNull()
  })
})

describe('parseBundleBooks — Open Library fields', () => {
  it('parses ol_work_key and cover_url per row', () => {
    const fd = new FormData()
    fd.set('book_rows', '1')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', 'J.K. Rowling')
    fd.set('book_ol_work_key_1', '/works/OL82586W')
    fd.set('book_cover_url_1', 'https://covers.openlibrary.org/b/id/2-M.jpg')
    expect(parseBundleBooks(fd)).toEqual([{
      title: 'Chamber of Secrets', author: 'J.K. Rowling',
      ol_work_key: '/works/OL82586W', cover_url: 'https://covers.openlibrary.org/b/id/2-M.jpg',
    }])
  })

  it('defaults a row\'s ol_work_key and cover_url to null when absent', () => {
    const fd = new FormData()
    fd.set('book_rows', '1')
    fd.set('book_title_1', 'Chamber of Secrets')
    fd.set('book_author_1', 'J.K. Rowling')
    const result = parseBundleBooks(fd)
    expect(result[0].ol_work_key).toBeNull()
    expect(result[0].cover_url).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/parseListingForm.test.ts`
Expected: FAIL — `ol_work_key`/`cover_url` are `undefined`, not matching expectations.

- [ ] **Step 3: Update the implementation**

```typescript
// lib/parseListingForm.ts — full replacement
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
  ol_work_key: string | null
  cover_url: string | null
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
    ol_work_key: (formData.get('ol_work_key') as string) || null,
    cover_url:   (formData.get('cover_url')   as string) || null,
  }
}

const MAX_BUNDLE_BOOKS = 20

export function parseBundleBooks(formData: FormData): { title: string; author: string; ol_work_key: string | null; cover_url: string | null }[] {
  const rawCount = parseInt((formData.get('book_rows') as string) || '0', 10)
  const count = Math.min(Number.isFinite(rawCount) ? Math.max(rawCount, 0) : 0, MAX_BUNDLE_BOOKS)

  const books: { title: string; author: string; ol_work_key: string | null; cover_url: string | null }[] = []
  for (let i = 1; i <= count; i++) {
    const title = ((formData.get(`book_title_${i}`) as string) || '').trim()
    const author = ((formData.get(`book_author_${i}`) as string) || '').trim()
    if (title === '' && author === '') continue
    books.push({
      title,
      author,
      ol_work_key: (formData.get(`book_ol_work_key_${i}`) as string) || null,
      cover_url:   (formData.get(`book_cover_url_${i}`)   as string) || null,
    })
  }
  return books
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/parseListingForm.test.ts`
Expected: PASS (all previous tests plus the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add lib/parseListingForm.ts lib/parseListingForm.test.ts
git commit -m "feat: parse ol_work_key/cover_url in parseListingForm and parseBundleBooks"
```

---

### Task 7: Post form — main book Open Library integration

**Files:**
- Modify: `app/post/PostForm.tsx`
- Modify: `app/post/PostForm.test.tsx`
- Modify: `lib/types.ts`
- Modify: `app/listings/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `BookSearchInput` (Task 4), `BookSuggestion` (Task 2). `parseListingForm`'s `...fields` spread (Task 6) already carries `ol_work_key`/`cover_url` into `app/post/actions.ts`'s `insert`/`update` calls — **no change needed in `app/post/actions.ts` for the main book.**
- Produces: `PostForm` gains an optional `search` prop (test seam, forwarded to every `BookSearchInput` it renders — also used by Task 8). `initialValues` gains `ol_work_key?: string | null; cover_url?: string | null`.

- [ ] **Step 1: Add `ol_work_key`/`cover_url` to `lib/types.ts`'s `Listing` type**

In `lib/types.ts`, add two fields to `Listing`:

```typescript
export type Listing = {
  id: string
  user_id: string
  title: string
  author: string
  condition: ListingCondition
  price: number | null
  description: string | null
  photo_url: string | null
  city: string
  status: ListingStatus
  genre?: string
  format?: string
  created_at: string
  profiles?: Profile
  is_bundle?: boolean
  bundle_name?: string | null
  book_count?: number
  ol_work_key?: string | null
  cover_url?: string | null
}
```

- [ ] **Step 2: Run the existing PostForm test suite to confirm the baseline passes**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: PASS (all existing tests, confirming the starting point before this task's changes).

- [ ] **Step 3: Wire `BookSearchInput` into the main Title field**

In `app/post/PostForm.tsx`:

1. Add imports:
```typescript
import BookSearchInput from '@/components/BookSearchInput'
import type { BookSuggestion } from '@/lib/openLibrary'
```

2. Extend `Props` (add after `submitLabel?: string`):
```typescript
  search?: (query: string) => Promise<BookSuggestion[]>
```
And extend `initialValues` with:
```typescript
    ol_work_key?: string | null
    cover_url?: string | null
```

3. In the component, destructure `search` from props (`export default function PostForm({ city, action, error, initialValues, submitLabel, search }: Props) {`) and add state after the existing `author` state line:
```typescript
  const [olWorkKey, setOlWorkKey] = useState(initialValues?.ol_work_key ?? '')
  const [coverUrl, setCoverUrl] = useState<string | null>(initialValues?.cover_url ?? null)
```

4. Add a handler near `toggleBundle`/`updateBook`:
```typescript
  function selectBook(book: BookSuggestion) {
    setTitle(book.title)
    setAuthor(book.author)
    setOlWorkKey(book.workKey)
    setCoverUrl(book.coverUrl)
  }
```

5. Add two hidden inputs alongside the existing ones near the top of the `<form>` (after `<input type="hidden" name="book_rows" value={books.length} />`):
```tsx
      <input type="hidden" name="ol_work_key" value={olWorkKey} />
      <input type="hidden" name="cover_url" value={coverUrl ?? ''} />
```

6. Replace the Title `<input>` block:
```tsx
        <div style={{ marginBottom: 18 }}>
          <FieldLabel>Book Title *</FieldLabel>
          <BookSearchInput
            name="title"
            value={title}
            onChange={v => { setTitle(v); setOlWorkKey(''); setCoverUrl(null) }}
            onSelect={selectBook}
            placeholder="e.g. The Great Gatsby"
            required
            style={inputStyle}
            search={search}
          />
          {coverUrl && (
            <img
              src={coverUrl}
              alt="Cover preview"
              style={{ width: 40, height: 56, objectFit: 'cover', borderRadius: 6, marginTop: 8, border: '2px solid #fed7aa' }}
            />
          )}
        </div>
```

7. Update the Author `<input>`'s `onChange` so manually editing it after a pick invalidates the resolved key/cover:
```tsx
            onChange={e => { setAuthor(e.target.value); setOlWorkKey(''); setCoverUrl(null) }}
```

- [ ] **Step 4: Pass `ol_work_key`/`cover_url` through the edit page**

In `app/listings/[id]/edit/page.tsx`, add two fields to the `initialValues` object passed to `PostForm`:
```typescript
          ol_work_key: listing.ol_work_key,
          cover_url: listing.cover_url,
```

- [ ] **Step 5: Run the existing PostForm test suite again to confirm no regressions**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: PASS — `BookSearchInput` renders a plain `<input>` with the same `placeholder`, so every existing `getByPlaceholderText` query still resolves.

- [ ] **Step 6: Write new failing tests for the Open Library wiring**

Append to `app/post/PostForm.test.tsx`:

```typescript
import type { BookSuggestion } from '@/lib/openLibrary'

const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W',
}

describe('PostForm — Open Library integration', () => {
  it('selecting a suggestion fills author and the hidden ol_work_key/cover_url fields', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    const option = await screen.findByText(/Dune — Frank Herbert/)
    fireEvent.click(option)

    expect(screen.getByPlaceholderText('e.g. F. Scott Fitzgerald')).toHaveValue('Frank Herbert')
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('/works/OL893415W')
    expect(container.querySelector('input[name="cover_url"]')).toHaveValue('https://covers.openlibrary.org/b/id/12345-M.jpg')
  })

  it('clears the resolved ol_work_key when the title is edited again after a selection', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune' } })
    const option = await screen.findByText(/Dune — Frank Herbert/)
    fireEvent.click(option)
    fireEvent.change(screen.getByPlaceholderText('e.g. The Great Gatsby'), { target: { value: 'Dune Messiah' } })

    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
  })

  it('leaves ol_work_key/cover_url empty by default', () => {
    const { container } = render(<PostForm action={vi.fn()} />)
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
    expect(container.querySelector('input[name="cover_url"]')).toHaveValue('')
  })

  it('pre-fills ol_work_key/cover_url from initialValues (edit mode)', () => {
    const { container } = render(
      <PostForm
        action={vi.fn()}
        initialValues={{
          title: 'Dune', author: 'Frank Herbert', condition: 'Good', genre: 'Fiction', format: 'Paperback',
          description: null, pickup_description: null, photo_url: null, photo_url_2: null, photo_url_3: null,
          ol_work_key: '/works/OL893415W', cover_url: 'https://covers.openlibrary.org/b/id/12345-M.jpg',
        }}
      />
    )
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('/works/OL893415W')
    expect(screen.getByAltText('Cover preview')).toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: PASS (all existing tests plus the 4 new ones).

- [ ] **Step 8: Commit**

```bash
git add app/post/PostForm.tsx app/post/PostForm.test.tsx lib/types.ts "app/listings/[id]/edit/page.tsx"
git commit -m "feat: wire Open Library search into the Post form's main book field"
```

---

### Task 8: Post form — bundle row Open Library integration

**Files:**
- Modify: `app/post/PostForm.tsx`
- Modify: `app/post/PostForm.test.tsx`
- Modify: `app/post/actions.ts`
- Modify: `app/listings/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `BookSearchInput` (Task 4), `parseBundleBooks` (Task 6, now returning `ol_work_key`/`cover_url` per row).

- [ ] **Step 1: Extend bundle row state and handlers in `app/post/PostForm.tsx`**

Change the `books` state type and its default row shape:
```typescript
  const [books, setBooks] = useState<{ title: string; author: string; ol_work_key: string; cover_url: string | null }[]>(
    initialValues?.books?.map(b => ({ ol_work_key: '', cover_url: null, ...b })) ?? []
  )
```

Update `addBook` (a fresh row has no resolved key yet):
```typescript
  function addBook() {
    setBooks(prev => (prev.length >= MAX_BUNDLE_BOOKS ? prev : [...prev, { title: '', author, ol_work_key: '', cover_url: null }]))
  }
```

Update the "Auto-fill from Book 1" button's handler so it preserves the row's own `ol_work_key`/`cover_url` (only the author text changes):
```tsx
                      onClick={() => updateBook(i, { ...book, author })}
```

- [ ] **Step 2: Replace each bundle row's Title input with `BookSearchInput`**

Replace the row's Title `<input>` block:
```tsx
                <div style={{ marginBottom: 10 }}>
                  <BookSearchInput
                    name={`book_title_${i + 1}`}
                    value={book.title}
                    onChange={v => updateBook(i, { ...book, title: v, ol_work_key: '', cover_url: null })}
                    onSelect={s => updateBook(i, { title: s.title, author: s.author, ol_work_key: s.workKey, cover_url: s.coverUrl })}
                    placeholder="Title in series"
                    style={inputStyle}
                    search={search}
                  />
                  {book.cover_url && (
                    <img
                      src={book.cover_url}
                      alt="Cover preview"
                      style={{ width: 32, height: 46, objectFit: 'cover', borderRadius: 6, marginTop: 8, border: '2px solid #fed7aa' }}
                    />
                  )}
                </div>
```

Update the row's Author `<input>`'s `onChange` to clear the resolved key/cover on manual edit:
```tsx
                  onChange={e => updateBook(i, { title: book.title, author: e.target.value, ol_work_key: '', cover_url: null })}
```

And add two hidden inputs right after the Author input, still inside the row's wrapping `<div>`:
```tsx
                <input type="hidden" name={`book_ol_work_key_${i + 1}`} value={book.ol_work_key} />
                <input type="hidden" name={`book_cover_url_${i + 1}`} value={book.cover_url ?? ''} />
```

- [ ] **Step 3: Extend `initialValues.books` type**

In `Props['initialValues']`, change:
```typescript
    books?: { title: string; author: string }[]
```
to:
```typescript
    books?: { title: string; author: string; ol_work_key?: string; cover_url?: string | null }[]
```

- [ ] **Step 4: Fetch bundle books' Open Library fields on the edit page**

In `app/listings/[id]/edit/page.tsx`, change the bundle books query:
```typescript
    const { data: books } = await supabase
      .from('listing_books').select('title, author, ol_work_key, cover_url').eq('listing_id', listing.id).order('position', { ascending: true })
```

- [ ] **Step 5: Persist bundle rows' Open Library fields in `app/post/actions.ts`**

In `createListing`, update the `listing_books` insert:
```typescript
      const { error: booksError } = await supabase.from('listing_books').insert(
        bundleBooks.map((b, i) => ({
          listing_id: listing!.id, title: b.title, author: b.author,
          ol_work_key: b.ol_work_key, cover_url: b.cover_url, position: i,
        }))
      )
```

In `updateListing`, apply the identical change to its `listing_books` insert:
```typescript
      const { error: booksError } = await supabase.from('listing_books').insert(
        bundleBooks.map((b, i) => ({
          listing_id: listingId, title: b.title, author: b.author,
          ol_work_key: b.ol_work_key, cover_url: b.cover_url, position: i,
        }))
      )
```

- [ ] **Step 6: Run the existing PostForm bundle test suite to confirm no regressions**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: PASS — existing bundle tests only assert on `book_title_{i}`/`book_author_{i}` values and the running total, unaffected by the added hidden fields.

- [ ] **Step 7: Write new failing tests for bundle-row Open Library wiring**

Append to `app/post/PostForm.test.tsx`:

```typescript
describe('PostForm — bundle row Open Library integration', () => {
  it('selecting a suggestion in a bundle row fills that row\'s author and hidden fields', async () => {
    const CHAMBER: BookSuggestion = {
      title: 'Chamber of Secrets', author: 'J.K. Rowling', year: 1998, isbn: null,
      coverUrl: 'https://covers.openlibrary.org/b/id/2-M.jpg', workKey: '/works/OL82586W',
    }
    const search = vi.fn().mockResolvedValue([CHAMBER])
    const { container } = render(<PostForm action={vi.fn()} search={search} />)
    fireEvent.click(screen.getByText('📚 List as a Bundle / Series'))
    fireEvent.click(screen.getByText('+ Add Another Book'))
    fireEvent.change(screen.getByPlaceholderText('Title in series'), { target: { value: 'Chamber' } })
    const option = await screen.findByText(/Chamber of Secrets — J.K. Rowling/)
    fireEvent.click(option)

    expect(screen.getByPlaceholderText('Author')).toHaveValue('J.K. Rowling')
    expect(container.querySelector('input[name="book_ol_work_key_1"]')).toHaveValue('/works/OL82586W')
    expect(container.querySelector('input[name="book_cover_url_1"]')).toHaveValue('https://covers.openlibrary.org/b/id/2-M.jpg')
  })
})
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run app/post/PostForm.test.tsx`
Expected: PASS (all tests).

- [ ] **Step 9: Commit**

```bash
git add app/post/PostForm.tsx app/post/PostForm.test.tsx app/post/actions.ts "app/listings/[id]/edit/page.tsx"
git commit -m "feat: wire Open Library search into Post form bundle rows"
```

---

### Task 9: TBR add form Open Library integration

**Files:**
- Create: `app/profile/TbrAddForm.tsx`
- Create: `app/profile/TbrAddForm.test.tsx`
- Modify: `app/profile/DashboardClient.tsx`
- Modify: `lib/actions/tbrEntries.ts`

**Interfaces:**
- Consumes: `BookSearchInput` (Task 4), `StateSelect` (existing, `components/StateSelect.tsx`).
- Produces: `<TbrAddForm addTbrEntry search? />`, matching the existing pattern of extracting tab content into its own file (`MessagesTab`, `HistorySection`).

- [ ] **Step 1: Write the failing test**

```tsx
// app/profile/TbrAddForm.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import TbrAddForm from './TbrAddForm'
import type { BookSuggestion } from '@/lib/openLibrary'

const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W',
}

describe('TbrAddForm', () => {
  it('renders empty Title/Author/City fields and hidden Open Library fields', () => {
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} />)
    expect(screen.getByPlaceholderText('Book title...')).toHaveValue('')
    expect(screen.getByPlaceholderText('Author (optional)...')).toHaveValue('')
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
    expect(container.querySelector('input[name="cover_url"]')).toHaveValue('')
  })

  it('selecting a suggestion fills author and the hidden ol_work_key/cover_url fields', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('Book title...'), { target: { value: 'Dune' } })
    const option = await screen.findByText(/Dune — Frank Herbert/)
    fireEvent.click(option)

    expect(screen.getByPlaceholderText('Author (optional)...')).toHaveValue('Frank Herbert')
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('/works/OL893415W')
  })

  it('clears the resolved ol_work_key when the author is edited manually afterward', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<TbrAddForm addTbrEntry={vi.fn()} search={search} />)
    fireEvent.change(screen.getByPlaceholderText('Book title...'), { target: { value: 'Dune' } })
    const option = await screen.findByText(/Dune — Frank Herbert/)
    fireEvent.click(option)
    fireEvent.change(screen.getByPlaceholderText('Author (optional)...'), { target: { value: 'Someone Else' } })

    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/profile/TbrAddForm.test.tsx`
Expected: FAIL — `Cannot find module './TbrAddForm'`.

- [ ] **Step 3: Write the implementation**

```tsx
// app/profile/TbrAddForm.tsx
'use client'

import { useState } from 'react'
import StateSelect from '@/components/StateSelect'
import BookSearchInput from '@/components/BookSearchInput'
import type { BookSuggestion } from '@/lib/openLibrary'

type Props = {
  addTbrEntry: (formData: FormData) => Promise<void>
  search?: (query: string) => Promise<BookSuggestion[]>
}

export default function TbrAddForm({ addTbrEntry, search }: Props) {
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [olWorkKey, setOlWorkKey] = useState('')
  const [coverUrl, setCoverUrl] = useState<string | null>(null)

  function handleSelect(book: BookSuggestion) {
    setTitle(book.title)
    setAuthor(book.author)
    setOlWorkKey(book.workKey)
    setCoverUrl(book.coverUrl)
  }

  return (
    <form action={addTbrEntry} className="flex gap-2 mb-4 flex-wrap items-start">
      <input type="hidden" name="ol_work_key" value={olWorkKey} />
      <input type="hidden" name="cover_url" value={coverUrl ?? ''} />
      <div className="flex-1" style={{ minWidth: 120, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        {coverUrl && (
          <img src={coverUrl} alt="Cover preview" style={{ width: 28, height: 40, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
        )}
        <BookSearchInput
          name="title"
          value={title}
          onChange={v => { setTitle(v); setOlWorkKey(''); setCoverUrl(null) }}
          onSelect={handleSelect}
          placeholder="Book title..."
          className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
          style={{ padding: '9px 12px', minWidth: 120, width: '100%' }}
          search={search}
        />
      </div>
      <input
        name="author"
        placeholder="Author (optional)..."
        value={author}
        onChange={e => { setAuthor(e.target.value); setOlWorkKey(''); setCoverUrl(null) }}
        className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
        style={{ padding: '9px 12px', minWidth: 120 }}
      />
      <input name="city" placeholder="City (optional)..."
        className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
        style={{ padding: '9px 12px', minWidth: 100 }} />
      <StateSelect name="state" placeholder="Any state"
        className="flex-1 border-2 border-[#ddd6fe] rounded-[12px] font-bold text-[13px] bg-[#f5f3ff]"
        style={{ padding: '9px 12px', minWidth: 100 }} />
      <button type="submit" className="text-white font-extrabold text-[13px]"
        style={{ background: '#7c3aed', padding: '9px 18px', borderRadius: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
        + Add
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/profile/TbrAddForm.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Swap the inline form in `DashboardClient.tsx` for `TbrAddForm`**

In `app/profile/DashboardClient.tsx`:

1. Add the import near the other tab-content imports:
```typescript
import TbrAddForm from './TbrAddForm'
```

2. Add `ol_work_key`/`cover_url` to the `TbrEntry` type:
```typescript
type TbrEntry = {
  id: string
  title: string
  author: string
  city: string
  state: string
  ol_work_key: string | null
  cover_url: string | null
  match: { id: string; title: string } | null
}
```

3. Replace the entire inline `<form action={addTbrEntry} className="flex gap-2 mb-4 flex-wrap">...</form>` block with:
```tsx
          <TbrAddForm addTbrEntry={addTbrEntry} />
```

- [ ] **Step 6: Persist `ol_work_key`/`cover_url` in `addTbrEntry`**

In `lib/actions/tbrEntries.ts`, update the insert in `addTbrEntry`:
```typescript
  const olWorkKey = ((formData.get('ol_work_key') as string) || '').trim() || null
  const coverUrl = ((formData.get('cover_url') as string) || '').trim() || null

  await supabase.from('tbr_entries').insert({
    user_id: user.id,
    title,
    author,
    city,
    state,
    ol_work_key: olWorkKey,
    cover_url: coverUrl,
  })
```
(Add the two new `const` lines right after the existing `redirectTo` line, before the `supabase.from('tbr_entries').insert(...)` call.)

- [ ] **Step 7: Commit**

```bash
git add app/profile/TbrAddForm.tsx app/profile/TbrAddForm.test.tsx app/profile/DashboardClient.tsx lib/actions/tbrEntries.ts
git commit -m "feat: wire Open Library search into the TBR add form"
```

---

### Task 10: TBR-to-listing exact matching

**Files:**
- Modify: `app/profile/page.tsx`

**Interfaces:**
- Consumes: `buildTbrMatchStrategy` (Task 5).

- [ ] **Step 1: Replace the per-entry matching block**

In `app/profile/page.tsx`, replace the existing `import { tbrMatchPattern, isTooGenericToMatch } from '@/lib/tbrMatch'` line with:
```typescript
import { tbrMatchPattern, buildTbrMatchStrategy } from '@/lib/tbrMatch'
```

Replace the entire `tbrEntries = await Promise.all(...)` block with:
```typescript
      tbrEntries = await Promise.all((tbr ?? []).map(async (entry: any) => {
        const strategy = buildTbrMatchStrategy(entry)
        if (strategy.mode === 'none') return { ...entry, match: null }

        if (strategy.mode === 'exact') {
          // Standalone listings for this exact book.
          let directQuery = supabase
            .from('listings')
            .select('id, title, city, profiles!inner(state)')
            .eq('status', 'active')
            .neq('user_id', user.id)
            .eq('ol_work_key', strategy.workKey)
          if (entry.state) directQuery = directQuery.eq('profiles.state', entry.state)
          const { data: direct } = await directQuery.limit(1).maybeSingle()
          if (direct) return { ...entry, match: { id: direct.id, title: direct.title } }

          // Bundles containing this exact book, via listing_books.
          const { data: bundleRows } = await supabase
            .from('listing_books').select('listing_id').eq('ol_work_key', strategy.workKey)
          const bundleListingIds = [...new Set((bundleRows ?? []).map((r: any) => r.listing_id))]
          if (bundleListingIds.length === 0) return { ...entry, match: null }

          let bundleQuery = supabase
            .from('listings')
            .select('id, title, city, profiles!inner(state)')
            .in('id', bundleListingIds)
            .eq('status', 'active')
            .neq('user_id', user.id)
          if (entry.state) bundleQuery = bundleQuery.eq('profiles.state', entry.state)
          const { data: bundleMatch } = await bundleQuery.limit(1).maybeSingle()
          return { ...entry, match: bundleMatch ? { id: bundleMatch.id, title: bundleMatch.title } : null }
        }

        // Fallback: today's whole-word text matching, unchanged, for entries with no resolved key.
        if (strategy.titlePattern === null && strategy.authorPattern === null && !entry.city) {
          return { ...entry, match: null }
        }
        let query = supabase
          .from('listings')
          .select('id, title, author, city, profiles!inner(state)')
          .eq('status', 'active')
          .neq('user_id', user.id)
        if (strategy.titlePattern)  query = query.regexIMatch('title', strategy.titlePattern)
        if (strategy.authorPattern) query = query.regexIMatch('author', strategy.authorPattern)
        if (entry.city)  query = query.regexIMatch('city', tbrMatchPattern(entry.city))
        if (entry.state) query = query.eq('profiles.state', entry.state)
        const { data: match } = await query.limit(1).maybeSingle()
        return { ...entry, match: match ? { id: match.id, title: match.title } : null }
      }))
```

`isTooGenericToMatch` is no longer called directly in this file — that check now lives inside `buildTbrMatchStrategy` (Task 5) — which is why the import line above drops it.

- [ ] **Step 2: Manually verify against a live/demo database**

This file has no existing unit test (matches the codebase-wide convention of no tests for page-level data-fetching). Verify manually:
1. Add a TBR entry via the UI without picking an Open Library suggestion (plain text) — confirm it still matches an existing listing with the same title/author (regex fallback path, unchanged behavior).
2. Add a TBR entry by picking an Open Library suggestion, then post a listing for the *same* book by also picking that suggestion — confirm the TBR entry shows "📖 Avail" / "📖 Available!" linking to that listing (exact-match path).
3. Post the same book as part of a bundle instead of standalone — confirm the TBR entry still matches (bundle path).

- [ ] **Step 3: Commit**

```bash
git add app/profile/page.tsx
git commit -m "feat: exact ol_work_key TBR matching ahead of the text-regex fallback"
```

---

### Task 11: Browse filter bar Open Library integration

**Files:**
- Create: `app/listings/BookFilterField.tsx`
- Create: `app/listings/BookFilterField.test.tsx`
- Modify: `app/listings/page.tsx`

**Interfaces:**
- Consumes: `BookSearchInput` (Task 4).
- Produces: `<BookFilterField defaultValue style search? />` — a client-only wrapper around the Title filter input, submitted inside the existing server-rendered `<form method="GET">`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/listings/BookFilterField.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import BookFilterField from './BookFilterField'
import type { BookSuggestion } from '@/lib/openLibrary'

const DUNE: BookSuggestion = {
  title: 'Dune', author: 'Frank Herbert', year: 1965, isbn: null,
  coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL893415W',
}

describe('BookFilterField', () => {
  it('renders a title input named "title" with the given default value', () => {
    render(<BookFilterField defaultValue="Dune" style={{}} />)
    expect(screen.getByRole('textbox')).toHaveValue('Dune')
  })

  it('leaves the hidden ol_work_key field empty by default', () => {
    const { container } = render(<BookFilterField defaultValue="" style={{}} />)
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('')
  })

  it('selecting a suggestion fills the hidden ol_work_key field', async () => {
    const search = vi.fn().mockResolvedValue([DUNE])
    const { container } = render(<BookFilterField defaultValue="" style={{}} search={search} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dune' } })
    const option = await screen.findByText(/Dune — Frank Herbert/)
    fireEvent.click(option)
    expect(container.querySelector('input[name="ol_work_key"]')).toHaveValue('/works/OL893415W')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/listings/BookFilterField.test.tsx`
Expected: FAIL — `Cannot find module './BookFilterField'`.

- [ ] **Step 3: Write the implementation**

```tsx
// app/listings/BookFilterField.tsx
'use client'

import { useState } from 'react'
import BookSearchInput from '@/components/BookSearchInput'
import type { BookSuggestion } from '@/lib/openLibrary'

type Props = {
  defaultValue: string
  style: React.CSSProperties
  search?: (query: string) => Promise<BookSuggestion[]>
}

export default function BookFilterField({ defaultValue, style, search }: Props) {
  const [title, setTitle] = useState(defaultValue)
  const [olWorkKey, setOlWorkKey] = useState('')

  return (
    <>
      <input type="hidden" name="ol_work_key" value={olWorkKey} />
      <BookSearchInput
        name="title"
        value={title}
        onChange={v => { setTitle(v); setOlWorkKey('') }}
        onSelect={b => { setTitle(b.title); setOlWorkKey(b.workKey) }}
        placeholder="e.g. Great Gatsby..."
        style={style}
        search={search}
      />
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/listings/BookFilterField.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `BookFilterField` into the filter form**

In `app/listings/page.tsx`:

1. Add the import:
```typescript
import BookFilterField from './BookFilterField'
```

2. Add `ol_work_key` to the `searchParams` type and read it:
```typescript
  searchParams: {
    city?: string
    title?: string
    author?: string
    ol_work_key?: string
    type?: string
    genre?: string
    condition?: string
    sort?: string
  }
```
and, inside the component body, after the existing `const title = ...` line:
```typescript
  const olWorkKey = searchParams.ol_work_key ?? ''
```

3. Pass `olWorkKey` into `getListings`:
```typescript
  const [listings, { isLoggedIn, userId, savedIds }] = await Promise.all([
    getListings({ city, title, author, olWorkKey, type, genre, condition, sort }),
    getUserSaveContext(),
  ])
```

4. Replace the `.map(f => ...)` block that renders City/Title/Author with three explicit blocks (Title uses `BookFilterField`, City and Author stay plain inputs):
```tsx
        <div style={{ marginBottom: 22 }}>
          <span className="block mb-2.5" style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}>
            City
          </span>
          <input name="city" type="text" defaultValue={city} placeholder="e.g. Chicago..." style={filterInputStyle} />
        </div>

        <div style={{ marginBottom: 22 }}>
          <span className="block mb-2.5" style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}>
            Search Title
          </span>
          <BookFilterField defaultValue={title} style={filterInputStyle} />
        </div>

        <div style={{ marginBottom: 22 }}>
          <span className="block mb-2.5" style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.8px', color: '#aaa' }}>
            Search Author
          </span>
          <input name="author" type="text" defaultValue={author} placeholder="e.g. Tara Westover..." style={filterInputStyle} />
        </div>
```

5. Update `clearFilterUrl` to also drop `ol_work_key` whenever `title` is cleared:
```typescript
  function clearFilterUrl(key: string) {
    const p = new URLSearchParams()
    if (city && key !== 'city') p.set('city', city)
    if (title && key !== 'title') p.set('title', title)
    if (olWorkKey && key !== 'title') p.set('ol_work_key', olWorkKey)
    if (author && key !== 'author') p.set('author', author)
    if (type !== 'all' && key !== 'type') p.set('type', type)
    if (genre !== 'all' && key !== 'genre') p.set('genre', genre)
    if (condition !== 'any' && key !== 'condition') p.set('condition', condition)
    if (sort !== 'newest') p.set('sort', sort)
    return `/listings?${p.toString()}`
  }
```

- [ ] **Step 6: Add exact-match querying to `getListings`**

Replace `getListings`'s signature and body:
```typescript
async function getListings(params: {
  city?: string
  title?: string
  author?: string
  olWorkKey?: string
  type?: string
  genre?: string
  condition?: string
  sort?: string
}): Promise<Listing[]> {
  try {
    const supabase = createClient()

    if (params.olWorkKey) {
      const applyCommonFilters = (q: any) => {
        if (params.city) q = q.ilike('city', `%${params.city}%`)
        if (params.type === 'free') q = q.is('price', null)
        if (params.type === 'sale') q = q.not('price', 'is', null)
        if (params.genre && params.genre !== 'all') q = q.eq('genre', params.genre)
        if (params.condition && params.condition !== 'any') q = q.eq('condition', params.condition)
        return q
      }

      // Standalone listings for this exact book.
      const directQuery = applyCommonFilters(
        supabase.from('listings').select('*, profiles(username, city)')
          .in('status', ['active', 'pending']).eq('ol_work_key', params.olWorkKey)
      )

      // Bundles containing this exact book, via listing_books.
      const { data: bundleRows } = await supabase
        .from('listing_books').select('listing_id').eq('ol_work_key', params.olWorkKey)
      const bundleListingIds = [...new Set((bundleRows ?? []).map((r: any) => r.listing_id))]

      const [{ data: direct, error: directErr }, bundleResult] = await Promise.all([
        directQuery,
        bundleListingIds.length > 0
          ? applyCommonFilters(
              supabase.from('listings').select('*, profiles(username, city)')
                .in('status', ['active', 'pending']).in('id', bundleListingIds)
            )
          : Promise.resolve({ data: [] as any[], error: null }),
      ])
      if (directErr) console.error('Browse ol_work_key query error:', directErr)

      const merged: any[] = []
      const seen = new Set<string>()
      for (const row of [...(direct ?? []), ...((bundleResult as any).data ?? [])]) {
        if (!seen.has(row.id)) { seen.add(row.id); merged.push(row) }
      }
      if (params.sort === 'price-asc') merged.sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
      else if (params.sort === 'price-desc') merged.sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
      else merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      return merged as Listing[]
    }

    let query = supabase
      .from('listings')
      .select('*, profiles(username, city)')
      .in('status', ['active', 'pending'])

    if (params.city) query = query.ilike('city', `%${params.city}%`)
    if (params.title) query = query.ilike('title', `%${params.title}%`)
    if (params.author) query = query.ilike('author', `%${params.author}%`)
    if (params.type === 'free') query = query.is('price', null)
    if (params.type === 'sale') query = query.not('price', 'is', null)
    if (params.genre && params.genre !== 'all') query = query.eq('genre', params.genre)
    if (params.condition && params.condition !== 'any') query = query.eq('condition', params.condition)

    if (params.sort === 'price-asc') query = query.order('price', { ascending: true })
    else if (params.sort === 'price-desc') query = query.order('price', { ascending: false })
    else query = query.order('created_at', { ascending: false })

    const { data, error } = await query
    if (error) console.error('Browse query error:', error)
    console.log('Browse query returned', data?.length ?? 0, 'listings')
    return (data as Listing[]) ?? []
  } catch (err) {
    console.error('Browse listings exception:', err)
    return []
  }
}
```

- [ ] **Step 7: Manually verify**

This file has no existing unit test (page-level data fetching, same convention as Task 10). Verify manually:
1. Filter Browse by typing a title without picking a suggestion — confirm results are unchanged from today (plain `ilike` path).
2. Filter Browse by picking an Open Library suggestion for a book you've posted a listing for with that same suggestion picked — confirm the listing appears.
3. Filter Browse by picking a suggestion for a book that's inside someone's bundle (not the bundle's book 1) — confirm the bundle listing appears.
4. Click the "×" on the active Title filter tag — confirm both `title` and `ol_work_key` clear from the URL.

- [ ] **Step 8: Commit**

```bash
git add app/listings/BookFilterField.tsx app/listings/BookFilterField.test.tsx app/listings/page.tsx
git commit -m "feat: exact ol_work_key Browse filtering ahead of the ilike fallback"
```

---

### Task 12: Cover image fallback display

**Files:**
- Modify: `next.config.mjs`
- Modify: `app/listings/[id]/page.tsx`
- Modify: `app/listings/page.tsx`

**Interfaces:**
- Consumes: `listings.cover_url`, `listing_books.cover_url` (Task 1).

- [ ] **Step 1: Allow `covers.openlibrary.org` for `next/image`**

In `next.config.mjs`, add a second entry to `images.remotePatterns`:
```javascript
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'qlctujyuupighlvzryva.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'covers.openlibrary.org',
        pathname: '/b/id/**',
      },
    ],
  },
```

- [ ] **Step 2: Fall back to `cover_url` on the listing detail page**

In `app/listings/[id]/page.tsx`, add a computed variable right before the `return (` statement:
```typescript
  const uploadedPhotos = [listing.photo_url, listing.photo_url_2, listing.photo_url_3].filter(Boolean)
  const displayPhotos = uploadedPhotos.length > 0 ? uploadedPhotos : (listing.cover_url ? [listing.cover_url] : [])
```

Change the `<PhotoGallery>` call's `photos` prop:
```tsx
        <PhotoGallery
          photos={displayPhotos}
          alt={listing.title}
          gradient={gradient}
        >
```

- [ ] **Step 3: Fetch `cover_url` for bundle books and show thumbnails**

Change the bundle books query:
```typescript
      const { data: books } = await supabase
        .from('listing_books').select('title, author, cover_url').eq('listing_id', listing.id).order('position', { ascending: true })
```

Replace the "Books in this Bundle" list's two rows (book 1 and the mapped additional books):
```tsx
                <div style={{ padding: '10px 14px', borderRadius: 12, background: '#fff7ed', border: '2px solid #fed7aa', display: 'flex', alignItems: 'center', gap: 10 }}>
                  {listing.cover_url && (
                    <img src={listing.cover_url} alt="" style={{ width: 32, height: 46, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                  )}
                  <div>
                    <span className="font-black text-[14px]">{listing.title}</span>
                    <span className="font-semibold text-[13px]" style={{ color: '#888' }}> — {listing.author}</span>
                  </div>
                </div>
                {(listing.books ?? []).map((b: { title: string; author: string; cover_url: string | null }, i: number) => (
                  <div key={i} style={{ padding: '10px 14px', borderRadius: 12, background: '#fff7ed', border: '2px solid #fed7aa', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {b.cover_url && (
                      <img src={b.cover_url} alt="" style={{ width: 32, height: 46, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                    )}
                    <div>
                      <span className="font-black text-[14px]">{b.title}</span>
                      <span className="font-semibold text-[13px]" style={{ color: '#888' }}> — {b.author}</span>
                    </div>
                  </div>
                ))}
```

- [ ] **Step 4: Fall back to `cover_url` on Browse cards**

In `app/listings/page.tsx`, replace the card image block:
```tsx
                      {l.photo_url ? (
                        <Image src={l.photo_url} alt={l.title} fill className="object-cover" />
                      ) : l.cover_url ? (
                        <Image src={l.cover_url} alt={l.title} fill className="object-cover" />
                      ) : (
                        <span>📚</span>
                      )}
```

- [ ] **Step 5: Manually verify**

1. Restart the dev server (`next.config.mjs` changes require a restart).
2. Post a listing without uploading a photo, picking an Open Library suggestion with a cover — confirm the listing card and detail page show that cover instead of the 📚 placeholder.
3. Post a listing *with* an uploaded photo and an Open Library suggestion — confirm the uploaded photo still takes priority everywhere.
4. Post a bundle where only some books have a resolved cover — confirm each itemized row shows its own cover or no thumbnail, independently.

- [ ] **Step 6: Commit**

```bash
git add next.config.mjs "app/listings/[id]/page.tsx" app/listings/page.tsx
git commit -m "feat: fall back to Open Library cover_url when no uploaded photo exists"
```

---

### Task 13: TBR dashboard card cover thumbnails

**Files:**
- Modify: `app/profile/DashboardClient.tsx`

**Interfaces:**
- Consumes: `tbr_entries.cover_url` (Task 1, already flowing through `TbrEntry` type from Task 9).

- [ ] **Step 1: Add a thumbnail to the desktop TBR table row**

In the desktop table row (the `.map(entry => ...)` under "Desktop: table with column headers"), change the row's grid template to make room for a thumbnail column and render one:
```tsx
                  <div key={entry.id} className="grid gap-3 items-center px-1"
                    style={{ gridTemplateColumns: '46px 2fr 1.5fr 1fr 70px 150px', padding: '12px 4px', borderBottom: '2px solid #f3f4f6', ...(isUnread ? { background: '#f5f3ff', borderRadius: 10 } : {}) }}>
                    {entry.cover_url ? (
                      <img src={entry.cover_url} alt="" style={{ width: 32, height: 46, objectFit: 'cover', borderRadius: 4 }} />
                    ) : (
                      <span style={{ width: 32, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📚</span>
                    )}
                    <span className="font-black text-[14px] truncate">{entry.title || '—'}</span>
```
(Keep every following `<span>`/`<div>` in that row exactly as-is — only the wrapping `gridTemplateColumns` and the new leading thumbnail cell change.)

Also update the header row immediately above it to match the new 6-column grid:
```tsx
                <div className="grid gap-3 px-1 pb-2" style={{ gridTemplateColumns: '46px 2fr 1.5fr 1fr 70px 150px', borderBottom: '2px solid #f3f4f6' }}>
                  {['', 'Title', 'Author', 'City', 'State', ''].map(h => (
```

- [ ] **Step 2: Add a thumbnail to the mobile TBR card**

In the mobile stacked-card `.map(entry => ...)` block, wrap the existing card content in a flex row with the thumbnail alongside it:
```tsx
                  <div key={entry.id} style={{ padding: '12px 0', borderBottom: '2px solid #f3f4f6', display: 'flex', gap: 10, ...(isUnread ? { background: '#f5f3ff', borderRadius: 10 } : {}) }}>
                    {entry.cover_url ? (
                      <img src={entry.cover_url} alt="" style={{ width: 32, height: 46, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }} />
                    ) : (
                      <span style={{ width: 32, height: 46, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>📚</span>
                    )}
                    <div style={{ flex: 1 }}>
                    <p className="font-black text-[14px] truncate">
                      {entry.title || `by ${entry.author}`}
                    </p>
                    <p className="font-semibold text-[12px] mb-2" style={{ color: '#aaa' }}>
                      {[entry.title && entry.author ? `by ${entry.author}` : null, entry.city, entry.state]
                        .filter(Boolean).join(' · ')}
                    </p>
                    <div className="flex items-center gap-3 flex-wrap">
                      {entry.match && (
                        <Link href={`/listings/${entry.match.id}`}
                          className="font-extrabold text-[12px] text-white whitespace-nowrap"
                          style={{ background: '#7c3aed', padding: '6px 14px', borderRadius: 999, boxShadow: '0 2px 0 #5b21b6' }}>
                          📖 Available!
                        </Link>
                      )}
                      <form action={removeTbrEntry}>
                        <input type="hidden" name="id" value={entry.id} />
                        <button className="font-extrabold text-[11px] hover:opacity-80"
                          style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', padding: 0 }}>
                          ✕ Delete
                        </button>
                      </form>
                    </div>
                    </div>
                  </div>
```
(This adds one closing `</div>` before the row's final `</div>` — the new wrapping `<div style={{ flex: 1 }}>` around the existing title/meta/actions content.)

- [ ] **Step 3: Manually verify**

1. Add a TBR entry via a picked Open Library suggestion (has a cover) — confirm its thumbnail shows on both desktop and mobile layouts (resize the browser or use dev tools device emulation).
2. Add a TBR entry via plain free text (no cover) — confirm the 📚 placeholder shows instead, and nothing else in the row shifts unexpectedly.

- [ ] **Step 4: Commit**

```bash
git add app/profile/DashboardClient.tsx
git commit -m "feat: show Open Library cover thumbnails on TBR dashboard cards"
```

---

## Post-Plan Verification

- [ ] Run the full test suite once: `npx vitest run`
- [ ] Expected: PASS, no failures, no unexpected skips.
