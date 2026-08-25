export type UserBookStats = { booksPosted: number; booksSold: number; booksBought: number }

// Real lifetime counts for the admin panel's stat cards, Users table, and
// user detail card — previously all hardcoded to 0. `booksPosted` counts
// every listing ever made regardless of status (matches how "N books
// posted" is already computed on the user-facing Dashboard). Sold/bought
// only count exchanges that actually completed — a pending or cancelled
// request was never really a trade.
export function computeUserBookStats(
  listings: { user_id: string }[],
  conversations: { seller_id: string; buyer_id: string; exchange_status: string }[],
  allUserIds: string[] = []
): Record<string, UserBookStats> {
  const stats: Record<string, UserBookStats> = {}

  function ensure(userId: string): UserBookStats {
    return (stats[userId] ??= { booksPosted: 0, booksSold: 0, booksBought: 0 })
  }

  for (const id of allUserIds) ensure(id)
  for (const l of listings) ensure(l.user_id).booksPosted++
  for (const c of conversations) {
    if (c.exchange_status !== 'completed') continue
    ensure(c.seller_id).booksSold++
    ensure(c.buyer_id).booksBought++
  }

  return stats
}
