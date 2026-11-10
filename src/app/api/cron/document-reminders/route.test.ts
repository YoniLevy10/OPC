import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreDocument } from '@/modules/documents/rules'

const mocks = vi.hoisted(() => ({ documents: vi.fn(), recipients: vi.fn(), hydrate: vi.fn(), notify: vi.fn(), notifyAri: vi.fn(), probe: vi.fn(), select: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/data/ops-ledger', () => ({ listDocuments: mocks.documents, deskNotifyPhones: mocks.recipients }))
vi.mock('@/lib/data/ops-db', () => ({ hydrateOpsLedger: mocks.hydrate }))
vi.mock('@/modules/notify/ari', () => ({ notifyPhone: mocks.notify, notifyAri: mocks.notifyAri }))
vi.mock('@/lib/logging', () => ({ logEvent: vi.fn() }))
vi.mock('@/lib/supabase/system', () => ({ createSystemClient: () => ({ from: mocks.from }) }))

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
    mocks.notifyAri.mockResolvedValue({ ok: true, outcomes: [{ to: '0501234567', status: 'sent', messageId: 'summary-1', error: null }] })
    mocks.select.mockImplementation(() => ({ limit: mocks.probe }))
    mocks.from.mockImplementation(() => ({ select: mocks.select }))
    mocks.probe.mockRejectedValue(new Error('reminder schema unavailable'))
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
    expect(mocks.notifyAri).not.toHaveBeenCalled()
  })

  function runLive() {
    delete process.env.MAINTAINOS_FORCE_MEMORY
    process.env.CRON_SECRET = 'test-secret'
    return GET(new Request('http://localhost/api/cron/document-reminders', { headers: { authorization: 'Bearer test-secret' } }))
  }

  it.each(['42P01', 'PGRST205'])('preserves the daily aggregate only after a read-only missing-table response (%s)', async (code) => {
    mocks.probe.mockResolvedValue({ data: null, error: { code, message: 'missing table' } })
    const response = await runLive()
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, mode: 'legacy_daily_summary', phaseDeduplication: false, sent: 1, twoMonths: 1 })
    expect(mocks.select).toHaveBeenCalledWith('delivery_key', { head: true })
    expect(mocks.probe).toHaveBeenCalledWith(0)
    expect(mocks.notifyAri).toHaveBeenCalledWith('מסמכים / כיולים — חודשיים לפני (1)', { mode: 'legacy_daily_summary', phaseDeduplication: false })
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('preserves the old daily recurrence rather than pretending phases were durably deduplicated', async () => {
    mocks.probe.mockResolvedValue({ data: null, error: { code: '42P01', message: 'missing table' } })
    await runLive()
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'))
    expect(await (await runLive()).json()).toMatchObject({ mode: 'legacy_daily_summary', phaseDeduplication: false, alreadySent: 0, sent: 1 })
    expect(mocks.notifyAri).toHaveBeenCalledTimes(2)
  })

  it.each(['42501', 'PGRST202', '08006'])('does not use the legacy path for another database failure (%s)', async (code) => {
    mocks.probe.mockResolvedValue({ data: null, error: { code, message: 'database failed' } })
    expect((await runLive()).status).toBe(503)
    expect(mocks.notifyAri).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('never downgrades after an available-journal claim failure', async () => {
    mocks.probe.mockResolvedValue({ data: null, error: null })
    // The mock deliberately has no insert method: the claim fails after a
    // successful live read-only probe, which must not cause a legacy send.
    const response = await runLive()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, mode: 'phase_deduplicated', failed: 1 })
    expect(mocks.notifyAri).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('never sends a legacy fallback after provider acceptance followed by a journal write failure', async () => {
    mocks.probe.mockResolvedValue({ data: null, error: null })
    const failedWrite = {
      eq: () => failedWrite,
      select: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'journal write unavailable' } }) }),
    }
    mocks.from.mockImplementation(() => ({
      select: mocks.select,
      insert: () => ({ select: () => ({ maybeSingle: async () => ({ data: { delivery_key: 'claimed' }, error: null }) }) }),
      update: () => failedWrite,
    }))
    const response = await runLive()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, mode: 'phase_deduplicated', failed: 1, sent: 0 })
    expect(mocks.notify).toHaveBeenCalledOnce()
    expect(mocks.notifyAri).not.toHaveBeenCalled()
  })

  it('does not report a legacy summary accepted without provider message IDs', async () => {
    mocks.probe.mockResolvedValue({ data: null, error: { code: '42P01' } })
    mocks.notifyAri.mockResolvedValue({ ok: true, outcomes: [{ status: 'sent', messageId: ' ', error: null }] })
    const response = await runLive()
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, mode: 'legacy_daily_summary', sent: 0, failed: 1 })
  })

  it('keeps legacy dry runs distinct from provider acceptance', async () => {
    mocks.probe.mockResolvedValue({ data: null, error: { code: '42P01' } })
    mocks.notifyAri.mockResolvedValue({ ok: false, outcomes: [{ status: 'dry_run', messageId: null, error: null }] })
    expect(await (await runLive()).json()).toMatchObject({ ok: false, mode: 'legacy_daily_summary', sent: 0, dryRun: 1, failed: 0 })
  })

  it('reports a failed legacy send without attempting phase notifications', async () => {
    mocks.probe.mockResolvedValue({ data: null, error: { code: 'PGRST205' } })
    mocks.notifyAri.mockResolvedValue({ ok: false, outcomes: [{ status: 'failed', messageId: null, error: 'Meta unavailable' }] })
    expect((await runLive()).status).toBe(503)
    expect(mocks.notifyAri).toHaveBeenCalledOnce()
    expect(mocks.notify).not.toHaveBeenCalled()
  })

  it('requires a nonempty recipient result for a legacy summary', async () => {
    mocks.probe.mockResolvedValue({ data: null, error: { code: '42P01' } })
    mocks.notifyAri.mockResolvedValue({ ok: false, outcomes: [] })
    expect(await (await runLive()).json()).toMatchObject({ ok: false, sent: 0, failed: 1 })
  })

  it('aborts before the probe or fallback if live hydration failed', async () => {
    mocks.hydrate.mockResolvedValue({ ok: false, error: 'documents unavailable' })
    mocks.probe.mockResolvedValue({ data: null, error: { code: '42P01' } })
    expect((await runLive()).status).toBe(503)
    expect(mocks.probe).not.toHaveBeenCalled()
    expect(mocks.notifyAri).not.toHaveBeenCalled()
  })

  it('does not send an empty legacy summary and still identifies the compatibility mode', async () => {
    mocks.documents.mockReturnValue([])
    mocks.probe.mockResolvedValue({ data: null, error: { code: '42P01' } })
    expect(await (await runLive()).json()).toMatchObject({ ok: true, mode: 'legacy_daily_summary', phaseDeduplication: false, sent: 0 })
    expect(mocks.notifyAri).not.toHaveBeenCalled()
  })
})
