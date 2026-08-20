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
]

describe('DisputesAdminTab', () => {
  it('defaults to showing only open disputes', () => {
    const { getByTestId, queryByTestId } = render(<DisputesAdminTab disputes={disputes} disputesLoaded={true} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByTestId('dispute-d-open')).toBeTruthy()
    expect(queryByTestId('dispute-d-resolved')).toBeNull()
  })

  it('shows resolved disputes when the Resolved filter is selected', () => {
    const { getByText, getByTestId, queryByTestId } = render(<DisputesAdminTab disputes={disputes} disputesLoaded={true} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    fireEvent.click(getByText('Resolved'))
    expect(getByTestId('dispute-d-resolved')).toBeTruthy()
    expect(queryByTestId('dispute-d-open')).toBeNull()
  })

  it('shows every dispute when the All filter is selected', () => {
    const { getByText, getByTestId } = render(<DisputesAdminTab disputes={disputes} disputesLoaded={true} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    fireEvent.click(getByText('All'))
    expect(getByTestId('dispute-d-open')).toBeTruthy()
    expect(getByTestId('dispute-d-resolved')).toBeTruthy()
  })

  it('shows an empty state when no disputes match the filter', () => {
    const { getByText } = render(<DisputesAdminTab disputes={[]} disputesLoaded={true} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByText('No open disputes.')).toBeTruthy()
  })

  it('shows a single-spaced empty state for the All filter', () => {
    const { getByText } = render(<DisputesAdminTab disputes={[]} disputesLoaded={true} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    fireEvent.click(getByText('All'))
    expect(getByText('No disputes.')).toBeTruthy()
  })

  it('shows a loading message instead of the empty state while disputes have not loaded yet', () => {
    const { getByText, queryByText } = render(<DisputesAdminTab disputes={[]} disputesLoaded={false} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByText('Loading disputes...')).toBeTruthy()
    expect(queryByText('No open disputes.')).toBeNull()
  })

  it('shows the loading message even when disputes data is present but not yet marked loaded', () => {
    const { getByText, queryByTestId } = render(<DisputesAdminTab disputes={disputes} disputesLoaded={false} onChanged={vi.fn()} onMessageReporter={vi.fn()} />)
    expect(getByText('Loading disputes...')).toBeTruthy()
    expect(queryByTestId('dispute-d-open')).toBeNull()
  })
})
