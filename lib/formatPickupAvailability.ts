export type PickupAvailability = {
  mode?: 'window' | 'after' | 'anytime' | null
  date?: string | null // 'YYYY-MM-DD'
  timeStart?: string | null // 'HH:MM' (24h)
  timeEnd?: string | null // 'HH:MM' (24h)
}

// Parses a plain 'YYYY-MM-DD' string into a local calendar date (no Date()
// UTC-parse step) so this can never shift a day across a timezone boundary —
// the same class of bug flagged elsewhere in this project's history.
function formatDate(dateStr: string): string | null {
  const parts = dateStr.split('-').map(Number)
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return null
  const [year, month, day] = parts
  const d = new Date(year, month - 1, day)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

// Pure string/number math — no Date object involved, so there's no wall-clock
// vs. UTC ambiguity to get wrong for a plain time-of-day value.
function formatTime(timeStr: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr)
  if (!match) return null
  const hour24 = Number(match[1])
  const minute = match[2]
  if (hour24 < 0 || hour24 > 23) return null
  const period = hour24 < 12 ? 'AM' : 'PM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${hour12}:${minute} ${period}`
}

export function formatPickupAvailability(p: PickupAvailability): string | null {
  if (p.mode === 'anytime') return '✅ Ready for pickup now'

  if (p.mode === 'window' || p.mode === 'after') {
    if (!p.date || !p.timeStart) return null
    const date = formatDate(p.date)
    const start = formatTime(p.timeStart)
    if (!date || !start) return null

    if (p.mode === 'after') return `${date} · after ${start}`

    if (!p.timeEnd) return null
    const end = formatTime(p.timeEnd)
    if (!end) return null
    return `${date} · ${start}–${end}`
  }

  return null
}
