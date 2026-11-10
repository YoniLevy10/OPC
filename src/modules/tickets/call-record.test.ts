import { describe, expect, it } from 'vitest'
import { serviceCallRecord } from './call-record'

describe('serviceCallRecord', () => {
  it('keeps one call open until the store confirms', () => {
    const call = serviceCallRecord({
      store: 'אריאל',
      type: 'אינסטלציה',
      urgent: true,
      openedAt: '2026-11-01T08:00:00.000Z',
      events: [
        { event_type: 'service_visit_planned', created_at: '2026-11-01T09:00:00.000Z' },
        { event_type: 'engagement_locked', created_at: '2026-11-01T10:00:00.000Z' },
        { event_type: 'store_handoff', created_at: '2026-11-01T10:01:00.000Z' },
      ],
      professional: 'דני',
      phone: '0501234567',
      approvedPrice: 450,
    })
    expect(call.visits).toBe(1)
    expect(call.professional).toBe('דני')
    expect(call.approvedPrice).toBe(450)
    expect(call.closeMethod).toBe('פתוחה')
    expect(call.storeApproved).toBe(false)
    expect(call.decisions).toEqual(['ביקור תוכנן', 'מחיר ננעל', 'הודעה לחנות'])
  })

  it('records a manual close by Ari separately from a store approval', () => {
    const call = serviceCallRecord({
      store: 'חדרה',
      type: 'חשמל',
      urgent: false,
      openedAt: '2026-10-01T08:00:00.000Z',
      closedAt: '2026-10-02T08:00:00.000Z',
      events: [{ event_type: 'ari_manual_close', created_at: '2026-10-02T08:00:00.000Z' }],
    })
    expect(call.closeMethod).toBe('סגירה ידנית של ארי')
  })
})
