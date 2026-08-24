import { render, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DisputeRow from './DisputeRow'
import { adminSetDisputeStatus, adminDeleteDispute } from '@/lib/actions/admin'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

vi.mock('@/lib/actions/admin', () => ({
  adminSetDisputeStatus: vi.fn(),
  adminDeleteDispute: vi.fn(),
}))

const openDispute: EnrichedDispute = {
  id: 'd1', conversationId: 'c1', message: 'Book never showed up', status: 'open',
  createdAt: '2026-08-01T00:00:00.000Z', resolvedAt: null, adminReadAt: null,
  reporterId: 'u1', reporterName: 'Alex', otherPartyId: 'u2', otherPartyName: 'Sam', bookTitle: 'Dune',
}
const resolvedDispute: EnrichedDispute = { ...openDispute, id: 'd2', status: 'resolved', resolvedAt: '2026-08-02T00:00:00.000Z' }
const unresolvedDispute: EnrichedDispute = { ...openDispute, id: 'd3', status: 'unresolved', resolvedAt: '2026-08-02T00:00:00.000Z' }

describe('DisputeRow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adminSetDisputeStatus).mockResolvedValue({ ok: true })
    vi.mocked(adminDeleteDispute).mockResolvedValue({ ok: true })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('shows Resolve for an open dispute and calls the action on click', async () => {
    const onChanged = vi.fn()
    const { getByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={onChanged} />)
    fireEvent.click(getByText('✓ Resolve'))
    await waitFor(() => expect(adminSetDisputeStatus).toHaveBeenCalledWith('d1', 'resolved'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('shows both Resolve and Unresolved on an open dispute, and clicking Unresolved calls the action', async () => {
    const onChanged = vi.fn()
    const { getByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={onChanged} />)
    expect(getByText('✓ Resolve')).toBeTruthy()
    fireEvent.click(getByText('✕ Unresolved'))
    await waitFor(() => expect(adminSetDisputeStatus).toHaveBeenCalledWith('d1', 'unresolved'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('shows no Resolve/Unresolved buttons on an already-resolved dispute — one-way archive', () => {
    const { queryByText } = render(<DisputeRow dispute={resolvedDispute} context="admin-tab" onChanged={vi.fn()} />)
    expect(queryByText('✓ Resolve')).toBeNull()
    expect(queryByText('✕ Unresolved')).toBeNull()
  })

  it('shows no Resolve/Unresolved buttons on an already-unresolved dispute — one-way archive', () => {
    const { queryByText } = render(<DisputeRow dispute={unresolvedDispute} context="admin-tab" onChanged={vi.fn()} />)
    expect(queryByText('✓ Resolve')).toBeNull()
    expect(queryByText('✕ Unresolved')).toBeNull()
  })

  it('still shows Delete on a resolved dispute', () => {
    const { getByText } = render(<DisputeRow dispute={resolvedDispute} context="admin-tab" onChanged={vi.fn()} />)
    expect(getByText('🗑️ Delete')).toBeTruthy()
  })

  it('still shows Delete on an unresolved dispute', () => {
    const { getByText } = render(<DisputeRow dispute={unresolvedDispute} context="admin-tab" onChanged={vi.fn()} />)
    expect(getByText('🗑️ Delete')).toBeTruthy()
  })

  it('shows a status badge that matches each status', () => {
    const { container: openContainer } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={vi.fn()} />)
    expect(openContainer.textContent).toContain('Open')
    const { container: resolvedContainer } = render(<DisputeRow dispute={resolvedDispute} context="admin-tab" onChanged={vi.fn()} />)
    expect(resolvedContainer.textContent).toContain('Resolved')
    const { container: unresolvedContainer } = render(<DisputeRow dispute={unresolvedDispute} context="admin-tab" onChanged={vi.fn()} />)
    expect(unresolvedContainer.textContent).toContain('Unresolved')
  })

  it('deletes after confirming, and calls onChanged', async () => {
    const onChanged = vi.fn()
    const { getByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={onChanged} />)
    fireEvent.click(getByText('🗑️ Delete'))
    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => expect(adminDeleteDispute).toHaveBeenCalledWith('d1'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('does not delete when the confirm dialog is cancelled', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { getByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={vi.fn()} />)
    fireEvent.click(getByText('🗑️ Delete'))
    expect(adminDeleteDispute).not.toHaveBeenCalled()
  })

  it('shows an inline error and does not call onChanged when an action fails', async () => {
    vi.mocked(adminSetDisputeStatus).mockResolvedValue({ ok: false, error: 'Something broke.' })
    const onChanged = vi.fn()
    const { getByText, findByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={onChanged} />)
    fireEvent.click(getByText('✓ Resolve'))
    expect(await findByText('Something broke.')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('shows the reporter/other-party framing and a Message button in admin-tab context', () => {
    const onMessageReporter = vi.fn()
    const { getByText, container } = render(
      <DisputeRow dispute={openDispute} context="admin-tab" onChanged={vi.fn()} onMessageReporter={onMessageReporter} />
    )
    expect(container.textContent).toContain('Reported by Alex against Sam')
    fireEvent.click(getByText('💬 Message'))
    expect(onMessageReporter).toHaveBeenCalledWith('u1')
  })

  it('labels "Filed by this user" when the card owner is the reporter, and hides the Message button', () => {
    const { container, queryByText } = render(
      <DisputeRow dispute={openDispute} context="user-card" cardUserId="u1" onChanged={vi.fn()} />
    )
    expect(container.textContent).toContain('Filed by this user')
    expect(queryByText('💬 Message')).toBeNull()
  })

  it('labels "Filed against this user" when the card owner is the other party', () => {
    const { container } = render(
      <DisputeRow dispute={openDispute} context="user-card" cardUserId="u2" onChanged={vi.fn()} />
    )
    expect(container.textContent).toContain('Filed against this user')
  })

  it('handles rejected server actions and re-enables the button', async () => {
    vi.mocked(adminSetDisputeStatus).mockRejectedValue(new Error('network error'))
    const onChanged = vi.fn()
    const { getByText, findByText } = render(<DisputeRow dispute={openDispute} context="admin-tab" onChanged={onChanged} />)
    fireEvent.click(getByText('✓ Resolve'))
    expect(await findByText('Something went wrong.')).toBeTruthy()
    expect(onChanged).not.toHaveBeenCalled()
    const button = getByText('✓ Resolve') as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })
})
