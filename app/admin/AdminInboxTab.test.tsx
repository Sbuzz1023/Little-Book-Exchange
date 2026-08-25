import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AdminInboxTab from './AdminInboxTab'
import { createClient } from '@/lib/supabase/client'

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

// A generic chainable query-builder stub: every intermediate method returns
// itself, and it resolves to `result` however it's awaited — matches
// Supabase's real fluent builder closely enough without replicating it.
function makeChain(result: unknown) {
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, in: () => chain,
    then: (resolve: (v: unknown) => void) => Promise.resolve(result).then(resolve),
  }
  return chain
}

const ADMIN_ID = 'admin-1'

let conversationsResult: { data: any[]; error: unknown }
let profilesResult: { data: any[] }
let messagesResult: { data: any[] }
let updateResult: { data: any[] | null; error: unknown }

const updateSelectMock = vi.fn(() => Promise.resolve(updateResult))
const updateEqMock = vi.fn(() => ({ select: updateSelectMock }))
const updateMock = vi.fn(() => ({ eq: updateEqMock }))
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: { id: ADMIN_ID } } }))

const fromMock = vi.fn((table: string) => {
  if (table === 'conversations') return { select: () => makeChain(conversationsResult), update: updateMock }
  if (table === 'profiles') return { select: () => makeChain(profilesResult) }
  if (table === 'messages') return { select: () => makeChain(messagesResult) }
  throw new Error(`unexpected table ${table}`)
})

beforeEach(() => {
  vi.clearAllMocks()
  conversationsResult = {
    data: [
      { id: 'convo-unread', user_id: 'user-1', repliable: true, created_at: '2026-08-01T00:00:00.000Z', admin_last_read_at: null },
      { id: 'convo-read', user_id: 'user-2', repliable: true, created_at: '2026-08-02T00:00:00.000Z', admin_last_read_at: '2026-08-05T00:00:00.000Z' },
    ],
    error: null,
  }
  profilesResult = { data: [{ id: 'user-1', username: 'Alex' }, { id: 'user-2', username: 'Sam' }] }
  messagesResult = {
    data: [
      { id: 'm1', conversation_id: 'convo-unread', body: 'Need help', sender_id: 'user-1', created_at: '2026-08-04T00:00:00.000Z' },
      { id: 'm2', conversation_id: 'convo-read', body: 'Thanks', sender_id: 'user-2', created_at: '2026-08-02T00:00:00.000Z' },
    ],
  }
  updateResult = { data: [{ id: 'convo-unread' }], error: null }
  vi.mocked(createClient).mockReturnValue({ from: fromMock, auth: { getUser: getUserMock } } as any)
})

describe('AdminInboxTab', () => {
  it('reports the initial unread count once conversations load', async () => {
    const onUnreadCountChange = vi.fn()
    render(<AdminInboxTab onUnreadCountChange={onUnreadCountChange} />)
    await waitFor(() => expect(onUnreadCountChange).toHaveBeenCalledWith(1))
  })

  it('highlights the unread conversation but not the read one', async () => {
    const { findByTestId, getByTestId } = render(<AdminInboxTab onUnreadCountChange={vi.fn()} />)
    expect(await findByTestId('inbox-convo-convo-unread')).toHaveAttribute('data-unread', 'true')
    expect(getByTestId('inbox-convo-convo-read')).toHaveAttribute('data-unread', 'false')
  })

  it('marks only the opened conversation as read, clearing its highlight and decrementing the count', async () => {
    const onUnreadCountChange = vi.fn()
    const { findByTestId } = render(<AdminInboxTab onUnreadCountChange={onUnreadCountChange} />)
    const row = await findByTestId('inbox-convo-convo-unread')
    onUnreadCountChange.mockClear()

    fireEvent.click(row)

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith({ admin_last_read_at: expect.any(String) }))
    expect(updateEqMock).toHaveBeenCalledWith('id', 'convo-unread')
    await waitFor(() => expect(row).toHaveAttribute('data-unread', 'false'))
    expect(onUnreadCountChange).toHaveBeenCalledWith(0)
  })

  it('does not re-mark an already-read conversation as read when clicked', async () => {
    const { findByTestId } = render(<AdminInboxTab onUnreadCountChange={vi.fn()} />)
    const row = await findByTestId('inbox-convo-convo-read')
    fireEvent.click(row)
    await new Promise(r => setTimeout(r, 0))
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('does not clear the highlight or badge when the mark-read update is silently blocked by RLS (zero rows, no error)', async () => {
    updateResult = { data: [], error: null }
    const onUnreadCountChange = vi.fn()
    const { findByTestId } = render(<AdminInboxTab onUnreadCountChange={onUnreadCountChange} />)
    const row = await findByTestId('inbox-convo-convo-unread')
    onUnreadCountChange.mockClear()

    fireEvent.click(row)

    await waitFor(() => expect(updateSelectMock).toHaveBeenCalled())
    expect(row).toHaveAttribute('data-unread', 'true')
    expect(onUnreadCountChange).not.toHaveBeenCalledWith(0)
  })

  it('shows an error and does not clear the highlight when the mark-read update fails outright', async () => {
    updateResult = { data: null, error: { message: 'network error' } }
    const { findByTestId, findByText } = render(<AdminInboxTab onUnreadCountChange={vi.fn()} />)
    const row = await findByTestId('inbox-convo-convo-unread')

    fireEvent.click(row)

    expect(await findByText(/Could not mark this conversation as read/)).toBeInTheDocument()
    expect(row).toHaveAttribute('data-unread', 'true')
  })
})
