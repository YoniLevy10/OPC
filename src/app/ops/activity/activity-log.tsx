'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { format, isSameDay, parseISO, startOfDay } from 'date-fns'
import { he } from 'date-fns/locale'
import { SearchField } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { PLAIN_STATUS_HE } from '@/components/ops/plain-labels'
import {
  TICKET_EVENT_LABELS_HE,
  type TicketStatus,
} from '@/modules/tickets/constants'
import type { AuditEventRow } from '@/modules/audit/service'

export type AuditEvent = AuditEventRow

const NOISE_TYPES = new Set(['sla_breached'])

function statusHe(raw: unknown): string {
  const key = String(raw ?? '')
  return PLAIN_STATUS_HE[key as TicketStatus] ?? (key || '—')
}

function sourceHe(source: string): string {
  const map: Record<string, string> = {
    whatsapp: 'וואטסאפ',
    qr_whatsapp: 'QR → וואטסאפ',
    nfc_whatsapp: 'NFC → וואטסאפ',
    web_fallback: 'טופס web',
    demo: 'דמו',
  }
  return map[source] ?? source
}

function urgencyHe(raw: unknown): string {
  const key = String(raw ?? '')
  if (key === 'critical' || key === 'high') return 'דחוף'
  if (key === 'medium' || key === 'low') return 'רגיל'
  return key || ''
}

/** Human phrasing for the system journal — who / what / on which ticket. */
export function phraseEvent(e: AuditEvent): string {
  const p =
    e.payload && typeof e.payload === 'object'
      ? (e.payload as Record<string, unknown>)
      : {}

  switch (e.event_type) {
    case 'status_changed': {
      const from = p.from ?? p.from_status
      const to = p.to ?? p.to_status
      if (from && to) return `${statusHe(from)} → ${statusHe(to)}`
      return `סטטוס · ${statusHe(to)}`
    }
    case 'assigned':
      return 'שויכה לטכנאי פנימי'
    case 'created': {
      const source = p.source ? sourceHe(String(p.source)) : null
      return source ? `נפתחה · ${source}` : 'תקלה נפתחה'
    }
    case 'sla_breached': {
      const kind =
        p.kind === 'respond'
          ? 'תגובה'
          : p.kind === 'resolve'
            ? 'סגירה'
            : null
      const to = urgencyHe(p.to_priority)
      if (kind && to) return `חריגת יעד (${kind}) · עלה ל־${to}`
      if (kind) return `חריגת יעד · ${kind}`
      return 'חריגת יעד טיפול'
    }
    case 'partner_dispatched': {
      const name = p.vendor_name ? String(p.vendor_name) : null
      return name ? `שוגר לספק · ${name}` : 'שוגר לספק חיצוני'
    }
    case 'engagement_locked': {
      const name = p.professionalName ? String(p.professionalName) : null
      const phone = p.professionalPhone ? String(p.professionalPhone) : null
      if (name && phone) return `אושר איש מקצוע · ${name} · ${phone}`
      if (name) return `אושר איש מקצוע · ${name}`
      return 'אושר איש מקצוע'
    }
    case 'engagement_cancelled':
      return 'בוטל אישור איש מקצוע'
    case 'store_handoff': {
      const line = typeof p.line === 'string' ? p.line : null
      if (p.ok === false && line) return `WA לחנות — לא נמסר (${line})`
      if (line) return `WA לחנות · ${line}`
      return 'נשלח WA למנהל החנות'
    }
    case 'pro_sms': {
      const line = typeof p.line === 'string' ? p.line : null
      if (p.ok === false && line) return `SMS לאיש מקצוע — לא נשלח (${line})`
      return line || 'נשלח SMS לאיש מקצוע'
    }
    case 'store_confirmed': {
      const by = p.by ? String(p.by) : null
      return by ? `החנות אישרה תיקון · ${by}` : 'החנות אישרה תיקון'
    }
    case 'store_rejected':
      return 'החנות דיווחה שהתקלה לא נפתרה'
    case 'urgent_changed':
      return p.urgent === true || p.to === true || p.to === 'true'
        ? 'סומן כדחוף'
        : 'סומן כלא דחוף'
    case 'priority_changed':
      return `דחיפות · ${urgencyHe(p.to) || String(p.to ?? '')}`
    case 'hq_note':
    case 'note_added':
      return typeof p.note === 'string' && p.note.trim()
        ? `הערת מוקד · ${p.note.trim().slice(0, 80)}`
        : 'נוספה הערת מוקד'
    case 'tech_note':
      return typeof p.note === 'string' && p.note.trim()
        ? `הערת טכנאי · ${p.note.trim().slice(0, 80)}`
        : 'נוספה הערת טכנאי'
    case 'tech_photo':
    case 'photo_added':
      return 'נוספה תמונה / תיעוד'
    case 'service_visit_planned':
    case 'service_visit_created':
      return 'תוכנן ביקור שירות'
    case 'ari_manual_close':
      return 'סגירה ידנית על ידי ארי'
    case 'resolve_override':
      return 'סגירה ללא הוכחה (חריגה)'
    case 'quality_hold_override':
      return 'סגירה לפני תום החזקת איכות'
    case 'repair_eta_set':
      return 'עודכן מועד הגעה משוער'
    case 'classification_corrected':
      return 'תוקן סיווג התקלה'
    case 'lifecycle_nudge':
      return 'נשלחה תזכורת מחזור לחנות'
    case 'unassigned_timeout_notified':
      return 'תזכורת · תקלה בלי שיוך'
    default:
      return TICKET_EVENT_LABELS_HE[e.event_type] ?? e.event_type
  }
}

