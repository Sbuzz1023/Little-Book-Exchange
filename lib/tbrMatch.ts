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
