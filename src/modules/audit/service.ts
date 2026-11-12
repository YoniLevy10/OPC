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

/**
 * Recent ticket journal for Ari's history screen.
 * Prefers real actions over SLA-breach spam so the feed stays usable.
 */
export async function listRecentAuditEvents(limit = 200): Promise<{
  events: AuditEventRow[]
  slaCount: number
  backend: 'supabase' | 'memory'
}> {
  if (await supabaseReady()) {
    const supabase = createSystemClient('audit_list')
    const select =
      'id, ticket_id, event_type, actor_id, payload, created_at, tickets(display_number, stores(code, name))'

    const [actionsRes, slaRes, slaCountRes] = await Promise.all([
      supabase
        .from('ticket_events')
        .select(select)
        .neq('event_type', 'sla_breached')
        .order('created_at', { ascending: false })
        .limit(limit),
      supabase
        .from('ticket_events')
        .select(select)
        .eq('event_type', 'sla_breached')
        .order('created_at', { ascending: false })
        .limit(80),
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
      return {
        backend: 'supabase',
        slaCount: slaCountRes.count ?? slaRows.length,
        events: mapRows(merged as Array<Record<string, unknown>>, nameById),
      }
    }
  }

  const all = memListRecentEvents(Math.max(limit * 3, 400))
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
