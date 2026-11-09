// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, seedListing, call } from './harness'
import { formatPickupAvailability } from '@/lib/formatPickupAvailability'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

let seq = 0
async function requested() {
  const seller = await createUser(db, { username: `sally_${++seq}` })
  const buyer = await createUser(db, { credits: 1 })
  const listing = await seedListing(db, seller)
  const r = await call<{ id: string }>(db, buyer, 'request_book($1)', [listing])
  return { seller, buyer, listing, convo: r.id, sellerName: `sally_${seq}` }
}
const convoRow = async (id: string) => (await db.query<Record<string, unknown>>('select * from conversations where id = $1', [id])).rows[0]
const window = { pickup_mode: 'window', pickup_date: '2026-11-12', pickup_time_start: '15:05', pickup_time_end: '17:00' }

describe('format_pickup_availability', () => {
  const cases: [string, string | null, string | null, string | null][] = [
    ['anytime', null, null, null],
    ['after', '2026-01-04', '00:30', null],
    ['window', '2026-11-12', '12:00', '13:15'],
    ['window', '2026-11-12', '09:00', null],
  ]
  it.each(cases)('matches the website formatter for %s %s %s %s', async (mode, date, start, end) => {
    const { rows } = await db.query<{ r: string | null }>('select format_pickup_availability($1, $2::date, $3::time, $4::time) as r', [mode, date, start, end])
    expect(rows[0].r).toBe(formatPickupAvailability({ mode: mode as 'window', date, timeStart: start, timeEnd: end }))
  })
})

describe('confirm_exchange', () => {
  it('confirms, stores the pickup, marks the listing sold and posts the confirmation message', async () => {
    const { seller, listing, convo, sellerName } = await requested()
    const pickup = { ...window, city: 'Springfield', state: 'IL', address: '1 Main St', address_unit: 'Apt 2', pickup: 'front porch' }
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(pickup)])).toBe('ok')
    expect(await convoRow(convo)).toMatchObject({ exchange_status: 'confirmed', confirmed_address: '1 Main St', confirmed_pickup: 'front porch', confirmed_pickup_mode: 'window' })
    expect((await db.query<{ status: string }>('select status from listings where id = $1', [listing])).rows[0].status).toBe('sold')
    const msg = (await db.query<{ body: string; kind: string }>(`select body, kind from messages where conversation_id = $1 and kind = 'confirmation'`, [convo])).rows[0]
    expect(msg.body).toBe([
      "📍 Exchange confirmed! Here's how to connect:",
      `👤 ${sellerName}`,
      '📌 Springfield, IL',
      '🏠 1 Main St Apt 2',
      '📦 Pickup: front porch',
      '🕐 Thu, Nov 12 · 3:05 PM–5:00 PM',
    ].join('\n'))
  })

  it('clears date and times for "ready now"', async () => {
    const { seller, convo } = await requested()
    const pickup = { pickup_mode: 'anytime', pickup_date: '2026-11-12', pickup_time_start: '10:00', city: 'Springfield' }
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(pickup)])).toBe('ok')
    expect(await convoRow(convo)).toMatchObject({ confirmed_pickup_date: null, confirmed_pickup_time_start: null, confirmed_pickup_time_end: null })
  })

  it('rejects an incomplete or garbled pickup time without confirming', async () => {
    const { seller, convo } = await requested()
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify({ ...window, pickup_time_end: '' })])).toBe('invalid_pickup')
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify({ ...window, pickup_date: 'soon' })])).toBe('invalid_pickup')
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify({ pickup_mode: 'whenever' })])).toBe('invalid_pickup')
    expect((await convoRow(convo)).exchange_status).toBe('requested')
  })

  it('refuses the buyer, strangers, and an exchange that is not requested', async () => {
    const { seller, buyer, convo } = await requested()
    const stranger = await createUser(db)
    expect(await call(db, buyer, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(window)])).toBe('not_allowed')
    expect(await call(db, stranger, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(window)])).toBe('not_allowed')
    await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(window)])
    expect(await call(db, seller, 'confirm_exchange($1, $2::jsonb)', [convo, JSON.stringify(window)])).toBe('wrong_status')
  })
})

describe('deny_request', () => {
  it('declines, reopens the listing and notifies the buyer', async () => {
    const { seller, buyer, listing, convo } = await requested()
    expect(await call(db, seller, 'deny_request($1)', [convo])).toBe('ok')
    expect((await convoRow(convo)).exchange_status).toBe('declined')
    expect((await db.query<{ status: string }>('select status from listings where id = $1', [listing])).rows[0].status).toBe('active')
    const notes = (await db.query(`select id from notifications where user_id = $1 and type = 'purchase_decision' and entity_id = $2`, [buyer, convo])).rows
    expect(notes).toHaveLength(1)
  })

  it('refuses the buyer and strangers', async () => {
    const { buyer, convo } = await requested()
    const stranger = await createUser(db)
    expect(await call(db, buyer, 'deny_request($1)', [convo])).toBe('not_allowed')
    expect(await call(db, stranger, 'deny_request($1)', [convo])).toBe('not_allowed')
  })
})
