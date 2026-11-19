'use client'

import { useEffect, useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { enUS, fr, he } from 'date-fns/locale'
import { useLocale, usePhrase } from '@/components/i18n/locale-provider'
import type { Locale } from '@/lib/i18n/locale'
import { EmptyState, Panel, PanelHeader } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import type {
  AlertBucket,
  AlertMessage,
  AlertSource,
  AlertSourceHealth,
  OpsAlert,
} from '@/modules/alerts/types'
import { filterAlerts, splitAlertBuckets } from '@/modules/alerts/types'
import {
  countUnseenAlerts,
  loadSeenAlertIds,
  markAlertsSeen,
  syncAppBadge,
} from '@/modules/alerts/read-state'
import { PhoneFold, PhoneFoldStack } from '@/components/layout/phone-fold'
import { PhoneList, PhoneRow } from '@/components/mobile'

const BUCKET_KEYS: { key: AlertBucket | 'open'; he: string }[] = [
  { key: 'open', he: 'פעולות פתוחות' },
  { key: 'urgent_overdue', he: 'דחוף / באיחור' },
  { key: 'needs_decision', he: 'דורש החלטה' },
  { key: 'waiting', he: 'ממתין למישהו' },
]

const SOURCE_LABEL_HE: Record<AlertSource, string> = {
  ticket: 'תקלה',
  spend: 'הוצאה',
  document: 'מסמך',
  verify: 'אימות',
  task: 'משימה',
  conflict: 'סתירה',
  store_confirm: 'אישור חנות',
}

function dateFnsLocale(locale: Locale) {
  if (locale === 'fr') return fr
  if (locale === 'en') return enUS
  return he
}

function fmtWhen(iso: string, locale: Locale): string {
  try {
    return format(parseISO(iso), 'd/M HH:mm', { locale: dateFnsLocale(locale) })
  } catch {
    return iso
  }
}

export function AlertsClient({
  open,
  history,
  sources,
  partialFailure,
}: {
  open: OpsAlert[]
  history: AlertMessage[]
  sources: AlertSourceHealth
  partialFailure: boolean
}) {
  const p = usePhrase()
  const { locale } = useLocale()
  const [bucket, setBucket] = useState<AlertBucket | 'open'>('open')
  const [storeCode, setStoreCode] = useState('')
  const [source, setSource] = useState<AlertSource | 'all'>('all')
  const [q, setQ] = useState('')
  const [unseen, setUnseen] = useState(0)

  // On entering alerts: mark currently open items as read and sync home-screen badge.
  useEffect(() => {
    const ids = open.map((alert) => alert.id)
    const seen = markAlertsSeen(ids)
    const remaining = countUnseenAlerts(ids, seen)
    setUnseen(remaining)
    void syncAppBadge(remaining)
  }, [open])

  // Keep badge in sync when open set changes without remount (e.g. soft nav).
  useEffect(() => {
    const ids = open.map((alert) => alert.id)
    setUnseen(countUnseenAlerts(ids, loadSeenAlertIds()))
  }, [open])

  const stores = useMemo(() => {
    const map = new Map<string, string>()
    for (const alert of open) {
      if (alert.storeCode && alert.storeCode !== '—') {
        map.set(alert.storeCode, alert.storeName)
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he'))
  }, [open])

  const filtered = useMemo(
    () =>
      filterAlerts(open, {
        bucket,
        storeCode: storeCode || null,
        source,
        q,
      }),
    [open, bucket, storeCode, source, q],
  )

  const counts = splitAlertBuckets(open)

  const storeGroups = useMemo(() => {
    const rank = (severity: OpsAlert['severity']) =>
      severity === 'critical' ? 0 : severity === 'high' ? 1 : severity === 'medium' ? 2 : 3
    const map = new Map<string, OpsAlert[]>()
    for (const alert of filtered) {
      const key = alert.storeCode && alert.storeCode !== '—' ? alert.storeCode : 'none'
      const list = map.get(key) ?? []
      list.push(alert)
      map.set(key, list)
    }
    return [...map.entries()].map(([key, alerts]) => {
      const hottest = [...alerts].sort((a, b) => rank(a.severity) - rank(b.severity))[0]
      return {
        key,
        name: hottest?.storeName || p('בלי סניף'),
        alerts,
        hottest: hottest?.nextAction ?? '',
      }
    })
  }, [filtered, p])

  function alertPriority(
    severity: OpsAlert['severity'],
  ): 'critical' | 'high' | 'medium' | 'low' | null {
    if (severity === 'critical') return 'critical'
    if (severity === 'high') return 'high'
    if (severity === 'medium') return 'medium'
    if (severity === 'low') return 'low'
    return null
  }

  function alertRow(alert: OpsAlert, withStore = false) {
    const late = alert.reasons.some((reason) =>
      reason.includes('איחור') || reason.includes('SLA'),
    )
    const meta = [
      withStore && alert.storeName ? alert.storeName : null,
      late ? p('באיחור') : null,
      alert.nextAction,
    ]
      .filter(Boolean)
      .join(' · ')
    return (
      <PhoneRow
        key={alert.id}
        href={alert.href}
        priority={alertPriority(alert.severity)}
        leading={fmtWhen(alert.at, locale)}
        title={alert.title}
        subtitle={meta || undefined}
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {partialFailure ? (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--signal-warning)_45%,var(--border))] bg-[color-mix(in_srgb,var(--signal-warning)_10%,var(--surface))] px-4 py-3"
        >
          <p className="t-body text-ink">
            {p('לא ניתן להציג «הכל שקט» — טעינת מקור נכשלה.')}
          </p>
          <p className="t-meta mt-1 text-ink-2">
            {p('חלק מהמקורות לא נטענו')}
            {' · '}
            {p('תקלות')}:{' '}
            {sources.tickets === 'failed' ? p('נכשל') : p('תקין')}
            {' · '}
            {p('פנקס')}: {sources.ledger === 'failed' ? p('נכשל') : p('תקין')}
            {' · '}
            {p('היסטוריה')}:{' '}
            {sources.history === 'failed' ? p('נכשל') : p('תקין')}
          </p>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label={p('פעולות פתוחות')}
        className="grid w-full grid-cols-2 gap-1 rounded-[var(--radius-md)] border border-border bg-[var(--surface-sunken)]/50 p-1"
      >
        {BUCKET_KEYS.map((tab) => {
          const selected = bucket === tab.key
          const count =
            tab.key === 'open'
              ? open.length
              : counts[tab.key].length
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={cn(
                'w-full rounded-[var(--radius-sm)] px-3 py-2 t-meta transition-colors',
                selected
                  ? 'bg-surface text-ink shadow-[var(--shadow-1)]'
                  : 'text-ink-2 hover:text-ink',
              )}
              onClick={() => setBucket(tab.key)}
            >
              {p(tab.he)}
              <span className="ms-1 t-num text-ink-3">{count}</span>
            </button>
          )
        })}
      </div>

      <PhoneFoldStack>
      <PhoneFold title={p('סינון')} summary={q || storeCode || source !== 'all' ? p('פעיל') : p('הכל')}>
      <div className="flex min-w-0 flex-col gap-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="t-meta text-ink-3">{p('חיפוש')}</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={p('כותרת, סניף, סיבה…')}
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 t-body"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="t-meta text-ink-3">{p('סינון לפי חנות')}</span>
          <select
            value={storeCode}
            onChange={(e) => setStoreCode(e.target.value)}
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 t-body"
          >
            <option value="">{p('כל הסניפים בהיקף')}</option>
            {stores.map(([code, name]) => (
              <option key={code} value={code}>
                {code} · {name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="t-meta text-ink-3">{p('מקור')}</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as AlertSource | 'all')}
            className="rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2 t-body"
          >
            <option value="all">{p('כל המקורות')}</option>
            {(Object.keys(SOURCE_LABEL_HE) as AlertSource[]).map((key) => (
              <option key={key} value={key}>
                {p(SOURCE_LABEL_HE[key])}
              </option>
            ))}
          </select>
        </label>
      </div>
      </PhoneFold>

      <Panel elevated>
        <PanelHeader
          title={p('פעולות פתוחות')}
          meta={
            unseen > 0
              ? `${filtered.length} · ${unseen} ${p('לא נקראו')}`
              : String(filtered.length)
          }
        />
        {!partialFailure && filtered.length === 0 ? (
          <EmptyState title={p('אין פעולות פתוחות')} />
        ) : partialFailure && filtered.length === 0 ? (
          <p className="t-body px-4 py-8 text-ink-2">
            {p('לא ניתן להציג «הכל שקט» — טעינת מקור נכשלה.')}
          </p>
        ) : (
          <>
          <div className="md:hidden">
            {storeGroups.map((group) => (
              <PhoneFold
                key={group.key}
                title={group.name}
                summary={`${group.alerts.length} · ${group.hottest}`}
              >
                <PhoneList>
                  {group.alerts.map((alert) => alertRow(alert))}
                </PhoneList>
              </PhoneFold>
            ))}
          </div>
          <PhoneList className="hidden md:block">
            {filtered.map((alert) => alertRow(alert, true))}
          </PhoneList>
          </>
        )}
      </Panel>

      <PhoneFold title={p('היסטוריית הודעות')} summary={String(history.length)}>
      <Panel>
        {history.length === 0 ? (
          <p className="t-body px-4 py-6 text-ink-3">
            {partialFailure && sources.history === 'failed'
              ? p('חלק מהמקורות לא נטענו')
              : p('עדיין אין אירועים')}
          </p>
        ) : (
          <PhoneList>
            {history.slice(0, 40).map((row) =>
              row.href ? (
                <PhoneRow
                  key={row.id}
                  href={row.href}
                  leading={fmtWhen(row.at, locale)}
                  title={row.summary}
                />
              ) : (
                <div
                  key={row.id}
                  className="flex min-h-12 items-center justify-between gap-3 px-4 py-3"
                >
                  <span className="t-body text-ink">{row.summary}</span>
                  <span className="t-meta t-num shrink-0 text-ink-3">
                    {fmtWhen(row.at, locale)}
                  </span>
                </div>
              ),
            )}
          </PhoneList>
        )}
      </Panel>
      </PhoneFold>
      </PhoneFoldStack>
    </div>
  )
}
