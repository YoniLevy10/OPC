'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { usePhrase } from '@/components/i18n/locale-provider'
import type { CostGrain } from '@/modules/reports/summary'
import { defaultCostGrain } from '@/modules/reports/summary'

export type ReportExportQuery = {
  from?: string
  to?: string
  month?: string
  store?: string
  status?: string
}

function exportHref(
  format: 'csv' | 'xlsx' | 'pdf',
  query: ReportExportQuery,
  grain: CostGrain,
) {
  const params = new URLSearchParams({ format, grain })
  if (query.from) params.set('from', query.from)
  if (query.to) params.set('to', query.to)
  if (query.month) params.set('month', query.month)
  if (query.store) params.set('store', query.store)
  if (query.status) params.set('status', query.status)
  return `/api/reports/export?${params.toString()}`
}

const GRAINS: CostGrain[] = ['day', 'week', 'month', 'year']

export function ReportsExportActions({
  query,
  count,
  className,
}: {
  query: ReportExportQuery
  count: number
  className?: string
}) {
  const p = usePhrase()
  const autoGrain = useMemo(
    () => defaultCostGrain(query.from, query.to),
    [query.from, query.to],
  )
  const [grain, setGrain] = useState<CostGrain>(autoGrain)
  const [grainTouched, setGrainTouched] = useState(false)
  const activeGrain = grainTouched ? grain : autoGrain

  function download(format: 'csv' | 'xlsx' | 'pdf') {
    window.location.href = exportHref(format, query, activeGrain)
  }

  const grainLabel = (value: CostGrain) => {
    if (value === 'day') return p('יום')
    if (value === 'week') return p('שבוע')
    if (value === 'month') return p('חודש')
    return p('שנה')
  }

  return (
    <div
      className={
        className ??
        'flex flex-wrap items-center gap-2 max-md:flex-col max-md:items-stretch'
      }
    >
      <label className="flex flex-wrap items-center gap-1.5">
        <span className="t-caption text-ink-3">{p('פירוק')}</span>
        <select
          className="t-control h-8 rounded-[var(--radius-md)] border border-border bg-surface px-2 text-ink"
          value={activeGrain}
          onChange={(e) => {
            setGrainTouched(true)
            setGrain(e.target.value as CostGrain)
          }}
          aria-label={p('פירוק לפי תקופה')}
        >
          {GRAINS.map((value) => (
            <option key={value} value={value}>
              {grainLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="max-md:w-full"
        onClick={() => download('csv')}
      >
        {p('ייצוא CSV')}
        {count > 0 ? ` (${count})` : ''}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="max-md:w-full"
        onClick={() => download('xlsx')}
      >
        Excel
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="max-md:w-full"
        onClick={() => download('pdf')}
      >
        PDF
      </Button>
    </div>
  )
}
