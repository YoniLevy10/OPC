import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  readError: null as { message: string } | null,
  writeError: null as { message: string } | null,
  updateTicket: vi.fn(),
  write: vi.fn(),
  row: {
    id: 'engagement-1', organization_id: 'org-1', store_id: 'store-1',
    ticket_id: 'ticket-1', bundled_ticket_ids: [], professional_name: 'פבל',
    professional_phone: '0501234567', approved_amount: 450, approved_by: 'ארי',
    approved_at: '2026-11-10T00:00:00.000Z', status: 'locked', closed_at: null,
  },
}))

vi.mock('@/lib/data/memory-store', () => ({
  supabaseReady: async () => true,
  memAddMessage: vi.fn(), memFindStoreById: vi.fn(), memGet: vi.fn(),
}))
vi.mock('@/modules/tickets/service', () => ({
  appendEvent: vi.fn(), getById: vi.fn(), listTickets: vi.fn(), updateStatus: state.updateTicket,
}))
vi.mock('@/modules/whatsapp/send', () => ({ sendWhatsAppText: vi.fn() }))
vi.mock('@/lib/supabase/system', () => ({
  createSystemClient: () => ({
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: [state.row], error: state.readError }) }) }),
      update: (patch: Record<string, unknown>) => ({ eq: async () => {
        state.write(patch)
        return { error: state.writeError }
      } }),
    }),
  }),
}))

import { cancelEngagement, listEngagements, markEngagementClosed } from './service'

describe('engagement persistence failures', () => {
  beforeEach(() => {
    state.readError = null
    state.writeError = null
    state.write.mockReset()
    state.updateTicket.mockReset()
  })

  it('does not pretend an unavailable live ledger is an empty memory ledger', async () => {
    state.readError = { message: 'database unavailable' }
    await expect(listEngagements()).rejects.toThrow('database unavailable')
  })

  it('does not reset tickets when cancelling the approval failed to persist', async () => {
    state.writeError = { message: 'cancellation denied' }
    await expect(cancelEngagement('ticket-1')).rejects.toThrow('cancellation denied')
    expect(state.write).toHaveBeenCalledWith({ status: 'cancelled' })
    expect(state.updateTicket).not.toHaveBeenCalled()
  })

  it('does not report an engagement closed when the close marker failed to persist', async () => {
    state.writeError = { message: 'close write failed' }
    await expect(markEngagementClosed('ticket-1', '2026-11-10T10:00:00.000Z')).rejects.toThrow('close write failed')
    expect(state.write).toHaveBeenCalledWith({ closed_at: '2026-11-10T10:00:00.000Z' })
  })
})
