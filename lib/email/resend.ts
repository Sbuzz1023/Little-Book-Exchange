import { Resend } from 'resend'

// Lazily constructed so tests can set RESEND_API_KEY before first use, and so
// importing this module never throws in an environment where the key isn't
// set yet (e.g. during `next build`).
let client: Resend | null = null
function getClient(): Resend {
  if (!client) client = new Resend(process.env.RESEND_API_KEY)
  return client
}

export async function sendEmail(params: { to: string; subject: string; text: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const from = process.env.EMAIL_FROM_ADDRESS || 'Little Book Exchange <onboarding@resend.dev>'
    const { error } = await getClient().emails.send({ from, to: params.to, subject: params.subject, text: params.text })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Failed to send email.' }
  }
}
