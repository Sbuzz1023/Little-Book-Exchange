// Turns the credit_transactions rows a user hasn't seen yet into the coin
// show the nav plays on their next page load: an earn burst (sales + the
// welcome bonus) then a spend burst (purchases). Pure — no DOM — so every
// rule here is unit-tested; components/CreditCoinShow.tsx plays the result.

export const CREDIT_SHOW_REASONS = ['sale_earned', 'purchase_spent', 'onboarding_bonus'] as const
export type CreditShowReason = typeof CREDIT_SHOW_REASONS[number]

export type UnseenCredit = { id: string; amount: number; reason: CreditShowReason; created_at: string; title: string | null }
export type ShowCoin = { value: number; label: string | null }
export type ShowBurst = { kind: 'earn' | 'spend'; coins: ShowCoin[]; caption: string; srText: string }
export type CreditShowPlan = { startBalance: number; finalBalance: number; bursts: ShowBurst[]; seenUpTo: string }

const MAX_COINS = 5
const MINUS = '−'

const isShowReason = (r: unknown): r is CreditShowReason =>
  (CREDIT_SHOW_REASONS as readonly unknown[]).includes(r)

const credits = (n: number) => `${n} ${n === 1 ? 'credit' : 'credits'}`
const books = (n: number) => `${n} ${n === 1 ? 'book' : 'books'}`
const titleOf = (r: UnseenCredit) => r.title ?? 'a book'

// One coin per credit, capped: past MAX_COINS the last coin carries the rest.
function coinsFor(total: number, sign: 1 | -1): ShowCoin[] {
  if (total <= MAX_COINS) return Array.from({ length: total }, () => ({ value: sign, label: null }))
  const rest = total - (MAX_COINS - 1)
  return [
    ...Array.from({ length: MAX_COINS - 1 }, () => ({ value: sign, label: null })),
    { value: sign * rest, label: `${sign > 0 ? '+' : MINUS}${rest}` },
  ]
}

function earnBurst(rows: UnseenCredit[]): ShowBurst | null {
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const sales = rows.filter(r => r.reason === 'sale_earned')
  const hasBonus = rows.some(r => r.reason === 'onboarding_bonus')
  let caption: string
  let srText: string
  if (sales.length === 0) {
    caption = `+${credits(total)} · Welcome bonus`
    srText = `You earned ${credits(total)}: welcome bonus.`
  } else if (sales.length === 1 && !hasBonus) {
    caption = `+${credits(total)} · ${titleOf(sales[0])} was picked up`
    srText = `You earned ${credits(total)} for ${titleOf(sales[0])}.`
  } else {
    const soldBooks = sales.reduce((s, r) => s + r.amount, 0)
    caption = `+${credits(total)} · ${books(soldBooks)} picked up${hasBonus ? ' + welcome bonus' : ''}`
    srText = `You earned ${credits(total)}.`
  }
  return { kind: 'earn', coins: coinsFor(total, 1), caption, srText }
}

function spendBurst(rows: UnseenCredit[]): ShowBurst | null {
  if (rows.length === 0) return null
  const total = rows.reduce((s, r) => s - r.amount, 0)
  const single = rows.length === 1
  return {
    kind: 'spend',
    coins: coinsFor(total, -1),
    caption: single ? `${MINUS}${credits(total)} · you got ${titleOf(rows[0])}` : `${MINUS}${credits(total)} · you got ${books(total)}`,
    srText: single ? `You spent ${credits(total)} on ${titleOf(rows[0])}.` : `You spent ${credits(total)}.`,
  }
}

export function planCreditShow(rows: UnseenCredit[], finalBalance: number): CreditShowPlan | null {
  const shown = rows.filter(r => isShowReason(r.reason) && r.amount !== 0)
  if (shown.length === 0) return null
  const earn = earnBurst(shown.filter(r => r.reason !== 'purchase_spent' && r.amount > 0))
  const spend = spendBurst(shown.filter(r => r.reason === 'purchase_spent' && r.amount < 0))
  const bursts = [earn, spend].filter((b): b is ShowBurst => b !== null)
  if (bursts.length === 0) return null
  const delta = bursts.flatMap(b => b.coins).reduce((s, c) => s + c.value, 0)
  const seenUpTo = shown.reduce((latest, r) => (Date.parse(r.created_at) > Date.parse(latest) ? r.created_at : latest), shown[0].created_at)
  return { startBalance: finalBalance - delta, finalBalance, bursts, seenUpTo }
}

// Supabase returns the joined listing as an object, an array or null
// depending on how it infers the relation; flatten it to a title.
export function toUnseenCredits(rows: unknown[]): UnseenCredit[] {
  const out: UnseenCredit[] = []
  for (const raw of rows) {
    const r = raw as { id?: unknown; amount?: unknown; reason?: unknown; created_at?: unknown; listings?: unknown }
    if (!isShowReason(r.reason) || typeof r.amount !== 'number' || typeof r.id !== 'string' || typeof r.created_at !== 'string') continue
    const listing = Array.isArray(r.listings) ? r.listings[0] : r.listings
    const title = listing && typeof (listing as { title?: unknown }).title === 'string' ? (listing as { title: string }).title : null
    out.push({ id: r.id, amount: r.amount, reason: r.reason, created_at: r.created_at, title })
  }
  return out
}

// Demo mode has no ledger: ?coin_demo=… previews the show on the demo server.
export type CoinDemoMode = 'earn' | 'spend' | 'both' | 'bundle'
export function demoUnseenCredits(mode: string | null): UnseenCredit[] {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString()
  const sale = (id: string, title: string, amount = 1, s = 1): UnseenCredit => ({ id, amount, reason: 'sale_earned', created_at: at(s), title })
  const buy = (id: string, title: string): UnseenCredit => ({ id, amount: -1, reason: 'purchase_spent', created_at: at(3), title })
  switch (mode) {
    case 'earn': return [sale('demo-1', 'Dune')]
    case 'spend': return [buy('demo-1', 'Matilda')]
    case 'both': return [sale('demo-1', 'Dune'), sale('demo-2', 'Emma', 1, 2), buy('demo-3', 'Matilda')]
    case 'bundle': return [sale('demo-1', 'Little Women bundle', 3)]
    default: return []
  }
}
