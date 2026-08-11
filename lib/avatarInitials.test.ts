import { describe, it, expect } from 'vitest'
import { avatarInitials } from './avatarInitials'

describe('avatarInitials', () => {
  it('uses the first two capital letters when two or more are present', () => {
    expect(avatarInitials('SeanB')).toBe('SB')
  })

  it('finds capitals anywhere in the string, not just at word starts', () => {
    expect(avatarInitials('sarahREADS')).toBe('RE')
  })

  it('combines the first character with the one capital when the capital is not first', () => {
    expect(avatarInitials('3sEan')).toBe('3E')
  })

  it('does not duplicate the character when the lone capital is the first character', () => {
    expect(avatarInitials('Sean')).toBe('S')
  })

  it('falls back to the first character, uppercased, when there are no capitals', () => {
    expect(avatarInitials('seanbuczynski')).toBe('S')
  })

  it('falls back to the first character as-is when it is a digit and there are no capitals', () => {
    expect(avatarInitials('3sean')).toBe('3')
  })

  it('returns an empty string for an empty username', () => {
    expect(avatarInitials('')).toBe('')
  })
})
