// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, seedConversation, call, asUser } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

type Res = { status: string; id?: string }
const listingStatus = async (id: string) => (await db.query<{ status: string }>('select status from listings where id = $1', [id])).rows[0]?.status

describe('start_conversation', () => {
  it('creates one thread per buyer and listing, and reuses it', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db)
    const listing = await seedListing(db, seller)
    const first = await call<Res>(db, buyer, 'start_conversation($1)', [listing])
    const again = await call<Res>(db, buyer, 'start_conversation($1)', [listing])
    expect(first.status).toBe('ok')
    expect(again.id).toBe(first.id)
  })

  it('refuses messaging yourself and a missing listing', async () => {
    const seller = await createUser(db)
    const listing = await seedListing(db, seller)
    expect(await call<Res>(db, seller, 'start_conversation($1)', [listing])).toEqual({ status: 'own_listing' })
    expect(await call<Res>(db, seller, 'start_conversation($1)', ['00000000-0000-0000-0000-000000000000'])).toEqual({ status: 'not_found' })
  })
})

describe('request_book', () => {
  it('locks the listing, opens a requested exchange and posts the request message', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    const r = await call<Res>(db, buyer, 'request_book($1)', [listing])
    expect(r.status).toBe('ok')
    expect(await listingStatus(listing)).toBe('pending')
    const convo = (await db.query<{ exchange_status: string }>('select exchange_status from conversations where id = $1', [r.id])).rows[0]
    expect(convo.exchange_status).toBe('requested')
    const msgs = (await db.query<{ kind: string; sender_id: string }>('select kind, sender_id from messages where conversation_id = $1', [r.id])).rows
    expect(msgs).toEqual([{ kind: 'purchase_request', sender_id: buyer }])
  })

  it('reuses an existing message thread', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    const thread = await call<Res>(db, buyer, 'start_conversation($1)', [listing])
    expect((await call<Res>(db, buyer, 'request_book($1)', [listing])).id).toBe(thread.id)
  })

  it('refuses when the buyer cannot afford the book count, leaving the listing active', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 2 })
    const bundle = await seedListing(db, seller, { bundleBooks: 2 })
    expect(await call<Res>(db, buyer, 'request_book($1)', [bundle])).toEqual({ status: 'insufficient_credits' })
    expect(await listingStatus(bundle)).toBe('active')
  })

  it('counts credits held by a confirmed exchange whose listing is already sold', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const soldListing = await seedListing(db, seller, { status: 'sold' })
    await seedConversation(db, { listingId: soldListing, buyerId: buyer, sellerId: seller, status: 'confirmed' })
    const next = await seedListing(db, seller)
    expect(await call<Res>(db, buyer, 'request_book($1)', [next])).toEqual({ status: 'insufficient_credits' })
  })

  it('lets only the first of two buyers request the same listing, and ignores a double tap', async () => {
    const seller = await createUser(db)
    const first = await createUser(db, { credits: 1 })
    const second = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    expect((await call<Res>(db, first, 'request_book($1)', [listing])).status).toBe('ok')
    expect(await call<Res>(db, first, 'request_book($1)', [listing])).toEqual({ status: 'not_available' })
    expect(await call<Res>(db, second, 'request_book($1)', [listing])).toEqual({ status: 'not_available' })
    const messages = (await db.query('select m.id from messages m join conversations c on c.id = m.conversation_id where c.listing_id = $1', [listing])).rows
    expect(messages).toHaveLength(1)
  })

  it('refuses your own listing and signed-out callers', async () => {
    const seller = await createUser(db, { credits: 5 })
    const listing = await seedListing(db, seller)
    expect(await call<Res>(db, seller, 'request_book($1)', [listing])).toEqual({ status: 'own_listing' })
    expect(await call<Res>(db, null, 'request_book($1)', [listing])).toEqual({ status: 'not_allowed' })
  })

  it('prevents a second buyer from requesting when another has an open request', async () => {
    const seller = await createUser(db)
    const buyerA = await createUser(db, { credits: 1 })
    const buyerB = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    await seedConversation(db, { listingId: listing, buyerId: buyerA, sellerId: seller, status: 'requested' })
    expect(await call<Res>(db, buyerB, 'request_book($1)', [listing])).toEqual({ status: 'not_available' })
  })
})

describe('cancel_request', () => {
  it('lets the buyer cancel a request, reopening the listing', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    const r = await call<Res>(db, buyer, 'request_book($1)', [listing])
    expect(await call(db, buyer, 'cancel_request($1)', [r.id])).toBe('ok')
    expect(await listingStatus(listing)).toBe('active')
    expect((await db.query('select id from conversations where id = $1', [r.id])).rows).toHaveLength(0)
  })

  it('refuses the seller, strangers, and a confirmed exchange', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db)
    const stranger = await createUser(db)
    const listing = await seedListing(db, seller, { status: 'sold' })
    const convo = await seedConversation(db, { listingId: listing, buyerId: buyer, sellerId: seller, status: 'confirmed' })
    expect(await call(db, seller, 'cancel_request($1)', [convo])).toBe('not_allowed')
    expect(await call(db, stranger, 'cancel_request($1)', [convo])).toBe('not_allowed')
    expect(await call(db, buyer, 'cancel_request($1)', [convo])).toBe('wrong_status')
    expect(await asUser(db, buyer, 'select id from conversations where id = $1', [convo])).toHaveLength(1)
  })

  it('keeps listing pending when another conversation is open (do not reopen for the first)', async () => {
    const seller = await createUser(db)
    const buyerA = await createUser(db)
    const buyerB = await createUser(db)
    const listing = await seedListing(db, seller, { status: 'pending' })
    const convoA = await seedConversation(db, { listingId: listing, buyerId: buyerA, sellerId: seller, status: 'requested' })
    await seedConversation(db, { listingId: listing, buyerId: buyerB, sellerId: seller, status: 'requested' })
    expect(await call(db, buyerA, 'cancel_request($1)', [convoA])).toBe('ok')
    expect(await listingStatus(listing)).toBe('pending')
  })
})
