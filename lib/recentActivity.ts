export type RecentActivityType = 'signup' | 'post' | 'trade' | 'report' | 'review'
export type RecentActivityEvent = { type: RecentActivityType; text: string; timestamp: string }
export type RecentActivityItem = { type: RecentActivityType; text: string; timeAgo: string }

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR

function formatTimeAgo(timestamp: string, now: Date): string {
  const diff = now.getTime() - new Date(timestamp).getTime()
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`
  const d = new Date(timestamp)
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`
}

// Merges events from every source (signups, posts, trades, location
// reports, flagged reviews) into one most-recent-first feed, capped at
// `limit` — the admin panel's Recent Activity card just renders the result
// directly, with no sorting/formatting logic of its own.
export function buildRecentActivity(events: RecentActivityEvent[], limit: number, now: Date = new Date()): RecentActivityItem[] {
  return [...events]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit)
    .map(e => ({ type: e.type, text: e.text, timeAgo: formatTimeAgo(e.timestamp, now) }))
}
