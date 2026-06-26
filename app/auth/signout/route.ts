import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = createClient()
    await supabase.auth.signOut()
  } catch {}

  const url = new URL('/', request.url)
  const response = NextResponse.redirect(url)
  response.cookies.delete('lbe_demo_user')
  return response
}
