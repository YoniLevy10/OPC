import { beforeEach, describe, expect, it } from 'vitest'
import { memGet, memListDispatches, memReset } from '@/lib/data/memory-store'
import { confirmStoreFix } from '@/modules/tickets/store-confirm'
import { createTicket, updateStatus } from '@/modules/tickets/service'
import { createServiceVisit, memResetVisits } from '@/modules/visits/service'
import { lockEngagement, resetEngagementsForTests } from './service'

process.env.MAINTAINOS_FORCE_MEMORY = '1'

describe('OPC main path in memory', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    memReset()
    memResetVisits()
    resetEngagementsForTests()
  })

  it('plans a visit, locks a real price, and closes only after the store', async () => {
    const opened = await createTicket({
      storeCode: '6006',
      description: 'המזגן לא מקרר',
      category: 'hvac',
      priority: 'high',
      source: 'web_fallback',
      reporterName: 'חנות',
    })
    expect(opened.status).toBe('new')

    const visit = await createServiceVisit({
      storeId: opened.store_id,
      ticketIds: [opened.id],
      idempotencyKey: 'process-plan-1',
    })
    expect(visit.status).toBe('planned')
    expect(visit.vendor_id).toBeNull()
    expect(visit.dispatch_ids).toHaveLength(0)
    expect(memListDispatches()).toHaveLength(0)
    expect(memGet(opened.id)?.status).not.toBe('engaged')

    const locked = await lockEngagement({
      ticketId: opened.id,
      professionalName: 'פבל',
      professionalPhone: '0501234567',
      approvedAmount: 0,
      approvedBy: 'ארי',
    })
    expect(locked.approvedAmount).toBe(0)
    expect(locked.handoff?.ok).toBe(false)
    expect(memGet(opened.id)?.messages.some((message) => message.body?.includes('מחיר שאושר'))).toBe(false)
    expect(locked.handoff?.line ?? '').not.toMatch(/קיבל/)
    expect(memGet(opened.id)?.status).toBe('engaged')

    await expect(
      updateStatus(opened.id, 'closed', 'country', {
        ariManualClose: true,
        overrideReason: 'בלי חנות',
        actorRoles: ['country_manager'],
      }),
    ).rejects.toThrow(/אישור מנהל החנות/)
    await expect(
      updateStatus(opened.id, 'closed', 'region', {
        ariManualClose: true,
        overrideReason: 'בלי חנות',
        actorRoles: ['regional_manager'],
      }),
    ).rejects.toThrow(/אישור מנהל החנות/)
    expect(memGet(opened.id)?.status).toBe('engaged')

    const confirmed = await confirmStoreFix({
      ticketId: opened.id,
      actorLabel: 'מנהל חנות',
    })
    expect(confirmed.status).toBe('closed')
    expect(memGet(opened.id)?.status).toBe('closed')
    expect(memGet(opened.id)?.store_confirmed_at).toBeTruthy()
  })

  it('lets Ari close an engaged fault with a reason before the store confirms', async () => {
    const opened = await createTicket({
      storeCode: '6006',
      description: 'דלת לא נסגרת',
      category: 'other',
      priority: 'medium',
      source: 'web_fallback',
    })
    await lockEngagement({
      ticketId: opened.id,
      professionalName: 'דני',
      professionalPhone: '0501234567',
      approvedAmount: 180,
      approvedBy: 'ארי',
    })
    const closed = await updateStatus(opened.id, 'closed', 'ari', {
      ariManualClose: true,
      overrideReason: 'החנות לא זמינה',
      actorRoles: ['global_maintenance'],
    })
    expect(closed.status).toBe('closed')
    expect(
      memGet(opened.id)?.events.some((event) => event.event_type === 'ari_manual_close'),
    ).toBe(true)
  })
})
