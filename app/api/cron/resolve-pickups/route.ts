import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/serviceRole'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()

  const { data: candidates, error } = await supabase
    .from('conversations')
    .select('id')
    .eq('exchange_status', 'confirmed')
    .or('seller_picked_up_at.not.is.null,buyer_picked_up_at.not.is.null')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  let resolved = 0
  for (const row of candidates ?? []) {
    const { data: result } = await supabase.rpc('resolve_pickup', { p_conversation_id: row.id })
    if (result === 'completed_auto_timeout') resolved++
  }

  return NextResponse.json({ checked: candidates?.length ?? 0, resolved })
}
