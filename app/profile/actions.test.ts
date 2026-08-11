import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateProfile } from './actions'

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

let updateResult: { error: { code?: string; message?: string } | null }
let selectResult: { data: { phone_verified: boolean } | null; error: unknown }

const eqMock = vi.fn(() => Promise.resolve(updateResult))
const updateMock = vi.fn((_payload: Record<string, unknown>) => ({ eq: eqMock }))

const singleMock = vi.fn(() => Promise.resolve(selectResult))
const selectEqMock = vi.fn(() => ({ single: singleMock }))
const selectMock = vi.fn(() => ({ eq: selectEqMock }))

const fromMock = vi.fn(() => ({ update: updateMock, select: selectMock }))
const getUserMock = vi.fn(() => Promise.resolve({ data: { user: { id: 'user-1' } } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  }),
}))

function buildFormData(fields: Record<string, string>) {
  const fd = new FormData()
  for (const [key, value] of Object.entries(fields)) fd.set(key, value)
  return fd
}

const baseFields = {
  username: 'newname',
  city: 'Chicago',
  state: 'IL',
  phone: '3125550100',
  address: '',
  address_unit: '',
  zip: '',
  share_address: 'true',
  pickup_description: '',
  share_pickup: 'true',
  notify_message: 'true',
  notify_purchase_request: 'true',
  notify_purchase_decision: 'true',
  notify_tbr_match: 'true',
  notify_pickup: 'true',
}

describe('updateProfile', () => {
  beforeEach(() => {
    redirectMock.mockClear()
    fromMock.mockClear()
    updateMock.mockClear()
    eqMock.mockClear()
    selectMock.mockClear()
    selectEqMock.mockClear()
    singleMock.mockClear()
    selectResult = { data: { phone_verified: false }, error: null }
  })

  it('saves the username along with the rest of the profile and redirects to success', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData(baseFields))).rejects.toThrow('REDIRECT:/profile?tab=account&success=1')
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ username: 'newname' }))
  })

  it('preserves casing and strips whitespace from the submitted username, matching signup', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData({ ...baseFields, username: ' New Name ' })))
      .rejects.toThrow('REDIRECT:/profile?tab=account&success=1')
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ username: 'NewName' }))
  })

  it('redirects with a clear message when the username is already taken', async () => {
    updateResult = { error: { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' } }
    await expect(updateProfile(buildFormData(baseFields)))
      .rejects.toThrow(`REDIRECT:/profile?tab=account&error=${encodeURIComponent('That username is already taken — try another.')}`)
  })

  it('redirects with a generic message on any other save failure', async () => {
    updateResult = { error: { code: '42501', message: 'permission denied' } }
    await expect(updateProfile(buildFormData(baseFields)))
      .rejects.toThrow(`REDIRECT:/profile?tab=account&error=${encodeURIComponent('Something went wrong saving your changes. Please try again.')}`)
  })

  it('redirects to the Account tab so the banner is actually visible', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData(baseFields))).rejects.toThrow()
    expect(redirectMock).toHaveBeenCalledWith(expect.stringContaining('tab=account'))
  })

  it('saves the phone when it is not yet verified', async () => {
    updateResult = { error: null }
    selectResult = { data: { phone_verified: false }, error: null }
    await expect(updateProfile(buildFormData(baseFields))).rejects.toThrow()
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ phone: '3125550100' }))
  })

  it('never overwrites a verified phone, even if a different value is submitted', async () => {
    updateResult = { error: null }
    selectResult = { data: { phone_verified: true }, error: null }
    await expect(updateProfile(buildFormData({ ...baseFields, phone: '9995550000' })))
      .rejects.toThrow('REDIRECT:/profile?tab=account&success=1')
    const payload = updateMock.mock.calls[0][0]
    expect(payload).not.toHaveProperty('phone')
    // the rest of the profile still saves
    expect(payload).toEqual(expect.objectContaining({ username: 'newname', city: 'Chicago' }))
  })

  it('rejects an empty username without touching the database', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData({ ...baseFields, username: '   ' })))
      .rejects.toThrow(`REDIRECT:/profile?tab=account&error=${encodeURIComponent('Please enter a username.')}`)
    expect(updateMock).not.toHaveBeenCalled()
  })
})
