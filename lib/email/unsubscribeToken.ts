import { createHmac, timingSafeEqual } from 'crypto'

// Low-stakes by design: worst case is someone unsubscribes another user from
// marketing email, which is not a security-sensitive action. This just stops
// a plain "?userId=..." link from being trivially guessable/scriptable.
export function makeUnsubscribeToken(userId: string): string {
  return createHmac('sha256', process.env.UNSUBSCRIBE_SECRET!).update(userId).digest('hex')
}

export function verifyUnsubscribeToken(userId: string, token: string): boolean {
  const expected = makeUnsubscribeToken(userId)
  const a = Buffer.from(expected)
  const b = Buffer.from(token)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
