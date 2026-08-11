// Avatar initials for the nav bar, derived from the capital letters a user
// typed in their username (e.g. "SeanB" -> "SB"). See
// docs/superpowers/specs/2026-08-10-capital-letter-avatar-initials-design.md
// for the full rule table and rationale.
export function avatarInitials(username: string): string {
  if (!username) return ''

  const capitals: { char: string; index: number }[] = []
  for (let i = 0; i < username.length; i++) {
    const char = username[i]
    if (char >= 'A' && char <= 'Z') capitals.push({ char, index: i })
  }

  if (capitals.length >= 2) {
    return capitals[0].char + capitals[1].char
  }

  const firstChar = username[0]
  const firstCharDisplay = firstChar >= 'a' && firstChar <= 'z' ? firstChar.toUpperCase() : firstChar

  if (capitals.length === 1) {
    if (capitals[0].index === 0) return firstCharDisplay
    return firstCharDisplay + capitals[0].char
  }

  return firstCharDisplay
}
