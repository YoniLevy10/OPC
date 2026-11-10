import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreDocument } from '@/modules/documents/rules'

const mocks = vi.hoisted(() => ({ documents: vi.fn(), recipients: vi.fn(), hydrate: vi.fn(), notify: vi.fn() }))
vi.mock('@/lib/data/ops-ledger', () => ({ listDocuments: mocks.documents, deskNotifyPhones: mocks.recipients }))
vi.mock('@/lib/data/ops-db', () => ({ hydrateOpsLedger: mocks.hydrate }))
vi.mock('@/modules/notify/ari', () => ({ notifyPhone: mocks.notify }))
vi.mock('@/lib/logging', () => ({ logEvent: vi.fn() }))
vi.mock('@/lib/supabase/system', () => ({ createSystemClient: () => { throw new Error('reminder schema unavailable') } }))

import { resetReminderDeliveriesForTests } from '@/modules/documents/reminder-deliveries'
import { GET } from './route'

function document(patch: Partial<StoreDocument> = {}): StoreDocument {
  return {
    id: 'doc', storeId: 'store', storeCode: '6006', storeName: 'Store', docType: 'hearing_a',
    sourceUrl: 'https://example.com/certificate.pdf', extractedExpiry: '2027-01-01T00:00:00Z',
    computedNextCheck: null, owner: 'Ari', intakeStatus: 'ingested', intakeReason: null,
    version: 1, previousId: null, renewed: false, createdAt: '2026-01-01T00:00:00Z', ...patch,
  }
}
function run() { return GET(new Request('http://localhost/api/cron/document-reminders')) }

describe('document reminder cron', () => {
  const previousMode = process.env.MAINTAINOS_FORCE_MEMORY
  const previousSecret = process.env.CRON_SECRET
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-10T12:00:00Z'))
    vi.clearAllMocks()
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    resetReminderDeliveriesForTests()
    mocks.documents.mockReturnValue([document()])
    mocks.recipients.mockReturnValue(['0501234567'])
    mocks.hydrate.mockResolvedValue({ ok: true, backend: 'supabase' })
    mocks.notify.mockResolvedValue({ status: 'sent', messageId: 'wa-1', error: null })
  })
  afterEach(() => {
    vi.useRealTimers()
    if (previousMode === undefined) delete process.env.MAINTAINOS_FORCE_MEMORY
    else process.env.MAINTAINOS_FORCE_MEMORY = previousMode
    if (previousSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = previousSecret
  })

  it('sends one reminder per document phase and does not repeat it daily', async () => {
    const first = await run()
    expect(await first.json()).toMatchObject({ ok: true, sent: 1, failed: 0, twoMonths: 1 })
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
    expect(await (await run()).json()).toMatchObject({ ok: true, sent: 0, alreadySent: 1 })
    expect(mocks.notify).toHaveBeenCalledOnce()
    // Moving to the next phase creates a different reminder, still once only.
    vi.setSystemTime(new Date('2026-12-10T12:00:00Z'))
    expect(await (await run()).json()).toMatchObject({ sent: 1 })
    expect(await (await run()).json()).toMatchObject({ sent: 0, alreadySent: 1 })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
  })

  it('returns failure and retries a failed send until provider acceptance is recorded', async () => {
    mocks.notify.mockResolvedValueOnce({ status: 'failed', messageId: null, error: 'Meta unavailable' })
    const failed = await run()
    expect(failed.status).toBe(503)
    expect(await failed.json()).toMatchObject({ ok: false, sent: 0, failed: 1 })
    expect(await (await run()).json()).toMatchObject({ ok: true, sent: 1 })
    expect(await (await run()).json()).toMatchObject({ sent: 0, alreadySent: 1 })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
  })

  it('retries only the failed recipient after partial success', async () => {
    mocks.recipients.mockReturnValue(['0501234567', '0507654321'])
    mocks.notify.mockResolvedValueOnce({ status: 'sent', messageId: 'wa-1', error: null })
      .mockResolvedValueOnce({ status: 'failed', messageId: null, error: 'failed' })
    expect((await run()).status).toBe(503)
    expect(await (await run()).json()).toMatchObject({ ok: true, alreadySent: 1, sent: 1 })
    expect(mocks.notify).toHaveBeenCalledTimes(3)
    expect(mocks.notify.mock.calls[2][0]).toBe('0507654321')
  })

  it('does not treat dry runs as real successful sends or suppress later retries', async () => {
    mocks.notify.mockResolvedValue({ status: 'dry_run', messageId: null, error: null })
    expect(await (await run()).json()).toMatchObject({ ok: false, sent: 0, dryRun: 1 })
    expect(await (await run()).json()).toMatchObject({ ok: false, alreadySent: 0, dryRun: 1 })
    expect(mocks.notify).toHaveBeenCalledTimes(2)
  })

  it('does not send for renewed or failed documents', async () => {
    mocks.documents.mockReturnValue([document({ renewed: true }), document({ id: 'failed', intakeStatus: 'failed' })])
    expect(await (await run()).json()).toMatchObject({ ok: true, sent: 0 })
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('routes an invalid legacy expiry to review without blocking other documents', async () => {
    mocks.documents.mockReturnValue([document({ id: 'invalid', extractedExpiry: 'bad-date' }), document()])
    expect(await (await run()).json()).toMatchObject({ ok: true, sent: 2 })
    expect(mocks.notify.mock.calls[0][2]).toMatchObject({ documentId: 'invalid', dueAt: null, stage: 'review' })
  })

  it('does not report a data-loading failure as success', async () => {
    mocks.hydrate.mockResolvedValue({ ok: false, error: 'database down' })
    expect((await run()).status).toBe(503)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('refuses memory fallback and missing schema outside explicit memory mode', async () => {
    delete process.env.MAINTAINOS_FORCE_MEMORY
    process.env.CRON_SECRET = 'test-secret'
    mocks.hydrate.mockResolvedValue({ ok: true, backend: 'memory' })
    const response = await GET(new Request('http://localhost/api/cron/document-reminders', {
      headers: { authorization: 'Bearer test-secret' },
    }))
    expect(response.status).toBe(503)
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('requires the cron secret outside explicit memory mode', async () => {
    delete process.env.MAINTAINOS_FORCE_MEMORY
    delete process.env.CRON_SECRET
    expect((await run()).status).toBe(401)
    expect(mocks.hydrate).not.toHaveBeenCalled()
  })

  it('returns 503 without sending when the persistent journal is unavailable', async () => {
    delete process.env.MAINTAINOS_FORCE_MEMORY
    process.env.CRON_SECRET = 'test-secret'
    const response = await GET(new Request('http://localhost/api/cron/document-reminders', {
      headers: { authorization: 'Bearer test-secret' },
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, failed: 1, sent: 0 })
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})
