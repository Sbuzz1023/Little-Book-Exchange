import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'
import { sendEmail } from '@/lib/email/resend'

// Emails every admin about a newly filed dispute — at most once per dispute:
// admin_notified_at is claimed atomically before sending, so a retry (or the
// app calling /api/disputes/notify twice) can't send it again. Best-effort:
// the dispute row itself is what freezes the exchange.
export async function notifyAdminsOfDispute(disputeId: string): Promise<boolean> {
  const admin = createServiceRoleClient()
  const { data: claimed } = await admin
    .from('disputes')
    .update({ admin_notified_at: new Date().toISOString() })
    .eq('id', disputeId)
    .is('admin_notified_at', null)
    .select('id, message, conversation_id')
    .maybeSingle()
  if (!claimed) return false

  const { data: convo } = await admin.from('conversations').select('listing_id').eq('id', claimed.conversation_id).single()
  const { data: listing } = convo?.listing_id
    ? await admin.from('listings').select('title').eq('id', convo.listing_id).single()
    : { data: null }
  const { data: admins } = await admin.from('profiles').select('email').eq('is_admin', true)

  for (const a of admins ?? []) {
    if (!a.email) continue
    // Per-admin try/catch: the claim above means nothing retries, so one failure must not skip the rest.
    try {
      await sendEmail({
        to: a.email,
        subject: `Dispute filed: ${listing?.title ?? 'an exchange'}`,
        text: `A dispute was filed on an exchange.\n\nMessage:\n${claimed.message}\n\nConversation ID: ${claimed.conversation_id}`,
      })
    } catch (err) {
      console.error('notifyAdminsOfDispute: email failed for an admin', err)
    }
  }
  return true
}
