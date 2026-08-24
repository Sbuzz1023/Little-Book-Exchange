import { describe, it, expect } from 'vitest'
import { enrichDisputes, buildDisputeTally, type RawDispute, type ConversationParticipants } from './disputeEnrichment'

const conversations: ConversationParticipants[] = [
  { id: 'convo-1', listing_id: 'listing-1', buyer_id: 'buyer-1', seller_id: 'seller-1' },
  { id: 'convo-2', listing_id: 'listing-2', buyer_id: 'buyer-2', seller_id: 'seller-2' },
]

const listingTitles = { 'listing-1': 'Dune', 'listing-2': 'Sapiens' }
const userNames = { 'buyer-1': 'Alex', 'seller-1': 'Sam', 'buyer-2': 'Jordan', 'seller-2': 'Robin' }

describe('enrichDisputes', () => {
  it('resolves the other party as whichever participant is not the reporter', () => {
    const disputes: RawDispute[] = [
      { id: 'd1', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'Never showed up', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const [enriched] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(enriched.otherPartyId).toBe('seller-1')
    expect(enriched.otherPartyName).toBe('Sam')
    expect(enriched.reporterName).toBe('Alex')
    expect(enriched.bookTitle).toBe('Dune')
  })

  it('resolves the other party correctly when the seller is the reporter', () => {
    const disputes: RawDispute[] = [
      { id: 'd2', conversation_id: 'convo-2', reporter_id: 'seller-2', message: 'Buyer never confirmed', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const [enriched] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(enriched.otherPartyId).toBe('buyer-2')
    expect(enriched.otherPartyName).toBe('Jordan')
  })

  it('falls back to Unknown when a conversation, listing, or name cannot be found', () => {
    const disputes: RawDispute[] = [
      { id: 'd3', conversation_id: 'missing-convo', reporter_id: 'ghost-user', message: 'orphaned', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const [enriched] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(enriched.otherPartyId).toBeNull()
    expect(enriched.otherPartyName).toBe('Unknown')
    expect(enriched.reporterName).toBe('Unknown')
    expect(enriched.bookTitle).toBe('Unknown book')
  })

  it('passes an unresolved status through unchanged', () => {
    const disputes: RawDispute[] = [
      { id: 'd5', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'Closed without a fix', status: 'unresolved', created_at: '2026-08-01T00:00:00.000Z', resolved_at: '2026-08-02T00:00:00.000Z' },
    ]
    const [enriched] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(enriched.status).toBe('unresolved')
  })

  it('passes status, timestamps, and message through unchanged', () => {
    const disputes: RawDispute[] = [
      { id: 'd4', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'Resolved amicably', status: 'resolved', created_at: '2026-08-01T00:00:00.000Z', resolved_at: '2026-08-02T00:00:00.000Z' },
    ]
    const [enriched] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(enriched.status).toBe('resolved')
    expect(enriched.resolvedAt).toBe('2026-08-02T00:00:00.000Z')
    expect(enriched.message).toBe('Resolved amicably')
  })

  it('passes adminReadAt through unchanged, defaulting to null when absent', () => {
    const disputes: RawDispute[] = [
      { id: 'd6', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'a', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null, admin_read_at: '2026-08-05T00:00:00.000Z' },
      { id: 'd7', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'b', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null, admin_read_at: null },
    ]
    const [read, unread] = enrichDisputes(disputes, conversations, listingTitles, userNames)
    expect(read.adminReadAt).toBe('2026-08-05T00:00:00.000Z')
    expect(unread.adminReadAt).toBeNull()
  })
})

describe('buildDisputeTally', () => {
  it('counts filed and against separately per user', () => {
    const disputes: RawDispute[] = [
      { id: 'd1', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'a', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
      { id: 'd2', conversation_id: 'convo-1', reporter_id: 'seller-1', message: 'b', status: 'open', created_at: '2026-08-02T00:00:00.000Z', resolved_at: null },
    ]
    const enriched = enrichDisputes(disputes, conversations, listingTitles, userNames)
    const tally = buildDisputeTally(enriched)
    // buyer-1 filed d1 (against seller-1) and is the target of d2 (filed by seller-1)
    expect(tally['buyer-1']).toEqual({ filed: 1, against: 1 })
    expect(tally['seller-1']).toEqual({ filed: 1, against: 1 })
  })

  it('omits a user with no disputes entirely', () => {
    const disputes: RawDispute[] = [
      { id: 'd1', conversation_id: 'convo-1', reporter_id: 'buyer-1', message: 'a', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const enriched = enrichDisputes(disputes, conversations, listingTitles, userNames)
    const tally = buildDisputeTally(enriched)
    expect(tally['buyer-2']).toBeUndefined()
  })

  it('does not credit an "against" count when the conversation could not be resolved', () => {
    const disputes: RawDispute[] = [
      { id: 'd1', conversation_id: 'missing-convo', reporter_id: 'ghost-user', message: 'orphaned', status: 'open', created_at: '2026-08-01T00:00:00.000Z', resolved_at: null },
    ]
    const enriched = enrichDisputes(disputes, conversations, listingTitles, userNames)
    const tally = buildDisputeTally(enriched)
    expect(tally['ghost-user']).toEqual({ filed: 1, against: 0 })
  })
})
