import { useState } from 'react'
import { render, fireEvent, within, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AdminClient, { UsersTab, formatDisputeTally, formatDisputeCounts } from './AdminClient'
import { openAdminChat } from '@/lib/actions/emailAdmin'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

vi.mock('@/lib/actions/admin', () => ({
  adminUpdateUserCredits: vi.fn(() => Promise.resolve({ ok: true })),
}))

vi.mock('@/lib/actions/emailAdmin', () => ({ openAdminChat: vi.fn() }))

// Every query resolves to empty data; enough for AdminClient's load effects.
vi.mock('@/lib/supabase/client', () => {
  const chain: any = new Proxy(function () {}, {
    get: (_t, prop) => prop === 'then'
      ? (resolve: (v: unknown) => void) => resolve({ data: [], error: null, count: 0 })
      : chain,
    apply: () => chain,
  })
  return { createClient: () => ({ from: () => chain, rpc: () => chain, auth: { getUser: () => Promise.resolve({ data: { user: null } }) } }) }
})

vi.mock('./DisputesAdminTab', () => ({
  default: ({ onOpenChat }: { onOpenChat: (id: string) => void }) => (
    <div>
      <button onClick={() => onOpenChat('buyer-1')}>💬 Message buyer</button>
    </div>
  ),
}))

vi.mock('./EmailsAdminTab', () => ({
  default: ({ openConversationId }: { openConversationId?: string | null }) => (
    <div data-testid="emails-tab" data-open-convo={openConversationId ?? ''} />
  ),
}))

vi.mock('./DisputeRow', () => ({
  default: ({ dispute, context, cardUserId }: { dispute: EnrichedDispute; context: string; cardUserId?: string }) => (
    <div data-testid={`dispute-${dispute.id}`}>{context}:{cardUserId ?? ''}</div>
  ),
}))

const baseUser = {
  joined: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', booksPosted: 0, booksSold: 0, booksBought: 0, credits: 0,
  status: 'active', city: 'Chicago', state: 'IL', zip: '', bio: '', reviews: 0, is_admin: false,
}

const users = [
  { ...baseUser, id: 'u1', username: 'Alex', email: 'alex@example.com' },
  { ...baseUser, id: 'u2', username: 'Sam', email: 'sam@example.com' },
  { ...baseUser, id: 'u3', username: 'Jordan', email: 'jordan@example.com' },
]

const disputes: EnrichedDispute[] = [
  { id: 'd1', conversationId: 'c1', message: 'Never showed up', status: 'open', createdAt: '2026-08-01T00:00:00.000Z', resolvedAt: null, adminReadAt: null, reporterId: 'u1', reporterName: 'Alex', otherPartyId: 'u2', buyerId: 'u1', sellerId: 'u2', otherPartyName: 'Sam', bookTitle: 'Dune' },
]

const disputeTally = { u1: { filed: 1, against: 0 }, u2: { filed: 0, against: 1 } }

function Harness({ disputesLoaded = true }: { disputesLoaded?: boolean } = {}) {
  const [state, setState] = useState(users)
  return (
    <UsersTab
      users={state}
      setUsers={setState}
      toggleAdmin={vi.fn()}
      disputeTally={disputeTally}
      enrichedDisputes={disputes}
      disputesLoaded={disputesLoaded}
      onDisputesChanged={vi.fn()}
    />
  )
}

function rowFor(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll('tbody tr')).find(r => r.textContent?.includes(name))!
}

function modalFor(container: HTMLElement) {
  return container.querySelector('.fixed.inset-0') as HTMLElement
}

describe('formatDisputeTally', () => {
  it('renders an em dash when there are no disputes', () => {
    expect(formatDisputeTally(undefined)).toBe('—')
    expect(formatDisputeTally({ filed: 0, against: 0 })).toBe('—')
  })

  it('renders the filed/against counts', () => {
    expect(formatDisputeTally({ filed: 2, against: 1 })).toBe('2 filed · 1 against')
  })
})

describe('formatDisputeCounts', () => {
  it('renders the filed/against counts with no em-dash special case, even at zero', () => {
    expect(formatDisputeCounts({ filed: 0, against: 0 })).toBe('0 filed · 0 against')
    expect(formatDisputeCounts({ filed: 2, against: 1 })).toBe('2 filed · 1 against')
  })
})

