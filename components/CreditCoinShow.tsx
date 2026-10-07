'use client'
import { useEffect, useRef, useState } from 'react'
import type { CreditShowPlan, ShowBurst, ShowCoin } from '@/lib/creditShow'
import { markCreditsSeen } from '@/lib/actions/creditsSeen'

// Plays a CreditShowPlan (lib/creditShow.ts): earn coins spin in the centre
// and fly into the nav's credits pill; spend coins fly out of the pill to
// the centre and crumble into dust. Coins and dust are plain DOM nodes
// animated with the Web Animations API (falling back to timers where it's
// missing, e.g. jsdom); React only renders the overlay and caption.

// Timings (ms). Earn coin: spin, then fly to the pill. Spend coin: fly from
// the pill, spin, crumble. Coins in a burst start STAGGER_MS apart.
const STAGGER_MS = 700
const BURST_PAUSE_MS = 1000
const STILL_MS = 3000
const EARN_SPIN_MS = 2000
const FLIGHT_MS = 1300
const SPEND_SPIN_MS = 1100
const DUST_MS = 1600
// The pill's coin is 18px; shrink the (200px, or 50vw on phones) show coin to it.
const PILL_COIN_PX = 18
const ARC_LIFT_PX = 140
const COIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.2"/></svg>'

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function play(el: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
  if (typeof el.animate !== 'function') return wait(Number(options.duration ?? 0) + Number(options.delay ?? 0))
  return el.animate(keyframes, { fill: 'forwards', ...options }).finished.then(() => {}, () => {})
}

// Offset from screen centre to the pill's coin (top-right corner if the pill isn't visible).
function pillOffset(): { dx: number; dy: number } {
  const r = document.querySelector('.hnav-credits .hnav-coin')?.getBoundingClientRect()
  const x = r && r.width > 0 ? r.left + r.width / 2 : window.innerWidth - 24
  const y = r && r.width > 0 ? r.top + r.height / 2 : 24
  return { dx: x - window.innerWidth / 2, dy: y - window.innerHeight / 2 }
}

function popPill() {
  const pill = document.querySelector<HTMLElement>('.hnav-credits')
  if (!pill) return
  pill.classList.remove('is-pop')
  void pill.offsetWidth // restart the animation
  pill.classList.add('is-pop')
}

function makeCoin(layer: HTMLElement, coin: ShowCoin): HTMLElement {
  const el = document.createElement('div')
  el.className = 'ccs-coin'
  el.innerHTML = COIN_SVG
  if (coin.label) {
    const label = document.createElement('span')
    label.className = 'ccs-coin-label'
    label.textContent = coin.label
    el.appendChild(label)
  }
  layer.appendChild(el)
  return el
}

const arc = (dx: number, dy: number) => `translate(${dx * 0.5}px, ${dy * 0.5 - ARC_LIFT_PX}px) scale(.55)`
const pillScale = (el: HTMLElement) => PILL_COIN_PX / (el.getBoundingClientRect().width || 200)

async function earnCoin(layer: HTMLElement, coin: ShowCoin, land: () => void) {
  const el = makeCoin(layer, coin)
  await play(el, [
    { transform: 'perspective(900px) scale(.3) rotateY(0deg)', opacity: 0 },
    { transform: 'perspective(900px) scale(1) rotateY(360deg)', opacity: 1, offset: 0.3 },
    { transform: 'perspective(900px) scale(1) rotateY(1080deg)', opacity: 1 },
  ], { duration: EARN_SPIN_MS, easing: 'ease-out' })
  const { dx, dy } = pillOffset()
  await play(el, [
    { transform: 'translate(0px, 0px) scale(1)' },
    { transform: arc(dx, dy), offset: 0.5 },
    { transform: `translate(${dx}px, ${dy}px) scale(${pillScale(el)})` },
  ], { duration: FLIGHT_MS, easing: 'cubic-bezier(.45,0,.7,1)' })
  el.remove()
  land()
}

