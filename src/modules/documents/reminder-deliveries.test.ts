import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ rows: new Map<string, Record<string, unknown>>(), unavailable: false }))
vi.mock('@/lib/supabase/system', () => ({
  createSystemClient: () => ({ from: () => {
    let operation = 'read'
    let values: Record<string, unknown> = {}
    const filters: [string, unknown][] = []
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filters.push([column, value]); return query },
      insert: (row: Record<string, unknown>) => { operation = 'insert'; values = row; return query },
      update: (row: Record<string, unknown>) => { operation = 'update'; values = row; return query },
      maybeSingle: async () => {
        if (db.unavailable) return { data: null, error: { code: '42P01', message: 'document_reminder_deliveries missing' } }
        if (operation === 'insert') {
          const key = String(values.delivery_key)
          if (db.rows.has(key)) return { data: null, error: { code: '23505', message: 'duplicate key' } }
          db.rows.set(key, { ...values })
          return { data: { ...values }, error: null }
        }
        const row = [...db.rows.values()].find((row) => filters.every(([key, value]) => row[key] === value))
        if (!row) return { data: null, error: null }
        if (operation === 'update') Object.assign(row, values)
        return { data: { ...row }, error: null }
      },
    }
    return query
  } }),
}))

import { claimDocumentReminder, finishDocumentReminder, reminderDeliveryKey, resetReminderDeliveriesForTests, type ReminderIdentity } from './reminder-deliveries'

describe('document reminder delivery journal', () => {
  const identity: ReminderIdentity = { documentId: 'doc', version: 1, dueAt: '2027-02-01T00:00:00.000Z', stage: 'two', recipient: '0501234567' }
  const now = new Date('2026-12-01T10:00:00Z')
  const previousMode = process.env.MAINTAINOS_FORCE_MEMORY
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    resetReminderDeliveriesForTests()
    db.rows.clear()
    db.unavailable = false
  })
  afterEach(() => {
    if (previousMode === undefined) delete process.env.MAINTAINOS_FORCE_MEMORY
    else process.env.MAINTAINOS_FORCE_MEMORY = previousMode
  })

  it('deduplicates successful sends across days for one phase and recipient', async () => {
    const reserved = await claimDocumentReminder(identity, now)
    if (reserved.status !== 'claimed') throw new Error('not claimed')
    await finishDocumentReminder(reserved.claim, { status: 'sent', messageId: 'wa-1', error: null }, now)
    expect(await claimDocumentReminder(identity, new Date('2026-12-05T10:00:00Z'))).toEqual({ status: 'sent' })
    expect(reminderDeliveryKey(identity)).toBe(reminderDeliveryKey({ ...identity, recipient: '+972501234567' }))
  })

  it('retries failures and dry runs without marking them sent', async () => {
    for (const status of ['failed', 'dry_run'] as const) {
      const reserved = await claimDocumentReminder(identity, now)
      if (reserved.status !== 'claimed') throw new Error('not claimed')
      await finishDocumentReminder(reserved.claim, { status, messageId: null, error: 'not sent' }, now)
    }
    expect((await claimDocumentReminder(identity, now)).status).toBe('claimed')
  })

  it('claims only once concurrently and reclaims abandoned leases', async () => {
    const [first, second] = await Promise.all([claimDocumentReminder(identity, now), claimDocumentReminder(identity, now)])
    expect(first.status).toBe('claimed')
    expect(second.status).toBe('busy')
    const retried = await claimDocumentReminder(identity, new Date(now.getTime() + 6 * 60_000))
    expect(retried.status).toBe('claimed')
    if (first.status !== 'claimed') throw new Error('not claimed')
    await expect(finishDocumentReminder(first.claim, { status: 'sent', messageId: 'stale', error: null }, now)).rejects.toThrow('reminder_lease_lost')
  })

  it('allows distinct phases, versions, expiries and recipients', () => {
    const keys = [
      identity, { ...identity, stage: 'overdue' as const }, { ...identity, version: 2 },
      { ...identity, dueAt: '2028-02-01T00:00:00Z' }, { ...identity, recipient: '0507654321' },
    ].map(reminderDeliveryKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('fails closed on missing production schema rather than using memory', async () => {
    delete process.env.MAINTAINOS_FORCE_MEMORY
    db.unavailable = true
    await expect(claimDocumentReminder(identity, now)).rejects.toThrow('document_reminder_deliveries missing')
  })

  it('uses a unique persistent claim and saves acceptance evidence before deduplicating', async () => {
    delete process.env.MAINTAINOS_FORCE_MEMORY
    const [first, concurrent] = await Promise.all([claimDocumentReminder(identity, now), claimDocumentReminder(identity, now)])
    expect(first.status).toBe('claimed')
    expect(concurrent.status).toBe('busy')
    if (first.status !== 'claimed') throw new Error('not claimed')
    await finishDocumentReminder(first.claim, { status: 'sent', messageId: 'wa-persisted', error: null }, now)
    expect(db.rows.get(first.claim.key)).toMatchObject({ status: 'sent', provider_message_id: 'wa-persisted', attempts: 1, sent_at: now.toISOString() })
    expect(await claimDocumentReminder(identity, new Date('2026-12-05T10:00:00Z'))).toEqual({ status: 'sent' })
  })

  it('retries a failed persistent record with a new token and records the next attempt', async () => {
    delete process.env.MAINTAINOS_FORCE_MEMORY
    const first = await claimDocumentReminder(identity, now)
    if (first.status !== 'claimed') throw new Error('not claimed')
    await finishDocumentReminder(first.claim, { status: 'failed', messageId: null, error: 'Meta timeout' }, now)
    const retried = await claimDocumentReminder(identity, now)
    if (retried.status !== 'claimed') throw new Error('not reclaimed')
    expect(retried.claim.token).not.toBe(first.claim.token)
    expect(db.rows.get(first.claim.key)).toMatchObject({ status: 'sending', attempts: 2 })
    await expect(finishDocumentReminder(first.claim, { status: 'sent', messageId: 'stale', error: null }, now)).rejects.toThrow('reminder_lease_lost')
    await finishDocumentReminder(retried.claim, { status: 'sent', messageId: 'wa-retry', error: null }, now)
    expect(db.rows.get(first.claim.key)).toMatchObject({ status: 'sent', attempts: 2 })
  })
})
