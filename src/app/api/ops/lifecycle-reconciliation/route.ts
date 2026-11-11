import { NextResponse } from 'next/server'
import { authErrorResponse, requireActor } from '@/lib/auth/request-actor'
import { actorHasHqAccess, AuthError } from '@/lib/auth/types'
import { captureError } from '@/lib/monitoring'
import { logEvent } from '@/lib/logging'
import { hydrateOpsLedger } from '@/lib/data/ops-db'
import { listSpends } from '@/lib/data/ops-ledger'
import { memListVisits, type ServiceVisit } from '@/modules/visits/service'
import { memListTickets } from '@/lib/data/memory-store'
import { listEngagements } from '@/modules/engagements/service'
import { listTickets } from '@/modules/tickets/service'
import { detectLifecycleIssues } from '@/modules/ops/lifecycle-invariants'
import { supabaseReady } from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'
import { IL_ORG_ID } from '@/modules/stores/israel-stores'

export const dynamic = 'force-dynamic'

/** Admin-only, read-only operational lifecycle reconciliation. */
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request)
    if (!actorHasHqAccess(actor)) throw new AuthError('HQ access required', 403)

    const organizationIds = [...new Set(actor.memberships
      .filter((membership) => actorHasHqAccess({ ...actor, memberships: [membership] }))
      .map((membership) => membership.organization_id))]
    if (!organizationIds.length) throw new AuthError('HQ access required', 403)
    // Current operational ledger is Israel-pilot scoped; do not imply coverage for
    // unrelated organizations in a multi-tenant actor's memberships.
    if (!organizationIds.includes(IL_ORG_ID)) throw new AuthError('Reconciliation is not configured for this organization', 403)
    const organizationId = IL_ORG_ID
    const hydrationError = await hydrateOpsLedger().then(() => null, (error) => error instanceof Error ? error.message : String(error))
    const [ticketResult, engagements] = await Promise.all([
      listTickets({ limit: 1000, organizationId }),
      listEngagements(organizationId),
    ])
    if (ticketResult.error) throw new Error(`Unable to load tickets: ${ticketResult.error}`)

    let visits: ServiceVisit[]
    let visitEvents: Map<string, Array<{ event_type: string; payload: Record<string, unknown> }>> = new Map()
    if (await supabaseReady()) {
      const supabase = createSystemClient('lifecycle_reconciliation')
      const { data, error } = await supabase.from('service_visits').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(2001)
      if (error) throw new Error(`Unable to load visits: ${error.message}`)
      const visitRows = data ?? []
      if (visitRows.length > 2000) throw new Error('Visit result exceeds 2000-row cap; reconciliation incomplete')
      visits = await Promise.all(visitRows.map(async (row) => {
        const id = String(row.id)
        const linked = await supabase.from('service_visit_tickets').select('ticket_id').eq('visit_id', id)
        if (linked.error) throw new Error(`Unable to load visit tickets: ${linked.error.message}`)
        const dispatches = await supabase.from('vendor_dispatches').select('id, ticket_id, status').eq('visit_id', id)
        if (dispatches.error) throw new Error(`Unable to load visit dispatches: ${dispatches.error.message}`)
        return {
          id, organization_id: String(row.organization_id ?? ''), store_id: String(row.store_id ?? ''),
          vendor_id: row.vendor_id ? String(row.vendor_id) : null, status: String(row.status ?? ''),
          scheduled_at: (row.scheduled_at as string | null) ?? null, created_by: (row.created_by as string | null) ?? null,
          notes: (row.notes as string | null) ?? null, created_at: String(row.created_at ?? ''),
          idempotency_key: (row.idempotency_key as string | null) ?? null,
          ticket_ids: (linked.data ?? []).map((item) => String(item.ticket_id)),
          dispatch_ids: (dispatches.data ?? []).map((item) => String(item.id)),
          items: (dispatches.data ?? []).map((item) => ({ ticket_id: String(item.ticket_id), display_number: null, status: String(item.status) as 'sent' | 'labeled' | 'failed' | 'ack' | 'queued' | 'blocked', dispatch_id: String(item.id), error: null, can_retry: false })),
        }
      }))
      const scopedTicketIds = ticketResult.tickets.map((ticket) => ticket.id)
      const { data: eventRows, error: eventError } = scopedTicketIds.length
        ? await supabase.from('ticket_events').select('ticket_id, event_type, payload').eq('event_type', 'store_handoff').in('ticket_id', scopedTicketIds).limit(10001)
        : { data: [], error: null }
      if (eventError) throw new Error(`Unable to load ticket events: ${eventError.message}`)
      if ((eventRows ?? []).length > 10000) throw new Error('Ticket event result exceeds 10000-row cap; reconciliation incomplete')
      visitEvents = new Map()
      for (const row of eventRows ?? []) {
        const bucket = visitEvents.get(String(row.ticket_id)) ?? []
        bucket.push({ event_type: String(row.event_type), payload: (row.payload as Record<string, unknown>) ?? {} })
        visitEvents.set(String(row.ticket_id), bucket)
      }
    } else visits = memListVisits().filter((visit) => visit.organization_id === organizationId)
    if (engagements.length >= 2000) throw new Error('Engagement result may exceed 2000-row cap; reconciliation incomplete')
    if (ticketResult.tickets.length >= 1000) throw new Error('Ticket result may exceed 1000-row cap; reconciliation incomplete')

    const ticketsWithEvents = (await supabaseReady() ? ticketResult.tickets : memListTickets().filter((ticket) => ticket.organization_id === organizationId)).map((ticket) => ({
      id: ticket.id, status: ticket.status, events: visitEvents.get(ticket.id) ?? [],
    }))
    const issues = detectLifecycleIssues({
      spends: listSpends().filter((spend) => ticketsWithEvents.some((ticket) => ticket.id === spend.ticketId)), visits, engagements: engagements.filter((row) => row.organizationId === organizationId), tickets: ticketsWithEvents as Parameters<typeof detectLifecycleIssues>[0]['tickets'],
    })
    const body = { ok: false, complete: false, completenessWarning: hydrationError ? 'Ledger hydration failed; reconciliation is incomplete.' : 'Source reads can be truncated or silently fail; reconciliation is incomplete.', readOnly: true, source: ticketResult.backend, counts: { spends: listSpends().filter((spend) => ticketsWithEvents.some((ticket) => ticket.id === spend.ticketId)).length, visits: visits.length, engagements: engagements.filter((row) => row.organizationId === organizationId).length, tickets: ticketsWithEvents.length }, issues }
    logEvent('lifecycle_reconciliation', 'info', 'completed', { ...body, actorId: actor.id })
    return NextResponse.json(body)
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error)
    captureError(error, { route: 'GET /api/ops/lifecycle-reconciliation' })
    logEvent('lifecycle_reconciliation', 'error', 'failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: 'Unable to complete lifecycle reconciliation' }, { status: 500 })
  }
}
