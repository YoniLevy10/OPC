'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { format, isSameDay, parseISO, startOfDay } from 'date-fns'
import { he } from 'date-fns/locale'
import { Field, Input, Select } from '@/components/ui/input'
import { EmptyState, Notice, Panel } from '@/components/ui/primitives'
import { PhoneFold, PhoneFoldStack } from '@/components/layout/phone-fold'
import {
  TICKET_EVENT_LABELS_HE,
  TICKET_STATUS_LABELS_HE,
  type TicketStatus,
} from '@/modules/tickets/constants'
import type { AuditEventRow } from '@/modules/audit/service'

export type AuditEvent = AuditEventRow

function statusHe(raw: unknown): string {
  const key = String(raw ?? '')
  return TICKET_STATUS_LABELS_HE[key as TicketStatus] ?? (key || '—')
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
      if (from && to) return `סטטוס: ${statusHe(from)} → ${statusHe(to)}`
      return `שינוי סטטוס ל־${statusHe(to)}`
    }
    case 'assigned':
      return 'שויכה לטכנאי פנימי'
    case 'created': {
      const source = p.source ? sourceHe(String(p.source)) : null
      return source ? `תקלה נפתחה · ${source}` : 'תקלה נפתחה'
    }
    case 'sla_breached':
      return 'חריגת SLA'
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
      if (p.ok === false && line) return `WA למנהל החנות — לא נמסר (${line})`
      if (line) return `WA למנהל החנות · ${line}`
      return 'נשלח WA למנהל החנות עם פרטי איש המקצוע'
    }
    case 'pro_sms': {
      const line = typeof p.line === 'string' ? p.line : null
      if (p.ok === false && line) return `SMS לאיש מקצוע — לא נשלח (${line})`
      return line || 'נשלח SMS לאיש מקצוע עם קישור אישי'
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
      return `דחיפות עודכנה${p.to ? ` → ${String(p.to)}` : ''}`
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
    return format(d, 'EEEE, d בMMMM', { locale: he })
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

export function ActivityLog({ events }: { events: AuditEvent[] }) {
  const [actionType, setActionType] = useState('')
  const [actor, setActor] = useState('')
  const [date, setDate] = useState('')
  const [entity, setEntity] = useState('')

  const types = useMemo(() => {
    const set = new Set(events.map((e) => e.event_type))
    return Array.from(set).sort()
  }, [events])

  const actors = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of events) {
      if (!e.actor_id) continue
      map.set(e.actor_id, actorLabel(e))
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1], 'he'))
  }, [events])

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (actionType && e.event_type !== actionType) return false
      if (actor === '__system__' && e.actor_id) return false
      if (actor && actor !== '__system__' && e.actor_id !== actor) return false
      if (date) {
        try {
          if (!isSameDay(parseISO(e.created_at), parseISO(date))) return false
        } catch {
          return false
        }
      }
      if (entity) {
        const q = entity.trim().toLowerCase()
        const hay =
          `${e.ticket_display ?? ''} ${e.ticket_id} ${e.store_code ?? ''} ${e.store_name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [events, actionType, actor, date, entity])

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

  const filterOn = Boolean(actionType || actor || date || entity)

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="neutral">
        יומן מערכתי של אירועי תקלות: פתיחה, שיוך, אישור איש מקצוע, הודעות למנהל /
        איש מקצוע, אישור חנות וסגירה. לא צ׳אט וואטסאפ מלא — רק מה שנרשם על התקלה.
      </Notice>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3">
        <div>
          <h2 className="t-section text-ink">יומן פעילות מערכת</h2>
          <p className="t-meta text-ink-2">
            {filtered.length} אירועים מוצגים · עדכני לפי זמן
          </p>
        </div>
        <span className="rounded-full bg-[var(--tenant-soft)] px-3 py-1 t-caption text-[var(--tenant)]">
          {filterOn ? 'סינון פעיל' : 'כל האירועים'}
        </span>
      </div>

      {filtered.length === 0 ? (
        <Panel flush elevated className="overflow-hidden">
          <EmptyState
            title="אין אירועים"
            description={
              filterOn
                ? 'נסו לשנות את הסינון.'
                : 'ברגע שנפתחת תקלה או מתבצעת פעולה עליה — היא תופיע כאן.'
            }
          />
        </Panel>
      ) : (
        <Panel flush elevated className="overflow-hidden">
          <div className="divide-y divide-border">
            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="sticky top-0 z-10 border-b border-border bg-surface-sunken/90 px-4 py-2 t-caption text-ink-2 backdrop-blur">
                  {group.label}
                  <span className="ms-2 t-num text-ink-3">{group.items.length}</span>
                </h2>
                <ul className="divide-y divide-border/70">
                  {group.items.map((event) => {
                    const store = storeLabel(event)
                    return (
                      <li
                        key={event.id}
                        className="flex gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken/30"
                      >
                        <span
                          className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--tenant)]"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="t-body-strong text-ink">
                            {phraseEvent(event)}
                          </p>
                          <p className="t-meta mt-0.5 text-ink-2">
                            {event.ticket_display || event.ticket_id ? (
                              <Link
                                href={`/ops/tickets/${event.ticket_id}`}
                                className="text-[var(--tenant)] hover:underline"
                              >
                                {event.ticket_display ||
                                  event.ticket_id.slice(0, 8)}
                              </Link>
                            ) : (
                              '—'
                            )}
                            {store ? (
                              <span className="text-ink-3">{` · ${store}`}</span>
                            ) : null}
                            <span className="text-ink-3">
                              {' · '}
                              {actorLabel(event)}
                            </span>
                          </p>
                        </div>
                        <time
                          dateTime={event.created_at}
                          className="t-caption t-num shrink-0 text-ink-3"
                        >
                          {fmtTime(event.created_at)}
                        </time>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </Panel>
      )}

      <PhoneFoldStack>
        <PhoneFold title="סינון" summary={filterOn ? 'פעיל' : 'הכל'}>
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <Field label="סוג פעולה" htmlFor="activity-type">
              <Select
                id="activity-type"
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
                className="w-full min-w-0"
              >
                <option value="">הכל</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {TICKET_EVENT_LABELS_HE[t] ?? t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="מי ביצע" htmlFor="activity-actor">
              <Select
                id="activity-actor"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                className="w-full min-w-0"
              >
                <option value="">הכל</option>
                <option value="__system__">מערכת / אוטומציה</option>
                {actors.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="תאריך" htmlFor="activity-date">
              <Input
                id="activity-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full min-w-0"
              />
            </Field>
            <Field label="תקלה / סניף" htmlFor="activity-entity">
              <Input
                id="activity-entity"
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                placeholder="OC-… או קוד סניף"
                className="w-full min-w-0"
              />
            </Field>
          </div>
        </PhoneFold>
      </PhoneFoldStack>
    </div>
  )
}
