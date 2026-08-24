import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import EmailsAdminTab from './EmailsAdminTab'

vi.mock('./EmailComposeTab', () => ({ default: () => <div>Compose</div> }))
vi.mock('./EmailTemplatesEditor', () => ({ default: () => <div>Templates</div> }))
vi.mock('./EmailResendTool', () => ({ default: () => <div>Resend</div> }))
vi.mock('./AdminInboxTab', () => ({
  default: ({ onUnreadCountChange }: { onUnreadCountChange?: (n: number) => void }) => {
    onUnreadCountChange?.(3)
    return <div>Inbox contents</div>
  },
}))

describe('EmailsAdminTab — Inbox unread badge', () => {
  it('shows a badge on the Inbox pill reflecting the unread count from AdminInboxTab', () => {
    const { getByText } = render(<EmailsAdminTab users={[]} />)
    fireEvent.click(getByText('Inbox'))
    expect(getByText('3')).toBeInTheDocument()
  })

  it('bubbles the unread count up to the parent via onInboxUnreadCountChange once Inbox is opened', () => {
    const onInboxUnreadCountChange = vi.fn()
    const { getByText } = render(<EmailsAdminTab users={[]} onInboxUnreadCountChange={onInboxUnreadCountChange} />)
    fireEvent.click(getByText('Inbox'))
    expect(onInboxUnreadCountChange).toHaveBeenCalledWith(3)
  })

  it('shows the badge on the Inbox pill immediately from the parent-provided count, before Inbox is ever opened', () => {
    const { getByText } = render(<EmailsAdminTab users={[]} inboxUnreadCount={5} />)
    expect(getByText('5')).toBeInTheDocument()
  })

  it('updates the pill if the parent-provided count changes before Inbox has been opened', () => {
    const { getByText, rerender } = render(<EmailsAdminTab users={[]} inboxUnreadCount={0} />)
    expect(() => getByText('0')).toThrow() // a zero count shows no badge at all
    rerender(<EmailsAdminTab users={[]} inboxUnreadCount={2} />)
    expect(getByText('2')).toBeInTheDocument()
  })

  it("keeps AdminInboxTab's own live count once reported, instead of reverting to the parent-provided count", () => {
    const { getByText, rerender } = render(<EmailsAdminTab users={[]} inboxUnreadCount={5} />)
    fireEvent.click(getByText('Inbox')) // mocked AdminInboxTab reports 3
    expect(getByText('3')).toBeInTheDocument()
    rerender(<EmailsAdminTab users={[]} inboxUnreadCount={5} />)
    expect(getByText('3')).toBeInTheDocument()
  })
})
