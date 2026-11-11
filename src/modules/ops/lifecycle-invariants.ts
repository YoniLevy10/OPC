import type { SpendRequest } from '@/modules/spend/policy'
import type { ServiceVisit } from '@/modules/visits/service'
import type { Engagement } from '@/modules/engagements/service'
import type { TicketRecord, TicketEvent } from '@/modules/tickets/service'

export type LifecycleIssueCode =
  | 'approved_spend_without_visit'
  | 'locked_engagement_without_handoff'
  | 'partial_visit_stuck'
  | 'ticket_engagement_status_mismatch'

export type LifecycleIssue = {
  code: LifecycleIssueCode
  entityId: string
  ticketId?: string
  detail: string
}

export type LifecycleSnapshot = {
  spends: SpendRequest[]
  visits: ServiceVisit[]
  engagements: Engagement[]
  tickets: (Pick<TicketRecord, 'id' | 'status'> & { events?: Pick<TicketEvent, 'event_type' | 'payload'>[] })[]
  /** Clock injection keeps stale/partial detection deterministic. */
  now?: Date
  partialVisitStuckAfterMs?: number
}

const DEFAULT_STUCK_AFTER_MS = 24 * 60 * 60 * 1000

/** Pure read-only detection. It never repairs or mutates workflow records. */
export function detectLifecycleIssues(snapshot: LifecycleSnapshot): LifecycleIssue[] {
  const issues: LifecycleIssue[] = []
  const visitsByTicket = new Map<string, ServiceVisit[]>()
  for (const visit of snapshot.visits) {
    for (const ticketId of visit.ticket_ids) {
      const rows = visitsByTicket.get(ticketId) ?? []
      rows.push(visit)
      visitsByTicket.set(ticketId, rows)
    }
  }

  for (const spend of snapshot.spends) {
    if (spend.status !== 'approved' || spend.needsReapproval || !spend.ticketId) continue
    const relatedVisits = visitsByTicket.get(spend.ticketId) ?? []
    // Planning a visit is intentional: approved work may be scheduled before a vendor
    // is selected or dispatched. Only flag when no active plan or dispatch exists.
    const hasActiveVisit = relatedVisits.some((visit) => visit.status !== 'cancelled')
    if (!hasActiveVisit) issues.push({
      code: 'approved_spend_without_visit',
      entityId: spend.id,
      ticketId: spend.ticketId,
      detail: 'Approved spend has no active visit.',
    })
  }

  for (const engagement of snapshot.engagements) {
    if (engagement.status !== 'locked') continue
    if (engagement.handoff?.ok === true) continue
    const ticket = snapshot.tickets.find((row) => row.id === engagement.ticketId)
    const persistedSuccess = ticket?.events?.some((event) =>
      event.event_type === 'store_handoff' && event.payload.ok === true &&
      String(event.payload.engagementId ?? '') === engagement.id,
    )
    if (!persistedSuccess) issues.push({
      code: 'locked_engagement_without_handoff',
      entityId: engagement.id,
      ticketId: engagement.ticketId,
      detail: 'Engagement is locked without a recorded successful store handoff.',
    })
  }

  const now = (snapshot.now ?? new Date()).getTime()
  const threshold = snapshot.partialVisitStuckAfterMs ?? DEFAULT_STUCK_AFTER_MS
  for (const visit of snapshot.visits) {
    if (visit.status !== 'partial') continue
    const createdAt = Date.parse(visit.created_at)
    if (!Number.isFinite(createdAt) || now - createdAt < threshold) continue
    issues.push({
      code: 'partial_visit_stuck',
      entityId: visit.id,
      detail: 'Partial visit has remained unresolved beyond the configured threshold.',
    })
  }

  const engagedTickets = new Set(snapshot.engagements
    .filter((row) => row.status === 'locked')
    .flatMap((row) => [row.ticketId, ...row.bundledTicketIds]))
  for (const ticket of snapshot.tickets) {
    const shouldBeEngaged = engagedTickets.has(ticket.id)
    const isEngaged = ticket.status === 'engaged'
    // A closed/resolved ticket may retain its historical locked engagement.
    if (shouldBeEngaged === isEngaged || (shouldBeEngaged && ['resolved', 'closed'].includes(ticket.status))) continue
    issues.push({
      code: 'ticket_engagement_status_mismatch',
      entityId: ticket.id,
      ticketId: ticket.id,
      detail: shouldBeEngaged
        ? 'Ticket has a locked engagement but is not in engaged status.'
        : 'Ticket is engaged without a locked engagement.',
    })
  }
  return issues
}
