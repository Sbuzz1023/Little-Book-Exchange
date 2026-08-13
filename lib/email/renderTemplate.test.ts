import { describe, it, expect } from 'vitest'
import { renderTemplate } from './renderTemplate'

describe('renderTemplate', () => {
  it('substitutes a known placeholder', () => {
    expect(renderTemplate('Hi {{username}}!', { username: 'Sean' })).toBe('Hi Sean!')
  })

  it('substitutes multiple placeholders, including repeats', () => {
    const result = renderTemplate('{{username}}, click {{link}}. Thanks, {{username}}.', { username: 'Sean', link: 'http://x' })
    expect(result).toBe('Sean, click http://x. Thanks, Sean.')
  })

  it('leaves an unknown placeholder untouched', () => {
    expect(renderTemplate('Hi {{nickname}}!', { username: 'Sean' })).toBe('Hi {{nickname}}!')
  })

  it('returns the template unchanged when it has no placeholders', () => {
    expect(renderTemplate('Plain text.', { username: 'Sean' })).toBe('Plain text.')
  })
})
