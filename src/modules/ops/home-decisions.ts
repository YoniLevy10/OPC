import { actorHasHqAccess, canReadTicket, type Actor } from '@/lib/auth/types'
import { canonicalStoreCode, IL_ORG_ID } from '@/modules/stores/israel-stores'
import type { StoreRecord } from '@/modules/stores/service'
import { scopeTicketsForActor } from '@/lib/auth/ticket-scope'
import { alertFromDecision, composeAlertsCenter } from '@/modules/alerts/center'
import type { OpsAlert } from '@/modules/alerts/types'
import { ticketDecision, type DecisionItem } from '@/modules/decisions/queue'
import { isBreached, type QueueTicket } from '@/modules/tickets/queue'
import type { Locale } from '@/lib/i18n/locale'
import { phrase } from '@/lib/i18n/phrases'
import type { OpsTask } from '@/lib/data/ops-ledger'
import { readTaskStatus } from '@/modules/tasks/status'

export type HomeDecisionModel = {
  decisions: OpsAlert[]
  waiting: OpsAlert[]
  spendApprovals: number
  partialFailure: boolean
  ticketsFailed: boolean
  ledgerFailed: boolean
  storesFailed: boolean
}

export function scopeHomeStores(actor: Actor | null, stores: StoreRecord[]): StoreRecord[] {
  if (!actor) return stores
  if (!actorHasHqAccess(actor)) return []
  return stores.filter((store) => {
    if (!store.organization_id || !store.country_id || !store.region_id) return false
    return canReadTicket(actor, {
      id: `store:${store.id}`,
      organization_id: store.organization_id,
      country_id: store.country_id,
      region_id: store.region_id,
      store_id: store.id,
      assigned_to: null,
      status: 'new',
    })
  })
}

/** Ledger rows belong to the OC tenant; unknown scoped locations fail closed. */
function scopeLedgerDecisions(
  actor: Actor | null,
  decisions: DecisionItem[],
  tickets: QueueTicket[],
  stores: StoreRecord[],
): DecisionItem[] {
  if (!actor) return decisions
  if (!actorHasHqAccess(actor)) return []
  const visibleTickets = new Set(tickets.filter((ticket) => ticket.organization_id === IL_ORG_ID).map((ticket) => ticket.id))
  const storeCodes = new Set(scopeHomeStores(actor, stores.filter((store) => store.organization_id === IL_ORG_ID)).map((store) => canonicalStoreCode(store.code)))
  const tenantWide = actor.memberships.some((membership) =>
    membership.organization_id === IL_ORG_ID &&
    (membership.role === 'global_admin' || membership.role === 'global_maintenance'),
  )
  return decisions.filter((decision) => {
    if (decision.ticketId && visibleTickets.has(decision.ticketId)) return true
    const code = canonicalStoreCode(decision.storeCode)
    if (code && code !== '—') return storeCodes.has(code)
    return tenantWide
  })
}

function ticketHomeAlert(ticket: QueueTicket, now: Date, locale: Locale): OpsAlert | null {
  if (['closed', 'cancelled', 'resolved'].includes(ticket.status)) return null
  const p = (text: string) => phrase(locale, text)
  const derived = ticketDecision(ticket, now, locale)
  const waiting = ['engaged', 'assigned', 'in_progress', 'awaiting_info', 'waiting_vendor', 'waiting_parts'].includes(ticket.status)
  // A late execution is an exception for Ari; coordination remains with the store.
  const delayed = isBreached(ticket, now)
  const needsDecision = !waiting || delayed
  const nextAction = delayed && waiting
    ? p('לבדוק עיכוב')
    : ticket.status === 'engaged'
      ? p('החנות מתאמת')
      : ticket.status === 'awaiting_info'
        ? p('ממתין למידע מהחנות')
        : ticket.status === 'waiting_parts'
          ? p('ממתין לחלקים')
          : ticket.status === 'waiting_vendor'
            ? p('ממתין לאיש מקצוע')
            : waiting
              ? p('במעקב אחר הביצוע')
              : p('לתכנן טיפול')
  const decision: DecisionItem = derived ?? {
    id: `ticket:${ticket.id}`,
    kind: 'ticket',
    title: ticket.title || ticket.description,
    storeCode: ticket.stores?.code ?? '—',
    storeName: ticket.stores?.name ?? p('סניף'),
    owner: needsDecision ? p('ארי') : p('חנות'),
    urgency: delayed ? 'overdue' : 'today',
    action: nextAction,
    href: `/ops/tickets/${ticket.id}`,
    ticketId: ticket.id,
  }
  return {
    ...alertFromDecision(decision, now.toISOString(), locale, ticket, now),
    owner: needsDecision ? p('ארי') : ticket.status === 'engaged' || ticket.status === 'awaiting_info' ? p('מנהל החנות') : p('איש המקצוע'),
    nextAction,
    bucket: needsDecision ? delayed || ticket.priority === 'critical' ? 'urgent_overdue' : 'needs_decision' : 'waiting',
  }
}

