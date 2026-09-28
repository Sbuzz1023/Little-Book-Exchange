// Credits aren't deducted when a buyer requests a book — only when the
// exchange completes (complete_exchange_marks_listing_sold in schema.sql).
// So a request must be checked against the balance *minus* what the buyer's
// other still-open requests will take, or several requests can each pass
// against the same credits and drive the balance negative on completion.

export type OpenRequestRow = {
  exchange_status: string
  listings: { status: string; book_count: number | null } | null
}

// A request is still open (its credits still to be spent) while it's
// requested/confirmed and its listing is still locked as pending. A
// confirmed exchange on a listing that's since been sold/reopened is stale
// and holds nothing.
function isOpen(row: OpenRequestRow): boolean {
  return (row.exchange_status === 'requested' || row.exchange_status === 'confirmed')
    && row.listings?.status === 'pending'
}

function heldCredits(buyerExchanges: OpenRequestRow[]): number {
  return buyerExchanges.filter(isOpen).reduce((sum, r) => sum + (r.listings?.book_count ?? 1), 0)
}

export function availableCredits(balance: number, buyerExchanges: OpenRequestRow[]): number {
  return balance - heldCredits(buyerExchanges)
}

export type CreditShortfall = {
  // 'balance': the balance itself is below the cost.
  // 'pending': the balance covers it, but credits held by open requests don't leave enough.
  reason: 'balance' | 'pending'
  balance: number
  held: number
  pendingCount: number
  cost: number
}

// Why a buyer can't afford `cost`, or null if they can.
export function creditShortfall(balance: number, buyerExchanges: OpenRequestRow[], cost: number): CreditShortfall | null {
  const held = heldCredits(buyerExchanges)
  if (balance - held >= cost) return null
  return {
    reason: balance < cost ? 'balance' : 'pending',
    balance,
    held,
    pendingCount: buyerExchanges.filter(isOpen).length,
    cost,
  }
}
