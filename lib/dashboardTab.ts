// The Dashboard's full set of tabs — kept as a plain string list here (not
// imported from DashboardClient's own Tab type) since this needs to be a
// runtime-checkable whitelist, not just a compile-time type.
const VALID_TABS = ['listings', 'exchanges', 'tbr', 'saved', 'wallet', 'account', 'messages'] as const
export type DashboardTab = typeof VALID_TABS[number]

// Which tab the Dashboard should open on. An explicit, recognized ?tab=
// param always wins — this is what lets a mutating action (confirm a
// purchase, unsave a listing, etc.) redirect back to the tab it was
// actually clicked from instead of always bouncing to My Listings.
// Unrecognized values are ignored rather than trusted, so a garbled URL
// can't put the Dashboard in a broken state.
export function resolveDefaultTab(tabParam: string | undefined, demoPending: string | undefined): DashboardTab {
  if (tabParam && (VALID_TABS as readonly string[]).includes(tabParam)) return tabParam as DashboardTab
  return demoPending ? 'exchanges' : 'listings'
}
