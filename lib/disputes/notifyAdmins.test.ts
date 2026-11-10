import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyAdminsOfDispute } from './notifyAdmins'

vi.mock('server-only', () => ({}))
const sendEmail = vi.fn((_: { to: string; subject: string; text: string }) => Promise.resolve({ ok: true }))
vi.mock('@/lib/email/resend', () => ({ sendEmail: (m: { to: string; subject: string; text: string }) => sendEmail(m) }))

let claimed: { id: string; message: string; conversation_id: string } | null
const tables: Record<string, unknown> = {
  disputes: { update: () => ({ eq: () => ({ is: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: claimed }) }) }) }) }) },
  conversations: { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { listing_id: 'listing-1' } }) }) }) },
  listings: { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { title: 'Dune' } }) }) }) },
  profiles: { select: () => ({ eq: () => Promise.resolve({ data: [{ email: 'admin@example.com' }, { email: null }] }) }) },
}
vi.mock('@/lib/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ from: (t: string) => tables[t] }) }))

describe('notifyAdminsOfDispute', () => {
  beforeEach(() => { sendEmail.mockClear() })

  it('emails every admin once with the book title and message', async () => {
    claimed = { id: 'd-1', message: 'Book never left out', conversation_id: 'convo-1' }
    expect(await notifyAdminsOfDispute('d-1')).toBe(true)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'admin@example.com',
      subject: 'Dispute filed: Dune',
      text: 'A dispute was filed on an exchange.\n\nMessage:\nBook never left out\n\nConversation ID: convo-1',
    })
  })

  it('sends nothing when the email already went out', async () => {
    claimed = null
    expect(await notifyAdminsOfDispute('d-1')).toBe(false)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
