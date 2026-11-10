import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  profile: null as { id: string } | null,
  lookupError: null as { message: string } | null,
  createAuth: vi.fn(), updateAuth: vi.fn(), listAuth: vi.fn(), upsert: vi.fn(),
}))
vi.mock('@/lib/data/memory-store', async (original) => ({ ...await original<typeof import('@/lib/data/memory-store')>(), supabaseReady: async () => true }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ auth: { admin: { createUser: state.createAuth, updateUserById: state.updateAuth, listUsers: state.listAuth } } }) }))
vi.mock('@/lib/supabase/system', () => ({ createSystemClient: () => ({ from: () => ({
  select: () => ({ eq: () => ({ limit: () => ({ maybeSingle: async () => ({ data: state.profile, error: state.lookupError }) }) }) }),
  upsert: state.upsert,
}) }) }))

import { createUser } from './service'
const input = { full_name: 'New user', email: 'already@example.test', role: 'global_maintenance' as const, password: 'new-password-for-test' }

describe('new-user creation never resets or rebinds an existing account', () => {
  beforeEach(() => {
    state.profile = null
    state.lookupError = null
    state.createAuth.mockReset().mockResolvedValue({ data: { user: null }, error: { message: 'User already registered' } })
    state.updateAuth.mockReset()
    state.listAuth.mockReset()
    state.upsert.mockReset()
  })

  it('rejects an existing profile before attempting Auth creation or any profile write', async () => {
    state.profile = { id: 'existing-profile' }
    await expect(createUser(input)).rejects.toThrow('המייל כבר רשום')
    expect(state.createAuth).not.toHaveBeenCalled()
    expect(state.updateAuth).not.toHaveBeenCalled()
    expect(state.upsert).not.toHaveBeenCalled()
  })

  it('does not change the password or memberships when only an existing Auth account has the email', async () => {
    await expect(createUser(input)).rejects.toThrow('המייל כבר רשום')
    expect(state.createAuth).toHaveBeenCalledTimes(1)
    expect(state.updateAuth).not.toHaveBeenCalled()
    expect(state.listAuth).not.toHaveBeenCalled()
    expect(state.upsert).not.toHaveBeenCalled()
  })

  it('does not create an Auth account when profile ownership lookup failed', async () => {
    state.lookupError = { message: 'profile lookup unavailable' }
    await expect(createUser(input)).rejects.toThrow('profile lookup unavailable')
    expect(state.createAuth).not.toHaveBeenCalled()
    expect(state.upsert).not.toHaveBeenCalled()
  })
})
