import Link from 'next/link'
import type { CreditShortfall } from '@/lib/creditCheck'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Why a purchase was blocked: too few credits overall, or credits held by
// the buyer's other pending requests. `null` (reason unknown, e.g. demo
// mode) shows the plain message.
export default function ShortfallNote({ shortfall }: { shortfall: CreditShortfall | null }) {
  if (shortfall?.reason === 'pending') {
    const free = shortfall.balance - shortfall.held
    return (
      <div className="ld-note error" data-testid="shortfall-note">
        🪙 You have {plural(shortfall.balance, 'credit')}, but {shortfall.held} {shortfall.held === 1 ? 'is' : 'are'} held
        for your {plural(shortfall.pendingCount, 'pending request')}
        {free > 0 ? `, leaving ${free} — this costs ${shortfall.cost}.` : ', so no credits are available for this one.'}
        {' '}They will be processed after pickup or cancellation.
        <Link href="/profile?tab=exchanges" className="ld-note-link">View your pending requests →</Link>
      </div>
    )
  }
  return (
    <div className="ld-note error" data-testid="shortfall-note">
      🪙 You don&apos;t have enough credits for this.
      {shortfall && <> It costs {plural(shortfall.cost, 'credit')} and you have {shortfall.balance}.</>}
    </div>
  )
}
