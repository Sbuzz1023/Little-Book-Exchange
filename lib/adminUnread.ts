export type DisputeStatus = 'open' | 'resolved' | 'unresolved'

// A conversation counts as unread if it has at least one message from
// someone other than the admin, newer than the admin's last-read timestamp
// for it. A null lastReadAt means "never read" — any qualifying message
// makes it unread.
export function hasUnreadMessage(
  messages: { sender_id: string; created_at: string }[],
  adminId: string,
  lastReadAt: string | null
): boolean {
  return messages.some(m => m.sender_id !== adminId && (lastReadAt === null || m.created_at > lastReadAt))
}

// A dispute counts as unread only while it's still open and hasn't been
// marked read yet — resolved/unresolved disputes are archived and never
// need attention again, regardless of read state.
export function isDisputeUnread(status: DisputeStatus, adminReadAt: string | null): boolean {
  return status === 'open' && adminReadAt === null
}
