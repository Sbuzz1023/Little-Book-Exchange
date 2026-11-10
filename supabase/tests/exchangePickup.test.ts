// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, call, credits } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

async function confirmed(opts: { bundleBooks?: number; buyerCredits?: number } = {}) {
  const seller = await createUser(db, { username: `seller_${Math.random().toString(36).slice(2, 8)}` })
  const buyer = await createUser(db, { credits: opts.buyerCredits ?? 1 })
  const listing = await seedListing(db, seller, { bundleBooks: opts.bundleBooks })
  const { id } = await call<{ id: string }>(db, buyer, 'request_book($1)', [listing])
  await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [id, JSON.stringify({ pickup_mode: 'anytime', city: 'Springfield' })])
  return { seller, buyer, listing, convo: id }
}
const status = async (id: string) => (await db.query<{ exchange_status: string }>('select exchange_status from conversations where id = $1', [id])).rows[0].exchange_status

describe('mark_picked_up', () => {
  it('waits for the other side, then completes and moves credits exactly once', async () => {
    const { seller, buyer, convo } = await confirmed({ bundleBooks: 1, buyerCredits: 2 })
    expect(await call(db, buyer, 'mark_picked_up($1)', [convo])).toBe('waiting')
    expect(await call(db, buyer, 'mark_picked_up($1)', [convo])).toBe('already_marked')
    const pickupMsgs = (await db.query(`select id from messages where conversation_id = $1 and kind = 'pickup'`, [convo])).rows
    expect(pickupMsgs).toHaveLength(1)
    expect(await call(db, seller, 'mark_picked_up($1)', [convo])).toBe('completed_manual')
    expect(await call(db, seller, 'mark_picked_up($1)', [convo])).toBe('wrong_status')
    expect(await status(convo)).toBe('completed')
    expect(await credits(db, buyer)).toBe(0)
    expect(await credits(db, seller)).toBe(2)
  })

  it('refuses strangers and exchanges that are not confirmed', async () => {
    const { convo } = await confirmed()
    const stranger = await createUser(db)
    expect(await call(db, stranger, 'mark_picked_up($1)', [convo])).toBe('not_allowed')
    const seller = await createUser(db)
    const buyer = await createUser(db, { credits: 1 })
    const listing = await seedListing(db, seller)
    const { id } = await call<{ id: string }>(db, buyer, 'request_book($1)', [listing])
    expect(await call(db, buyer, 'mark_picked_up($1)', [id])).toBe('wrong_status')
  })
})

describe('file_dispute', () => {
  it('files one open dispute per exchange and blocks completion', async () => {
    const { seller, buyer, convo } = await confirmed()
    const r = await call<{ status: string; id: string }>(db, buyer, 'file_dispute($1, $2)', [convo, '  Book never left out  '])
    expect(r.status).toBe('ok')
    const row = (await db.query<{ message: string; admin_notified_at: string | null }>('select message, admin_notified_at from disputes where id = $1', [r.id])).rows[0]
    expect(row).toEqual({ message: 'Book never left out', admin_notified_at: null })
    expect(await call(db, seller, 'file_dispute($1, $2)', [convo, 'Second'])).toEqual({ status: 'already_open' })
    await call(db, buyer, 'mark_picked_up($1)', [convo])
    expect(await call(db, seller, 'mark_picked_up($1)', [convo])).toBe('blocked_dispute')
  })

  it('refuses an empty message and strangers', async () => {
    const { buyer, convo } = await confirmed()
    const stranger = await createUser(db)
    expect(await call(db, buyer, 'file_dispute($1, $2)', [convo, '   '])).toEqual({ status: 'empty_message' })
    expect(await call(db, stranger, 'file_dispute($1, $2)', [convo, 'hi'])).toEqual({ status: 'not_allowed' })
  })
})

describe('hide_exchange', () => {
  it("hides only the caller's own side", async () => {
    const { buyer, convo } = await confirmed()
    expect(await call(db, buyer, 'hide_exchange($1)', [convo])).toBe('ok')
    const row = (await db.query('select buyer_hidden, seller_hidden from conversations where id = $1', [convo])).rows[0]
    expect(row).toEqual({ buyer_hidden: true, seller_hidden: false })
    expect(await call(db, await createUser(db), 'hide_exchange($1)', [convo])).toBe('not_allowed')
  })
})

describe('start_support_conversation', () => {
  it('creates one support thread and reuses it', async () => {
    const me = await createUser(db)
    const a = await call<{ status: string; id: string }>(db, me, 'start_support_conversation()')
    const b = await call<{ status: string; id: string }>(db, me, 'start_support_conversation()')
    expect(a.status).toBe('ok')
    expect(b.id).toBe(a.id)
    expect(await call(db, null, 'start_support_conversation()')).toEqual({ status: 'not_allowed' })
  })

  it('blocks exchange operations on support threads', async () => {
    const me = await createUser(db)
    const stranger = await createUser(db)
    const { id: thread } = await call<{ status: string; id: string }>(db, me, 'start_support_conversation()')

    // file_dispute rejects both stranger and owner on support thread
    expect(await call(db, stranger, 'file_dispute($1, $2)', [thread, 'x'])).toEqual({ status: 'not_allowed' })
    expect(await call(db, me, 'file_dispute($1, $2)', [thread, 'x'])).toEqual({ status: 'not_allowed' })
    // No dispute row should exist
    expect((await db.query('select id from disputes where conversation_id = $1', [thread])).rows).toHaveLength(0)

    // mark_picked_up rejects both
    expect(await call(db, stranger, 'mark_picked_up($1)', [thread])).toBe('not_allowed')
    expect(await call(db, me, 'mark_picked_up($1)', [thread])).toBe('not_allowed')

    // hide_exchange rejects both
    expect(await call(db, stranger, 'hide_exchange($1)', [thread])).toBe('not_allowed')
    expect(await call(db, me, 'hide_exchange($1)', [thread])).toBe('not_allowed')
  })
})

describe('move_saved_to_tbr', () => {
  it('copies the listing into To-Be-Read and unsaves it in one step', async () => {
    const seller = await createUser(db)
    const me = await createUser(db)
    const listing = await seedListing(db, seller, { title: 'Emma', author: 'Jane Austen' })
    await db.query('insert into saved_listings (user_id, listing_id) values ($1, $2)', [me, listing])
    expect(await call(db, me, 'move_saved_to_tbr($1)', [listing])).toBe('ok')
    expect((await db.query('select title, author from tbr_entries where user_id = $1', [me])).rows).toEqual([{ title: 'Emma', author: 'Jane Austen' }])
    expect((await db.query('select id from saved_listings where user_id = $1', [me])).rows).toHaveLength(0)
    expect(await call(db, me, 'move_saved_to_tbr($1)', ['00000000-0000-0000-0000-000000000000'])).toBe('not_found')
  })

  it('requires the caller to have saved the listing', async () => {
    const seller = await createUser(db)
    const me = await createUser(db)
    const listing = await seedListing(db, seller, { title: 'Dune', author: 'Frank Herbert' })
    // listing exists but not saved by me
    expect(await call(db, me, 'move_saved_to_tbr($1)', [listing])).toBe('not_found')
    // No TBR entry should exist
    expect((await db.query('select id from tbr_entries where user_id = $1', [me])).rows).toHaveLength(0)
  })
})
