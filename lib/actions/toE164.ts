// profiles.phone is free-form text from the signup form (e.g. "(312) 555-0100"),
// but supabase.auth.updateUser({ phone }) and verifyOtp({ phone, ... }) both
// require E.164 ("+13125550100"). Both call sites must normalize identically —
// the number the code was sent to and the number it's verified against have to
// match exactly. US-centric, matching the rest of the app's city/state signup form.
export function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (raw.trim().startsWith('+')) return `+${digits}`
  return digits.length === 11 && digits.startsWith('1') ? `+${digits}` : `+1${digits}`
}
