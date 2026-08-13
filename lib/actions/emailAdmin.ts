'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'
import { sendEmail } from '@/lib/email/resend'
import { makeUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import { filterRecipients, type BroadcastTarget, type Recipient, type ProfileRow } from '@/lib/email/broadcastRecipients'

export type EmailTemplateType = 'welcome_confirmation' | 'password_reset'
export type EmailTemplate = { type: EmailTemplateType; subject: string; body: string }

export async function getEmailTemplates(): Promise<{ ok: boolean; templates?: EmailTemplate[]; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { data, error } = await supabase.from('email_templates').select('type, subject, body').order('type')
  if (error) return { ok: false, error: error.message }
  return { ok: true, templates: data as EmailTemplate[] }
}

export async function updateEmailTemplate(type: EmailTemplateType, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  if (!subject.trim() || !body.trim()) return { ok: false, error: 'Subject and body cannot be empty.' }

  const { error } = await supabase
    .from('email_templates')
    .update({ subject: subject.trim(), body, updated_at: new Date().toISOString(), updated_by: admin.userId })
    .eq('type', type)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export type { BroadcastTarget }

async function fetchRecipients(supabase: ReturnType<typeof createClient>, target: BroadcastTarget): Promise<Recipient[]> {
  const { data } = await supabase.from('profiles').select('id, email, city, state, marketing_opt_out')
  return filterRecipients((data ?? []) as ProfileRow[], target)
}

export async function resolveBroadcastRecipients(target: BroadcastTarget): Promise<{ ok: boolean; recipients?: Recipient[]; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const recipients = await fetchRecipients(supabase, target)
  return { ok: true, recipients }
}

export async function sendBroadcastEmail(target: BroadcastTarget, subject: string, body: string): Promise<{ ok: boolean; sent: number; failed: number; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, sent: 0, failed: 0, error: admin.error }

  if (!subject.trim() || !body.trim()) return { ok: false, sent: 0, failed: 0, error: 'Subject and body cannot be empty.' }

  const recipients = await fetchRecipients(supabase, target)
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  let sent = 0, failed = 0
  for (const recipient of recipients) {
    const unsubLink = `${siteUrl}/unsubscribe/${recipient.id}?t=${makeUnsubscribeToken(recipient.id)}`
    const text = `${body}\n\n---\nDon't want these emails? Unsubscribe: ${unsubLink}`
    const result = await sendEmail({ to: recipient.email, subject, text })

    await supabase.from('email_log').insert({
      kind: 'broadcast',
      recipient_user_id: recipient.id,
      recipient_email: recipient.email,
      subject,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error,
    })

    if (result.ok) sent++; else failed++
  }

  return { ok: true, sent, failed }
}
