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

export async function listRecentAuditEvents(limit = 200): Promise<{
  events: AuditEventRow[]
  backend: 'supabase' | 'memory'
}> {
  if (await supabaseReady()) {
    const supabase = createSystemClient('audit_list')
    const { data, error } = await supabase
      .from('ticket_events')
      .select(
        'id, ticket_id, event_type, actor_id, payload, created_at, tickets(display_number, stores(code, name))',
      )
      .order('created_at', { ascending: false })
      .limit(limit)

    if (!error && data) {
      const actorIds = [
        ...new Set(
          data
            .map((e) => e.actor_id as string | null)
            .filter((id): id is string => Boolean(id)),
        ),
      ]
      const nameById = new Map<string, string>()
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', actorIds)
        for (const row of profiles ?? []) {
          if (row.full_name) nameById.set(String(row.id), String(row.full_name))
        }
      }

      return {
        backend: 'supabase',
        events: data.map((e) => {
          const tickets = e.tickets as
            | {
                display_number?: string | null
                stores?:
                  | { code?: string | null; name?: string | null }
                  | { code?: string | null; name?: string | null }[]
                  | null
              }
            | {
                display_number?: string | null
                stores?:
                  | { code?: string | null; name?: string | null }
                  | { code?: string | null; name?: string | null }[]
                  | null
              }[]
            | null
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
        }),
      }
    }
  }

  return {
    backend: 'memory',
    events: memListRecentEvents(limit).map((e) => ({
      ...e,
      actor_name: null,
      store_code: null,
      store_name: null,
    })),
  }
}
