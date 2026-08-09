# Genre Keyword Word-Boundary Matching — Design

**Date:** 2026-08-09
**Status:** Approved
**Depends on:** `2026-08-08-open-library-metadata-enrichment-design.md` (the `mapSubjectsToGenre` function this fixes)

## Problem

`mapSubjectsToGenre` (`lib/openLibrary.ts`) matches genre keywords with plain substring search (`joined.includes(kw)`), which matches a keyword hiding anywhere inside an unrelated word — not just as its own word. Confirmed real cases:

- `['Crimean War, 1853-1856', 'History']` → maps to **Mystery**, because "Crimean" contains "crime".
- `['Earth sciences', 'Nonfiction', 'Geology']` → maps to **Art**, because "Earth" contains "art" (also hits "he**art**", "ch**art**", "dep**art**ment", etc. — the single riskiest keyword in the list).

This was partially masked by a prior fix (reordering `GENRE_KEYWORDS` so `Non-Fiction`/`Fiction` are checked before `Art`/`History`), but the underlying substring-matching bug remains for any case that reorder doesn't happen to cover.

## Goal

Genre keywords match only as whole words/phrases — never as a substring buried inside a longer, unrelated word — while keeping every currently-correct match working exactly as it does today.

## Design

This codebase already has the exact right tool: `tbrMatchPattern` (`lib/tbrMatch.ts`), built for the TBR-matching feature specifically to solve this same problem ("matches `value` only as a whole word or bounded phrase, not as a substring inside another word"), already tested for this exact scenario. Reuse it rather than writing new matching logic.

`mapSubjectsToGenre` changes from:
```typescript
export function mapSubjectsToGenre(subjects: string[]): string | null {
  const joined = subjects.join(' | ').toLowerCase()
  for (const [genre, keywords] of GENRE_KEYWORDS) {
    if (keywords.some(kw => joined.includes(kw))) return genre
  }
  return null
}
```
to:
```typescript
import { tbrMatchPattern } from './tbrMatch'

export function mapSubjectsToGenre(subjects: string[]): string | null {
  const joined = subjects.join(' | ')
  for (const [genre, keywords] of GENRE_KEYWORDS) {
    if (keywords.some(kw => new RegExp(tbrMatchPattern(kw), 'i').test(joined))) return genre
  }
  return null
}
```
`.toLowerCase()` is dropped — the regex's `i` flag now handles case-insensitivity, so lowercasing beforehand is redundant. `GENRE_KEYWORDS` itself is untouched (no keyword list or ordering changes) — only the matching mechanism changes.

**Verified by hand-tracing all 16 existing test cases (14 original + 2 regression) against the new matching logic — every one resolves to the same expected genre.** This is a pure bug fix with no behavior change to any currently-correct case.

## Known residual limitation (explicitly out of scope)

Word-boundary matching fixes "keyword hides inside an unrelated word" (the majority of real cases seen so far). It does **not** fix "a real whole word coincidentally means something else in this context" — e.g. `['Romance languages', 'French language']` still maps to Romance, because "Romance" genuinely appears there as its own whole word; the ambiguity is in word *meaning*, not word *boundaries*. Solving that would require real subject-classification logic, not a matching-mechanism fix, and is out of scope here.

## Testing

Add to `lib/openLibrary.test.ts`, inside the existing `describe('mapSubjectsToGenre', ...)` block:
- `mapSubjectsToGenre(['Crimean War, 1853-1856', 'History'])` → `'History'` (regression: "Crimean" no longer false-matches the Mystery keyword "crime").
- `mapSubjectsToGenre(['Charts, diagrams, etc', 'History'])` → `'History'` (regression: "Charts" no longer false-matches the Art keyword "art").
- A case confirming a real, correct Art match still works with the new matching, e.g. `mapSubjectsToGenre(['Art', 'Painting'])` → `'Art'`.

No other file changes. `normalizeSearchResults`'s existing tests are unaffected (they only assert on the resulting `genre` value, not the matching mechanism).

## Files Changed

| File | Change |
|---|---|
| `lib/openLibrary.ts` | `mapSubjectsToGenre` uses `tbrMatchPattern`-based regex matching instead of substring `.includes()`; new import from `./tbrMatch` |
| `lib/openLibrary.test.ts` | Two regression tests + one Art-still-works sanity test |
