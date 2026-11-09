// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, seedConversation, asUser, credits } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

describe('test database harness', () => {
  it('loads the real schema and auto-creates a profile for a new user', async () => {
    const id = await createUser(db, { username: 'sally', credits: 3 })
    const rows = (await db.query<{ username: string }>('select username from profiles where id = $1', [id])).rows
    expect(rows[0].username).toBe('sally')
    expect(await credits(db, id)).toBe(3)
  })

  it('enforces row-level security for a signed-in user', async () => {
    const seller = await createUser(db)
    const buyer = await createUser(db)
    const stranger = await createUser(db)
    const listing = await seedListing(db, seller)
    await seedConversation(db, { listingId: listing, buyerId: buyer, sellerId: seller, status: 'requested' })
    expect(await asUser(db, buyer, 'select id from conversations where listing_id = $1', [listing])).toHaveLength(1)
    expect(await asUser(db, stranger, 'select id from conversations where listing_id = $1', [listing])).toHaveLength(0)
  })

  it('counts bundle books into book_count', async () => {
    const seller = await createUser(db)
    const listing = await seedListing(db, seller, { bundleBooks: 2 })
    const rows = (await db.query<{ book_count: number }>('select book_count from listings where id = $1', [listing])).rows
    expect(rows[0].book_count).toBe(3)
  })
})
