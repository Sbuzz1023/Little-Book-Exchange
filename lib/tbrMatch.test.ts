import { describe, it, expect } from 'vitest'
import { tbrMatchPattern, isTooGenericToMatch, buildTbrMatchStrategy } from './tbrMatch'

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

describe('isTooGenericToMatch', () => {
  it('is true for a lone common filler word', () => {
    // Reported bug: entering "the" incorrectly showed "The Illustrated Man" as available.
    expect(isTooGenericToMatch('the')).toBe(true)
    expect(isTooGenericToMatch('a')).toBe(true)
    expect(isTooGenericToMatch('an')).toBe(true)
    expect(isTooGenericToMatch('of')).toBe(true)
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(isTooGenericToMatch('The')).toBe(true)
    expect(isTooGenericToMatch('  the  ')).toBe(true)
  })

  it('is false for a real title or author, even a short one', () => {
    expect(isTooGenericToMatch('Dune')).toBe(false)
    expect(isTooGenericToMatch('It')).toBe(false)
    expect(isTooGenericToMatch('Circe')).toBe(false)
  })

  it('is false for a multi-word phrase that merely contains a filler word', () => {
    expect(isTooGenericToMatch('The Great Gatsby')).toBe(false)
    expect(isTooGenericToMatch('Harry Potter')).toBe(false)
  })
})

describe('buildTbrMatchStrategy', () => {
  it('returns exact mode with the work key when ol_work_key is set', () => {
    const strategy = buildTbrMatchStrategy({ title: 'Dune', author: 'Frank Herbert', ol_work_key: '/works/OL893415W' })
    expect(strategy).toEqual({ mode: 'exact', workKey: '/works/OL893415W' })
  })

  it('ignores title/author entirely when ol_work_key is set', () => {
    // Even a generic-only title shouldn't fall through to text mode if a key is present.
    const strategy = buildTbrMatchStrategy({ title: 'the', author: '', ol_work_key: '/works/OL1W' })
    expect(strategy.mode).toBe('exact')
  })

  it('returns text mode with both patterns when no key and both fields are usable', () => {
    const strategy = buildTbrMatchStrategy({ title: 'Dune', author: 'Frank Herbert', ol_work_key: null })
    expect(strategy).toEqual({
      mode: 'text',
      titlePattern: tbrMatchPattern('Dune'),
      authorPattern: tbrMatchPattern('Frank Herbert'),
    })
  })

  it('returns text mode with only the usable pattern when the other is generic or blank', () => {
    const strategy = buildTbrMatchStrategy({ title: 'the', author: 'Frank Herbert', ol_work_key: null })
    expect(strategy).toEqual({
      mode: 'text',
      titlePattern: null,
      authorPattern: tbrMatchPattern('Frank Herbert'),
    })
  })

  it('returns none mode when no key and neither field is usable', () => {
    const strategy = buildTbrMatchStrategy({ title: 'the', author: '', ol_work_key: null })
    expect(strategy).toEqual({ mode: 'none' })
  })
})
