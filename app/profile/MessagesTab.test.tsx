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
    listings: { title: 'The Hobbit', author: 'J.R.R. Tolkien' },
    buyer: { name: 'Neighbor A' }, seller: { name: 'Me' },
    messages: [
      { id: 'm1', body: 'Is this still available?', sender_id: 'them-1', created_at: '2026-07-01T10:00:00.000Z' },
      { id: 'm2', body: 'Yes!', sender_id: 'me', created_at: '2026-07-01T10:05:00.000Z' },
    ],
  },
  {
    id: 'convo-2', listing_id: 'listing-2', buyer_id: 'me', seller_id: 'them-2',
    listings: { title: 'Sapiens', author: 'Yuval Noah Harari' },
    buyer: { name: 'Me' }, seller: { name: 'Neighbor B' },
    messages: [],
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

  it('non-demo mode: sending a message inserts a row via Supabase', async () => {
    const insert = vi.fn(() => Promise.resolve({ error: null }))
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
    await waitFor(() => expect(insert).toHaveBeenCalledWith({
      conversation_id: 'convo-1', sender_id: 'me', body: 'See you Saturday!',
    }))
  })
})
