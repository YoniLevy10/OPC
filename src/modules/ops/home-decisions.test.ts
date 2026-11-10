import { describe, expect, it } from 'vitest'
import type { Actor, MemberRole } from '@/lib/auth/types'
import type { QueueTicket } from '@/modules/tickets/queue'
import type { DecisionItem } from '@/modules/decisions/queue'
import type { StoreRecord } from '@/modules/stores/service'
import type { OpsTask } from '@/lib/data/ops-ledger'
import { IL_ORG_ID } from '@/modules/stores/israel-stores'
import { buildHomeDecisions, scopeHomeStores } from './home-decisions'

const NOW = new Date('2026-11-10T12:00:00Z')
const STORE: StoreRecord = {
  id: 'store-il', code: '6006', name: 'תל אביב אבן גבירול', city: 'תל אביב', address: null,
  organization_id: IL_ORG_ID, country_id: 'il', region_id: 'ta', is_active: true,
}
const OTHER_STORE: StoreRecord = { ...STORE, id: 'store-other', code: '6001', name: 'ירושלים', region_id: 'jlm' }

function actor(role: MemberRole = 'global_maintenance', organization = IL_ORG_ID): Actor {
  return {
    id: 'ari', full_name: 'ארי', authVia: 'test_bearer',
    memberships: [{ id: 'm', profile_id: 'ari', organization_id: organization, role, country_id: 'il', region_id: 'ta', store_id: STORE.id }],
  }
}

function ticket(partial: Partial<QueueTicket> = {}): QueueTicket {
  return {
    id: 'fault', status: 'new', priority: 'high', category: 'hvac', description: 'מזגן לא מקרר',
    created_at: NOW.toISOString(), organization_id: IL_ORG_ID, country_id: 'il', region_id: 'ta', store_id: STORE.id,
    assigned_to: null, stores: { code: STORE.code, name: STORE.name }, ...partial,
  }
}

function decision(partial: Partial<DecisionItem> = {}): DecisionItem {
  return {
    id: 'spend:1', kind: 'spend', title: 'החלפת מזגן', storeCode: STORE.code, storeName: STORE.name,
    owner: 'מנהל החנות', urgency: 'today', action: 'לאשר הצעת מחיר', href: '/ops/approvals', spendId: '1', ...partial,
  }
}

function model(partial: Partial<Parameters<typeof buildHomeDecisions>[0]> = {}) {
  return buildHomeDecisions({ actor: actor(), tickets: [], decisions: [], stores: [STORE, OTHER_STORE], now: NOW, ...partial })
}

describe('Ari home decisions', () => {
  it('does not count urgent faults as spending approvals', () => {
    const home = model({ tickets: [ticket()] })
    expect(home.decisions).toHaveLength(1)
    expect(home.decisions[0]).toMatchObject({ nextAction: 'לתכנן טיפול', owner: 'ארי', source: 'ticket' })
    expect(home.spendApprovals).toBe(0)
  })

  it('shows expenses, documents and open tasks on the home with their next action', () => {
    const task: OpsTask = {
      id: 'task-1', title: 'לבדוק טיפול מונע', storeId: STORE.id, storeCode: STORE.code, assignee: null,
      dueAt: null, ticketId: null, documentId: null, spendId: null, done: false, needsClarification: false,
      clarification: null, createdAt: NOW.toISOString(),
    }
    const home = model({
      decisions: [decision(), decision({ id: 'doc:1', kind: 'document', title: 'אישור כיבוי אש', action: 'לחדש מסמך', href: '/ops/documents' })],
      tasks: [task],
    })
    expect(home.decisions.map((item) => item.source).sort()).toEqual(['document', 'spend', 'task'])
    expect(home.decisions.find((item) => item.source === 'task')).toMatchObject({ owner: 'ארי', nextAction: 'לטפל במשימה' })
    expect(home.spendApprovals).toBe(1)
  })

  it('separates store coordination, execution and store confirmation from Ari decisions', () => {
    const home = model({ tickets: [ticket({ status: 'engaged' }), ticket({ id: 'executing', status: 'in_progress', assigned_to: 'tech' }), ticket({ id: 'feedback', status: 'resolved' })] })
    expect(home.decisions).toEqual([])
    expect(home.waiting).toHaveLength(3)
    expect(home.waiting.find((item) => item.ticketId === 'fault')).toMatchObject({ owner: 'מנהל החנות', nextAction: 'החנות מתאמת' })
    expect(home.waiting.find((item) => item.ticketId === 'feedback')?.source).toBe('store_confirm')
  })

  it('brings overdue execution back as an exception without giving Ari scheduling ownership', () => {
    const home = model({ tickets: [ticket({ status: 'engaged', sla_resolve_by: '2026-11-09T12:00:00Z' })] })
    expect(home.decisions[0]).toMatchObject({ nextAction: 'לבדוק עיכוב', bucket: 'urgent_overdue' })
    expect(home.spendApprovals).toBe(0)
  })

  it('presents a linked price decision once instead of a competing generic ticket decision', () => {
    const home = model({ tickets: [ticket()], decisions: [decision({ ticketId: 'fault' })] })
    expect(home.decisions).toHaveLength(1)
    expect(home.decisions[0]).toMatchObject({ source: 'spend', nextAction: 'לאשר הצעת מחיר', owner: 'ארי' })
    expect(home.spendApprovals).toBe(1)
  })

  it('keeps closed work and completed tasks out of the next-action list', () => {
    expect(model({ tickets: [ticket({ status: 'closed' })] }).decisions).toEqual([])
  })

  it('keeps regional decisions in the authorized stores and hides unknown locations', () => {
    const home = model({ actor: actor('regional_manager'), decisions: [decision(), decision({ id: 'other', storeCode: '6001' }), decision({ id: 'unknown', storeCode: '—' })] })
    expect(home.decisions.map((item) => item.id)).toEqual(['spend:1'])
    expect(scopeHomeStores(actor('regional_manager'), [STORE, OTHER_STORE])).toEqual([STORE])
  })

  it('does not expose OC ledger rows to another organization with the same store code', () => {
    const foreign = { ...STORE, organization_id: 'foreign-org' }
    const home = model({ actor: actor('global_admin', 'foreign-org'), stores: [STORE, foreign], decisions: [decision(), decision({ id: 'unknown', storeCode: '—' })] })
    expect(home.decisions).toEqual([])
  })

  it.each(['store_employee', 'internal_technician'] as const)('hides headquarters decisions from %s', (role) => {
    const home = model({ actor: actor(role), tickets: [ticket()], decisions: [decision()] })
    expect(home.decisions).toEqual([])
    expect(home.waiting).toEqual([])
  })

  it('marks failed sources and discards stale data from those sources', () => {
    const home = model({ tickets: [ticket()], decisions: [decision()], ledgerFailed: true })
    expect(home.partialFailure).toBe(true)
    expect(home.spendApprovals).toBe(0)
    expect(home.decisions.map((item) => item.source)).toEqual(['ticket'])
    const failedTickets = model({ tickets: [ticket()], ticketsFailed: true })
    expect(failedTickets.decisions).toEqual([])
    expect(failedTickets.partialFailure).toBe(true)
    expect(model({ storesFailed: true }).partialFailure).toBe(true)
  })

  it('supports an honest empty state only when every required source loaded', () => {
    expect(model()).toMatchObject({ partialFailure: false, decisions: [], waiting: [], spendApprovals: 0 })
  })
})
