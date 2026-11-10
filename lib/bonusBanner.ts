const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type Tx = { reason: string; created_at: string }

// The "Bonus earned" strip is shown for 7 days after the onboarding bonus was awarded.
// No bonus row (older data) means no strip.
export function showBonusBanner(transactions: Tx[], now: Date = new Date()): boolean {
  const bonus = transactions.find(t => t.reason === 'onboarding_bonus')
  if (!bonus) return false
  const awarded = new Date(bonus.created_at).getTime()
  if (Number.isNaN(awarded)) return false
  return now.getTime() - awarded < WEEK_MS
}
