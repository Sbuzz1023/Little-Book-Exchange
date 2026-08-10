import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PhoneVerify from './PhoneVerify'

describe('PhoneVerify', () => {
  it('renders nothing when the phone is already verified', () => {
    const { container } = render(
      <PhoneVerify
        phone="3125550100"
        phoneVerified={true}
        sendPhoneOtp={vi.fn()}
        verifyPhoneOtp={vi.fn()}
        onVerified={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('sends a code and confirms it, calling onVerified on success', async () => {
    const sendPhoneOtp = vi.fn(() => Promise.resolve({ ok: true }))
    const verifyPhoneOtp = vi.fn(() => Promise.resolve({ ok: true }))
    const onVerified = vi.fn()

    render(
      <PhoneVerify
        phone="3125550100"
        phoneVerified={false}
        sendPhoneOtp={sendPhoneOtp}
        verifyPhoneOtp={verifyPhoneOtp}
        onVerified={onVerified}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    fireEvent.click(screen.getByRole('button', { name: /Send code/ }))
    expect(sendPhoneOtp).toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText(/6-digit code/), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm code/ }))

    await waitFor(() => expect(onVerified).toHaveBeenCalled())
    const [fd] = verifyPhoneOtp.mock.calls[0]
    expect(fd.get('phone')).toBe('3125550100')
    expect(fd.get('token')).toBe('123456')
  })

  it('shows an error and does not call onVerified when the code is wrong', async () => {
    const verifyPhoneOtp = vi.fn(() => Promise.resolve({ ok: false, error: 'Invalid code.' }))
    const onVerified = vi.fn()

    render(
      <PhoneVerify
        phone="3125550100"
        phoneVerified={false}
        sendPhoneOtp={vi.fn(() => Promise.resolve({ ok: true }))}
        verifyPhoneOtp={verifyPhoneOtp}
        onVerified={onVerified}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    fireEvent.change(screen.getByPlaceholderText(/6-digit code/), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: /Confirm code/ }))

    expect(await screen.findByText('Invalid code.')).toBeInTheDocument()
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('renders an editable phone input only when onPhoneChange is provided', () => {
    render(
      <PhoneVerify
        phone="3125550100"
        phoneVerified={false}
        sendPhoneOtp={vi.fn()}
        verifyPhoneOtp={vi.fn()}
        onVerified={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Verify Phone/ }))
    expect(screen.queryByDisplayValue('3125550100')).not.toBeInTheDocument()
  })
})
