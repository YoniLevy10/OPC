import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { IL_ORG_ID } from '@/modules/stores/israel-stores'

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(), hydrateOpsLedger: vi.fn(), listSpends: vi.fn(), memListVisits: vi.fn(), memListTickets: vi.fn(),
  listEngagements: vi.fn(), listTickets: vi.fn(), getById: vi.fn(), supabaseReady: vi.fn(),
  createSystemClient: vi.fn(),
}))
vi.mock('@/lib/auth/request-actor', () => ({ requireActor: mocks.requireActor, authErrorResponse: (e: Error & { status?: number }) => Response.json({ error: e.message }, { status: e.status ?? 500 }) }))
vi.mock('@/lib/data/ops-db', () => ({ hydrateOpsLedger: mocks.hydrateOpsLedger }))
vi.mock('@/lib/data/ops-ledger', () => ({ listSpends: mocks.listSpends }))
vi.mock('@/modules/visits/service', () => ({ memListVisits: mocks.memListVisits }))
vi.mock('@/modules/engagements/service', () => ({ listEngagements: mocks.listEngagements }))
vi.mock('@/modules/tickets/service', () => ({ listTickets: mocks.listTickets, getById: mocks.getById }))
vi.mock('@/lib/data/memory-store', () => ({ supabaseReady: mocks.supabaseReady, memListTickets: mocks.memListTickets }))
vi.mock('@/lib/supabase/system', () => ({ createSystemClient: mocks.createSystemClient }))
vi.mock('@/lib/monitoring', () => ({ captureError: vi.fn() }))
vi.mock('@/lib/logging', () => ({ logEvent: vi.fn() }))

describe('GET /api/ops/lifecycle-reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireActor.mockResolvedValue({ id: 'admin', memberships: [{ role: 'global_admin', organization_id: IL_ORG_ID }] })
    mocks.hydrateOpsLedger.mockResolvedValue(undefined)
    mocks.listSpends.mockReturnValue([])
    mocks.memListVisits.mockReturnValue([])
    mocks.listEngagements.mockResolvedValue([])
    mocks.listTickets.mockResolvedValue({ tickets: [{ id: 't1', status: 'engaged' }], backend: 'memory' })
    mocks.getById.mockResolvedValue({ events: [] })
    mocks.supabaseReady.mockResolvedValue(false)
    mocks.memListTickets.mockReturnValue([{ id: 't1', status: 'engaged', organization_id: IL_ORG_ID }])
  })
  it('returns and logs findings without corrective writes', async () => {
    const response = await GET(new Request('http://localhost/api/ops/lifecycle-reconciliation'))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.readOnly).toBe(true)
    expect(body.complete).toBe(false)
    expect(body.ok).toBe(false)
    expect(body.counts.tickets).toBe(1)
    expect(mocks.listTickets).toHaveBeenCalledWith({ limit: 1000, organizationId: IL_ORG_ID })
    expect(mocks.listEngagements).toHaveBeenCalledWith(IL_ORG_ID)
    expect(body.issues).toEqual([expect.objectContaining({ code: 'ticket_engagement_status_mismatch', ticketId: 't1' })])
  })
  it('rejects non-HQ actors', async () => {
    mocks.requireActor.mockResolvedValue({ id: 'store', memberships: [{ role: 'store_manager' }] })
    const response = await GET(new Request('http://localhost/api/ops/lifecycle-reconciliation'))
    expect(response.status).toBe(403)
  })
})
