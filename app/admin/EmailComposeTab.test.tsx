import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import EmailComposeTab from './EmailComposeTab'

vi.mock('@/lib/actions/emailAdmin', () => ({
  resolveBroadcastRecipients: vi.fn(),
  sendBroadcastEmail: vi.fn(),
  sendBroadcastMessage: vi.fn(),
}))

const users = [{ id: 'u1', username: 'Alex', email: 'alex@example.com', city: 'Chicago', state: 'IL' }]

describe('EmailComposeTab — Open chat', () => {
  it('shows Send (not Open chat) in email mode', () => {
    const { queryByText } = render(<EmailComposeTab users={users} onOpenChat={vi.fn()} />)
    expect(queryByText('Open chat')).toBeNull()
    expect(queryByText('Send…')).toBeTruthy()
  })

  it('shows Send (not Open chat) for Message to All Users and Filtered Group', () => {
    const { getByText, queryByText } = render(<EmailComposeTab users={users} onOpenChat={vi.fn()} />)
    fireEvent.click(getByText('💬 Message'))
    expect(queryByText('Open chat')).toBeNull()
    fireEvent.click(getByText('Filtered Group'))
    expect(queryByText('Open chat')).toBeNull()
    expect(queryByText('Send…')).toBeTruthy()
  })

  it('shows Open chat instead of Send for Message + One User, and calls onOpenChat with the selected user', () => {
    const onOpenChat = vi.fn()
    const { getByText, getByPlaceholderText, queryByText } = render(<EmailComposeTab users={users} onOpenChat={onOpenChat} />)
    fireEvent.click(getByText('💬 Message'))
    fireEvent.click(getByText('One User'))
    expect(queryByText('Send…')).toBeNull()
    expect(getByText('Open chat')).toBeDisabled()
    fireEvent.change(getByPlaceholderText('Search by username or email…'), { target: { value: 'alex' } })
    fireEvent.click(getByText('Alex'))
    fireEvent.click(getByText('Open chat'))
    expect(onOpenChat).toHaveBeenCalledWith('u1')
  })

  it('still shows Send for Email + One User', () => {
    const { getByText, queryByText } = render(<EmailComposeTab users={users} onOpenChat={vi.fn()} />)
    fireEvent.click(getByText('One User'))
    expect(queryByText('Open chat')).toBeNull()
    expect(queryByText('Send…')).toBeTruthy()
  })
})
