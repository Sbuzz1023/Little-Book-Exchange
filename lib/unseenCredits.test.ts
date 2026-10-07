import { describe, it, expect, vi } from 'vitest'
import { fetchUnseenCredits } from './unseenCredits'

// Minimal Supabase stand-in: profiles → select().eq().single(); credit_transactions →
// select().eq().in().gt().order().limit(). Records the calls it gets.
function fakeSupabase(opts: {
  profile: { data: { credits_seen_at: string | null } | null; error: unknown }
  ledger?: { data: unknown[] | null; error: unknown }
}) {
  const calls: Record<string, unknown[]> = {}
  const chain = (table: string, result: unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'gt', 'order']) c[m] = (...a: unknown[]) => { calls[`${table}.${m}`] = a; return c }
    c.single = () => Promise.resolve(result)
    c.limit = (...a: unknown[]) => { calls[`${table}.limit`] = a; return Promise.resolve(result) }
    return c
  }
  const from = vi.fn((table: string) => {
    if (table === 'profiles') return chain(table, opts.profile)
    if (table === 'credit_transactions') return chain(table, opts.ledger ?? { data: [], error: null })
    throw new Error(`unexpected table ${table}`)
  })
  return { client: { from } as never, from, calls }
}

describe('fetchUnseenCredits', () => {
  it('returns [] without touching the ledger when credits_seen_at cannot be read (migration not run)', async () => {
    const sb = fakeSupabase({ profile: { data: null, error: { code: '42703', message: 'column profiles.credits_seen_at does not exist' } } })
    expect(await fetchUnseenCredits(sb.client, 'user-1')).toEqual([])
    expect(sb.from).not.toHaveBeenCalledWith('credit_transactions')
  })

  it('fetches animated ledger rows newer than credits_seen_at, oldest first', async () => {
    const sb = fakeSupabase({
      profile: { data: { credits_seen_at: '2026-10-06T09:00:00+00:00' }, error: null },
      ledger: { data: [{ id: 'a', amount: 1, reason: 'sale_earned', created_at: '2026-10-06T10:00:00+00:00', listings: { title: 'Dune' } }], error: null },
    })
    const rows = await fetchUnseenCredits(sb.client, 'user-1')
    expect(rows).toEqual([{ id: 'a', amount: 1, reason: 'sale_earned', created_at: '2026-10-06T10:00:00+00:00', title: 'Dune' }])
    expect(sb.calls['profiles.select']).toEqual(['credits_seen_at'])
    expect(sb.calls['credit_transactions.eq']).toEqual(['user_id', 'user-1'])
    expect(sb.calls['credit_transactions.in']).toEqual(['reason', ['sale_earned', 'purchase_spent', 'onboarding_bonus']])
    expect(sb.calls['credit_transactions.gt']).toEqual(['created_at', '2026-10-06T09:00:00+00:00'])
    expect(sb.calls['credit_transactions.order']).toEqual(['created_at', { ascending: true }])
    expect(sb.calls['credit_transactions.limit']).toEqual([50])
  })

  it('returns [] when the ledger query fails', async () => {
    const sb = fakeSupabase({
      profile: { data: { credits_seen_at: '2026-10-06T09:00:00+00:00' }, error: null },
      ledger: { data: null, error: { message: 'boom' } },
    })
    expect(await fetchUnseenCredits(sb.client, 'user-1')).toEqual([])
  })

  it('never throws', async () => {
    const client = { from: () => { throw new Error('down') } } as never
    expect(await fetchUnseenCredits(client, 'user-1')).toEqual([])
  })
})
