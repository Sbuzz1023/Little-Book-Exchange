import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import DisputesAdminTab from './DisputesAdminTab'
import type { EnrichedDispute } from '@/lib/disputeEnrichment'

vi.mock('./DisputeRow', () => ({
  default: ({ dispute }: { dispute: EnrichedDispute }) => <div data-testid={`dispute-${dispute.id}`}>{dispute.message}</div>,
}))

const disputes: EnrichedDispute[] = [
  { id: 'd-open', conversationId: 'c1', message: 'Book never showed up', status: 'open', createdAt: '2026-08-01T00:00:00.000Z', resolvedAt: null, reporterId: 'u1', reporterName: 'Alex', otherPartyId: 'u2', otherPartyName: 'Sam', bookTitle: 'Dune' },
  { id: 'd-resolved', conversationId: 'c2', message: 'Resolved amicably', status: 'resolved', createdAt: '2026-08-02T00:00:00.000Z', resolvedAt: '2026-08-03T00:00:00.000Z', reporterId: 'u2', reporterName: 'Sam', otherPartyId: 'u1', otherPartyName: 'Alex', bookTitle: 'Sapiens' },
  { id: 'd-unresolved', conversationId: 'c3', message: 'Closed without a fix', status: 'unresolved', createdAt: '2026-08-04T00:00:00.000Z', resolvedAt: '2026-08-05T00:00:00.000Z', reporterId: 'u1', reporterName: 'Alex', otherPartyId: 'u2', otherPartyName: 'Sam', bookTitle: 'Sapiens' },
]

describe('DisputesAdminTab', () => {
  it('defaults to showing only active (open) disputes', () => {
    const { getByTestId, queryByTestId } = render(<DisputesAdminTab disputes={disputes} disputesLoaded={true} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByTestId('dispute-d-open')).toBeTruthy()
    expect(queryByTestId('dispute-d-resolved')).toBeNull()
    expect(queryByTestId('dispute-d-unresolved')).toBeNull()
  })

  it('shows both resolved and unresolved disputes together when the History tab is selected', () => {
    const { getByText, getByTestId, queryByTestId } = render(<DisputesAdminTab disputes={disputes} disputesLoaded={true} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    fireEvent.click(getByText('History'))
    expect(getByTestId('dispute-d-resolved')).toBeTruthy()
    expect(getByTestId('dispute-d-unresolved')).toBeTruthy()
    expect(queryByTestId('dispute-d-open')).toBeNull()
  })

  it('shows an empty state on the Active tab when there are no open disputes', () => {
    const { getByText } = render(<DisputesAdminTab disputes={[]} disputesLoaded={true} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByText('No active disputes.')).toBeTruthy()
  })

  it('shows an empty state on the History tab when there is no history yet', () => {
    const { getByText } = render(<DisputesAdminTab disputes={[]} disputesLoaded={true} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    fireEvent.click(getByText('History'))
    expect(getByText('No history yet.')).toBeTruthy()
  })

  it('shows a loading message instead of the empty state while disputes have not loaded yet', () => {
    const { getByText, queryByText } = render(<DisputesAdminTab disputes={[]} disputesLoaded={false} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByText('Loading disputes...')).toBeTruthy()
    expect(queryByText('No active disputes.')).toBeNull()
  })

  it('shows the loading message even when disputes data is present but not yet marked loaded', () => {
    const { getByText, queryByTestId } = render(<DisputesAdminTab disputes={disputes} disputesLoaded={false} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByText('Loading disputes...')).toBeTruthy()
    expect(queryByTestId('dispute-d-open')).toBeNull()
  })
})
