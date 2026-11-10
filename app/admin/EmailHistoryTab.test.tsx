import { render, fireEvent, waitFor, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import EmailHistoryTab from './EmailHistoryTab'

const getEmailHistoryMock = vi.fn()
vi.mock('@/lib/actions/emailAdmin', () => ({
  getEmailHistory: (...args: unknown[]) => getEmailHistoryMock(...args),
}))

const row = (over: Record<string, unknown> = {}) => ({
  id: 'e1', kind: 'broadcast', recipient_email: 'ann@example.com', subject: 'Hello all',
  status: 'sent', error: null, sent_at: '2026-01-02T03:04:00Z', profiles: { username: 'ann' }, ...over,
})

describe('EmailHistoryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEmailHistoryMock.mockResolvedValue({ ok: true, rows: [], hasMore: false })
  })

  it('renders rows with username, email, subject, type label and status', async () => {
    getEmailHistoryMock.mockResolvedValue({
      ok: true, hasMore: false,
      rows: [
        row(),
        row({ id: 'e2', kind: 'password_reset', recipient_email: 'bob@example.com', subject: 'Reset it', status: 'failed', error: 'bounced', profiles: null }),
        row({ id: 'e3', kind: 'welcome_confirmation', recipient_email: 'cy@example.com', subject: 'Welcome', profiles: { username: 'cy' } }),
      ],
    })
    render(<EmailHistoryTab />)
    expect(await screen.findByText('Hello all')).toBeInTheDocument()
    expect(screen.getByText('ann')).toBeInTheDocument()
    expect(screen.getByText('ann@example.com')).toBeInTheDocument()
    expect(screen.getByText('Broadcast')).toBeInTheDocument()
    expect(screen.getByText('Password reset')).toBeInTheDocument()
    expect(screen.getByText('Welcome & confirm')).toBeInTheDocument()
    expect(screen.getAllByText('Sent')).toHaveLength(2)
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('bounced')).toBeInTheDocument()
    // no username -> the email is the recipient name, shown once
    expect(screen.getAllByText('bob@example.com')).toHaveLength(1)
  })

  it('shows the empty state', async () => {
    render(<EmailHistoryTab />)
    expect(await screen.findByText('No emails yet.')).toBeInTheDocument()
  })

  it('shows an error', async () => {
    getEmailHistoryMock.mockResolvedValue({ ok: false, error: 'Not authorized.' })
    render(<EmailHistoryTab />)
    expect(await screen.findByText('Not authorized.')).toBeInTheDocument()
  })

  it('Load more appends the next page using the last row as cursor', async () => {
    getEmailHistoryMock.mockResolvedValueOnce({ ok: true, hasMore: true, rows: [row()] })
    getEmailHistoryMock.mockResolvedValueOnce({ ok: true, hasMore: false, rows: [row({ id: 'e2', subject: 'Second page' })] })
    render(<EmailHistoryTab />)
    await screen.findByText('Hello all')
    fireEvent.click(screen.getByText('Load more'))
    expect(await screen.findByText('Second page')).toBeInTheDocument()
    expect(screen.getByText('Hello all')).toBeInTheDocument()
    expect(getEmailHistoryMock).toHaveBeenLastCalledWith({ search: '', before: '2026-01-02T03:04:00Z' })
    expect(screen.queryByText('Load more')).not.toBeInTheDocument()
  })

  it('search calls the action with the term', async () => {
    render(<EmailHistoryTab />)
    await screen.findByText('No emails yet.')
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'ann' } })
    await waitFor(() => expect(getEmailHistoryMock).toHaveBeenLastCalledWith({ search: 'ann' }))
  })
})
