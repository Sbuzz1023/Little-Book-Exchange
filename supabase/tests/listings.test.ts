// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, call } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

const photoFor = (userId: string) => `https://proj.supabase.co/storage/v1/object/public/book-photos/${userId}/1-1.jpg`
const base = { title: 'Dune', author: 'Frank Herbert', condition: 'Good', ol_work_key: '/works/OL1W' }
type Created = { status: string; id?: string }
const row = async (id: string) =>
  (await db.query<Record<string, unknown>>('select * from listings where id = $1', [id])).rows[0]

describe('create_listing', () => {
  it('creates a single-book listing with the seller city from their profile', async () => {
    const seller = await createUser(db, { city: 'Shelbyville' })
    const r = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, photo_url: photoFor(seller) })])
    expect(r.status).toBe('ok')
    const l = await row(r.id!)
    expect(l).toMatchObject({ user_id: seller, title: 'Dune', city: 'Shelbyville', status: 'active', book_count: 1, is_bundle: false, photo_url: photoFor(seller) })
  })

  it('creates a bundle with its books, counted into book_count', async () => {
    const seller = await createUser(db)
    const books = [{ title: 'Hyperion', author: 'Dan Simmons', ol_work_key: '/works/OL2W' }, { title: '', author: '' }]
    const r = await call<Created>(db, seller, 'create_listing($1::jsonb, $2::jsonb)',
      [JSON.stringify({ ...base, is_bundle: true, bundle_name: ' Sci-fi pack ' }), JSON.stringify(books)])
    expect(await row(r.id!)).toMatchObject({ is_bundle: true, bundle_name: 'Sci-fi pack', book_count: 2 })
  })

  it('drops a cover URL that is not an Open Library cover', async () => {
    const seller = await createUser(db)
    const r = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, cover_url: 'https://evil.example/x.jpg' })])
    expect((await row(r.id!)).cover_url).toBeNull()
  })

  it('rejects a book with no Open Library match', async () => {
    const seller = await createUser(db)
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, ol_work_key: '' })])).toEqual({ status: 'needs_match' })
  })

  it("rejects a photo from someone else's folder", async () => {
    const seller = await createUser(db)
    const other = await createUser(db)
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, photo_url: photoFor(other) })])).toEqual({ status: 'invalid_photo' })
  })

  it('rejects a missing title or an unknown condition', async () => {
    const seller = await createUser(db)
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, title: ' ' })])).toEqual({ status: 'invalid_listing' })
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, condition: 'Mint' })])).toEqual({ status: 'invalid_listing' })
  })

  it('refuses a signed-out caller', async () => {
    expect(await call<Created>(db, null, 'create_listing($1::jsonb)', [JSON.stringify(base)])).toEqual({ status: 'not_allowed' })
  })
})

describe('update_listing', () => {
  it('updates the owner listing, keeping photos that were not replaced', async () => {
    const seller = await createUser(db)
    const created = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, photo_url: photoFor(seller) })])
    expect(await call(db, seller, 'update_listing($1, $2::jsonb)', [created.id, JSON.stringify({ ...base, title: 'Dune Messiah' })])).toBe('ok')
    expect(await row(created.id!)).toMatchObject({ title: 'Dune Messiah', photo_url: photoFor(seller) })
  })

  it("refuses someone else's listing and a listing with a pending request", async () => {
    const seller = await createUser(db)
    const other = await createUser(db)
    const active = await seedListing(db, seller)
    const pending = await seedListing(db, seller, { status: 'pending' })
    expect(await call(db, other, 'update_listing($1, $2::jsonb)', [active, JSON.stringify(base)])).toBe('not_allowed')
    expect(await call(db, seller, 'update_listing($1, $2::jsonb)', [pending, JSON.stringify(base)])).toBe('pending_request')
  })

  it('replaces bundle books as a whole', async () => {
    const seller = await createUser(db)
    const listing = await seedListing(db, seller, { bundleBooks: 3 })
    const books = [{ title: 'Only one', author: 'A', ol_work_key: '/works/OL5W' }]
    expect(await call(db, seller, 'update_listing($1, $2::jsonb, $3::jsonb)', [listing, JSON.stringify({ ...base, is_bundle: true }), JSON.stringify(books)])).toBe('ok')
    expect((await row(listing)).book_count).toBe(2)
  })
})

describe('set_listing_status and delete_listing', () => {
  it('lets the owner pause and reactivate, nothing else', async () => {
    const seller = await createUser(db)
    const other = await createUser(db)
    const listing = await seedListing(db, seller)
    expect(await call(db, seller, 'set_listing_status($1, $2)', [listing, 'paused'])).toBe('ok')
    expect((await row(listing)).status).toBe('paused')
    expect(await call(db, seller, 'set_listing_status($1, $2)', [listing, 'sold'])).toBe('invalid_status')
    expect(await call(db, other, 'set_listing_status($1, $2)', [listing, 'active'])).toBe('not_allowed')
  })

  it('never reopens a listing that has a pending request', async () => {
    const seller = await createUser(db)
    const pending = await seedListing(db, seller, { status: 'pending' })
    expect(await call(db, seller, 'set_listing_status($1, $2)', [pending, 'active'])).toBe('not_allowed')
    expect(await call(db, seller, 'delete_listing($1)', [pending])).toBe('pending_request')
  })

  it('deletes only the owner listing', async () => {
    const seller = await createUser(db)
    const other = await createUser(db)
    const listing = await seedListing(db, seller)
    expect(await call(db, other, 'delete_listing($1)', [listing])).toBe('not_allowed')
    expect(await call(db, seller, 'delete_listing($1)', [listing])).toBe('ok')
    expect(await row(listing)).toBeUndefined()
  })
})
