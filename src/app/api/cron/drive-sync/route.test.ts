import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ hydrate: vi.fn(), sync: vi.fn(), persist: vi.fn() }))
vi.mock('@/lib/data/ops-db', () => ({ hydrateOpsLedger: mocks.hydrate, persistOpsLedger: mocks.persist }))
vi.mock('@/lib/data/ops-ledger', () => ({ getDriveSync: () => ({ rootFolderId: 'folder' }) }))
vi.mock('@/modules/drive/folder', () => ({ driveCanWrite: () => true }))
vi.mock('@/modules/drive/sync', () => ({ syncDriveFolder: mocks.sync }))
vi.mock('@/modules/notify/ari', () => ({ notifyAri: vi.fn() }))
vi.mock('@/lib/logging', () => ({ logEvent: vi.fn() }))
import { GET } from './route'

afterEach(() => vi.unstubAllEnvs())

describe('drive sync never writes a stale operational ledger after read failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MAINTAINOS_FORCE_MEMORY', '1')
    mocks.hydrate.mockResolvedValue({ ok: true, backend: 'memory' })
    mocks.sync.mockResolvedValue({ pulled: 0, review: 0, pushed: 0 })
  })
  it.each(['returned failure', 'thrown failure'])('aborts before sync or persistence on %s', async (mode) => {
    if (mode === 'thrown failure') mocks.hydrate.mockRejectedValue(new Error('read failure'))
    else mocks.hydrate.mockResolvedValue({ ok: false, error: 'read failure' })
    const response = await GET(new Request('http://localhost/api/cron/drive-sync'))
    expect(response.status).toBe(503)
    expect(mocks.sync).not.toHaveBeenCalled()
    expect(mocks.persist).not.toHaveBeenCalled()
  })
  it('continues a fully loaded explicit memory test without hiding failures', async () => {
    expect((await GET(new Request('http://localhost/api/cron/drive-sync'))).status).toBe(200)
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith('folder')
    expect(mocks.persist).toHaveBeenCalledOnce()
  })
})
