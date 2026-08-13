import { NextRequest, NextResponse } from 'next/server'
import { Webhook } from 'standardwebhooks'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { renderTemplate } from '@/lib/email/renderTemplate'
import { sendEmail } from '@/lib/email/resend'

type HookPayload = {
  user: { id: string; email: string }
  email_data: { token_hash: string; email_action_type: 'signup' | 'recovery' | string }
}

const TEMPLATE_BY_ACTION: Record<string, 'welcome_confirmation' | 'password_reset'> = {
  signup: 'welcome_confirmation',
  recovery: 'password_reset',
}

// Where the user lands after /auth/confirm verifies their link. Signup just
// needs them back at sign-in; recovery needs the set-new-password page.
const NEXT_BY_ACTION: Record<string, string> = {
  signup: '/auth/signin?info=confirmed',
  recovery: '/auth/reset-password',
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers)

  let payload: HookPayload
  try {
    const wh = new Webhook(process.env.SUPABASE_EMAIL_HOOK_SECRET!)
    payload = wh.verify(rawBody, headers) as HookPayload
  } catch {
    return NextResponse.json({ error: { http_code: 401, message: 'Invalid webhook signature.' } }, { status: 401 })
  }

  const templateType = TEMPLATE_BY_ACTION[payload.email_data.email_action_type]
  const next = NEXT_BY_ACTION[payload.email_data.email_action_type]
  if (!templateType || !next) {
    // Only signup + recovery are used by this app today (see spec §7 note on
    // scope). Anything else is unexpected — fail loudly rather than silently
    // skip sending.
    return NextResponse.json({ error: { http_code: 400, message: `Unsupported email action: ${payload.email_data.email_action_type}` } }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  const { data: template, error: templateError } = await supabase
    .from('email_templates').select('subject, body').eq('type', templateType).single()

  if (templateError || !template) {
    // Fail loudly rather than falling through to renderTemplate(undefined)
    // and sending — and logging as 'sent' — a blank email.
    await supabase.from('email_log').insert({
      kind: templateType,
      recipient_user_id: payload.user.id,
      recipient_email: payload.user.email,
      subject: '(template unavailable)',
      status: 'failed',
      error: templateError?.message ?? `No ${templateType} email template is configured.`,
    })
    return NextResponse.json({ error: { http_code: 500, message: 'Email template is not configured.' } }, { status: 500 })
  }

  const { data: profile } = await supabase
    .from('profiles').select('username').eq('id', payload.user.id).single()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'
  const link = `${siteUrl}/auth/confirm?token_hash=${payload.email_data.token_hash}&type=${payload.email_data.email_action_type}&next=${encodeURIComponent(next)}`
  const vars = { username: profile?.username || 'there', link }

  const subject = renderTemplate(template.subject, vars)
  const text = renderTemplate(template.body, vars)

  const result = await sendEmail({ to: payload.user.email, subject, text })

  await supabase.from('email_log').insert({
    kind: templateType,
    recipient_user_id: payload.user.id,
    recipient_email: payload.user.email,
    subject,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
  })

  if (!result.ok) {
    return NextResponse.json({ error: { http_code: 500, message: 'Failed to send email.' } }, { status: 500 })
  }
  return NextResponse.json({})
}
