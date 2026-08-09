# Genre Keyword Word-Boundary Matching — Design

**Date:** 2026-08-09
**Status:** Approved
**Depends on:** `2026-08-08-open-library-metadata-enrichment-design.md` (the `mapSubjectsToGenre` function this fixes)

## Problem

`mapSubjectsToGenre` (`lib/openLibrary.ts`) matches genre keywords with plain substring search (`joined.includes(kw)`), which matches a keyword hiding anywhere inside an unrelated word — not just as its own word. Verified directly against the current (already keyword-reordered) source — these two still reproduce today:

- `mapSubjectsToGenre(['Crimean War, 1853-1856', 'History'])` → maps to **Mystery**, because "Crimean" contains "crime". (`Mystery` is checked 2nd, well before `History` — the earlier reorder fix doesn't touch this pair at all.)
- `mapSubjectsToGenre(['Earth sciences', 'Geology'])` → maps to **Art**, because "Earth" contains "art" (also hits "he**art**", "ch**art**", "dep**art**ment", etc. — the single riskiest keyword in the list). Note: adding an explicit `'Nonfiction'` tag to this same subject list would currently "accidentally" resolve correctly (the prior reorder put `Non-Fiction` ahead of `Art`) — but that's incidental cover, not a real fix; drop the explicit `Nonfiction` tag and the bug is exposed again, as shown here.

The prior fix (reordering `GENRE_KEYWORDS` so `Non-Fiction`/`Fiction` are checked before `Art`/`History`) only ever helped cases where a *more specific, still-substring-matched* keyword happened to fire first — it did not address the underlying substring-matching bug itself, which both examples above still demonstrate.

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

## Plural-form handling (added after initial review)

The initial word-boundary fix above accidentally stopped matching plural forms of
keywords — e.g. `['Arts']`, `['Detectives']`, `['Romances']` all stopped resolving to
their expected genres, because `tbrMatchPattern`'s right boundary (`(\W|$)`) requires
the keyword to be followed immediately by a non-word character or end-of-string, with
no allowance for a trailing "s". This is a false-negative regression found in the
final whole-branch review (distinct from the original false-positive substring-matching
bug this design fixes). The fix adds an optional trailing "s" to the boundary pattern
used in `mapSubjectsToGenre` (`(^|\\W)${escapeRegex(kw)}s?(\\W|$)`), inlined locally
rather than changing `tbrMatchPattern` itself, since that helper's no-plural-handling
contract is correct for its original TBR-matching use case. Verified against 32 cases
total: the 19 from the original fix above, plus 9 plural-regression cases, plus 4
anti-false-positive sanity checks confirming the trailing "s" doesn't reopen substring
false-positives (e.g. `'Parts'` and `'Starts'` still correctly return `null`).

## Testing

Add to `lib/openLibrary.test.ts`, inside the existing `describe('mapSubjectsToGenre', ...)` block:
- `mapSubjectsToGenre(['Crimean War, 1853-1856', 'History'])` → `'History'` (regression: "Crimean" no longer false-matches the Mystery keyword "crime"; verified this case still returns `'Mystery'` under the current pre-fix code).
- `mapSubjectsToGenre(['Earth sciences', 'Geology'])` → `null` (regression: "Earth" no longer false-matches the Art keyword "art"; verified this case still returns `'Art'` under the current pre-fix code — expecting `null` here, not some other genre, since nothing in this subject list legitimately maps to any of the 11 categories once the false match is removed).
- A case confirming a real, correct Art match still works with the new matching, e.g. `mapSubjectsToGenre(['Art', 'Painting'])` → `'Art'`.

No other file changes. `normalizeSearchResults`'s existing tests are unaffected (they only assert on the resulting `genre` value, not the matching mechanism).

## Files Changed

| File | Change |
|---|---|
| `lib/openLibrary.ts` | `mapSubjectsToGenre` uses `tbrMatchPattern`-based regex matching instead of substring `.includes()`; new import from `./tbrMatch` |
| `lib/openLibrary.test.ts` | Two regression tests + one Art-still-works sanity test |
