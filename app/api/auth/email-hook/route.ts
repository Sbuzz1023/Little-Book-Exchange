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

// Supabase's dashboard displays the Send Email Hook secret as
// `v1,whsec_<base64>`, but standardwebhooks' Webhook only knows how to strip
// the `whsec_` part — the leading `v1,` makes its base64 decode throw. Strip it
// here so all three paste-shapes work: `v1,whsec_…`, `whsec_…`, and a bare
// base64 secret. A no-op when the prefix isn't present.
function normalizeHookSecret(secret: string): string {
  return secret.startsWith('v1,') ? secret.slice('v1,'.length) : secret
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers)

  // Construction failure (a missing/malformed secret — a config problem) and
  // verification failure (a genuinely bad signature — a security event) are
  // wildly different diagnoses, so they get separate log lines. The HTTP
  // response stays 401 for both so we never leak which one it was.
  let wh: Webhook
  try {
    wh = new Webhook(normalizeHookSecret(process.env.SUPABASE_EMAIL_HOOK_SECRET ?? ''))
  } catch (err) {
    console.error(
      'email-hook: CONFIG ERROR — could not construct the webhook verifier. Check SUPABASE_EMAIL_HOOK_SECRET; it should be the value Supabase shows for the Send Email Hook (`v1,whsec_…`).',
      err
    )
    return NextResponse.json({ error: { http_code: 401, message: 'Invalid webhook signature.' } }, { status: 401 })
  }

  let payload: HookPayload
  try {
    payload = wh.verify(rawBody, headers) as HookPayload
  } catch (err) {
    console.error('email-hook: SIGNATURE REJECTED — the request did not verify against the configured secret.', err)
    return NextResponse.json({ error: { http_code: 401, message: 'Invalid webhook signature.' } }, { status: 401 })
  }

  // A signature-valid payload can still be the wrong shape (Supabase changing
  // the hook contract, a hand-rolled test request). Guard before dereferencing
  // so that produces a clean 400 rather than an unhandled throw and a bare 500.
  if (!payload?.email_data?.email_action_type || !payload.email_data.token_hash || !payload.user?.id) {
    console.error('email-hook: signature-valid request had a missing or malformed email_data/user payload.')
    return NextResponse.json({ error: { http_code: 400, message: 'Malformed hook payload.' } }, { status: 400 })
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
    const { error: logError } = await supabase.from('email_log').insert({
      kind: templateType,
      recipient_user_id: payload.user.id,
      recipient_email: payload.user.email,
      subject: '(template unavailable)',
      status: 'failed',
      error: templateError?.message ?? `No ${templateType} email template is configured.`,
    })
    // Don't change control flow on a logging failure, but do make a broken
    // audit trail visible instead of silently dropping it.
    if (logError) console.error('email-hook: failed to write email_log row', logError)
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

  const { error: logError } = await supabase.from('email_log').insert({
    kind: templateType,
    recipient_user_id: payload.user.id,
    recipient_email: payload.user.email,
    subject,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
  })
  if (logError) console.error('email-hook: failed to write email_log row', logError)

  if (!result.ok) {
    return NextResponse.json({ error: { http_code: 500, message: 'Failed to send email.' } }, { status: 500 })
  }
  return NextResponse.json({})
}
