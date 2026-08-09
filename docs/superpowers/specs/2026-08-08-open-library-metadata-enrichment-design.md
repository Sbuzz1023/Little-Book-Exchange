# Open Library Metadata Enrichment — Genre & ISBN — Design

**Date:** 2026-08-08
**Status:** Approved
**Depends on:** `2026-08-08-open-library-integration-design.md` (the base Open Library search/autocomplete integration this extends)

## Overview

The base Open Library integration already resolves a `BookSuggestion` (title, author, year, cover, work key) whenever a user picks a book while posting a listing — but two pieces of readily-available Open Library data go unused: **subject/genre classification** and **ISBN**. This feature pulls both in, for the Post form's main book field only (not bundle rows, not TBR, not Browse — those keep their current scope).

- **Genre:** Open Library's subject data is freeform and messy (a popular book can carry 15–100+ tags like "Fiction", "American literature", "Reading Level-Grade 9"). The app's Genre picker, by contrast, is a fixed 12-category list that also drives Browse's genre filter. Rather than replacing that picker with raw tags, this feature does a best-effort keyword mapping from subjects to the closest existing category and pre-selects it — the picker stays fully manual/overridable, nothing about its mechanism changes.
- **ISBN:** the Post form already has an ISBN text input (`app/post/PostForm.tsx`) that has never been wired to anything — no state, no persistence, no `isbn` column. This feature completes it: auto-filled from the selected suggestion, persisted, and shown on the listing detail page.

Both are entirely best-effort/optional — a suggestion with no recognizable subject leaves the Genre picker exactly as it was, and a suggestion with no ISBN leaves that field blank, exactly like today.

---

## 1. Fetching subject data (`lib/actions/openLibrary.ts`)

