import { describe, it, expect } from 'vitest'
import { toE164 } from './toE164'

describe('toE164', () => {
  it('normalizes a formatted US 10-digit number', () => {
    expect(toE164('(312) 555-0100')).toBe('+13125550100')
  })

  it('normalizes a bare US 10-digit number', () => {
    expect(toE164('3125550100')).toBe('+13125550100')
  })

  it('keeps an 11-digit number that already starts with the US country code', () => {
    expect(toE164('1-312-555-0100')).toBe('+13125550100')
  })

  it('leaves an already-E.164 number alone', () => {
    expect(toE164('+13125550100')).toBe('+13125550100')
  })

  it('does not prepend +1 to a non-US number that already has a + prefix', () => {
    expect(toE164('+44 20 7946 0958')).toBe('+442079460958')
  })

  it('normalizes the sent and verified forms of the same number identically', () => {
    expect(toE164('(312) 555-0100')).toBe(toE164('312.555.0100'))
  })
})
