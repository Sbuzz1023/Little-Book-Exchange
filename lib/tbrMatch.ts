export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Builds a Postgres-compatible regex (usable with `~*` / regexIMatch, and
 * with JS RegExp) that matches `value` only as a whole word or bounded
 * phrase, not as a substring inside another word (e.g. "me" inside "time").
 */
export function tbrMatchPattern(value: string): string {
  const escaped = escapeRegex(value.trim())
  return `(^|\\W)${escaped}(\\W|$)`
}

const GENERIC_WORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'at', 'by', 'with', 'from',
])

/**
 * True when `value` is nothing but a single common English filler word (an
 * article, preposition, or conjunction) — too generic to mean anything as a
 * TBR match criterion. Entering just "the" would otherwise whole-word-match
 * nearly every book titled "The ...". Multi-word phrases and other single
 * words are unaffected, even when they contain one of these words.
 */
export function isTooGenericToMatch(value: string): boolean {
  return GENERIC_WORDS.has(value.trim().toLowerCase())
}

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
