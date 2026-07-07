import { describe, it, expect } from 'vitest'
import { buildConfirmationMessage } from './buildConfirmationMessage'

const base = {
  username: 'sarahreads',
  city: 'Chicago',
  state: 'IL',
  phone: '(312) 555-0100',
  share_address: false as boolean,
  share_pickup: false as boolean,
}

describe('buildConfirmationMessage', () => {
  it('always includes username', () => {
    expect(buildConfirmationMessage(base)).toContain('sarahreads')
  })

  it('always includes city and state', () => {
    expect(buildConfirmationMessage(base)).toContain('Chicago, IL')
  })

  it('includes phone when provided', () => {
    expect(buildConfirmationMessage(base)).toContain('(312) 555-0100')
  })

  it('omits phone line when phone is empty', () => {
    const msg = buildConfirmationMessage({ ...base, phone: '' })
    expect(msg).not.toContain('📞')
  })

  it('omits address when share_address is false', () => {
    const msg = buildConfirmationMessage({ ...base, address: '123 Main St', share_address: false })
    expect(msg).not.toContain('123 Main St')
  })

  it('includes street address when share_address is true', () => {
    const msg = buildConfirmationMessage({ ...base, address: '123 Main St', share_address: true })
    expect(msg).toContain('123 Main St')
  })

  it('includes address_unit alongside address when share_address is true', () => {
    const msg = buildConfirmationMessage({ ...base, address: '123 Main St', address_unit: 'Apt 2B', share_address: true })
    expect(msg).toContain('123 Main St Apt 2B')
  })

  it('omits address line when address is empty even if share_address is true', () => {
    const msg = buildConfirmationMessage({ ...base, address: '', address_unit: '', share_address: true })
    expect(msg).not.toContain('🏠')
  })

  it('omits pickup when share_pickup is false', () => {
    const msg = buildConfirmationMessage({ ...base, share_pickup: false, profile_pickup: 'front porch' })
    expect(msg).not.toContain('front porch')
  })

  it('includes profile pickup when share_pickup is true and no listing override', () => {
    const msg = buildConfirmationMessage({ ...base, share_pickup: true, listing_pickup: null, profile_pickup: 'front porch' })
    expect(msg).toContain('front porch')
  })

  it('prefers listing pickup over profile pickup', () => {
    const msg = buildConfirmationMessage({ ...base, share_pickup: true, listing_pickup: 'side gate', profile_pickup: 'front porch' })
    expect(msg).toContain('side gate')
    expect(msg).not.toContain('front porch')
  })

  it('omits pickup line when both listing and profile pickup are empty', () => {
    const msg = buildConfirmationMessage({ ...base, share_pickup: true, listing_pickup: null, profile_pickup: '' })
    expect(msg).not.toContain('📦')
  })

  it('omits state from city line when state is empty', () => {
    const msg = buildConfirmationMessage({ ...base, state: '' })
    expect(msg).toContain('Chicago')
    expect(msg).not.toContain('Chicago,')
  })
})
