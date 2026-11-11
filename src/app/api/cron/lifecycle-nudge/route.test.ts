import { beforeEach, describe, expect, it } from 'vitest'
import { memCreate, memGet, memReset } from '@/lib/data/memory-store'
import { israelStoresAsRows } from '@/modules/stores/israel-stores'
import { GET } from './route'

process.env.MAINTAINOS_FORCE_MEMORY = '1'
process.env.STORE_CONFIRM_NUDGE_HOURS = '4'

describe('lifecycle nudge', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    process.env.STORE_CONFIRM_NUDGE_HOURS = '4'
    memReset()
  })

  it('does not send a second nudge inside the window', async () => {
    const store = israelStoresAsRows().find((row) => row.code === '6006')
    if (!store) throw new Error('missing store')
    const created = memCreate({
      store,
      description: 'מזגן',
      priority: 'high',
      category: 'hvac',
      status: 'engaged',
      reporterPhone: '0501111111',
    })
    const row = memGet(created.id)
    if (!row) throw new Error('missing ticket')
    const old = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()
    row.updated_at = old
    row.resolved_at = old

    const first = await GET(new Request('http://localhost/api/cron/lifecycle-nudge'))
    const body1 = (await first.json()) as { nudged: number }
    expect(first.status).toBe(200)
    expect(body1.nudged).toBeGreaterThanOrEqual(1)
    const nudges = () =>
      memGet(created.id)?.events.filter((event) => event.event_type === 'lifecycle_nudge')
        .length ?? 0
    const messages = () => memGet(created.id)?.messages.length ?? 0
    expect(nudges()).toBe(1)
    const sent = messages()
    expect(sent).toBeGreaterThan(0)

    const second = await GET(new Request('http://localhost/api/cron/lifecycle-nudge'))
    const body2 = (await second.json()) as { nudged: number }
    expect(body2.nudged).toBe(0)
    expect(nudges()).toBe(1)
    expect(messages()).toBe(sent)
  })
})
