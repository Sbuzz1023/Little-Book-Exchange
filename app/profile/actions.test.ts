import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateProfile } from './actions'

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

let updateResult: { error: { code?: string; message?: string } | null }
const eqMock = vi.fn(() => Promise.resolve(updateResult))
const updateMock = vi.fn(() => ({ eq: eqMock }))
const fromMock = vi.fn(() => ({ update: updateMock }))
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
  })

  it('saves the username along with the rest of the profile and redirects to success', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData(baseFields))).rejects.toThrow('REDIRECT:/profile?success=1')
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ username: 'newname' }))
  })

  it('lowercases and strips whitespace from the submitted username, matching signup', async () => {
    updateResult = { error: null }
    await expect(updateProfile(buildFormData({ ...baseFields, username: ' New Name ' })))
      .rejects.toThrow('REDIRECT:/profile?success=1')
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ username: 'newname' }))
  })

  it('redirects with a clear message when the username is already taken', async () => {
    updateResult = { error: { code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' } }
    await expect(updateProfile(buildFormData(baseFields)))
      .rejects.toThrow(`REDIRECT:/profile?error=${encodeURIComponent('That username is already taken — try another.')}`)
  })

  it('redirects with a generic message on any other save failure', async () => {
    updateResult = { error: { code: '42501', message: 'permission denied' } }
    await expect(updateProfile(buildFormData(baseFields)))
      .rejects.toThrow(`REDIRECT:/profile?error=${encodeURIComponent('Something went wrong saving your changes. Please try again.')}`)
  })
})
