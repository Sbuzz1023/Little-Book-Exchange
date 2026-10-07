import type { Metadata, Viewport } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import ScrollToTop from '@/components/ScrollToTop'
import { cookies } from 'next/headers'
import { dashboardAlertTotal } from '@/lib/notifications'
import { MOCK_PROFILE } from '@/lib/mock-data'
import type { UnseenCredit } from '@/lib/creditShow'
import { fetchUnseenCredits } from '@/lib/unseenCredits'

export const metadata: Metadata = {
  title: 'LittleBookExchange — Local Used Books',
  description: 'Buy, sell, or give away used books with your neighbors.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let userName: string | null = null
  let isAdmin = false
  let unreadCount = 0
  let credits: number | null = null
  let unseenCredits: UnseenCredit[] = []

  // Check demo cookie first — getUser() returns null silently with placeholder URL
  // so we can't rely on the catch block to read it
  const demoCookie = cookies().get('lbe_demo_user')?.value
  if (demoCookie) {
    userName = demoCookie
    credits = MOCK_PROFILE.credits
  } else {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('username, is_admin, onboarding_bonus_claimed, credits').eq('id', user.id).single()
        userName = p?.username ?? user.email ?? 'Me'
        isAdmin = p?.is_admin === true
        credits = p?.credits ?? null
        // Credit changes the user hasn't seen animate in the nav (CreditCoinShow).
        if (credits != null) unseenCredits = await fetchUnseenCredits(supabase, user.id)
        const { count } = await supabase
          .from('notifications').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).eq('read', false)
        unreadCount = dashboardAlertTotal(count ?? 0, p?.onboarding_bonus_claimed)
      }
    } catch {}
  }

  return (
    <html lang="en">
      <body className="bg-cream min-h-screen flex flex-col">
        <ScrollToTop />
        <Nav userName={userName} isAdmin={isAdmin} unreadCount={unreadCount} credits={credits} unseenCredits={unseenCredits} />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
