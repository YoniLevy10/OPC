import { describe, expect, it } from 'vitest'
import { detectLifecycleIssues } from './lifecycle-invariants'
import type { LifecycleSnapshot } from './lifecycle-invariants'

const base = {
  spends: [], visits: [], engagements: [], tickets: [],
  now: new Date('2026-11-11T12:00:00Z'),
} as unknown as LifecycleSnapshot

describe('detectLifecycleIssues', () => {
  it('detects each requested broken workflow state', () => {
    const snapshot: LifecycleSnapshot = {
      ...base,
      spends: [{ id: 's1', status: 'approved', needsReapproval: false, ticketId: 't1' } as LifecycleSnapshot['spends'][number]],
      engagements: [{ id: 'e1', ticketId: 't2', bundledTicketIds: [], status: 'locked' } as unknown as LifecycleSnapshot['engagements'][number]],
      visits: [{ id: 'v1', ticket_ids: ['t3'], status: 'partial', created_at: '2026-11-09T00:00:00Z', items: [] } as unknown as LifecycleSnapshot['visits'][number]],
      tickets: [
        { id: 't1', status: 'new', events: [] },
        { id: 't2', status: 'engaged', events: [] },
        { id: 't3', status: 'new', events: [] },
        { id: 't4', status: 'engaged', events: [] },
      ] as unknown as LifecycleSnapshot['tickets'],
    }
    expect(detectLifecycleIssues(snapshot).map((issue) => issue.code)).toEqual([
      'approved_spend_without_visit', 'locked_engagement_without_handoff',
      'partial_visit_stuck', 'ticket_engagement_status_mismatch',
    ])
  })

  it('does not flag approved spend with an intentional planned visit and no vendor', () => {
    const snapshot: LifecycleSnapshot = {
      ...base,
      spends: [{ id: 's1', status: 'approved', needsReapproval: false, ticketId: 't1' } as LifecycleSnapshot['spends'][number]],
      visits: [{ id: 'v1', ticket_ids: ['t1'], status: 'planned', vendor_id: null, items: [] } as unknown as LifecycleSnapshot['visits'][number]],
    }
    expect(detectLifecycleIssues(snapshot).filter((issue) => issue.code === 'approved_spend_without_visit')).toEqual([])
  })

  it('treats a successful outcome/handoff and matching status as reconciled', () => {
    const snapshot: LifecycleSnapshot = {
      ...base,
      spends: [{ id: 's1', status: 'approved', needsReapproval: false, ticketId: 't1' } as LifecycleSnapshot['spends'][number]],
      visits: [{ id: 'v1', ticket_ids: ['t1'], status: 'dispatched', items: [{ ticket_id: 't1', status: 'sent' }] } as unknown as LifecycleSnapshot['visits'][number]],
      engagements: [{ id: 'e1', ticketId: 't2', bundledTicketIds: [], status: 'locked', handoff: { ok: true, line: 'sent' } } as unknown as LifecycleSnapshot['engagements'][number]],
      tickets: [{ id: 't2', status: 'engaged', events: [] }] as unknown as LifecycleSnapshot['tickets'],
    }
    expect(detectLifecycleIssues(snapshot)).toEqual([])
  })
})
