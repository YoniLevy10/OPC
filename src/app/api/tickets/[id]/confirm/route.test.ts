import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, type Actor, type MemberRole, type Membership } from '@/lib/auth/types'

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  demoEntry: vi.fn(),
  getById: vi.fn(),
  confirmStoreFix: vi.fn(),
}))

vi.mock('@/lib/auth/request-actor', () => ({
  requireActor: mocks.requireActor,
  authErrorResponse: (error: AuthError) => Response.json({ error: error.message }, { status: error.status }),
}))
vi.mock('@/lib/auth/home-path', () => ({ shouldAllowDemoEntry: mocks.demoEntry }))
vi.mock('@/modules/tickets/service', () => ({ getById: mocks.getById }))
vi.mock('@/modules/tickets/store-confirm', () => ({ confirmStoreFix: mocks.confirmStoreFix }))
vi.mock('@/lib/monitoring', () => ({ captureError: vi.fn() }))

import { POST } from './route'

function actor(role: MemberRole, scope: Partial<Membership> = {}): Actor {
  return {
    id: 'actor',
    full_name: 'Manager',
    authVia: 'supabase_session',
    memberships: [{
      id: 'membership',
      profile_id: 'actor',
      organization_id: 'org',
      country_id: 'country',
      region_id: 'region',
      store_id: 'store',
      role,
      ...scope,
    }],
  }
}

function confirm() {
  return POST(new Request('http://localhost/api/tickets/ticket/confirm', { method: 'POST' }), {
    params: Promise.resolve({ id: 'ticket' }),
  })
}

describe('POST /api/tickets/[id]/confirm authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.demoEntry.mockReturnValue(false)
    mocks.requireActor.mockResolvedValue(actor('store_employee'))
    mocks.getById.mockResolvedValue({
      id: 'ticket',
      organization_id: 'org',
      country_id: 'country',
      region_id: 'region',
      store_id: 'store',
      assigned_to: 'actor',
      status: 'engaged',
    })
    mocks.confirmStoreFix.mockResolvedValue({ id: 'ticket', status: 'closed' })
  })

  it.each<MemberRole>([
    'store_employee', 'store_manager', 'global_admin', 'global_maintenance',
    'country_manager', 'regional_manager',
  ])('allows %s within the ticket scope', async (role) => {
    mocks.requireActor.mockResolvedValue(actor(role))
    const response = await confirm()
    expect(response.status).toBe(200)
    expect(mocks.confirmStoreFix).toHaveBeenCalledExactlyOnceWith({ ticketId: 'ticket', actorLabel: 'Manager' })
  })

  it.each([
    { role: 'store_employee', scope: { store_id: 'another-store' } },
    { role: 'store_manager', scope: { organization_id: 'another-org' } },
    { role: 'global_maintenance', scope: { organization_id: 'another-org' } },
    { role: 'global_admin', scope: { organization_id: 'another-org' } },
    { role: 'country_manager', scope: { country_id: 'another-country' } },
    { role: 'regional_manager', scope: { region_id: 'another-region' } },
    { role: 'internal_technician', scope: {} },
    { role: 'external_provider', scope: {} },
  ] satisfies { role: MemberRole; scope: Partial<Membership> }[])('blocks $role outside confirmation scope ($scope)', async ({ role, scope }) => {
    mocks.requireActor.mockResolvedValue(actor(role, scope))
    const response = await confirm()
    expect(response.status).toBe(403)
    expect(mocks.confirmStoreFix).not.toHaveBeenCalled()
  })

  it('blocks an unauthorized signed-in store even when demo entry is enabled', async () => {
    mocks.demoEntry.mockReturnValue(true)
    mocks.requireActor.mockResolvedValue(actor('store_employee', { store_id: 'another-store' }))
    expect((await confirm()).status).toBe(403)
    expect(mocks.confirmStoreFix).not.toHaveBeenCalled()
  })

  it('requires a session outside explicit demo mode', async () => {
    mocks.requireActor.mockRejectedValue(new AuthError('נדרשת התחברות', 401))
    expect((await confirm()).status).toBe(401)
    expect(mocks.confirmStoreFix).not.toHaveBeenCalled()
  })

  it('preserves explicit anonymous demo entry', async () => {
    mocks.demoEntry.mockReturnValue(true)
    mocks.requireActor.mockRejectedValue(new AuthError('נדרשת התחברות', 401))
    expect((await confirm()).status).toBe(200)
    expect(mocks.confirmStoreFix).toHaveBeenCalledWith({ ticketId: 'ticket', actorLabel: 'demo-store' })
  })
})
