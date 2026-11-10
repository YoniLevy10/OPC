import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ready: vi.fn(), notify: vi.fn(), from: vi.fn(), record: vi.fn(), memoryList: vi.fn(),
  candidates: [] as Array<Record<string, unknown>>,
  events: [] as Array<{ event_type: string; created_at: string; payload?: unknown }>,
  store: {} as Record<string, unknown> | null,
  ticketError: null as null | { message: string },
  historyError: null as null | { message: string },
  storeError: null as null | { message: string },
  writeError: null as null | { message: string },
  queries: [] as Array<{ table: string; field: string; value: unknown }>,
}))

vi.mock('@/lib/data/memory-store', () => ({
  supabaseReady: mocks.ready,
  memListTickets: mocks.memoryList,
  memGet: (id: string) => ({ ...mocks.candidates.find((candidate) => candidate.id === id), events: mocks.events }),
  memFindStoreById: () => mocks.store,
  memAddEvent: (...args: unknown[]) => {
    mocks.record(...args)
    mocks.events.push({ event_type: String(args[1]), payload: args[2], created_at: new Date().toISOString() })
  },
}))
vi.mock('@/lib/supabase/system', () => ({ createSystemClient: () => ({ from: mocks.from }) }))
vi.mock('@/modules/notify/ari', () => ({ notifyPhone: mocks.notify }))
vi.mock('@/lib/monitoring', () => ({ captureError: vi.fn() }))
vi.mock('@/lib/logging', () => ({ logEvent: vi.fn() }))

import { GET } from './route'

const NOW = new Date('2026-11-10T12:00:00Z')
const ORG = 'org-1'
const MANAGER = '0541234567'
const ARI = '0509881951'

function candidate(patch: Record<string, unknown> = {}) {
  return {
    id: 'fault-1', organization_id: ORG, store_id: 'store-1', status: 'resolved',
    resolved_at: '2026-11-10T06:00:00Z', updated_at: '2026-11-10T11:59:00Z', store_confirmed_at: null,
    display_number: 'OC-99', number: 99, reporter_phone: ARI, ...patch,
  }
}

function live() { delete process.env.MAINTAINOS_FORCE_MEMORY }
function run(authorized = true) {
  return GET(new Request('https://opc.example/api/cron/lifecycle-nudge', {
    headers: authorized ? { authorization: 'Bearer cron-test' } : {},
  }))
}

