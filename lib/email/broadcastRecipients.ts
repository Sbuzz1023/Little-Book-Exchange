export type BroadcastTarget =
  | { kind: 'all' }
  | { kind: 'user'; userId: string }
  | { kind: 'filtered'; city?: string; state?: string }

export type BroadcastChannel = 'email' | 'message'

export type ProfileRow = { id: string; email: string | null; city: string; state: string; marketing_opt_out: boolean }
export type Recipient = { id: string; email: string }

export function filterRecipients(profiles: ProfileRow[], target: BroadcastTarget, channel: BroadcastChannel = 'email'): Recipient[] {
  if (target.kind === 'user') {
    const match = profiles.find(p => p.id === target.userId)
    if (!match) return []
    if (channel === 'message') return [{ id: match.id, email: match.email ?? '' }]
    return match.email ? [{ id: match.id, email: match.email }] : []
  }

  return profiles
    .filter(p => channel === 'message' || !p.marketing_opt_out)
    .filter(p => channel === 'message' || !!p.email)
    .filter(p => target.kind !== 'filtered' || !target.city || p.city === target.city)
    .filter(p => target.kind !== 'filtered' || !target.state || p.state === target.state)
    .map(p => ({ id: p.id, email: p.email ?? '' }))
}
