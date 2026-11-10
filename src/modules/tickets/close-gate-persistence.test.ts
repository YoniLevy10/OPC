import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  stamp: null as string | null,
  readError: null as { message: string } | null,
  writeResults: [] as { data: unknown; error: { message: string; code?: string } | null }[],
  updates: vi.fn(),
  guards: vi.fn(),
  events: vi.fn(),
}))

vi.mock('@/lib/data/memory-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/data/memory-store')>(),
  supabaseReady: async () => true,
}))
vi.mock('@/lib/supabase/system', () => ({
  createSystemClient: () => ({
    from: (table: string) => {
      if (table === 'ticket_events') return {
        insert: (event: unknown) => {
          db.events(event)
          return { select: () => ({ single: async () => ({ data: event, error: null }) }) }
        },
      }
      return {
        select: (columns: string) => ({
          eq: () => ({
            maybeSingle: async () => columns === 'store_confirmed_at'
              ? { data: { store_confirmed_at: db.stamp }, error: db.readError }
              : { data: { id: 'ticket', status: 'engaged', assigned_to: null }, error: null },
          }),
        }),
        update: (patch: unknown) => {
          db.updates(patch)
          const chain = {
            eq: () => chain,
            not: (...args: unknown[]) => { db.guards(...args); return chain },
            select: () => ({ single: async () => db.writeResults.shift() ?? { data: { id: 'ticket', status: 'closed' }, error: null } }),
          }
          return chain
        },
      }
    },
  }),
}))

import { STORE_CONFIRMATION_REQUIRED_HE, updateStatus } from './service'

describe('persistent final-closure guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.stamp = null
    db.readError = null
    db.writeResults = []
  })

  it('does not mutate a ticket without persisted store feedback', async () => {
    await expect(updateStatus('ticket', 'closed')).rejects.toThrow(STORE_CONFIRMATION_REQUIRED_HE)
    expect(db.updates).not.toHaveBeenCalled()
    expect(db.events).not.toHaveBeenCalled()
  })

  it('fails closed when the feedback read fails', async () => {
    db.readError = { message: 'confirmation column unavailable' }
    await expect(updateStatus('ticket', 'closed')).rejects.toThrow('confirmation column unavailable')
    expect(db.updates).not.toHaveBeenCalled()
  })

  it('keeps the confirmation condition on the status write after a successful read', async () => {
    db.stamp = '2026-11-10T12:00:00Z'
    expect((await updateStatus('ticket', 'closed')).status).toBe('closed')
    expect(db.guards).toHaveBeenCalledExactlyOnceWith('store_confirmed_at', 'is', null)
  })

  it('keeps the confirmation condition when retrying a lean legacy-schema write', async () => {
    db.stamp = '2026-11-10T12:00:00Z'
    db.writeResults = [
      { data: null, error: { code: '42703', message: 'column quality_hold_until does not exist' } },
      { data: { id: 'ticket', status: 'closed' }, error: null },
    ]
    expect((await updateStatus('ticket', 'closed')).status).toBe('closed')
    expect(db.guards).toHaveBeenCalledTimes(2)
    expect(db.guards).toHaveBeenNthCalledWith(2, 'store_confirmed_at', 'is', null)
  })
})
