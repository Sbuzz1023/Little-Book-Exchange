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

  it('returns the same listing for an identical double-submit and inserts only one row', async () => {
    const seller = await createUser(db)
    const payload = JSON.stringify({ ...base, photo_url: photoFor(seller) })
    const a = await call<Created>(db, seller, 'create_listing($1::jsonb)', [payload])
    const b = await call<Created>(db, seller, 'create_listing($1::jsonb)', [payload])
    expect(a.status).toBe('ok')
    expect(b).toEqual({ status: 'ok', id: a.id })
    const n = await db.query<{ n: number }>('select count(*)::int as n from listings where user_id = $1', [seller])
    expect(n.rows[0].n).toBe(1)
  })

  it('creates a second listing when the title differs', async () => {
    const seller = await createUser(db)
    const a = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify(base)])
    const b = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, title: 'Dune Messiah' })])
    expect(b.status).toBe('ok')
    expect(b.id).not.toBe(a.id)
    const n = await db.query<{ n: number }>('select count(*)::int as n from listings where user_id = $1', [seller])
    expect(n.rows[0].n).toBe(2)
  })

  it('refuses a signed-out caller', async () => {
    expect(await call<Created>(db, null, 'create_listing($1::jsonb)', [JSON.stringify(base)])).toEqual({ status: 'not_allowed' })
  })

  it('rejects a crafted URL that looks like it contains the user folder but is not', async () => {
    const seller = await createUser(db)
    // Vulnerable: https://evil.example/x?/storage/v1/object/public/book-photos/<seller>/
    const evilUrl = `https://evil.example/x?/storage/v1/object/public/book-photos/${seller}/`
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, photo_url: evilUrl })])).toEqual({ status: 'invalid_photo' })
  })

  it('accepts a legitimate photo URL in own folder', async () => {
    const seller = await createUser(db)
    const legit = `https://proj.supabase.co/storage/v1/object/public/book-photos/${seller}/photo.jpg`
    const r = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, photo_url: legit })])
    expect(r.status).toBe('ok')
  })

  it('rejects invalid price formats', async () => {
    const seller = await createUser(db)
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, price: 'abc' })])).toEqual({ status: 'invalid_listing' })
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, price: '99999999' })])).toEqual({ status: 'invalid_listing' })
  })

  it('does not raise on is_bundle "yes", treats as not a bundle', async () => {
    const seller = await createUser(db)
    const r = await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify({ ...base, is_bundle: 'yes' })])
    expect(r.status).toBe('ok')
    expect((await row(r.id!)).is_bundle).toBe(false)
  })

  it('rejects p_books as object instead of array', async () => {
    const seller = await createUser(db)
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb, $2::jsonb)',
      [JSON.stringify({ ...base, is_bundle: true }), JSON.stringify({})])).toEqual({ status: 'invalid_listing' })
  })

  it('rejects non-object p_listing', async () => {
    const seller = await createUser(db)
    expect(await call<Created>(db, seller, 'create_listing($1::jsonb)', [JSON.stringify('not an object')])).toEqual({ status: 'invalid_listing' })
  })
})


async function confirmedSale() {
  const seller = await createUser(db)
  const buyer = await createUser(db, { credits: 1 })
  const listing = await seedListing(db, seller)
  const r = await call<{ id: string }>(db, buyer, 'request_book($1)', [listing])
  await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [r.id, JSON.stringify({ pickup_mode: 'anytime', city: 'X' })])
  return { seller, buyer, listing, convo: r.id }
}

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

  it('refuses to edit a sold listing, so the price cannot change after confirmation', async () => {
    const { seller, listing } = await confirmedSale()
    expect((await row(listing)).status).toBe('sold')
    const books = Array.from({ length: 5 }, (_, i) => ({ title: `B${i}`, author: 'A', ol_work_key: `/works/OL${i}W` }))
    expect(await call(db, seller, 'update_listing($1, $2::jsonb, $3::jsonb)', [listing, JSON.stringify({ ...base, is_bundle: 'true' }), JSON.stringify(books)])).toBe('sold')
    expect((await row(listing)).book_count).toBe(1)
  })

  it('replaces bundle books as a whole', async () => {
    const seller = await createUser(db)
    const listing = await seedListing(db, seller, { bundleBooks: 3 })
    const books = [{ title: 'Only one', author: 'A', ol_work_key: '/works/OL5W' }]
    expect(await call(db, seller, 'update_listing($1, $2::jsonb, $3::jsonb)', [listing, JSON.stringify({ ...base, is_bundle: true }), JSON.stringify(books)])).toBe('ok')
    expect((await row(listing)).book_count).toBe(2)
  })

  it('rejects invalid price in update', async () => {
    const seller = await createUser(db)
    const listing = await seedListing(db, seller)
    expect(await call(db, seller, 'update_listing($1, $2::jsonb)', [listing, JSON.stringify({ ...base, price: 'abc' })])).toBe('invalid_listing')
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

  it('refuses to delete a sold listing and keeps the exchange', async () => {
    const { seller, listing, convo } = await confirmedSale()
    expect(await call(db, seller, 'delete_listing($1)', [listing])).toBe('sold')
    const { rows } = await db.query('select 1 from conversations where id = $1', [convo])
    expect(rows).toHaveLength(1)
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
