// Trims/collapses whitespace and fixes obviously-mistyped casing (all
// lowercase, all UPPERCASE, or just the first letter capitalized — the
// common phone-keyboard "capitalize first letter of the field" pattern) —
// without ever touching a word that already has internal/mixed
// capitalization. That's deliberate: a real city name like "McAllen" or
// "DeKalb" would come out worse, not better, from a blind Title Case.
export function normalizeCity(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => {
      const letters = word.replace(/[^a-zA-Z]/g, '')
      const isAllLower = letters.length > 0 && letters === letters.toLowerCase()
      const isAllUpper = letters.length > 0 && letters === letters.toUpperCase()
      if (!isAllLower && !isAllUpper) return word // mixed case — leave it alone
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}
