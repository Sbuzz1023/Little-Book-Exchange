import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import MessagesTab, { type MessagesTabExchange } from './MessagesTab'
import { createClient } from '@/lib/supabase/client'

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(),
}))

const exchanges: MessagesTabExchange[] = [
  {
    id: 'convo-1', listing_id: 'listing-1', buyer_id: 'them-1', seller_id: 'me',
    created_at: '2026-07-01T09:00:00.000Z',
    listings: { title: 'The Hobbit', author: 'J.R.R. Tolkien' },
    buyer: { name: 'Neighbor A' }, seller: { name: 'Me' },
    messages: [
      { id: 'm1', body: 'Is this still available?', sender_id: 'them-1', created_at: '2026-07-01T10:00:00.000Z' },
      { id: 'm2', body: 'Yes!', sender_id: 'me', created_at: '2026-07-01T10:05:00.000Z' },
    ],
  },
  {
    id: 'convo-2', listing_id: 'listing-2', buyer_id: 'me', seller_id: 'them-2',
    created_at: '2026-07-02T09:00:00.000Z',
    listings: { title: 'Sapiens', author: 'Yuval Noah Harari' },
    buyer: { name: 'Me' }, seller: { name: 'Neighbor B' },
    messages: [],
    sellerRating: { average: 4.5, count: 8 },
  },
]

function findButtonWithText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes(text))
}

describe('MessagesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the empty-thread placeholder when no conversation is selected', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain('Select a conversation to start chatting')
  })

  it('lists every conversation with the other party\'s name and listing title', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain('Neighbor A')
    expect(container.textContent).toContain('The Hobbit')
    expect(container.textContent).toContain('Neighbor B')
    expect(container.textContent).toContain('Sapiens')
  })

  it('shows the selected conversation\'s messages in the thread', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-1" onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain('Is this still available?')
    expect(container.textContent).toContain('Yes!')
  })

  it('calls onSelectId with the conversation id when a list row is clicked', () => {
    const onSelectId = vi.fn()
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={onSelectId} />
    )
    fireEvent.click(findButtonWithText(container, 'Neighbor A')!)
    expect(onSelectId).toHaveBeenCalledWith('convo-1')
  })

  it('calls onSelectId(null) when the mobile back button is clicked', () => {
    const onSelectId = vi.fn()
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-1" onSelectId={onSelectId} />
    )
    const backButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === '‹')
    fireEvent.click(backButton!)
    expect(onSelectId).toHaveBeenCalledWith(null)
  })

  it('demo mode: sending a message appends it locally without calling Supabase', async () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-1" onSelectId={vi.fn()} />
    )
    const input = container.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'See you Saturday!' } })
    fireEvent.click(container.querySelector('button[type="submit"]')!)
    await waitFor(() => expect(container.textContent).toContain('See you Saturday!'))
    expect(createClient).not.toHaveBeenCalled()
  })

  it('non-demo mode: sending a message inserts a row via Supabase and shows it immediately', async () => {
    const inserted = { id: 'm3', conversation_id: 'convo-1', sender_id: 'me', body: 'See you Saturday!', created_at: '2026-07-01T10:10:00.000Z' }
    const single = vi.fn(() => Promise.resolve({ data: inserted, error: null }))
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => ({ insert })),
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
      removeChannel: vi.fn(),
    } as any)

    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={false} selectedId="convo-1" onSelectId={vi.fn()} />
    )
    const input = container.querySelector('input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'See you Saturday!' } })
    fireEvent.click(container.querySelector('button[type="submit"]')!)
    expect(insert).toHaveBeenCalledWith({
      conversation_id: 'convo-1', sender_id: 'me', body: 'See you Saturday!',
    })
    await waitFor(() => expect(container.textContent).toContain('See you Saturday!'))
  })

  it('shows the seller\'s rating badge next to their name when the other party is the seller', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-2" onSelectId={vi.fn()} />
    )
    expect(container.textContent).toContain('4.5')
    expect(container.textContent).toContain('(8)')
  })

  it('does not show a rating badge when the other party is the buyer, not the seller', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId="convo-1" onSelectId={vi.fn()} />
    )
    expect(container.textContent).not.toContain('★')
  })

  it('lists conversations with the most recent message activity first', () => {
    const orderedExchanges: MessagesTabExchange[] = [
      {
        id: 'convo-old', listing_id: 'listing-1', buyer_id: 'them-1', seller_id: 'me',
        created_at: '2026-01-01T00:00:00.000Z',
        listings: { title: 'Old Book', author: 'A' },
        buyer: { name: 'Old Neighbor' }, seller: { name: 'Me' },
        messages: [{ id: 'm1', body: 'hi', sender_id: 'them-1', created_at: '2026-01-01T00:05:00.000Z' }],
      },
      {
        id: 'convo-new', listing_id: 'listing-2', buyer_id: 'them-2', seller_id: 'me',
        created_at: '2026-07-01T00:00:00.000Z',
        listings: { title: 'New Book', author: 'B' },
        buyer: { name: 'New Neighbor' }, seller: { name: 'Me' },
        messages: [{ id: 'm2', body: 'hey', sender_id: 'them-2', created_at: '2026-07-30T00:00:00.000Z' }],
      },
    ]
    const { container } = render(
      <MessagesTab exchanges={orderedExchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} />
    )
    const oldIndex = container.textContent!.indexOf('Old Neighbor')
    const newIndex = container.textContent!.indexOf('New Neighbor')
    expect(newIndex).toBeGreaterThanOrEqual(0)
    expect(newIndex).toBeLessThan(oldIndex)
  })

  it('falls back to the conversation\'s own created_at when it has no messages yet', () => {
    const orderedExchanges: MessagesTabExchange[] = [
      {
        id: 'convo-old-empty', listing_id: 'listing-1', buyer_id: 'them-1', seller_id: 'me',
        created_at: '2026-01-01T00:00:00.000Z',
        listings: { title: 'Old Book', author: 'A' },
        buyer: { name: 'Old Neighbor' }, seller: { name: 'Me' },
        messages: [],
      },
      {
        id: 'convo-new-empty', listing_id: 'listing-2', buyer_id: 'them-2', seller_id: 'me',
        created_at: '2026-07-01T00:00:00.000Z',
        listings: { title: 'New Book', author: 'B' },
        buyer: { name: 'New Neighbor' }, seller: { name: 'Me' },
        messages: [],
      },
    ]
    const { container } = render(
      <MessagesTab exchanges={orderedExchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} />
    )
    const oldIndex = container.textContent!.indexOf('Old Neighbor')
    const newIndex = container.textContent!.indexOf('New Neighbor')
    expect(newIndex).toBeGreaterThanOrEqual(0)
    expect(newIndex).toBeLessThan(oldIndex)
  })
})

