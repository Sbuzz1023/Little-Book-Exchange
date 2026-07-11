'use server'

import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from './libraryLocations'

export async function submitLocationReport(locationId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Please sign in to report a location.' }

  const trimmedReason = reason.trim()
  if (!trimmedReason) return { ok: false, error: 'Please describe the issue.' }

  const { error } = await supabase
    .from('location_reports')
    .insert({ location_id: locationId, reporter_id: user.id, reason: trimmedReason })

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function resolveLocationReport(
  reportId: string,
  resolution: 'edited' | 'removed' | 'dismissed'
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createClient()
  const admin = await requireAdmin(supabase)
  if (!admin.ok) return { ok: false, error: admin.error }

  const { error } = await supabase
    .from('location_reports')
    .update({
      status: 'resolved',
      resolution,
      resolved_by: admin.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
