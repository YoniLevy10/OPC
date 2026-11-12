import { describe, expect, it } from 'vitest'
import { phraseEvent } from './activity-log'

describe('phraseEvent', () => {
  it('describes ticket creation with source', () => {
    expect(
      phraseEvent({
        id: '1',
        ticket_id: 't1',
        ticket_display: 'OC-1',
        event_type: 'created',
        actor_id: null,
        payload: { source: 'whatsapp' },
        created_at: new Date().toISOString(),
      }),
    ).toContain('וואטסאפ')
  })

  it('describes engagement lock with professional', () => {
    expect(
      phraseEvent({
        id: '2',
        ticket_id: 't1',
        ticket_display: 'OC-1',
        event_type: 'engagement_locked',
        actor_id: null,
        payload: {
          professionalName: 'פבל',
          professionalPhone: '0501234567',
        },
        created_at: new Date().toISOString(),
      }),
    ).toMatch(/פבל/)
  })

  it('describes status transition', () => {
    expect(
      phraseEvent({
        id: '3',
        ticket_id: 't1',
        ticket_display: 'OC-1',
        event_type: 'status_changed',
        actor_id: null,
        payload: { from: 'new', to: 'engaged' },
        created_at: new Date().toISOString(),
      }),
    ).toMatch(/→/)
  })

  it('describes SLA breach without jargon', () => {
    expect(
      phraseEvent({
        id: '4',
        ticket_id: 't1',
        ticket_display: 'OC-1',
        event_type: 'sla_breached',
        actor_id: null,
        payload: { kind: 'respond', to_priority: 'high' },
        created_at: new Date().toISOString(),
      }),
    ).toMatch(/חריגת יעד/)
  })
})
