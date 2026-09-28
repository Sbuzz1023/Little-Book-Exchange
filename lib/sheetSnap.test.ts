import { describe, it, expect } from 'vitest'
import { resolveSnap } from './sheetSnap'

// Snap points are the sheet's visible height in px: [peek, half, full].
const SNAPS = [96, 400, 700]

describe('resolveSnap', () => {
  it('snaps to the nearest point when released slowly', () => {
    expect(resolveSnap(120, 0, SNAPS)).toBe(96)
    expect(resolveSnap(300, 0, SNAPS)).toBe(400)
    expect(resolveSnap(600, 0, SNAPS)).toBe(700)
  })

  it('a fast upward flick goes to the next point above, even if a lower one is nearer', () => {
    expect(resolveSnap(130, 1, SNAPS)).toBe(400)
    expect(resolveSnap(420, 1, SNAPS)).toBe(700)
  })

  it('a fast downward flick goes to the next point below', () => {
    expect(resolveSnap(650, -1, SNAPS)).toBe(400)
    expect(resolveSnap(380, -1, SNAPS)).toBe(96)
  })

  it('a flick past the ends clamps to the first/last point', () => {
    expect(resolveSnap(720, 1, SNAPS)).toBe(700)
    expect(resolveSnap(80, -1, SNAPS)).toBe(96)
  })
})
