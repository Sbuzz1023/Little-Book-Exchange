// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, seedConversation, asUser, call, credits } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

async function confirmedExchange() {
  const seller = await createUser(db)
  const buyer = await createUser(db, { credits: 1 })
  const listing = await seedListing(db, seller)
  const { id } = await call<{ id: string }>(db, buyer, 'request_book($1)', [listing])
  await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [id, JSON.stringify({ pickup_mode: 'anytime' })])
  return { seller, buyer, listing, convo: id }
}

describe('the exchange-status hole is closed', () => {
  it('a seller cannot mark their own exchange completed to take the buyer credits', async () => {
    const { seller, buyer, convo } = await confirmedExchange()
    await expect(asUser(db, seller, `update conversations set exchange_status = 'completed' where id = $1 returning id`, [convo]))
      .resolves.toEqual([])
    expect(await credits(db, buyer)).toBe(1)
    expect(await credits(db, seller)).toBe(0)
  })

  it('nobody can create, edit or delete exchanges, listings, bundle books or disputes directly', async () => {
    const { seller, buyer, listing, convo } = await confirmedExchange()
    const other = await seedListing(db, seller)
    await expect(asUser(db, buyer, `insert into conversations (listing_id, buyer_id, seller_id, exchange_status) values ($1, $2, $3, 'confirmed')`, [other, buyer, seller])).rejects.toThrow(/row-level security/)
    expect(await asUser(db, buyer, 'delete from conversations where id = $1 returning id', [convo])).toEqual([])
    await expect(asUser(db, seller, `insert into listings (user_id, title, author, condition) values ($1, 'a', 'b', 'Good')`, [seller])).rejects.toThrow(/row-level security/)
    expect(await asUser(db, seller, `update listings set status = 'active' where id = $1 returning id`, [listing])).toEqual([])
    await expect(asUser(db, seller, `insert into listing_books (listing_id, title, author) values ($1, 'x', 'y')`, [other])).rejects.toThrow(/row-level security/)
    await expect(asUser(db, buyer, `insert into disputes (conversation_id, reporter_id, message) values ($1, $2, 'x')`, [convo, buyer])).rejects.toThrow(/row-level security/)
  })

  it('members can send chat messages but not fake system messages', async () => {
    const { buyer, convo } = await confirmedExchange()
    expect(await asUser(db, buyer, `insert into messages (conversation_id, sender_id, body) values ($1, $2, 'hi') returning kind`, [convo, buyer])).toEqual([{ kind: 'chat' }])
    for (const kind of ['confirmation', 'pickup', 'purchase_request']) {
      await expect(asUser(db, buyer, `insert into messages (conversation_id, sender_id, body, kind) values ($1, $2, 'x', $3)`, [convo, buyer, kind])).rejects.toThrow(/row-level security/)
    }
  })

  it('a stranger cannot send messages into someone else exchange', async () => {
    const { convo } = await confirmedExchange()
    const stranger = await createUser(db)
    await expect(asUser(db, stranger, `insert into messages (conversation_id, sender_id, body) values ($1, $2, 'hi')`, [convo, stranger])).rejects.toThrow(/row-level security/)
  })

  it('lock_listing_for_request can no longer be called by members', async () => {
    const seller = await createUser(db)
    const member = await createUser(db)
    const listing = await seedListing(db, seller)
    await expect(asUser(db, member, 'select lock_listing_for_request($1)', [listing])).rejects.toThrow(/permission denied/)
  })

  it('reopen_listing can no longer be called by members', async () => {
    const seller = await createUser(db)
    const member = await createUser(db)
    const listing = await seedListing(db, seller)
    await expect(asUser(db, member, 'select reopen_listing($1)', [listing])).rejects.toThrow(/permission denied/)
  })
})