/** One home queue from already-fetched sources; rendering never performs an action. */
export function buildHomeDecisions(input: {
  actor: Actor | null
  tickets: QueueTicket[]
  decisions: DecisionItem[]
  stores: StoreRecord[]
  tasks?: OpsTask[]
  ticketsFailed?: boolean
  ledgerFailed?: boolean
  storesFailed?: boolean
  now?: Date
  locale?: Locale
}): HomeDecisionModel {
  const now = input.now ?? new Date()
  const locale = input.locale ?? 'he'
  const tickets = input.ticketsFailed ? [] : input.actor ? scopeTicketsForActor(input.actor, input.tickets) : input.tickets
  const taskDecisions: DecisionItem[] = (input.tasks ?? []).flatMap((task) => {
    if (task.done || readTaskStatus(task) === 'done' || task.needsClarification) return []
    return [{
      id: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      storeCode: task.storeCode ?? '—',
      storeName: input.stores.find((store) => store.id === task.storeId)?.name ?? task.storeCode ?? phrase(locale, 'משימה'),
      owner: task.assignee || phrase(locale, 'ארי'),
      urgency: task.dueAt && new Date(task.dueAt).getTime() < now.getTime() ? 'overdue' : 'today',
      action: phrase(locale, 'לטפל במשימה'),
      href: '/ops/tasks',
      ticketId: task.ticketId ?? undefined,
    } satisfies DecisionItem]
  })
  const ledger = input.ledgerFailed ? [] : scopeLedgerDecisions(input.actor, [...input.decisions, ...taskDecisions], tickets, input.stores)
  const center = composeAlertsCenter({
    tickets,
    ticketsFailed: Boolean(input.ticketsFailed),
    decisions: ledger,
    ledgerFailed: Boolean(input.ledgerFailed),
    history: [],
    historyFailed: false,
    actor: input.actor,
    now,
    locale,
  })
  const items = new Map(center.open.map((alert) => {
    const task = alert.source === 'task' ? input.tasks?.find((row) => alert.id === `task:${row.id}`) : undefined
    const taskWaiting = task && !task.needsClarification &&
      (readTaskStatus(task) === 'waiting' || (task.assignee && ![input.actor?.full_name, 'ארי'].includes(task.assignee)))
    return [alert.id, taskWaiting
      ? { ...alert, bucket: 'waiting' as const, nextAction: phrase(locale, 'במעקב אחר המשימה') }
      : alert.source === 'verify'
        ? { ...alert, bucket: 'needs_decision' as const }
        : alert.source === 'spend'
          ? { ...alert, owner: phrase(locale, 'ארי') }
          : alert]
  }))
  const spendingTickets = new Set(center.open.filter((alert) => alert.source === 'spend').map((alert) => alert.ticketId))
  if (!input.actor || actorHasHqAccess(input.actor)) {
    for (const ticket of tickets) {
      if (spendingTickets.has(ticket.id)) continue
      const alert = ticketHomeAlert(ticket, now, locale)
      if (alert) items.set(alert.id, alert)
    }
  }
  const ordered = [...items.values()].sort((a, b) => {
    const rank = (alert: OpsAlert) => alert.bucket === 'urgent_overdue' ? 0 : alert.bucket === 'needs_decision' ? 1 : 2
    const difference = rank(a) - rank(b)
    return difference || new Date(a.at).getTime() - new Date(b.at).getTime()
  })
  const decisions = ordered.filter((alert) => alert.bucket !== 'waiting')
  return {
    decisions,
    waiting: ordered.filter((alert) => alert.bucket === 'waiting'),
    spendApprovals: decisions.filter((alert) => alert.source === 'spend').length,
    ticketsFailed: Boolean(input.ticketsFailed),
    ledgerFailed: Boolean(input.ledgerFailed),
    storesFailed: Boolean(input.storesFailed),
    partialFailure: center.partialFailure || Boolean(input.storesFailed),
  }
}
