import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ProfileCard from './ProfileCard'

const baseProfile = {
  username: 'demouser',
  email: 'demo@example.com',
  city: 'Chicago',
  state: 'IL',
  phone: '3125550100',
  phone_verified: false,
  created_at: '2026-01-15T00:00:00.000Z',
}

const baseProps = {
  updateAction: vi.fn(() => Promise.resolve()),
  sendPhoneOtp: vi.fn(() => Promise.resolve({ ok: true })),
  verifyPhoneOtp: vi.fn(() => Promise.resolve({ ok: true })),
  onPhoneVerified: vi.fn(),
}

describe('ProfileCard — view mode', () => {
  it('renders Username, Email, Phone, and Member Since together, ahead of Address', () => {
    render(<ProfileCard profile={baseProfile} {...baseProps} />)
    const text = document.body.textContent ?? ''
    expect(text.indexOf('Username')).toBeLessThan(text.indexOf('📍 Address'))
    expect(text.indexOf('Email')).toBeLessThan(text.indexOf('📍 Address'))
    expect(text.indexOf('Phone')).toBeLessThan(text.indexOf('📍 Address'))
    expect(text.indexOf('Member Since')).toBeLessThan(text.indexOf('📍 Address'))
  })

  it('does not render an Address section when no address fields are set', () => {
    render(<ProfileCard profile={{ ...baseProfile, city: null, state: null }} {...baseProps} />)
    expect(screen.queryByText('📍 Address')).not.toBeInTheDocument()
  })

  it('shows a verified badge next to the phone number once verified', () => {
    render(<ProfileCard profile={{ ...baseProfile, phone_verified: true }} {...baseProps} />)
    expect(screen.getByText(/3125550100/)).toHaveTextContent('✅')
  })
})

describe('ProfileCard — edit mode', () => {
  function openEdit(profile = baseProfile) {
    render(<ProfileCard profile={profile} {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))
  }

  it('has an editable Username input', () => {
    openEdit()
    expect(screen.getByDisplayValue('demouser')).toBeInTheDocument()
  })

  it('shows Email as plain text, not an input', () => {
    openEdit()
    expect(screen.getByText('demo@example.com')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('demo@example.com')).not.toBeInTheDocument()
  })

  it('phone stays editable and shows a Verify control when unverified', () => {
    openEdit()
    const phoneInput = screen.getByDisplayValue('3125550100') as HTMLInputElement
    expect(phoneInput).not.toHaveAttribute('readonly')
    expect(screen.getByRole('button', { name: /Verify Phone/ })).toBeInTheDocument()
  })

  it('locks the phone field and hides Verify once verified', () => {
    openEdit({ ...baseProfile, phone_verified: true })
    expect(screen.queryByRole('button', { name: /Verify Phone/ })).not.toBeInTheDocument()
    expect(screen.getByText(/✅ Verified/)).toBeInTheDocument()
  })

  it('shows the error banner when an error prop is passed', () => {
    render(<ProfileCard profile={baseProfile} {...baseProps} error="That username is already taken — try another." />)
    expect(screen.getByText('That username is already taken — try another.')).toBeInTheDocument()
  })
})
