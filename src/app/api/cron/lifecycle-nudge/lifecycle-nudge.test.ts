import { beforeEach, describe, expect, it } from 'vitest'
import {
  assign,
  createTicket,
  updateStatus,
} from '@/modules/tickets/service'
import { DEMO_TECH_ID, memGet, memReset } from '@/lib/data/memory-store'
import { GET } from './route'

process.env.MAINTAINOS_FORCE_MEMORY = '1'
delete process.env.MAINTAINOS_WA_CONFIRM_REMINDERS_LIVE

describe('OC-22 confirm reminder ladder', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    delete process.env.MAINTAINOS_WA_CONFIRM_REMINDERS_LIVE
    memReset()
  })

  it('advances to level 4 after 24h in dry-run and stops after confirm', async () => {
    let ticket = await createTicket({
      storeCode: '172',
      description: 'נזילה לאישור',
      category: 'plumbing',
      priority: 'medium',
      source: 'demo',
      reporterPhone: '972501234567',
    })
    ticket = await assign(ticket.id, DEMO_TECH_ID)
    ticket = await updateStatus(ticket.id, 'in_progress', null)
    ticket = await updateStatus(ticket.id, 'resolved', null, {
      proofAlreadyAttached: true,
    })

    const mem = memGet(ticket.id)!
    mem.resolved_at = new Date(Date.now() - 25 * 3600_000).toISOString()
    mem.awaiting_store_confirm_since = mem.resolved_at
    mem.confirm_reminder_level = 0
    mem.store_confirmed_at = null

    const res = await GET(new Request('http://localhost/api/cron/lifecycle-nudge'))
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      nudged: number
      live: boolean
      levels: number[]
    }
    expect(json.ok).toBe(true)
    expect(json.live).toBe(false)
    expect(json.nudged).toBeGreaterThanOrEqual(1)
    expect(Math.max(...json.levels, 0)).toBe(4)
    expect(memGet(ticket.id)?.confirm_reminder_level).toBe(4)

    const confirmed = memGet(ticket.id)!
    confirmed.store_confirmed_at = new Date().toISOString()
    const again = await GET(
      new Request('http://localhost/api/cron/lifecycle-nudge'),
    )
    const againJson = (await again.json()) as { nudged: number }
    expect(againJson.nudged).toBe(0)
  })
})
