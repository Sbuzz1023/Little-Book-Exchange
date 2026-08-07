export type NotificationType = 'message' | 'purchase_request' | 'purchase_decision' | 'tbr_match' | 'pickup'

export type NotificationRow = {
  type: NotificationType
  entity_id: string
}

export type UnreadCounts = {
  total: number
  exchanges: number
  tbr: number
  messages: number
}

const EXCHANGE_TYPES = new Set<NotificationType>(['purchase_request', 'purchase_decision', 'pickup'])

export function unreadCounts(rows: NotificationRow[]): UnreadCounts {
  let exchanges = 0
  let tbr = 0
  let messages = 0
  for (const row of rows) {
    if (EXCHANGE_TYPES.has(row.type)) exchanges++
    else if (row.type === 'tbr_match') tbr++
    else if (row.type === 'message') messages++
  }
  return { total: rows.length, exchanges, tbr, messages }
}

export function unreadEntityIds(rows: NotificationRow[], types: NotificationType[]): string[] {
  const typeSet = new Set(types)
  return rows.filter(row => typeSet.has(row.type)).map(row => row.entity_id)
}

// The Wallet tab's "unclaimed onboarding bonus" badge isn't backed by a
// notifications row — it's derived straight from the profile. Fold it in
// here so the nav bar's Dashboard badge reflects every red alert the
// dashboard shows, not just the notification-table ones.
export function dashboardAlertTotal(notificationCount: number, onboardingBonusClaimed: boolean | null | undefined): number {
  return notificationCount + (onboardingBonusClaimed ? 0 : 1)
}
