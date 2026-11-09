// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createTestDb, createUser, asUser } from './harness'

let db: PGlite
beforeAll(async () => { db = await createTestDb() }, 60_000)

describe('get_my_profile', () => {
  it("returns only the caller's own full row, including private columns", async () => {
    const me = await createUser(db, { username: 'me_profile', credits: 4 })
    await createUser(db)
    const rows = await asUser<{ id: string; email: string; credits: number }>(db, me, 'select id, email, credits from get_my_profile()')
    expect(rows).toEqual([{ id: me, email: 'me_profile@example.com', credits: 4 }])
  })

  it('returns nothing when signed out', async () => {
    expect(await asUser(db, null, 'select id from get_my_profile()')).toEqual([])
  })
})

describe('mark_credits_seen', () => {
  it('moves credits_seen_at forward, never back', async () => {
    const me = await createUser(db)
    await asUser(db, me, `select mark_credits_seen('2030-01-01T00:00:00Z')`)
    await asUser(db, me, `select mark_credits_seen('2029-01-01T00:00:00Z')`)
    const { rows } = await db.query<{ seen: string }>(`select to_char(credits_seen_at at time zone 'UTC', 'YYYY') as seen from profiles where id = $1`, [me])
    expect(rows[0].seen).toBe('2030')
  })
})

describe('admin_list_users', () => {
  it('lists users with their emails for an admin', async () => {
    const admin = await createUser(db, { isAdmin: true })
    const target = await createUser(db, { username: 'target_user' })
    const rows = await asUser<{ id: string; email: string }>(db, admin, 'select id, email from admin_list_users($1)', [[target]])
    expect(rows).toEqual([{ id: target, email: 'target_user@example.com' }])
  })

  it('returns nothing for a non-admin', async () => {
    const member = await createUser(db)
    expect(await asUser(db, member, 'select id from admin_list_users()')).toEqual([])
  })
})
