import { describe, it, expect } from 'vitest'
import { buildConfirmationMessage } from './buildConfirmationMessage'

const base = {
  username: 'sarahreads',
  city: 'Chicago',
  state: 'IL',
}

describe('buildConfirmationMessage', () => {
  it('always includes username', () => {
    expect(buildConfirmationMessage(base)).toContain('sarahreads')
  })

  it('always includes city and state', () => {
    expect(buildConfirmationMessage(base)).toContain('Chicago, IL')
  })

  it('omits state from city line when state is empty', () => {
    const msg = buildConfirmationMessage({ ...base, state: '' })
    expect(msg).toContain('Chicago')
    expect(msg).not.toContain('Chicago,')
  })

  it('never includes a phone number, even if one is passed in', () => {
    const msg = buildConfirmationMessage({ ...base, ...({ phone: '(312) 555-0100' } as any) })
    expect(msg).not.toContain('555-0100')
    expect(msg).not.toContain('📞')
  })

  it('includes street address when provided', () => {
    const msg = buildConfirmationMessage({ ...base, address: '123 Main St' })
    expect(msg).toContain('123 Main St')
  })

  it('includes address_unit alongside address', () => {
    const msg = buildConfirmationMessage({ ...base, address: '123 Main St', address_unit: 'Apt 2B' })
    expect(msg).toContain('123 Main St Apt 2B')
  })

  it('omits address line when both address and address_unit are empty', () => {
    const msg = buildConfirmationMessage({ ...base, address: '', address_unit: '' })
    expect(msg).not.toContain('🏠')
  })

  it('includes pickup when provided', () => {
    const msg = buildConfirmationMessage({ ...base, pickup: 'front porch' })
    expect(msg).toContain('front porch')
  })

  it('omits pickup line when pickup is empty', () => {
    const msg = buildConfirmationMessage({ ...base, pickup: '' })
    expect(msg).not.toContain('📦')
  })
})
