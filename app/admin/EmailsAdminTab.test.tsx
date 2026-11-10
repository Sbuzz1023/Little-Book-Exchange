import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import EmailsAdminTab from './EmailsAdminTab'

const inboxProps: { openConversationId?: string | null; onOpenConsumed?: () => void } = {}

vi.mock('./EmailComposeTab', () => ({ default: () => <div>Compose</div> }))
vi.mock('./EmailTemplatesEditor', () => ({ default: () => <div>Templates</div> }))
vi.mock('./EmailResendTool', () => ({ default: () => <div>Resend</div> }))
vi.mock('./EmailHistoryTab', () => ({ default: () => <div>History contents</div> }))
vi.mock('./AdminInboxTab', () => ({
  default: ({ onUnreadCountChange, openConversationId, onOpenConsumed }: { onUnreadCountChange?: (n: number) => void; openConversationId?: string | null; onOpenConsumed?: () => void }) => {
    onUnreadCountChange?.(3)
    inboxProps.openConversationId = openConversationId
    inboxProps.onOpenConsumed = onOpenConsumed
    return <div>Inbox contents</div>
  },
}))

describe('EmailsAdminTab â€” Inbox unread badge', () => {
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

  it('switches to the Inbox sub-tab when told to open a conversation', () => {
    const onOpenConsumed = vi.fn()
    const { getByText } = render(<EmailsAdminTab users={[]} openConversationId="convo-1" onOpenConsumed={onOpenConsumed} />)
    expect(getByText('Inbox contents')).toBeInTheDocument()
    expect(inboxProps.openConversationId).toBe('convo-1')
    expect(inboxProps.onOpenConsumed).toBe(onOpenConsumed)
  })
})

describe('EmailsAdminTab — History sub-tab', () => {
  it('has a History pill that shows the history component', () => {
    const { getByText, queryByText } = render(<EmailsAdminTab users={[]} />)
    expect(queryByText('History contents')).toBeNull()
    fireEvent.click(getByText('History'))
    expect(getByText('History contents')).toBeInTheDocument()
  })
})