describe('MessagesTab — unread highlighting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('highlights a conversation row that has an unread message notification', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} unreadConversationIds={['convo-1']} />
    )
    expect(container.querySelector('[data-testid="conversation-row-unread"]')).not.toBeNull()
  })

  it('does not highlight a conversation with no unread notification', () => {
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={vi.fn()} unreadConversationIds={[]} />
    )
    expect(container.querySelector('[data-testid="conversation-row-unread"]')).toBeNull()
  })

  it('marks the conversation read via Supabase when selected in non-demo mode', () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockReturnThis() }))
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => ({ update })),
      channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
      removeChannel: vi.fn(),
    } as any)

    const onSelectId = vi.fn()
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={false} selectedId={null} onSelectId={onSelectId} unreadConversationIds={['convo-1']} />
    )
    fireEvent.click(findButtonWithText(container, 'Neighbor A')!)
    expect(onSelectId).toHaveBeenCalledWith('convo-1')
    expect(update).toHaveBeenCalledWith({ read: true })
  })

  it('does not call Supabase to mark read in demo mode', () => {
    const onSelectId = vi.fn()
    const { container } = render(
      <MessagesTab exchanges={exchanges} userId="me" isDemo={true} selectedId={null} onSelectId={onSelectId} unreadConversationIds={['convo-1']} />
    )
    fireEvent.click(findButtonWithText(container, 'Neighbor A')!)
    expect(createClient).not.toHaveBeenCalled()
  })
})