function dust(layer: HTMLElement): Promise<void> {
  return Promise.all(Array.from({ length: 32 }, (_, i) => {
    const s = document.createElement('span')
    s.className = 'ccs-speck'
    layer.appendChild(s)
    const angle = (i / 32) * Math.PI * 2 + Math.random() * 0.3
    const dist = 80 + Math.random() * 100
    return play(s, [
      { transform: 'translate(0px, 0px) scale(1)', opacity: 1 },
      { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist + 90}px) scale(.4)`, opacity: 0 },
    ], { duration: DUST_MS, delay: Math.random() * 250, easing: 'cubic-bezier(.2,.6,.4,1)' }).then(() => s.remove())
  })).then(() => {})
}

async function spendCoin(layer: HTMLElement, coin: ShowCoin, leave: () => void) {
  const { dx, dy } = pillOffset()
  const el = makeCoin(layer, coin)
  leave()
  await play(el, [
    { transform: `translate(${dx}px, ${dy}px) scale(${pillScale(el)})` },
    { transform: arc(dx, dy), offset: 0.5 },
    { transform: 'translate(0px, 0px) scale(1)' },
  ], { duration: FLIGHT_MS, easing: 'cubic-bezier(.3,0,.55,1)' })
  await play(el, [
    { transform: 'perspective(900px) rotateY(0deg)' },
    { transform: 'perspective(900px) rotateY(720deg)' },
  ], { duration: SPEND_SPIN_MS, easing: 'ease-in-out' })
  el.remove()
  await dust(layer)
}

export default function CreditCoinShow({ plan, onBalance, onDone, persist }: {
  plan: CreditShowPlan
  onBalance: (n: number) => void
  onDone: () => void
  persist: boolean
}) {
  const layerRef = useRef<HTMLDivElement>(null)
  const [burst, setBurst] = useState<ShowBurst | null>(null)
  const [still, setStill] = useState(false)
  const callbacks = useRef({ onBalance, onDone })
  callbacks.current = { onBalance, onDone }
  const finished = useRef(false)
  const marked = useRef(false)
  const skipRef = useRef<() => void>(() => {})

  useEffect(() => {
    let stopped = false
    const live = () => !stopped && !finished.current
    const finish = () => {
      if (finished.current || stopped) return
      finished.current = true
      layerRef.current?.replaceChildren()
      callbacks.current.onBalance(plan.finalBalance)
      callbacks.current.onDone()
    }
    skipRef.current = finish

    if (persist && !marked.current) {
      marked.current = true
      markCreditsSeen(plan.seenUpTo).catch(() => {})
    }

    let balance = plan.startBalance
    callbacks.current.onBalance(balance)
    const step = (value: number) => {
      if (!live()) return
      balance += value
      callbacks.current.onBalance(balance)
    }

    const reduced = prefersReducedMotion()
    ;(async () => {
      for (let i = 0; i < plan.bursts.length; i++) {
        if (!live()) return
        const b = plan.bursts[i]
        if (i > 0) await wait(BURST_PAUSE_MS)
        if (!live()) return
        setBurst(b)
        if (reduced) {
          setStill(true)
          step(b.coins.reduce((s, c) => s + c.value, 0))
          await wait(STILL_MS)
          if (!live()) return
          setStill(false)
        } else {
          const layer = layerRef.current
          if (!layer) return
          const run = b.kind === 'earn' ? earnCoin : spendCoin
          await Promise.all(b.coins.map((c, k) => wait(k * STAGGER_MS).then(() =>
            live() ? run(layer, c, () => { step(c.value); popPill() }) : undefined)))
        }
        if (!live()) return
        setBurst(null)
      }
      finish()
    })()

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }
    window.addEventListener('keydown', onKey)
    return () => {
      stopped = true
      window.removeEventListener('keydown', onKey)
    }
    // Runs once per mount on purpose: HomeNav keys this component by
    // plan.seenUpTo, so a genuinely new plan remounts it, while a fresh but
    // identical plan object (router.refresh re-rendering the layout) must not
    // restart a show that's mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="ccs" onClick={() => skipRef.current()} role="presentation">
      <div className="ccs-backdrop" />
      <div ref={layerRef} className="ccs-layer" aria-hidden="true" />
      {still && <div className="ccs-coin ccs-still" aria-hidden="true" dangerouslySetInnerHTML={{ __html: COIN_SVG }} />}
      {burst && <p className={`ccs-caption ccs-${burst.kind}`} aria-hidden="true">{burst.caption}</p>}
      <p className="sr-only" aria-live="polite">{burst?.srText ?? ''}</p>
    </div>
  )
}
