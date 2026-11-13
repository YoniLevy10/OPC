import {
  memListRecentEvents,
  supabaseReady,
  type MemAuditEvent,
} from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'

export type AuditEventRow = MemAuditEvent & {
  /** Resolved display name when known. */
  actor_name?: string | null
  store_code?: string | null
  store_name?: string | null
}

type TicketJoin = {
  display_number?: string | null
  stores?:
    | { code?: string | null; name?: string | null }
    | { code?: string | null; name?: string | null }[]
    | null
}

function mapRows(
  data: Array<Record<string, unknown>>,
  nameById: Map<string, string>,
): AuditEventRow[] {
  return data.map((e) => {
    const tickets = e.tickets as TicketJoin | TicketJoin[] | null
    const ticket = Array.isArray(tickets) ? tickets[0] : tickets
    const storesRaw = ticket?.stores
    const store = Array.isArray(storesRaw) ? storesRaw[0] : storesRaw
    const actorId = (e.actor_id as string | null) ?? null
    return {
      id: e.id as string,
      ticket_id: e.ticket_id as string,
      ticket_display: ticket?.display_number ?? null,
      event_type: e.event_type as string,
      actor_id: actorId,
      actor_name: actorId ? nameById.get(actorId) ?? null : null,
      store_code: store?.code ?? null,
      store_name: store?.name ?? null,
      payload: (e.payload as Record<string, unknown>) ?? {},
      created_at: e.created_at as string,
    }
  })
}

async function resolveActorNames(
  supabase: ReturnType<typeof createSystemClient>,
  actorIds: string[],
): Promise<Map<string, string>> {
  const nameById = new Map<string, string>()
  if (actorIds.length === 0) return nameById
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', actorIds)
  for (const row of profiles ?? []) {
    if (row.full_name) nameById.set(String(row.id), String(row.full_name))
  }
  return nameById
}

function inDayRange(
  iso: string,
  from?: string | null,
  to?: string | null,
): boolean {
  const day = iso.slice(0, 10)
  if (from && day < from.slice(0, 10)) return false
  if (to && day > to.slice(0, 10)) return false
  return true
}

/**
 * Recent ticket journal for Ari's history screen.
 * Prefers real actions over SLA-breach spam so the feed stays usable.
 */
export async function listRecentAuditEvents(
  limit = 200,
  range?: { from?: string | null; to?: string | null },
): Promise<{
  events: AuditEventRow[]
  slaCount: number
  backend: 'supabase' | 'memory'
}> {
  const from = range?.from ?? null
  const to = range?.to ?? null

  if (await supabaseReady()) {
    const supabase = createSystemClient('audit_list')
    const select =
      'id, ticket_id, event_type, actor_id, payload, created_at, tickets(display_number, stores(code, name))'

    let actionsQuery = supabase
      .from('ticket_events')
      .select(select)
      .neq('event_type', 'sla_breached')
      .order('created_at', { ascending: false })
      .limit(limit)
    let slaQuery = supabase
      .from('ticket_events')
      .select(select)
      .eq('event_type', 'sla_breached')
      .order('created_at', { ascending: false })
      .limit(80)
    if (from) {
      actionsQuery = actionsQuery.gte('created_at', `${from.slice(0, 10)}T00:00:00.000Z`)
      slaQuery = slaQuery.gte('created_at', `${from.slice(0, 10)}T00:00:00.000Z`)
    }
    if (to) {
      actionsQuery = actionsQuery.lte('created_at', `${to.slice(0, 10)}T23:59:59.999Z`)
      slaQuery = slaQuery.lte('created_at', `${to.slice(0, 10)}T23:59:59.999Z`)
    }

    const [actionsRes, slaRes, slaCountRes] = await Promise.all([
      actionsQuery,
      slaQuery,
      supabase
        .from('ticket_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'sla_breached'),
    ])

    if (!actionsRes.error && actionsRes.data) {
      const slaRows = !slaRes.error && slaRes.data ? slaRes.data : []
      const merged = [...actionsRes.data, ...slaRows].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      )
      const actorIds = [
        ...new Set(
          merged
            .map((e) => e.actor_id as string | null)
            .filter((id): id is string => Boolean(id)),
        ),
      ]
      const nameById = await resolveActorNames(supabase, actorIds)
      const events = mapRows(
        merged as Array<Record<string, unknown>>,
        nameById,
      ).filter((e) => inDayRange(e.created_at, from, to))
      return {
        backend: 'supabase',
        slaCount: slaCountRes.count ?? slaRows.length,
        events,
      }
    }
  }

  const all = memListRecentEvents(Math.max(limit * 3, 400)).filter((e) =>
    inDayRange(e.created_at, from, to),
  )
  const actions = all.filter((e) => e.event_type !== 'sla_breached').slice(0, limit)
  const sla = all.filter((e) => e.event_type === 'sla_breached')
  const events = [...actions, ...sla.slice(0, 80)].sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  )

  return {
    backend: 'memory',
    slaCount: sla.length,
    events: events.map((e) => ({
      ...e,
      actor_name: null,
      store_code: null,
      store_name: null,
    })),
  }
}
