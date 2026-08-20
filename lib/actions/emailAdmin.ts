'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'
import { sendEmail } from '@/lib/email/resend'
import { makeUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import { filterRecipients, type BroadcastTarget, type Recipient, type ProfileRow, type BroadcastChannel } from '@/lib/email/broadcastRecipients'

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

// Returns either the recipients or the query error — never an empty list
// standing in for a failed query. Collapsing those two cases made a broken
// profiles query look like a successful send to zero people.
async function fetchRecipients(
  supabase: ReturnType<typeof createClient>,
  target: BroadcastTarget,
  channel: BroadcastChannel = 'email'
): Promise<{ recipients?: Recipient[]; error?: string }> {
  const { data, error } = await supabase.from('profiles').select('id, email, city, state, marketing_opt_out')
  if (error) return { error: error.message }
  return { recipients: filterRecipients((data ?? []) as ProfileRow[], target, channel) }
}

// Only the count is returned — the confirmation dialog is the sole consumer and
// only needs a number, so there's no reason to ship every user's email address
// to the browser.
export async function resolveBroadcastRecipients(target: BroadcastTarget, channel: BroadcastChannel = 'email'): Promise<{ ok: boolean; count?: number; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { recipients, error } = await fetchRecipients(supabase, target, channel)
  if (error || !recipients) return { ok: false, error: error ?? 'Failed to look up recipients.' }
  return { ok: true, count: recipients.length }
}

export async function sendBroadcastEmail(target: BroadcastTarget, subject: string, body: string): Promise<{ ok: boolean; sent: number; failed: number; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, sent: 0, failed: 0, error: admin.error }

  if (!subject.trim() || !body.trim()) return { ok: false, sent: 0, failed: 0, error: 'Subject and body cannot be empty.' }

  const { recipients, error: recipientsError } = await fetchRecipients(supabase, target)
  if (recipientsError || !recipients) {
    // Reporting `ok: true, sent: 0` here told the admin the send succeeded and
    // wiped their draft — surface the real failure instead.
    return { ok: false, sent: 0, failed: 0, error: recipientsError ?? 'Failed to look up recipients.' }
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  let sent = 0, failed = 0
  for (const recipient of recipients) {
    const unsubLink = `${siteUrl}/unsubscribe/${recipient.id}?t=${makeUnsubscribeToken(recipient.id)}`
    const text = `${body}\n\n---\nDon't want these emails? Unsubscribe: ${unsubLink}`
    const result = await sendEmail({ to: recipient.email, subject, text })

    const { error: logError } = await supabase.from('email_log').insert({
      kind: 'broadcast',
      recipient_user_id: recipient.id,
      recipient_email: recipient.email,
      subject,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error,
    })
    // The email really was sent — a failed audit-log write shouldn't change the
    // outcome reported to the admin, but it must not vanish either.
    if (logError) console.error('sendBroadcastEmail: failed to write email_log row', logError)

    if (result.ok) sent++; else failed++
  }

  return { ok: true, sent, failed }
}

async function findOrCreateAdminConversation(
  supabase: ReturnType<typeof createClient>, userId: string, repliable: boolean
): Promise<string> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('type', 'admin')
    .eq('user_id', userId)
    .eq('repliable', repliable)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ type: 'admin', user_id: userId, repliable })
    .select('id')
    .single()

  if (error || !created) throw error ?? new Error('Failed to create conversation')
  return created.id
}

export async function sendBroadcastMessage(target: BroadcastTarget, body: string, repliable: boolean): Promise<{ ok: boolean; sent: number; failed: number; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, sent: 0, failed: 0, error: admin.error }

  if (!body.trim()) return { ok: false, sent: 0, failed: 0, error: 'Message cannot be empty.' }

  const { recipients, error: recipientsError } = await fetchRecipients(supabase, target, 'message')
  if (recipientsError || !recipients) {
    return { ok: false, sent: 0, failed: 0, error: recipientsError ?? 'Failed to look up recipients.' }
  }

  let sent = 0, failed = 0
  for (const recipient of recipients) {
    try {
      const conversationId = await findOrCreateAdminConversation(supabase, recipient.id, repliable)
      const { error: msgError } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: admin.userId,
        body: body.trim(),
        kind: 'chat',
      })
      if (msgError) throw msgError
      sent++
    } catch (err) {
      console.error('sendBroadcastMessage: failed for recipient', recipient.id, err)
      failed++
    }
  }

  return { ok: true, sent, failed }
}

async function lookupUserEmail(supabase: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data } = await supabase.from('profiles').select('email').eq('id', userId).single()
  return data?.email ?? null
}

export async function resendConfirmationEmail(userId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const email = await lookupUserEmail(supabase, userId)
  if (!email) return { ok: false, error: 'No email on file for that user.' }

  const { error } = await supabase.auth.resend({ type: 'signup', email })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function resendPasswordResetEmail(userId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const email = await lookupUserEmail(supabase, userId)
  if (!email) return { ok: false, error: 'No email on file for that user.' }

  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
