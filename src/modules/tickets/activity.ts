import {
  TICKET_EVENT_LABELS_HE,
  TICKET_STATUS_LABELS_HE,
  type TicketStatus,
} from '@/modules/tickets/constants'

/**
 * Messages and events are one chronology, not two boxes. This merges the
 * WhatsApp transcript and the audit trail into a single ordered timeline for
 * presentation. Pure — reads existing rows, writes nothing.
 */

export type ActivityKind = 'message_in' | 'message_out' | 'event' | 'note'

export type ActivityItem = {
  id: string
  kind: ActivityKind
  at: string
  /** Headline, e.g. "שינוי סטטוס" or "הודעה מהחנות". */
  label: string
  /** Free text body, when the item carries one. */
  body?: string | null
  /** Rendered as a status transition when present. */
  transition?: { from?: string | null; to?: string | null }
  mediaUrl?: string | null
}

type MessageRow = {
  id: string
  direction: string
  body?: string | null
  media_url?: string | null
  created_at: string
}

type EventRow = {
  id: string
  event_type: string
  created_at: string
  payload?: Record<string, unknown> | null
}

/** Cron re-fires these every few minutes — one story line, not a wall of repeats. */
const CRON_NOISE_TYPES = new Set([
  'sla_breached',
  'unassigned_timeout_notified',
  'lifecycle_nudge',
])

function statusLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return TICKET_STATUS_LABELS_HE[value as TicketStatus] ?? value
}

function clockHe(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('he-IL', {
      timeZone: 'Asia/Jerusalem',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d)
  } catch {
    return '—'
  }
}

/**
 * Keep real ops events; collapse repeating cron noise into one row per type
 * (first occurrence + how many times the system reminded).
 */
export function densifyCronNoise(events: EventRow[]): EventRow[] {
  const kept: EventRow[] = []
  const noise = new Map<string, EventRow[]>()

  for (const e of events) {
    if (!CRON_NOISE_TYPES.has(e.event_type)) {
      kept.push(e)
      continue
    }
    const bucket = noise.get(e.event_type) ?? []
    bucket.push(e)
    noise.set(e.event_type, bucket)
  }

  for (const [type, bucket] of noise) {
    const ordered = [...bucket].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
    const first = ordered[0]!
    const last = ordered[ordered.length - 1]!
    kept.push({
      id: first.id,
      event_type: type,
      created_at: first.created_at,
      payload: {
        ...(first.payload ?? {}),
        _noiseCount: ordered.length,
        _noiseUntil: last.created_at,
      },
    })
  }

  return kept
}

function noiseBody(payload: Record<string, unknown>, note: string | null): string | null {
  const count =
    typeof payload._noiseCount === 'number' ? payload._noiseCount : null
  const until =
    typeof payload._noiseUntil === 'string' ? payload._noiseUntil : null
  if (!count || count <= 1) return note
  const untilLabel = until ? clockHe(until) : null
  const summary = untilLabel
    ? `${count} רישומי מערכת · עד ${untilLabel}`
    : `${count} רישומי מערכת`
  return note ? `${note}\n${summary}` : summary
}

export function buildActivity(
  messages: MessageRow[] = [],
  events: EventRow[] = [],
): ActivityItem[] {
  const fromMessages: ActivityItem[] = messages.map((m) => ({
    id: `m-${m.id}`,
    kind: m.direction === 'inbound' ? 'message_in' : 'message_out',
    at: m.created_at,
    label: m.direction === 'inbound' ? 'הודעה מהחנות' : 'הודעה מהמערכת',
    body: m.body ?? null,
    mediaUrl: m.media_url ?? null,
  }))

  const fromEvents: ActivityItem[] = densifyCronNoise(events).map((e) => {
    const payload = e.payload ?? {}
    const note = typeof payload.note === 'string' ? payload.note : null
    // Writers emit {from,to}; older/alt payloads use from_status/to_status.
    const to = statusLabel(payload.to ?? payload.to_status)
    const from = statusLabel(payload.from ?? payload.from_status)

    return {
      id: `e-${e.id}`,
      kind: note && e.event_type !== 'status_changed' ? 'note' : 'event',
      at: e.created_at,
      label: TICKET_EVENT_LABELS_HE[e.event_type] ?? e.event_type,
      body: noiseBody(payload, note),
      transition: to ? { from, to } : undefined,
    }
  })

  return [...fromMessages, ...fromEvents].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  )
}

/** Newest-first, for mobile where the latest state matters most. */
export function buildActivityDesc(
  messages: MessageRow[] = [],
  events: EventRow[] = [],
): ActivityItem[] {
  return buildActivity(messages, events).reverse()
}
