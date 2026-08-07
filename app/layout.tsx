import type { Metadata, Viewport } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import ScrollToTop from '@/components/ScrollToTop'
import { cookies } from 'next/headers'
import { dashboardAlertTotal } from '@/lib/notifications'

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

  // Check demo cookie first — getUser() returns null silently with placeholder URL
  // so we can't rely on the catch block to read it
  const demoCookie = cookies().get('lbe_demo_user')?.value
  if (demoCookie) {
    userName = demoCookie
  } else {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: p } = await supabase.from('profiles').select('username, is_admin, onboarding_bonus_claimed').eq('id', user.id).single()
        userName = p?.username ?? user.email ?? 'Me'
        isAdmin = p?.is_admin === true
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
        <Nav userName={userName} isAdmin={isAdmin} unreadCount={unreadCount} />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
