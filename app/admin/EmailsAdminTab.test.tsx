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
})
