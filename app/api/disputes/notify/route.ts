import { NextResponse } from 'next/server'
import { userFromBearer } from '@/lib/supabase/fromBearer'
import { notifyAdminsOfDispute } from '@/lib/disputes/notifyAdmins'

// Called by the iPhone app right after file_dispute succeeds. The website
// calls notifyAdminsOfDispute directly from its server action instead.
export async function POST(request: Request) {
  const auth = await userFromBearer(request)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const disputeId = typeof body.dispute_id === 'string' ? body.dispute_id : ''
  const { data: own } = await auth.supabase
    .from('disputes').select('id').eq('id', disputeId).eq('reporter_id', auth.user.id).maybeSingle()
  if (!own) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sent = await notifyAdminsOfDispute(disputeId)
  return NextResponse.json({ sent })
}
