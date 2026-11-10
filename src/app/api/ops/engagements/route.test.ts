import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, type Actor } from '@/lib/auth/types'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(), ticket: vi.fn(), lock: vi.fn(), locked: vi.fn(), retry: vi.fn(), resume: vi.fn(),
  InputError: class extends Error {},
}))
vi.mock('@/lib/auth/request-actor', () => ({
  requireActor: mocks.actor,
  authErrorResponse: (error: AuthError) => Response.json({ error: error.message }, { status: error.status }),
}))
vi.mock('@/modules/tickets/service', () => ({ getById: mocks.ticket }))
vi.mock('@/modules/engagements/service', () => ({
  lockEngagement: mocks.lock, lockedEngagementFor: mocks.locked,
  retryEngagementHandoffs: mocks.retry, resumeEngagementApproval: mocks.resume,
  EngagementInputError: mocks.InputError,
}))
vi.mock('@/lib/monitoring', () => ({ captureError: vi.fn() }))
import { POST } from './route'

const LEAD = 'aaaaaaaa-1111-4111-8111-111111111111'
const SIDE = 'bbbbbbbb-2222-4222-8222-222222222222'
const approval = {
  ticketId: LEAD, bundledTicketIds: [SIDE], professionalName: 'איש מקצוע לבדיקה',
  professionalPhone: '0501234567', approvedAmount: 450,
}
const engagement = { id: 'engagement', ...approval, handoffs: [], approvedBy: 'Ari', status: 'locked' }
const actor: Actor = {
  id: 'ari', authVia: 'supabase_session', full_name: 'Ari',
  memberships: [{ id: 'membership', profile_id: 'ari', role: 'global_maintenance', organization_id: 'org', country_id: null, region_id: null, store_id: null }],
}
function post(body: unknown) {
  return POST(new Request('http://localhost/api/ops/engagements', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }))
}

describe('fault-led work approval authorization and replay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue(actor)
    mocks.ticket.mockImplementation(async (id) => ({ id, organization_id: 'org', country_id: 'country', region_id: 'region', store_id: 'store', assigned_to: null, status: 'new' }))
    mocks.locked.mockResolvedValue(null)
    mocks.lock.mockResolvedValue(engagement)
    mocks.retry.mockResolvedValue(engagement)
    mocks.resume.mockResolvedValue(engagement)
  })

  it('requires a real authenticated actor', async () => {
    mocks.actor.mockRejectedValue(new AuthError('login', 401))
    expect((await post(approval)).status).toBe(401)
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('does not let a shop or technician approve a financial commitment', async () => {
    for (const role of ['store_employee', 'internal_technician'] as const) {
      mocks.actor.mockResolvedValue({ ...actor, memberships: [{ ...actor.memberships[0], role }] })
      expect((await post(approval)).status).toBe(403)
    }
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it.each([
    { ...approval, approvedAmount: 0 }, { ...approval, approvedAmount: -1 },
    { ...approval, approvedAmount: null }, { ...approval, professionalName: '' },
    { ...approval, professionalPhone: 'not-a-phone' }, { ...approval, approvedBy: 'spoofed' },
  ])('rejects incomplete or client-authored approval data before a write', async (body) => {
    expect((await post(body)).status).toBe(400)
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('approves without a vendor ID and derives the approver from the session', async () => {
    expect((await post(approval)).status).toBe(201)
    expect(mocks.ticket).toHaveBeenCalledWith(LEAD)
    expect(mocks.ticket).toHaveBeenCalledWith(SIDE)
    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith({ ...approval, approvedBy: 'Ari' })
  })
  it('authorizes every selected ticket before locking any of them', async () => {
    mocks.ticket.mockImplementation(async (id) => ({ id, organization_id: id === SIDE ? 'other' : 'org' }))
    expect((await post(approval)).status).toBe(403)
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('does not use a legacy scoped role in another organization as Ari authority', async () => {
    mocks.actor.mockResolvedValue({ ...actor, memberships: [
      { ...actor.memberships[0], organization_id: 'other' },
      { ...actor.memberships[0], role: 'country_manager', country_id: 'country' },
    ] })
    expect((await post(approval)).status).toBe(403)
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('returns an exact existing approval without creating or sending another', async () => {
    mocks.locked.mockResolvedValue(engagement)
    const response = await post({ ...approval, professionalPhone: '+972 50-1234567' })
    expect(response.status).toBe(200)
    expect((await response.json()).replay).toBe(true)
    expect(mocks.lock).not.toHaveBeenCalled()
    expect(mocks.retry).not.toHaveBeenCalled()
    expect(mocks.resume).toHaveBeenCalledExactlyOnceWith(LEAD)
  })
  it.each([
    { ...approval, approvedAmount: 800 },
    { ...approval, professionalName: 'אחר' },
    { ...approval, bundledTicketIds: [] },
  ])('requires a new deliberate approval when locked terms differ', async (body) => {
    mocks.locked.mockResolvedValue(engagement)
    expect((await post(body)).status).toBe(409)
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('retries the existing handoff without approving or charging again', async () => {
    mocks.locked.mockResolvedValue(engagement)
    expect((await post({ action: 'retry', ticketId: LEAD })).status).toBe(200)
    expect(mocks.retry).toHaveBeenCalledExactlyOnceWith(LEAD)
    expect(mocks.lock).not.toHaveBeenCalled()
  })
  it('checks the scope of existing companion tickets on handoff retry', async () => {
    mocks.locked.mockResolvedValue(engagement)
    mocks.ticket.mockImplementation(async (id) => ({ id, organization_id: id === SIDE ? 'other' : 'org' }))
    expect((await post({ action: 'retry', ticketId: LEAD })).status).toBe(403)
    expect(mocks.retry).not.toHaveBeenCalled()
  })
  it('does not fabricate an approval for a missing retry target', async () => {
    expect((await post({ action: 'retry', ticketId: LEAD })).status).toBe(404)
    expect(mocks.retry).not.toHaveBeenCalled()
  })
  it('returns service validation errors without a success response', async () => {
    mocks.lock.mockRejectedValue(new mocks.InputError('mixed professions'))
    expect((await post(approval)).status).toBe(400)
  })
  it('reports persistence failure as unavailable rather than a saved approval', async () => {
    mocks.lock.mockRejectedValue(new Error('database unavailable'))
    expect((await post(approval)).status).toBe(503)
  })

  it('does not return a healthy replay when a saved approval cannot resume its ticket state', async () => {
    mocks.locked.mockResolvedValue(engagement)
    mocks.resume.mockRejectedValue(new Error('inconsistent ticket state'))
    expect((await post(approval)).status).toBe(503)
    expect(mocks.lock).not.toHaveBeenCalled()
  })
})
