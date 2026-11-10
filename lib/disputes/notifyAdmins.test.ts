import { describe, it, expect, vi, beforeEach } from 'vitest'
import { notifyAdminsOfDispute } from './notifyAdmins'

vi.mock('server-only', () => ({}))
const sendEmail = vi.fn((_: { to: string; subject: string; text: string }) => Promise.resolve({ ok: true }))
vi.mock('@/lib/email/resend', () => ({ sendEmail: (m: { to: string; subject: string; text: string }) => sendEmail(m) }))

let adminRows: { email: string | null }[] = [{ email: 'admin@example.com' }, { email: null }]
let claimed: { id: string; message: string; conversation_id: string } | null
const tables: Record<string, unknown> = {
  disputes: { update: () => ({ eq: () => ({ is: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: claimed }) }) }) }) }) },
  conversations: { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { listing_id: 'listing-1' } }) }) }) },
  listings: { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { title: 'Dune' } }) }) }) },
  profiles: { select: () => ({ eq: () => Promise.resolve({ data: adminRows }) }) },
}
vi.mock('@/lib/supabase/serviceRole', () => ({ createServiceRoleClient: () => ({ from: (t: string) => tables[t] }) }))

describe('notifyAdminsOfDispute', () => {
  beforeEach(() => { sendEmail.mockClear(); adminRows = [{ email: 'admin@example.com' }, { email: null }] })

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

  it('still emails later admins when one send throws', async () => {
    claimed = { id: 'd-1', message: 'm', conversation_id: 'convo-1' }
    adminRows = [{ email: 'a@example.com' }, { email: 'b@example.com' }]
    sendEmail.mockRejectedValueOnce(new Error('resend down'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await notifyAdminsOfDispute('d-1')).toBe(true)
    expect(sendEmail).toHaveBeenCalledTimes(2)
    expect(sendEmail).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'b@example.com' }))
    spy.mockRestore()
  })
})
