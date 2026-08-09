# Genre Keyword Word-Boundary Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `mapSubjectsToGenre` so genre keywords match only as whole words/phrases, not as a substring hiding inside an unrelated word (e.g. "art" inside "he**art**"/"e**art**h", "crime" inside "**Crime**an").

**Architecture:** Reuse `tbrMatchPattern` (`lib/tbrMatch.ts`) — already built and tested for exactly this problem in the TBR-matching feature — instead of writing new matching logic. `GENRE_KEYWORDS` itself (keyword lists and priority order) is untouched; only the matching mechanism inside `mapSubjectsToGenre` changes.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints

- `GENRE_KEYWORDS`'s keyword lists and priority order must not change — this is a matching-mechanism fix only, verified (by hand-trace and by running the actual logic standalone before writing this plan) to preserve every currently-correct classification.
- No new files, no new dependencies — `tbrMatchPattern` is already exported from `lib/tbrMatch.ts`.
- The known residual limitation (word-*meaning* ambiguity, e.g. "Romance languages" still mapping to Romance) is explicitly out of scope — do not attempt to fix it here.

---

### Task 1: Word-boundary genre keyword matching

**Files:**
- Modify: `lib/openLibrary.ts`
- Modify: `lib/openLibrary.test.ts`

**Interfaces:**
- Consumes: `tbrMatchPattern` from `lib/tbrMatch.ts` (existing, unchanged).
- Produces: no change to `mapSubjectsToGenre`'s signature (`(subjects: string[]) => string | null`) — only its internal matching logic changes. No downstream consumer (`normalizeSearchResults`, `PostForm.tsx`) needs any change.

- [ ] **Step 1: Write the failing tests**

Append to `lib/openLibrary.test.ts`, inside the existing `describe('mapSubjectsToGenre', ...)` block (after the 14 existing cases, before the closing `})`):

```typescript
  it('does not match "crime" hiding inside "Crimean" (regression: word-boundary matching)', () => {
    expect(mapSubjectsToGenre(['Crimean War, 1853-1856', 'History'])).toBe('History')
  })

  it('does not match "art" hiding inside "Earth" (regression: word-boundary matching)', () => {
    expect(mapSubjectsToGenre(['Earth sciences', 'Geology'])).toBeNull()
  })

  it('still matches a real, correct Art subject as its own word', () => {
    expect(mapSubjectsToGenre(['Art', 'Painting'])).toBe('Art')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/openLibrary.test.ts`
Expected: the first two new tests FAIL — `mapSubjectsToGenre(['Crimean War, 1853-1856', 'History'])` currently returns `'Mystery'` (not `'History'`), and `mapSubjectsToGenre(['Earth sciences', 'Geology'])` currently returns `'Art'` (not `null`). The third new test passes already (not a regression, just a sanity check that the fix doesn't break real Art matches) — that's expected, it's there to guard the fix, not to demonstrate a bug.

- [ ] **Step 3: Fix `mapSubjectsToGenre`**

In `lib/openLibrary.ts`, add the import:
```typescript
import { tbrMatchPattern } from './tbrMatch'
```
(Place it as the first line of the file, before the existing type definitions.)

Replace the function body:
```typescript
export function mapSubjectsToGenre(subjects: string[]): string | null {
  const joined = subjects.join(' | ')
  for (const [genre, keywords] of GENRE_KEYWORDS) {
    if (keywords.some(kw => new RegExp(tbrMatchPattern(kw), 'i').test(joined))) return genre
  }
  return null
}
```
(Note: `.toLowerCase()` is removed — the regex's `i` flag now handles case-insensitivity, so lowercasing beforehand is redundant.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/openLibrary.test.ts`
Expected: PASS — all 14 pre-existing `mapSubjectsToGenre` cases plus the 3 new ones (17 total in that describe block).

- [ ] **Step 5: Run the full test suite once**

Run: `npx vitest run`
Expected: PASS, no regressions. `normalizeSearchResults`'s tests are unaffected (they only assert on the resulting `genre` value for inputs unrelated to this fix, and none of those inputs' expected genres change under the new matching — confirmed by the Step 4 full-describe-block pass).

- [ ] **Step 6: Commit**

```bash
git add lib/openLibrary.ts lib/openLibrary.test.ts
git commit -m "fix: match genre keywords as whole words, not substrings inside unrelated words"
```

---

## Post-Plan Verification

- [ ] Run the full test suite once: `npx vitest run`
- [ ] Expected: PASS, no failures, no unexpected skips.