describe('support and admin paths still work', () => {
  it('a member cannot insert a support thread directly, but an admin can', async () => {
    const member = await createUser(db)
    const admin = await createUser(db, { isAdmin: true })
    await expect(asUser(db, member, `insert into conversations (type, user_id) values ('admin', $1)`, [member])).rejects.toThrow(/row-level security/)
    expect(await asUser(db, admin, `insert into conversations (type, user_id) values ('admin', $1) returning id`, [member])).toHaveLength(1)
  })

  it('a member gets a thread via start_support_conversation and can send plain chat only', async () => {
    const member = await createUser(db)
    const { id } = await call<{ id: string }>(db, member, 'start_support_conversation()')
    expect(await asUser(db, member, `insert into messages (conversation_id, sender_id, body) values ($1, $2, 'help') returning kind`, [id, member])).toEqual([{ kind: 'chat' }])
    await expect(asUser(db, member, `insert into messages (conversation_id, sender_id, body, kind) values ($1, $2, 'x', 'confirmation')`, [id, member])).rejects.toThrow(/row-level security/)
  })

  it('an admin can message into a support thread', async () => {
    const member = await createUser(db)
    const admin = await createUser(db, { isAdmin: true })
    const { id } = await call<{ id: string }>(db, member, 'start_support_conversation()')
    expect(await asUser(db, admin, `insert into messages (conversation_id, sender_id, body) values ($1, $2, 'hello') returning id`, [id, admin])).toHaveLength(1)
  })

  it('an admin can resolve a dispute directly', async () => {
    const { buyer, convo } = await confirmedExchange()
    const admin = await createUser(db, { isAdmin: true })
    const { id } = await call<{ id: string }>(db, buyer, 'file_dispute($1, $2)', [convo, 'problem'])
    expect(await asUser(db, admin, `update disputes set status = 'resolved' where id = $1 returning id`, [id])).toHaveLength(1)
  })
})

describe('photo uploads', () => {
  it('are allowed only into your own folder', async () => {
    const me = await createUser(db)
    const other = await createUser(db)
    await expect(asUser(db, me, `insert into storage.objects (bucket_id, name) values ('book-photos', $1)`, [`${me}/1-1.jpg`])).resolves.toEqual([])
    await expect(asUser(db, me, `insert into storage.objects (bucket_id, name) values ('book-photos', $1)`, [`${other}/1-1.jpg`])).rejects.toThrow(/row-level security/)
  })
})

describe('private profile data', () => {
  it('public profile columns stay readable, signed in or not', async () => {
    const someone = await createUser(db, { username: 'public_name', city: 'Springfield' })
    expect(await asUser(db, null, 'select username, city from profiles where id = $1', [someone])).toEqual([{ username: 'public_name', city: 'Springfield' }])
    expect(await asUser(db, await createUser(db), 'select username from profiles where id = $1', [someone])).toEqual([{ username: 'public_name' }])
  })

  it.each(['email', 'phone', 'address', 'address_unit', 'zip', 'credits', 'marketing_opt_out'])('hides %s from members and visitors', async (column) => {
    const member = await createUser(db)
    await expect(asUser(db, member, `select ${column} from profiles`)).rejects.toThrow(/permission denied/)
    await expect(asUser(db, null, `select ${column} from profiles`)).rejects.toThrow(/permission denied/)
  })

  it('hides private columns through joins too', async () => {
    const member = await createUser(db)
    await expect(asUser(db, member, 'select l.id, p.email from listings l join profiles p on p.id = l.user_id')).rejects.toThrow(/permission denied/)
  })

  it('members can still edit their own public and private details', async () => {
    const me = await createUser(db)
    expect(await asUser(db, me, `update profiles set city = 'Shelbyville', phone = '5551234567' where id = $1`, [me])).toEqual([])
    const { rows } = await db.query<{ city: string; phone: string }>('select city, phone from profiles where id = $1', [me])
    expect(rows[0]).toEqual({ city: 'Shelbyville', phone: '5551234567' })
  })

  it('the homepage stats still work for visitors', async () => {
    await expect(asUser(db, null, 'select * from home_top_readers()')).resolves.toBeDefined()
  })
})
