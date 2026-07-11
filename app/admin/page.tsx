import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AdminClient from './AdminClient'

export const metadata: Metadata = {
  title: 'Admin Panel — LittleBookExchange',
}

async function checkIsAdmin(): Promise<boolean> {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()

    return profile?.is_admin === true
  } catch {
    return false
  }
}

export default async function AdminPage() {
  const isAdmin = await checkIsAdmin()
  if (!isAdmin) notFound()
  return <AdminClient />
}