describe('UsersTab', () => {
  it('shows the dispute tally column for each user, and an em dash for a user with none', () => {
    const { container } = render(<Harness />)
    expect(container.textContent).toContain('1 filed · 0 against')
    expect(container.textContent).toContain('0 filed · 1 against')
    expect(rowFor(container, 'Jordan').textContent).toContain('—')
  })

  it('no longer shows an Edit link', () => {
    const { container } = render(<Harness />)
    expect(container.textContent).not.toContain('Edit ✏️')
  })

  it('opens the user card when the row is clicked', () => {
    const { container, getByText } = render(<Harness />)
    fireEvent.click(rowFor(container, 'Alex'))
    expect(getByText('Edit User')).toBeTruthy()
  })

  it('toggling status inside a row updates status but does not open the card', () => {
    const { container, queryByText } = render(<Harness />)
    const alexRow = rowFor(container, 'Alex')
    // Every row starts 'active', so '● Active' is not unique across the table
    // — scope the query to Alex's own row.
    fireEvent.click(within(alexRow).getByText('● Active'))
    expect(queryByText('Edit User')).toBeNull()
    expect(within(alexRow).getByText('● Suspended')).toBeTruthy()
  })

  it('toggling admin inside a row calls toggleAdmin but does not open the card', () => {
    const toggleAdmin = vi.fn()
    const { container, queryByText } = render(
      <UsersTab users={users} setUsers={vi.fn()} toggleAdmin={toggleAdmin} disputeTally={disputeTally} enrichedDisputes={disputes} disputesLoaded={true} onDisputesChanged={vi.fn()} />
    )
    const alexRow = rowFor(container, 'Alex')
    // Every row starts non-admin, so '○ User' is not unique across the table
    // — scope the query to Alex's own row.
    fireEvent.click(within(alexRow).getByText('○ User'))
    expect(queryByText('Edit User')).toBeNull()
    expect(toggleAdmin).toHaveBeenCalledWith('u1', false)
  })

  it("shows this user's filed disputes in the card, correctly labeled", () => {
    const { container, getByText, getByTestId } = render(<Harness />)
    fireEvent.click(rowFor(container, 'Alex'))
    expect(getByText('🚩 Disputes')).toBeTruthy()
    // Scoped to the modal itself — 'Alex' row in the table behind the modal
    // also contains this text, so an unscoped assertion would still pass
    // even if the card's own tally header were deleted.
    expect(modalFor(container).textContent).toContain('1 filed · 0 against')
    expect(getByTestId('dispute-d1').textContent).toBe('user-card:u1')
  })

  it("shows disputes filed against a user in their card", () => {
    const { container, getByTestId } = render(<Harness />)
    fireEvent.click(rowFor(container, 'Sam'))
    expect(getByTestId('dispute-d1').textContent).toBe('user-card:u2')
  })

  it('shows "No disputes." for a user with none', () => {
    const { container, getByText } = render(<Harness />)
    fireEvent.click(rowFor(container, 'Jordan'))
    expect(getByText('No disputes.')).toBeTruthy()
  })

  it('shows a loading message in the card instead of a tally or "No disputes." while disputes have not loaded yet', () => {
    const { container, getByText, queryByText } = render(<Harness disputesLoaded={false} />)
    fireEvent.click(rowFor(container, 'Jordan'))
    expect(within(modalFor(container)).getByText('Loading disputes...')).toBeTruthy()
    expect(queryByText('No disputes.')).toBeNull()
    expect(modalFor(container).textContent).not.toContain('filed')
    expect(modalFor(container).textContent).not.toContain('against')
  })
})

describe('AdminClient - open chat', () => {
  beforeEach(() => { vi.mocked(openAdminChat).mockReset() })

  function openDisputesTab(r: ReturnType<typeof render>) {
    fireEvent.click(r.getAllByText('Disputes')[0])
  }

  it('opens a chat with the buyer, switches to the Email/Message tab and passes the conversation id through', async () => {
    vi.mocked(openAdminChat).mockResolvedValue({ ok: true, conversationId: 'convo-9' })
    const r = render(<AdminClient />)
    openDisputesTab(r)
    fireEvent.click(r.getByText('💬 Message buyer'))
    await waitFor(() => expect(r.getByTestId('emails-tab')).toHaveAttribute('data-open-convo', 'convo-9'))
    expect(openAdminChat).toHaveBeenCalledWith('buyer-1')
  })

  it('shows an error banner and stays on Disputes when opening the chat fails, and clears it on tab switch', async () => {
    vi.mocked(openAdminChat).mockResolvedValue({ ok: false, error: 'Not authorized.' })
    const r = render(<AdminClient />)
    openDisputesTab(r)
    fireEvent.click(r.getByText('💬 Message buyer'))
    expect(await r.findByText('Not authorized.')).toBeTruthy()
    expect(r.queryByTestId('emails-tab')).toBeNull()
    fireEvent.click(r.getAllByText('Reviews')[0])
    expect(r.queryByText('Not authorized.')).toBeNull()
  })

  it('ignores a second open-chat request while one is in flight', async () => {
    let resolveOpen: (v: { ok: boolean; conversationId: string }) => void = () => {}
    vi.mocked(openAdminChat).mockReturnValue(new Promise(res => { resolveOpen = res }))
    const r = render(<AdminClient />)
    openDisputesTab(r)
    const btn = r.getByText('💬 Message buyer')
    fireEvent.click(btn)
    fireEvent.click(btn)
    expect(openAdminChat).toHaveBeenCalledTimes(1)
    await act(async () => { resolveOpen({ ok: true, conversationId: 'convo-1' }) })
    await waitFor(() => expect(r.getByTestId('emails-tab')).toBeTruthy())
  })
})
