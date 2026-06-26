import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/Nav'
import Footer from '@/components/Footer'
import { cookies } from 'next/headers'

export const metadata: Metadata = {
  title: 'LittleBookExchange — Local Used Books',
  description: 'Buy, sell, or give away used books with your neighbors.',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let userName: string | null = null

  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: p } = await supabase.from('profiles').select('username').eq('id', user.id).single()
      userName = p?.username ?? user.email ?? 'Me'
    }
  } catch {
    const demoUser = cookies().get('lbe_demo_user')?.value
    if (demoUser) userName = demoUser
  }

  return (
    <html lang="en">
      <body className="bg-cream min-h-screen flex flex-col">
        <Nav userName={userName} />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
