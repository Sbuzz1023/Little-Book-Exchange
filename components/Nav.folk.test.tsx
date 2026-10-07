import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import Nav from './Nav'

let pathname = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}))

// HomeNav (the folk-editorial nav) renders a <header class="hnav">; the
// classic Nav does not.
function rendersFolkNav(path: string) {
  pathname = path
  const { container, unmount } = render(<Nav />)
  const folk = !!container.querySelector('.hnav')
  unmount()
  return folk
}

describe('Nav — which pages get the folk-editorial nav', () => {
  it('uses the folk nav on a listing detail page', () => {
    expect(rendersFolkNav('/listings/abc-123')).toBe(true)
  })

  it('still uses the folk nav on Browse and Edit Listing', () => {
    expect(rendersFolkNav('/listings')).toBe(true)
    expect(rendersFolkNav('/listings/abc-123/edit')).toBe(true)
  })

  it('keeps the classic nav on pages not yet reskinned', () => {
    expect(rendersFolkNav('/admin')).toBe(false)
    expect(rendersFolkNav('/sellers/abc-123/reviews')).toBe(false)
  })
})
