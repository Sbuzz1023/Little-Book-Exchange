# Open Library Book Metadata Integration — Design

**Date:** 2026-08-08
**Status:** Approved

## Overview

Every book in the app today is a free-typed pair of strings — `title` and `author` — entered on the Post form, the TBR "add" form, and matched against each other with a whole-word regex (`lib/tbrMatch.ts`) to notify a TBR user when a matching listing appears. There's no concept of "this is a specific, real book": a typo, an alternate title/edition, or inconsistent formatting between a TBR entry and a listing can silently break a match, and nothing stops (or helps avoid) a listing being posted for a book that doesn't really exist as typed.

This feature integrates the [Open Library Search API](https://openlibrary.org/developers/api) (free, no API key, run by the nonprofit Internet Archive) as a type-ahead lookup in three places — the Post form (including bundle rows), the TBR add form, and the Browse filter bar — so a user picks a real, identified book instead of typing a guess. The book's Open Library **work key** (a stable identifier independent of typos/edition/title variant) is stored alongside the existing `title`/`author` text, and TBR-to-listing matching gets a new exact-match path on that key, falling back to today's regex only when a key isn't available. Cover art from Open Library is shown during search and persisted for later display (TBR cards, bundle itemized contents, and as a fallback listing image).

Nothing about this is a hard requirement to use — every integration point still accepts plain free text if a user ignores the suggestions or Open Library is unreachable, so posting/searching/adding to TBR is never blocked by a third-party outage or a book Open Library doesn't have (e.g. self-published or rare books).

---

## 1. Provider integration (`lib/actions/openLibrary.ts`)

A new `'use server'` function, `searchBooks(query: string)`, proxies Open Library's Search API server-side:

```
GET https://openlibrary.org/search.json?q={query}&fields=title,author_name,first_publish_year,isbn,cover_i,key&limit=8
```

- **Why server-side:** browsers block scripts from setting a custom `User-Agent` header on `fetch`. Open Library's documented rate limit is 1 req/sec unidentified vs. 3 req/sec with an identifying `User-Agent` + contact email — a server-side proxy is the only way to actually send that header.
- `User-Agent` value is built from an env var (e.g. `OPEN_LIBRARY_CONTACT_EMAIL`), not hardcoded, so it's easy to change without a code edit.
- Response is normalized to `{ title, author, year, isbn, coverUrl, workKey }[]`, where `coverUrl` is built from `cover_i` (`https://covers.openlibrary.org/b/id/{cover_i}-M.jpg`) and `workKey` is the `key` field (e.g. `/works/OL45804W`).
- No API key, no billing — free and within Open Library's stated intended use (a per-user, human-facing discovery lookup, not bulk harvesting or high-traffic backend infra).

---

## 2. Data model

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

All six columns are nullable. Existing rows simply have `ol_work_key`/`cover_url` as `null` and keep working exactly as they do today (text-only matching, no cover shown) — no backfill migration. A user only gets a verified `ol_work_key`/`cover_url` the next time they post, edit, or add a TBR entry through the new search UI.

---

## 3. Shared component (`components/BookSearchInput.tsx`)

One reusable debounced type-ahead component: as the user types, it calls `searchBooks` (client-side, debounced ~300ms) and renders a dropdown of matches, each showing title, author, year, and a small cover thumbnail. Selecting a result:

- Fills the underlying `title`/`author` text (so the value looks identical to typed text — nothing downstream needs to know the difference).
- Sets a hidden `ol_work_key` field.
- Shows a small persistent cover thumbnail next to the field as a "this is the book you picked" confirmation.

If the user types and never selects a suggestion (or Open Library errors/times out), the field just behaves as a normal text input — `ol_work_key` stays empty, matching today's behavior exactly.

This component is reused, with different wiring, in four places:

### Post form (`app/post/PostForm.tsx`)
Replaces the main Title/Author inputs, and — per book row — the bundle "Additional Book" rows (Section 2 of the bundle-listings design). The existing "✨ Auto-fill from Book 1" button and running book/credit total are unaffected. Each row's selected `ol_work_key`/`cover_url` is submitted the same way `book_title_{i}`/`book_author_{i}` already are today (indexed hidden fields), for `parseBundleBooks` to pick up.

### TBR add form (`app/profile/DashboardClient.tsx`, TBR tab)
Replaces the "Book title..."/"Author (optional)..." inputs in the purple `+ Add` form. City/State fields are unchanged.

### Browse filter bar (`app/listings/page.tsx`)
This form is currently a plain server-rendered `<form method="GET" action="/listings">` with zero client JS — filtering works by full navigation with query params. Only the Title/Author fields become a small client component wrapping the same `name="title"`/`name="author"` text inputs (so the GET submission is unchanged) plus a hidden `ol_work_key` param filled in on selection. No other part of the filter form changes.

---

## 4. Listing creation & editing (`app/post/actions.ts`, `lib/parseListingForm.ts`)

- **`createListing`/`updateListing`:** the `listings` insert/update now also carries `ol_work_key`/`cover_url` from the main book fields.
- **`parseBundleBooks`:** gains `ol_work_key`/`cover_url` per row, inserted into `listing_books` alongside `title`/`author`/`position` exactly as today (bulk-insert on create, wholesale delete-and-reinsert on update — no new pattern, matches the existing bundle-listings behavior).

---

## 5. TBR matching (`app/profile/page.tsx`)

Today, for each TBR entry, a live query runs:
```ts
if (titleUsable)  query = query.regexIMatch('title', tbrMatchPattern(entry.title))
if (authorUsable) query = query.regexIMatch('author', tbrMatchPattern(entry.author))
if (entry.city)   query = query.regexIMatch('city', tbrMatchPattern(entry.city))
```

This gains an exact-match path ahead of the regex: when `entry.ol_work_key` is set, match listings where `listings.ol_work_key = entry.ol_work_key` **or** a row in `listing_books` has that same key (so a TBR want matches a bundle containing that book, not just a standalone listing of it) — `city` still applies as today either way. Only when `entry.ol_work_key` is null does the existing whole-word regex text match run, unchanged. This fixes the two concrete gaps discussed: typos/formatting differences no longer break a match, and title/edition variants (e.g. US vs. UK titles) that resolve to the same Open Library work now match correctly.

---

## 6. Browse filtering (`app/listings/page.tsx`)

When a suggestion is picked in the filter bar, the page navigates with `ol_work_key` as a new query param. The listings query filters on `listings.ol_work_key = key` **or** an `EXISTS` match against `listing_books.ol_work_key = key` (surfacing bundles containing that exact book). When no `ol_work_key` param is present (free-typed text, or a pre-migration browser bookmark/link), the existing `ilike` substring filter on `title`/`author` runs exactly as it does today — fully backward compatible.

---

## 7. Cover image display

- **During search** — dropdown thumbnails + a persistent selected-preview thumbnail, in all four `BookSearchInput` usages (Section 3).
- **Listing detail page / Browse cards** — `listings.photo_url` (the seller's own photo of their actual copy) stays the primary image, completely unchanged. Only when a listing has no `photo_url` does the page fall back to `listings.cover_url` (Open Library) — a real photo always wins when one exists.
- **Bundle itemized contents list** (`app/listings/[id]/page.tsx`, existing "📚 Books in this Bundle" section from the bundle-listings feature) — gains a small cover thumbnail next to each book's title/author line, from `listing_books.cover_url`.
- **TBR dashboard cards** (`app/profile/DashboardClient.tsx`, TBR tab) — gains a small cover thumbnail per entry, from `tbr_entries.cover_url`. TBR entries have no image today, so this is new, not a change to existing layout.

Cover images are always displayed by reference (hotlinked from `covers.openlibrary.org`), never downloaded/re-hosted — matches Open Library's documented usage norms and avoids any question of redistributing third-party cover art.

---

## 8. Error handling / fallback

Consistent everywhere: if `searchBooks` errors, times out, or returns no results, the relevant input just behaves like a plain text field — no error message, no blocked submission, no required retry. This applies uniformly to the Post form, TBR add form, and Browse filter. A book Open Library doesn't have (self-published, rare, obscure) is posted/searched/added exactly as it would be today, just without a `ol_work_key`/`cover_url`.

---

## Testing

- Colocated vitest unit tests for the Open Library response-normalizing helper in `lib/actions/openLibrary.ts` (mapping raw Open Library JSON → the normalized `{title, author, year, isbn, coverUrl, workKey}` shape, including missing-field cases like no `cover_i`).
- Unit tests for the new exact-match-then-fallback logic used in TBR matching (Section 5) and Browse filtering (Section 6), following the existing test conventions (e.g. `lib/parseListingForm.test.ts`, `lib/tbrMatch.test.ts` if introduced) — covering: both sides have a key and match, both have a key and don't match, one/both sides missing a key (falls back to today's behavior).
- No new tests needed for `BookSearchInput` beyond what a lightweight component test already covers elsewhere in the app (e.g. `components/ShareToggle.test.tsx` as the pattern) — debounce/dropdown behavior, not business logic.

---

## Out of Scope

- Backfilling `ol_work_key`/`cover_url` onto existing listings/TBR entries — they keep working via the existing text-match/no-cover fallback until next edited through the new UI.
- Any change to how `listings.photo_url` itself is captured/uploaded — the seller's real photo remains the primary, unchanged image everywhere it's shown.
- Reverse geocoding or any location-lookup feature — unrelated to this feature (see the separate, paused Mapbox integration discussion).
- Bulk-caching or redistributing Open Library data beyond per-user interactive lookups — would fall outside Open Library's stated intended use.
- International editions/non-English search tuning — Open Library's default search ranking is used as-is, no custom relevance tuning.

---

## Files Changed

| File | Change |
|---|---|
| `supabase/schema.sql` | New migration: `ol_work_key`/`cover_url` added to `listings`, `listing_books`, `tbr_entries` |
| `lib/actions/openLibrary.ts` | New — `searchBooks(query)` server action proxying Open Library's Search API with an identifying `User-Agent` |
| `components/BookSearchInput.tsx` | New — shared debounced type-ahead + cover-thumbnail dropdown component |
| `app/post/PostForm.tsx` | Main Title/Author inputs and each bundle row use `BookSearchInput` |
| `lib/parseListingForm.ts` | `parseBundleBooks` gains `ol_work_key`/`cover_url` per row |
| `app/post/actions.ts` | `createListing`/`updateListing` persist `ol_work_key`/`cover_url` on `listings` and `listing_books` |
| `app/profile/DashboardClient.tsx` | TBR add form uses `BookSearchInput`; TBR cards show `cover_url` thumbnail |
| `app/profile/page.tsx` | TBR-to-listing matching gains exact `ol_work_key` path ahead of the existing regex fallback |
| `app/listings/page.tsx` | Filter bar's Title/Author fields use `BookSearchInput` (GET submission unchanged); query filters on `ol_work_key` when present, falls back to `ilike` |
| `app/listings/[id]/page.tsx` | Listing image falls back to `cover_url` when no `photo_url`; bundle itemized contents list shows `listing_books.cover_url` thumbnails |
