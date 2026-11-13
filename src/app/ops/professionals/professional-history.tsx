'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PhoneSheet } from '@/components/mobile'
import { usePhrase } from '@/components/i18n/locale-provider'
import { formatIls } from '@/modules/spend/true-cost'
import type { ProfessionalVisitRow } from '@/modules/engagements/service'

function formatVisitDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('he-IL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function ProfessionalHistoryButton({
  name,
  visits,
}: {
  name: string
  visits: ProfessionalVisitRow[]
}) {
  const p = usePhrase()
  const [open, setOpen] = useState(false)

  const summary = useMemo(() => {
    const approved = visits.filter((v) => v.status === 'locked' && v.approvedAmount > 0)
    const total = approved.reduce((sum, v) => sum + v.approvedAmount, 0)
    const storeCounts = new Map<string, number>()
    for (const v of visits) {
      const key = v.storeCode || v.storeName
      storeCounts.set(key, (storeCounts.get(key) ?? 0) + 1)
    }
    const repeats = [...storeCounts.values()].filter((n) => n > 1).length
    return { visits: visits.length, total, repeats }
  }, [visits])

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="min-h-[44px] min-w-[44px] px-0"
        aria-label={`${p('היסטוריה')} ${name}`}
        title={p('היסטוריית טיפולים')}
        onClick={() => setOpen(true)}
      >
        <History className="h-4 w-4" aria-hidden />
      </Button>
      <PhoneSheet
        open={open}
        onOpenChange={setOpen}
        title={p('היסטוריית טיפולים')}
        description={name}
      >
        <div className="flex flex-col gap-3 px-1 pb-4">
          <div className="grid grid-cols-3 gap-2 rounded-[var(--radius-md)] border border-border bg-surface-sunken/40 px-3 py-2.5">
            <div>
              <p className="t-caption text-ink-3">{p('ביקורים')}</p>
              <p className="t-body-strong t-num text-ink">{summary.visits}</p>
            </div>
            <div>
              <p className="t-caption text-ink-3">{p('סה״כ שאושר')}</p>
              <p className="t-body-strong t-num text-ink">
                {summary.total > 0 ? formatIls(summary.total) : '—'}
              </p>
            </div>
            <div>
              <p className="t-caption text-ink-3">{p('חנויות חוזרות')}</p>
              <p className="t-body-strong t-num text-ink">{summary.repeats}</p>
            </div>
          </div>

          {visits.length === 0 ? (
            <p className="t-body text-ink-2">{p('אין עדיין ביקורים שמורים')}</p>
          ) : (
            <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border">
              {visits.map((visit) => (
                <li key={visit.engagementId} className="flex flex-col gap-1 px-3 py-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="t-body-strong text-ink">
                      #{visit.storeCode} · {visit.storeName}
                    </p>
                    <span className="t-caption t-num text-ink-3">
                      {formatVisitDate(visit.approvedAt)}
                    </span>
                  </div>
                  <p className="t-meta text-ink-2">
                    {visit.status === 'cancelled' ? p('בוטל') : p('אושר')}
                    {visit.approvedAmount > 0
                      ? ` · ${formatIls(visit.approvedAmount)}`
                      : ''}
                  </p>
                  <Link
                    href={`/ops/tickets/${visit.ticketId}`}
                    className="t-caption text-[var(--tenant)] underline-offset-2 hover:underline"
                    onClick={() => setOpen(false)}
                  >
                    {p('פתח תקלה')}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PhoneSheet>
    </>
  )
}
