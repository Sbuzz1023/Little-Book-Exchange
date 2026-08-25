'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isValidStateCode } from '@/lib/usStates'
import { isValidCoverUrl } from '@/lib/openLibrary'

export async function addTbrEntry(formData: FormData): Promise<void> {
  const title = ((formData.get('title') as string) || '').trim()
  const author = ((formData.get('author') as string) || '').trim()
  const city = ((formData.get('city') as string) || '').trim()
  const rawState = ((formData.get('state') as string) || '').trim()
  const state = isValidStateCode(rawState) ? rawState : ''
  const redirectTo = ((formData.get('redirect_to') as string) || '').trim() || '/profile?tab=tbr'
  const olWorkKey = ((formData.get('ol_work_key') as string) || '').trim() || null
  const rawCoverUrl = ((formData.get('cover_url') as string) || '').trim()
  const coverUrl = isValidCoverUrl(rawCoverUrl) ? rawCoverUrl : null

  if (!title && !author) {
    redirect('/profile?tab=tbr&tbr_error=' + encodeURIComponent('Enter a title or an author.'))
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=/profile')

  await supabase.from('tbr_entries').insert({
    user_id: user.id,
    title,
    author,
    city,
    state,
    ol_work_key: olWorkKey,
    cover_url: coverUrl,
  })

  redirect(redirectTo)
}

export async function removeTbrEntry(formData: FormData): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin?redirect=/profile')

  const id = formData.get('id') as string

  await supabase
    .from('tbr_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  redirect('/profile?tab=tbr')
}
