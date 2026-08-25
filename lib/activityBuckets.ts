export type ActivityPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type ActivityBucket = { label: string; posts: number; signups: number; trades: number }

// How much history each view shows — enough to see a real trend on that
// timescale without the chart getting cluttered.
const BUCKET_COUNTS: Record<ActivityPeriod, number> = { daily: 14, weekly: 8, monthly: 12, yearly: 5 }
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 86400000

type Range = { start: Date; end: Date; label: string }

export function bucketActivity(
  period: ActivityPeriod,
  data: { posts: string[]; signups: string[]; trades: string[] },
  now: Date = new Date()
): ActivityBucket[] {
  return buildRanges(period, now).map(r => ({
    label: r.label,
    posts: countInRange(data.posts, r),
    signups: countInRange(data.signups, r),
    trades: countInRange(data.trades, r),
  }))
}

function countInRange(timestamps: string[], { start, end }: Range): number {
  return timestamps.filter(t => {
    const d = new Date(t)
    return d >= start && d < end
  }).length
}

function buildRanges(period: ActivityPeriod, now: Date): Range[] {
  const count = BUCKET_COUNTS[period]
  const ranges: Range[] = []

  if (period === 'daily') {
    const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(todayStart - i * DAY_MS)
      const end = new Date(start.getTime() + DAY_MS)
      ranges.push({ start, end, label: `${MONTH_ABBR[start.getUTCMonth()]} ${start.getUTCDate()}` })
    }
  } else if (period === 'weekly') {
    // Weeks start Monday — daysSinceMonday maps Sun(0)->6, Mon(1)->0, ... Sat(6)->5.
    const daysSinceMonday = (now.getUTCDay() + 6) % 7
    const currentWeekStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday)
    for (let i = count - 1; i >= 0; i--) {
      const start = new Date(currentWeekStart - i * 7 * DAY_MS)
      const end = new Date(start.getTime() + 7 * DAY_MS)
      ranges.push({ start, end, label: `${MONTH_ABBR[start.getUTCMonth()]} ${start.getUTCDate()}` })
    }
  } else if (period === 'monthly') {
    for (let i = count - 1; i >= 0; i--) {
      const y = now.getUTCFullYear()
      const m = now.getUTCMonth() - i
      const start = new Date(Date.UTC(y, m, 1))
      const end = new Date(Date.UTC(y, m + 1, 1))
      ranges.push({ start, end, label: `${MONTH_ABBR[start.getUTCMonth()]} '${String(start.getUTCFullYear()).slice(-2)}` })
    }
  } else {
    for (let i = count - 1; i >= 0; i--) {
      const y = now.getUTCFullYear() - i
      ranges.push({ start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y + 1, 0, 1)), label: String(y) })
    }
  }

  return ranges
}
