'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

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