function actorLabel(e: AuditEvent) {
  if (e.actor_name?.trim()) return e.actor_name.trim()
  const p =
    e.payload && typeof e.payload === 'object'
      ? (e.payload as Record<string, unknown>)
      : {}
  if (typeof p.approvedBy === 'string' && p.approvedBy.trim()) return p.approvedBy
  if (typeof p.by === 'string' && p.by.trim()) return p.by
  if (!e.actor_id) return 'מערכת'
  if (e.actor_id.length <= 12) return e.actor_id
  return `${e.actor_id.slice(0, 8)}…`
}

function storeLabel(e: AuditEvent) {
  if (e.store_code && e.store_name) return `#${e.store_code} · ${e.store_name}`
  if (e.store_code) return `#${e.store_code}`
  if (e.store_name) return e.store_name
  return null
}

function ticketLabel(e: AuditEvent) {
  return e.ticket_display?.trim() || (e.ticket_id ? e.ticket_id.slice(0, 8) : '—')
}

function fmtTime(iso: string) {
  try {
    return format(parseISO(iso), 'HH:mm')
  } catch {
    return iso
  }
}

function fmtDayLabel(iso: string) {
  try {
    const d = parseISO(iso)
    if (isSameDay(d, new Date())) return 'היום'
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    if (isSameDay(d, yesterday)) return 'אתמול'
    return format(d, 'EEEE d.M', { locale: he })
  } catch {
    return iso
  }
}

function dayKey(iso: string) {
  try {
    return startOfDay(parseISO(iso)).toISOString()
  } catch {
    return iso.slice(0, 10)
  }
}

type FeedMode = 'actions' | 'all'

