export type DisputeStatus = 'open' | 'resolved' | 'unresolved'

export type RawDispute = {
  id: string
  conversation_id: string
  reporter_id: string
  message: string
  status: DisputeStatus
  created_at: string
  resolved_at: string | null
  admin_read_at?: string | null
}

export type ConversationParticipants = {
  id: string
  listing_id: string | null
  buyer_id: string
  seller_id: string
}

export type EnrichedDispute = {
  id: string
  conversationId: string
  message: string
  status: DisputeStatus
  createdAt: string
  resolvedAt: string | null
  adminReadAt: string | null
  reporterId: string
  reporterName: string
  otherPartyId: string | null
  otherPartyName: string
  bookTitle: string
}

export function enrichDisputes(
  disputes: RawDispute[],
  conversations: ConversationParticipants[],
  listingTitles: Record<string, string>,
  userNames: Record<string, string>
): EnrichedDispute[] {
  const convoMap: Record<string, ConversationParticipants> = {}
  for (const c of conversations) convoMap[c.id] = c

  return disputes.map(d => {
    const convo = convoMap[d.conversation_id]
    const otherPartyId = convo
      ? (d.reporter_id === convo.buyer_id ? convo.seller_id : convo.buyer_id)
      : null

    return {
      id: d.id,
      conversationId: d.conversation_id,
      message: d.message,
      status: d.status,
      createdAt: d.created_at,
      resolvedAt: d.resolved_at,
      adminReadAt: d.admin_read_at ?? null,
      reporterId: d.reporter_id,
      reporterName: userNames[d.reporter_id] ?? 'Unknown',
      otherPartyId,
      otherPartyName: otherPartyId ? (userNames[otherPartyId] ?? 'Unknown') : 'Unknown',
      bookTitle: convo?.listing_id ? (listingTitles[convo.listing_id] ?? 'Unknown book') : 'Unknown book',
    }
  })
}

export type DisputeTally = { filed: number; against: number }

export function buildDisputeTally(disputes: EnrichedDispute[]): Record<string, DisputeTally> {
  const tally: Record<string, DisputeTally> = {}

  function bump(userId: string, key: keyof DisputeTally) {
    if (!tally[userId]) tally[userId] = { filed: 0, against: 0 }
    tally[userId][key]++
  }

  for (const d of disputes) {
    bump(d.reporterId, 'filed')
    if (d.otherPartyId) bump(d.otherPartyId, 'against')
  }

  return tally
}
