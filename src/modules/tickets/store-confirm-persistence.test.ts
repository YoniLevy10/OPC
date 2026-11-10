import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  ticketStatus: 'engaged',
  holdUntil: null as string | null,
  rows: [] as { id: string; status: string; store_confirmed_at: string | null }[],
  updateError: null as { message: string } | null,
  update: vi.fn(),
  updateId: vi.fn(),
  memberIds: vi.fn(),
  closeTicket: vi.fn(),
  closeVisit: vi.fn(),
  appendEvent: vi.fn(),
}))

vi.mock('@/lib/data/memory-store', () => ({
  supabaseReady: async () => true,
  memGet: vi.fn(),
  memAddEvent: vi.fn(),
}))
vi.mock('@/lib/supabase/system', () => ({
  createSystemClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { id: 'lead', status: db.ticketStatus, quality_hold_until: db.holdUntil }, error: null }),
        }),
        in: async (_column: string, ids: string[]) => {
          db.memberIds(ids)
          return { data: db.rows, error: null }
        },
      }),
      update: (value: unknown) => {
        db.update(value)
        return {
          eq: async (column: string, id: string) => {
            db.updateId(column, id)
            return { error: db.updateError }
          },
        }
      },
    }),
  }),
}))
vi.mock('@/modules/tickets/service', () => ({
  updateStatus: db.closeTicket,
  appendEvent: db.appendEvent,
  getById: async () => null,
}))
vi.mock('@/modules/engagements/service', () => ({
  engagementTicketIds: async () => ['lead', 'side'],
  markEngagementClosed: db.closeVisit,
  cancelEngagement: vi.fn(),
}))
vi.mock('@/modules/notifications/lifecycle-notify', () => ({ notifyReporter: vi.fn() }))

import { confirmStoreFix } from './store-confirm'

describe('store feedback persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.ticketStatus = 'engaged'
    db.holdUntil = null
    db.updateError = null
    db.rows = [
      { id: 'lead', status: 'closed', store_confirmed_at: '2026-11-10T11:00:00Z' },
      { id: 'side', status: 'engaged', store_confirmed_at: null },
    ]
    db.closeTicket.mockResolvedValue({ id: 'lead', status: 'closed' })
  })

  it('writes feedback and closes only the named ticket, leaving the visit open', async () => {
    const result = await confirmStoreFix({ ticketId: 'lead', actorLabel: 'manager' })

    expect(db.update).toHaveBeenCalledOnce()
    expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ store_confirmed_by: 'manager' }))
    expect(db.updateId).toHaveBeenCalledExactlyOnceWith('id', 'lead')
    expect(db.appendEvent).toHaveBeenCalledExactlyOnceWith('lead', 'store_confirmed', null, { by: 'manager' })
    expect(db.closeTicket).toHaveBeenCalledExactlyOnceWith('lead', 'closed')
    expect(db.memberIds).toHaveBeenCalledWith(['lead', 'side'])
    expect(db.closeVisit).not.toHaveBeenCalled()
    expect(result.id).toBe('lead')
  })

  it('finishes the visit after all persisted tickets are closed and confirmed', async () => {
    db.rows[1] = { id: 'side', status: 'closed', store_confirmed_at: '2026-11-10T11:00:00Z' }
    const result = await confirmStoreFix({ ticketId: 'lead' })
    expect(db.closeVisit).toHaveBeenCalledExactlyOnceWith('lead', result.store_confirmed_at)
  })

  it('keeps the visit open when a closed member has no store feedback', async () => {
    db.rows[1].status = 'closed'
    await confirmStoreFix({ ticketId: 'lead' })
    expect(db.closeVisit).not.toHaveBeenCalled()
  })

  it('keeps the visit open when a member cannot be read', async () => {
    db.rows.pop()
    await confirmStoreFix({ ticketId: 'lead' })
    expect(db.closeVisit).not.toHaveBeenCalled()
  })

  it('does not close a ticket when saving its feedback fails', async () => {
    db.updateError = { message: 'feedback write failed' }
    await expect(confirmStoreFix({ ticketId: 'lead' })).rejects.toThrow('feedback write failed')
    expect(db.closeTicket).not.toHaveBeenCalled()
    expect(db.closeVisit).not.toHaveBeenCalled()
  })

  it('closes a persisted resolved repair immediately after feedback despite a future follow-up date', async () => {
    db.ticketStatus = 'resolved'
    db.holdUntil = '2099-12-31T12:00:00Z'
    const result = await confirmStoreFix({ ticketId: 'lead', actorLabel: 'manager' })
    expect(db.closeTicket).toHaveBeenCalledExactlyOnceWith('lead', 'closed')
    expect(result.status).toBe('closed')
    expect(result.pending_final_close).toBe(false)
    expect(result.quality_hold_until).toBe(db.holdUntil)
  })
})
