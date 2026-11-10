import { beforeEach, describe, expect, it } from 'vitest'
import { memCreate, memGet, memReset } from '@/lib/data/memory-store'
import { israelStoresAsRows } from '@/modules/stores/israel-stores'
import { GET } from './route'

describe('legacy store-feedback closure reconciliation', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    memReset()
  })

  it('closes already-confirmed legacy rows without waiting for the follow-up date, and leaves others open', async () => {
    const store = israelStoresAsRows().find((row) => row.code === '6006')!
    const confirmed = memCreate({ store, description: 'תיקון שאושר בעבר', category: 'hvac', priority: 'medium', status: 'resolved' })
    const pending = memCreate({ store, description: 'תיקון ללא אישור חנות', category: 'hvac', priority: 'medium', status: 'resolved' })
    const approvedOnly = memCreate({ store, description: 'הוזמנה עבודה בלבד', category: 'hvac', priority: 'medium', status: 'engaged' })
    const stored = memGet(confirmed.id)!
    stored.store_confirmed_at = new Date().toISOString()
    stored.store_confirmed_by = 'מנהל החנות'
    stored.quality_hold_until = '2099-12-31T12:00:00Z'
    memGet(pending.id)!.quality_hold_until = '2020-01-01T00:00:00Z'

    const response = await GET(new Request('http://localhost/api/cron/quality-hold-close'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, closed: 1, failed: 0 })
    expect(memGet(confirmed.id)?.status).toBe('closed')
    expect(memGet(pending.id)?.status).toBe('resolved')
    expect(memGet(approvedOnly.id)?.status).toBe('engaged')
  })
})
