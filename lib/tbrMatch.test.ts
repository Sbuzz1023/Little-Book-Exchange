import { describe, it, expect } from 'vitest'
import { tbrMatchPattern } from './tbrMatch'

describe('tbrMatchPattern', () => {
  it('does not match a substring buried inside another word', () => {
    // "me" must not match inside "time" — this was the reported bug:
    // a TBR entry titled "me" linked to a listing titled "It's a good place in time".
    const pattern = tbrMatchPattern('me')
    const regex = new RegExp(pattern, 'i')
    expect(regex.test("It's a good place in time")).toBe(false)
  })

  it('matches the word as a whole word, case-insensitively', () => {
    const pattern = tbrMatchPattern('me')
    const regex = new RegExp(pattern, 'i')
    expect(regex.test('Me')).toBe(true)
    expect(regex.test('a book called Me')).toBe(true)
  })

  it('matches a multi-word phrase as a bounded run of words', () => {
    const pattern = tbrMatchPattern('Harry Potter')
    const regex = new RegExp(pattern, 'i')
    expect(regex.test("Harry Potter and the Sorcerer's Stone")).toBe(true)
  })

  it('escapes regex special characters so they are treated literally', () => {
    const pattern = tbrMatchPattern('C++')
    const regex = new RegExp(pattern, 'i')
    expect(regex.test('Learning C++')).toBe(true)
    expect(regex.test('Learning C')).toBe(false)
  })
})