describe('store feedback lifecycle nudge guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.clearAllMocks()
    vi.stubEnv('MAINTAINOS_FORCE_MEMORY', '1')
    vi.stubEnv('CRON_SECRET', 'cron-test')
    vi.stubEnv('STORE_CONFIRM_NUDGE_HOURS', '4')
    vi.stubEnv('APP_URL', 'https://opc.example')
    mocks.candidates.splice(0, mocks.candidates.length, candidate())
    mocks.events.splice(0)
    mocks.queries.splice(0)
    mocks.store = { id: 'store-1', organization_id: ORG, manager_phone: MANAGER, name: 'החנות' }
    mocks.ticketError = mocks.historyError = mocks.storeError = mocks.writeError = null
    mocks.ready.mockResolvedValue(true)
    mocks.memoryList.mockImplementation(() => mocks.candidates)
    mocks.notify.mockResolvedValue({ status: 'sent', messageId: 'wa-accepted', error: null })
    mocks.from.mockImplementation((table: string) => {
      const query = {
        select: () => query,
        eq: (field: string, value: unknown) => { mocks.queries.push({ table, field, value }); return query },
        not: () => query,
        is: () => query,
        gte: () => query,
        limit: () => Promise.resolve(table === 'tickets'
          ? { data: mocks.candidates, error: mocks.ticketError }
          : { data: mocks.events, error: mocks.historyError }),
        maybeSingle: () => Promise.resolve({ data: mocks.store, error: mocks.storeError }),
        insert: (row: { payload: unknown }) => ({ select: () => ({ single: () => {
          mocks.record(row)
          if (!mocks.writeError) mocks.events.push({ event_type: 'lifecycle_nudge', created_at: NOW.toISOString(), payload: row.payload })
          return Promise.resolve({ data: mocks.writeError ? null : { id: 'event-1' }, error: mocks.writeError })
        } }) }),
      }
      return query
    })
  })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })

  it('never requests confirmation for an approved visit before work completion', async () => {
    mocks.candidates.splice(0, 1, candidate({ status: 'engaged', resolved_at: null, updated_at: '2026-11-01T00:00:00Z' }))
    expect(await (await run()).json()).toMatchObject({ nudged: 0, failed: 0 })
    expect(mocks.notify).not.toHaveBeenCalled()
    live()
    // Defense in depth if a backend returns an unexpected engaged row.
    expect(await (await run()).json()).toMatchObject({ nudged: 0, skipped: 1 })
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.queries).toContainEqual({ table: 'tickets', field: 'status', value: 'resolved' })
  })

  it.each([null, '', 'bad-date'])('requires a real execution timestamp, not updated_at (%s)', async (resolved_at) => {
    mocks.candidates.splice(0, 1, candidate({ resolved_at, updated_at: '2026-11-01T00:00:00Z' }))
    expect(await (await run()).json()).toMatchObject({ nudged: 0, skipped: 1 })
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('waits four hours from recorded completion even if an older update exists', async () => {
    mocks.candidates.splice(0, 1, candidate({ resolved_at: '2026-11-10T11:00:00Z', updated_at: '2026-11-01T00:00:00Z' }))
    expect(await (await run()).json()).toMatchObject({ nudged: 0, skipped: 1 })
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('sends to the current store manager, never to Ari who originally opened the ticket', async () => {
    expect(await (await run()).json()).toMatchObject({ ok: true, nudged: 1, failed: 0 })
    expect(mocks.notify).toHaveBeenCalledWith('972541234567', expect.stringContaining('/store/tickets/fault-1'), expect.objectContaining({ recipientRole: 'store_manager' }), true)
    expect(mocks.notify.mock.calls[0][0]).not.toBe(ARI)
    expect(mocks.record).toHaveBeenCalledWith('fault-1', 'lifecycle_nudge', expect.objectContaining({ providerMessageId: 'wa-accepted', resolvedAt: '2026-11-10T06:00:00Z' }), null)
  })

  it('does not resend a successfully recorded nudge in the cooldown window', async () => {
    await run()
    expect(await (await run()).json()).toMatchObject({ nudged: 0, skipped: 1 })
    expect(mocks.notify).toHaveBeenCalledOnce()
  })

  it('does not suppress a later completion episode using the previous execution reminder', async () => {
    mocks.candidates.splice(0, 1, candidate({ resolved_at: '2026-11-10T07:30:00Z' }))
    mocks.events.push({ event_type: 'lifecycle_nudge', created_at: '2026-11-10T07:00:00Z' })
    expect(await (await run()).json()).toMatchObject({ nudged: 1 })
  })

  it('does not request feedback again after the manager has confirmed', async () => {
    mocks.candidates.splice(0, 1, candidate({ store_confirmed_at: '2026-11-10T10:00:00Z' }))
    expect(await (await run()).json()).toMatchObject({ nudged: 0 })
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it.each([null, '', 'bad'])('does not fall back to the reporter when manager contact is missing (%s)', async (manager_phone) => {
    mocks.store = { ...mocks.store, manager_phone }
    const response = await run()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, nudged: 0, failed: 1 })
    expect(mocks.notify).not.toHaveBeenCalled()
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('checks that the responsible store belongs to the ticket organization', async () => {
    mocks.store = { ...mocks.store, organization_id: 'different-org' }
    expect((await run()).status).toBe(503)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('retries a failed send and records success only after acceptance', async () => {
    mocks.notify.mockResolvedValueOnce({ status: 'failed', messageId: null, error: 'Meta down' })
    expect((await run()).status).toBe(503)
    expect(mocks.record).not.toHaveBeenCalled()
    expect(await (await run()).json()).toMatchObject({ nudged: 1, failed: 0 })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    expect(mocks.record).toHaveBeenCalledOnce()
  })

  it('does not report or record dry runs as delivered reminders', async () => {
    mocks.notify.mockResolvedValue({ status: 'dry_run', messageId: null, error: null })
    expect(await (await run()).json()).toMatchObject({ ok: false, nudged: 0, dryRun: 1 })
    expect(await (await run()).json()).toMatchObject({ nudged: 0, dryRun: 1 })
    expect(mocks.record).not.toHaveBeenCalled()
    expect(mocks.notify).toHaveBeenCalledTimes(2)
  })

  it('requires a provider message ID even if a notifier claims sent', async () => {
    mocks.notify.mockResolvedValue({ status: 'sent', messageId: null, error: null })
    expect(await (await run()).json()).toMatchObject({ ok: false, failed: 1, nudged: 0 })
    expect(mocks.record).not.toHaveBeenCalled()
  })

  it('reads the current manager by store ID and organization from the configured database', async () => {
    live()
    expect(await (await run()).json()).toMatchObject({ nudged: 1 })
    expect(mocks.memoryList).not.toHaveBeenCalled()
    expect(mocks.queries).toContainEqual({ table: 'stores', field: 'id', value: 'store-1' })
    expect(mocks.queries).toContainEqual({ table: 'stores', field: 'organization_id', value: ORG })
    expect(mocks.notify.mock.calls[0][0]).toBe('972541234567')
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ providerMessageId: 'wa-accepted' }) }))
  })

  it('fails closed when the configured database is unavailable instead of reading demo tickets', async () => {
    live()
    mocks.ready.mockResolvedValue(false)
    expect((await run()).status).toBe(503)
    expect(mocks.memoryList).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('does not fall back to memory after a ticket query error', async () => {
    live()
    mocks.ticketError = { message: 'DB failed' }
    expect((await run()).status).toBe(503)
    expect(mocks.memoryList).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('does not send if successful-reminder history cannot be checked', async () => {
    live()
    mocks.historyError = { message: 'history unavailable' }
    expect(await (await run()).json()).toMatchObject({ failed: 1, nudged: 0 })
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('does not claim a recorded nudge when the event write fails after provider acceptance', async () => {
    live()
    mocks.writeError = { message: 'write failed' }
    expect(await (await run()).json()).toMatchObject({ ok: false, nudged: 0, failed: 1 })
    expect(mocks.notify).toHaveBeenCalledOnce()
    expect(mocks.events).toHaveLength(0)
  })

  it('requires the cron secret outside explicit memory mode', async () => {
    live()
    expect((await run(false)).status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