export function ActivityLog({
  events,
  slaCount,
}: {
  events: AuditEvent[]
  slaCount: number
}) {
  const [mode, setMode] = useState<FeedMode>('actions')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (mode === 'actions' && NOISE_TYPES.has(e.event_type)) return false
      if (query.trim()) {
        const q = query.trim().toLowerCase()
        const hay =
          `${e.ticket_display ?? ''} ${e.ticket_id} ${e.store_code ?? ''} ${e.store_name ?? ''} ${phraseEvent(e)} ${actorLabel(e)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, mode, query])

  const groups = useMemo(() => {
    const map = new Map<string, AuditEvent[]>()
    for (const e of filtered) {
      const key = dayKey(e.created_at)
      const list = map.get(key) ?? []
      list.push(e)
      map.set(key, list)
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      label: fmtDayLabel(items[0]!.created_at),
      items,
    }))
  }, [filtered])

  const actionTotal = events.filter((e) => !NOISE_TYPES.has(e.event_type)).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          aria-label="תצוגת היסטוריה"
          className="inline-flex rounded-full border border-border bg-surface p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'actions'}
            onClick={() => setMode('actions')}
            className={cn(
              't-caption rounded-full px-3.5 py-1.5 transition-colors',
              mode === 'actions'
                ? 'bg-ink text-[var(--tenant-contrast)]'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            פעולות
            <span className="t-num ms-1.5 opacity-70">{actionTotal}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'all'}
            onClick={() => setMode('all')}
            className={cn(
              't-caption rounded-full px-3.5 py-1.5 transition-colors',
              mode === 'all'
                ? 'bg-ink text-[var(--tenant-contrast)]'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            הכל
            {slaCount > 0 ? (
              <span className="t-num ms-1.5 opacity-70">+{slaCount} יעד</span>
            ) : null}
          </button>
        </div>
        <p className="t-caption text-ink-3">
          {filtered.length === 0
            ? 'אין תוצאות'
            : `${filtered.length} ביומן`}
        </p>
      </div>

      <SearchField
        value={query}
        onValueChange={setQuery}
        placeholder="חיפוש תקלה, סניף או פעולה…"
        className="max-w-xl"
      />

      {filtered.length === 0 ? (
        <EmptyState
          title={mode === 'actions' ? 'אין פעולות עדיין' : 'אין אירועים'}
          description={
            query
              ? 'נסו חיפוש אחר.'
              : mode === 'actions'
                ? 'פתיחה, אישור, הודעות וסגירה יופיעו כאן. חריגות יעד ב«הכל».'
                : 'ברגע שיש פעילות על תקלה — היא תופיע כאן.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-[color-mix(in_srgb,var(--surface)_88%,var(--canvas))] px-4 py-2 backdrop-blur-sm">
                <h2 className="t-caption font-semibold tracking-wide text-ink-2">
                  {group.label}
                </h2>
                <span className="t-caption t-num text-ink-3">{group.items.length}</span>
              </div>
              <ul>
                {group.items.map((event, index) => {
                  const store = storeLabel(event)
                  const warn = event.event_type === 'sla_breached'
                  const href = `/ops/tickets/${event.ticket_id}`
                  return (
                    <li
                      key={event.id}
                      className={cn(
                        'border-b border-border/70 last:border-b-0',
                        warn && 'bg-[color-mix(in_srgb,var(--warning,#d97706)_5%,transparent)]',
                      )}
                    >
                      <Link
                        href={href}
                        className={cn(
                          'flex items-start justify-between gap-4 px-4 py-2.5 transition-colors',
                          'hover:bg-surface-sunken/45',
                          index === 0 && 'pt-3',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="t-caption t-num font-semibold text-ink">
                              {ticketLabel(event)}
                            </span>
                            {store ? (
                              <span className="t-caption truncate text-ink-3">
                                {store}
                              </span>
                            ) : null}
                          </div>
                          <p
                            className={cn(
                              't-body mt-0.5 leading-snug text-ink',
                              warn && 'text-[var(--warning,#b45309)]',
                            )}
                          >
                            {phraseEvent(event)}
                          </p>
                          <p className="t-caption mt-0.5 text-ink-3">
                            {actorLabel(event)}
                          </p>
                        </div>
                        <time
                          dateTime={event.created_at}
                          className="t-caption t-num shrink-0 pt-0.5 text-ink-3"
                        >
                          {fmtTime(event.created_at)}
                        </time>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
