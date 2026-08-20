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
  createdAt: '2026-08-01T00:00:00.000Z', resolvedAt: null,
  reporterId: 'u1', reporterName: 'Alex', otherPartyId: 'u2', otherPartyName: 'Sam', bookTitle: 'Dune',
}
const resolvedDispute: EnrichedDispute = { ...openDispute, id: 'd2', status: 'resolved', resolvedAt: '2026-08-02T00:00:00.000Z' }

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

  it('shows Unresolved for a resolved dispute and calls the action on click', async () => {
    const onChanged = vi.fn()
    const { getByText } = render(<DisputeRow dispute={resolvedDispute} context="admin-tab" onChanged={onChanged} />)
    fireEvent.click(getByText('↺ Unresolved'))
    await waitFor(() => expect(adminSetDisputeStatus).toHaveBeenCalledWith('d2', 'open'))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
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
})
