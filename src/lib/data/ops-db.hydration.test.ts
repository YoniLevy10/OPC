import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ready: vi.fn(), from: vi.fn(), replace: vi.fn(),
}))
vi.mock('@/lib/data/memory-store', () => ({ supabaseReady: mocks.ready }))
vi.mock('@/lib/supabase/system', () => ({ createSystemClient: () => ({ from: mocks.from }) }))
vi.mock('@/lib/data/ops-ledger', () => ({
  replacePersistedOps: mocks.replace, getDriveSync: vi.fn(), setDriveSync: vi.fn(),
  listDocuments: vi.fn(), listFiles: vi.fn(), listSpends: vi.fn(), listTasks: vi.fn(),
}))
vi.mock('fs', () => ({ existsSync: () => false, readFileSync: vi.fn(), writeFileSync: vi.fn() }))

import { hydrateOpsLedger } from './ops-db'

describe('ledger hydration status for operational empty states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ready.mockResolvedValue(true)
    mocks.from.mockImplementation(() => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }))
  })

  it('confirms a successful empty database load instead of treating all empty data as failure', async () => {
    expect(await hydrateOpsLedger()).toEqual({ ok: true, backend: 'supabase' })
    expect(mocks.replace).toHaveBeenCalledWith({ files: [], documents: [], spends: [], tasks: [] })
  })

  it('reports a single failed ledger source without replacing the prior snapshot', async () => {
    mocks.from.mockImplementation((table: string) => ({
      select: () => ({ order: () => Promise.resolve({ data: [], error: table === 'spend_requests' ? { message: 'connection lost' } : null }) }),
    }))
    expect(await hydrateOpsLedger()).toEqual({ ok: false, error: 'connection lost' })
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('reports missing tables as incomplete rather than a successful empty list', async () => {
    mocks.from.mockImplementation(() => ({ select: () => ({ order: () => Promise.resolve({ data: null, error: { code: '42P01', message: 'missing relation' } }) }) }))
    expect(await hydrateOpsLedger()).toMatchObject({ ok: false })
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('preserves thrown read failures so legacy write callers abort', async () => {
    mocks.from.mockImplementation(() => { throw new Error('read failed') })
    await expect(hydrateOpsLedger()).rejects.toThrow('read failed')
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('identifies an intentional memory backend separately', async () => {
    mocks.ready.mockResolvedValue(false)
    expect(await hydrateOpsLedger()).toEqual({ ok: true, backend: 'memory' })
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