Add `subject` to the existing Open Library Search API query's `fields` parameter:
```
&fields=title,author_name,first_publish_year,isbn,cover_i,key,subject
```
No other change to this file — same request shape, same error handling, same no-test convention (server actions aren't unit tested in this codebase).

---

## 2. Genre mapping (`lib/openLibrary.ts`)

`OpenLibraryDoc` gains `subject?: string[]`. A new pure function maps a doc's subjects to one of the app's existing 12 Genre categories, checked in this exact priority order against the lowercased, joined subject list — most specific category first, so a book tagged with both "Fiction" and "Science fiction" correctly resolves to Sci-Fi rather than the generic Fiction bucket:

```typescript
const GENRE_KEYWORDS: [string, string[]][] = [
  ["Children's", ["juvenile", "children's stories", 'picture books']],
  ['Mystery',    ['mystery', 'detective', 'thriller', 'crime']],
  ['Sci-Fi',     ['science fiction', 'fantasy']],
  ['Romance',    ['romance', 'love stories']],
  ['Biography',  ['biography', 'autobiography']],
  ['Self-Help',  ['self-help', 'self help', 'personal growth']],
  ['Cooking',    ['cooking', 'cookery', 'cookbooks']],
  ['Art',        ['art', 'design', 'photography']],
  ['History',    ['history', 'historical']],
  ['Non-Fiction', ['non-fiction', 'nonfiction']],
  ['Fiction',    ['fiction']],
]

export function mapSubjectsToGenre(subjects: string[]): string | null {
  const joined = subjects.join(' | ').toLowerCase()
  for (const [genre, keywords] of GENRE_KEYWORDS) {
    if (keywords.some(kw => joined.includes(kw))) return genre
  }
  return null
}
```

`BookSuggestion` gains a `genre: string | null` field, computed inside `normalizeSearchResults` via `mapSubjectsToGenre(d.subject ?? [])` — the same pattern already used for deriving `coverUrl` from `cover_i`. Consumers (the Post form) just read `.genre`; nothing outside this file needs to know raw subjects exist. `isbn` is unchanged — `normalizeSearchResults` already extracts it (`d.isbn?.[0] ?? null`), this feature just starts using the value that was already there.

---

## 3. Data model

```sql
ALTER TABLE listings ADD COLUMN IF NOT EXISTS isbn text;
```
Nullable, matching every other Open-Library-sourced column. No `genre` schema change — genre already exists as a `listings.genre text` column (it's been a plain user-selected string since before this feature), this just changes what pre-fills the picker that writes to it.

---

## 4. Post form wiring (`app/post/PostForm.tsx`, main book only)

- The existing ISBN `<input name="isbn" type="text" placeholder="978-..." style={inputStyle} />` becomes a controlled field: new `const [isbn, setIsbn] = useState(initialValues?.isbn ?? '')` state, with `value={isbn}` / `onChange={e => setIsbn(e.target.value)}` added.
- `selectBook` gains two lines:
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
  `genre` is only overwritten when a mapping was actually found (`if (book.genre)`) — an unrecognized subject list leaves whatever the user already had selected (including the `'Fiction'` default) untouched, since forcing an "unknown → Fiction" default would be actively misleading. `isbn` always gets set (including to `''` when the suggestion has none), matching how `author` already behaves for a suggestion with no author — consistent, predictable behavior across every field `selectBook` touches.
- `Props.initialValues` gains `isbn?: string | null`, for edit-mode pre-fill.
- The Genre picker's click handlers, button rendering, and the bundle rows are entirely untouched — this only adds a new way to *pre-select* a value that the picker already fully owns.

`parseListingForm` reads `isbn` from the form the same way it already reads every other field, and it flows into `createListing`/`updateListing` through the existing `...fields` spread — no `app/post/actions.ts` change needed, identical to how `ol_work_key`/`cover_url` needed no action-layer change in the base integration.

---

## 5. Display (`app/listings/[id]/page.tsx`)

When `listing.isbn` is set, show it near the existing condition/genre/location badge row — small addition, not a new section:
```tsx
{listing.isbn && (
  <span className="text-[13px] font-extrabold" style={{ padding: '8px 16px', borderRadius: 12, background: '#f3f4f6', color: '#555' }}>
    ISBN {listing.isbn}
  </span>
)}
```

---

## Testing

- Unit tests for `mapSubjectsToGenre` in `lib/openLibrary.test.ts`: each of the 11 categories matched by its keyword(s); the Sci-Fi-vs-generic-Fiction priority case (a subject list containing both "Fiction" and "Science fiction" resolves to Sci-Fi); the Biography-vs-History priority case (a subject list containing both "History" and "Biography" resolves to Biography, mirroring the real Open Library data checked during design); an empty/no-match subject list returning `null`.
- Extend `normalizeSearchResults`'s existing tests to cover `genre` being present when subjects map, and `null` when they don't or `subject` is absent from the doc.
- No test needed for `app/post/actions.ts` (unchanged) or `app/listings/[id]/page.tsx` (page-level, no test convention, per this codebase's established pattern).
- `PostForm.test.tsx` gains a case confirming `selectBook` sets both the Genre picker's selected state and the ISBN field from a suggestion's `genre`/`isbn`, and a case confirming an unmapped suggestion (`genre: null`) leaves the existing Genre selection untouched.

## Out of Scope

- Bundle rows, TBR add form, and Browse filter — none of these get genre/ISBN capture, per the scoping decision. Bundle books keep title/author/cover only; genre is a whole-listing field regardless.
- Persisting or displaying raw Open Library subject tags anywhere — they're consumed transiently to compute one genre value and discarded, never stored.
- Editing/re-mapping genre after initial selection based on a later title edit — matches the base integration's existing pattern where editing title/author after a pick just clears `ol_work_key`/`cover_url` (and now `isbn`/mapped `genre` are simply left at whatever they were last set to, not re-computed).
- ISBN validation/format-checking — stored as free text exactly as received from Open Library (or left blank), same trust level as every other field on this form.

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `listings.isbn` (nullable text) |
| `lib/actions/openLibrary.ts` | Add `subject` to the Open Library query's `fields` param |
| `lib/openLibrary.ts` | `OpenLibraryDoc.subject`; new `mapSubjectsToGenre`; `BookSuggestion.genre` computed in `normalizeSearchResults` |
| `lib/openLibrary.test.ts` | Tests for `mapSubjectsToGenre` and the new `genre` field on normalized results |
| `app/post/PostForm.tsx` | Controlled ISBN field + state; `selectBook` sets `genre` (if mapped) and `isbn`; `initialValues.isbn` |
| `app/post/PostForm.test.tsx` | Tests for genre/ISBN auto-fill on selection, and unmapped-genre no-op |
| `app/listings/[id]/page.tsx` | Show ISBN badge when present |
