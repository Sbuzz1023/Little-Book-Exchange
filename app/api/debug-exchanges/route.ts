import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const supabase = createClient()
    const { data: { user }, error: authErr } = await supabase.auth.getUser()

    if (authErr || !user) {
      return NextResponse.json({ error: 'Not authenticated', authErr })
    }

    // Raw conversations query
    const { data: convos, error: convosErr } = await supabase
      .from('conversations')
      .select('*')
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)

    // Test insert (dry run — just check the listing)
    const { data: myListings, error: listErr } = await supabase
      .from('listings')
      .select('id, title, user_id, status')
      .eq('user_id', user.id)

    return NextResponse.json({
      userId: user.id,
      conversationsCount: convos?.length ?? 0,
      conversations: convos,
      conversationsError: convosErr,
      myListings,
      listingsError: listErr,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message })
  }
}
