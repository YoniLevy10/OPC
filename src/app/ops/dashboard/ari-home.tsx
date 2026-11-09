'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { usePhrase } from '@/components/i18n/locale-provider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AriHomeModel, AriHomeStore } from '@/modules/ops/ari-home'
export type AriHomeStats = {
  open: number
  closedToday: number
  overdue: number
  awaitingApproval: number
}

function storeNeedsDecision(store: AriHomeStore): boolean {
  return store.categories.some(
    (category) => category.urgent || category.rows.some((row) => row.overdue),
  )
}

function StoreFolder({
  store,
  tone,
  open,
  onToggle,
  ticketCost,
  storeCost,
}: {
  store: AriHomeStore
  tone: 'now' | 'quiet'
  open: boolean
  onToggle: () => void
  ticketCost: Record<string, string>
  storeCost: Record<string, string>
}) {
  const p = usePhrase()
  const openHere = store.categories.reduce(
    (sum, category) => sum + category.rows.length,
    0,
  )
  const range = storeCost[store.id]

  return (
    <article
      data-active={open ? 'true' : undefined}
      className={
        tone === 'now'
          ? 'overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-1)]'
          : 'overflow-hidden rounded-[var(--radius-md)] bg-surface-sunken'
      }
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
        >
          <span className="min-w-0">
            <span className="t-body-strong block truncate text-ink">{store.name}</span>
            {store.code ? (
              <span className="t-meta t-num block text-ink-3">{store.code}</span>
            ) : null}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="t-meta t-num text-ink-2">
              <span className="t-num">{openHere}</span> {p('פתוחות')}
            </span>
            <ChevronDown
              className={cn('h-4 w-4 text-ink-2 transition-transform', open && 'rotate-180')}
              aria-hidden
            />
          </span>
        </button>
      </h3>

      {open ? (
        <div className="border-t border-border">
          <div className="px-4 py-4">
            <p className="t-caption text-ink-3">{p('נרשם')}</p>
            {range ? (
              <p className="t-title t-num mt-1 text-ink">{range}</p>
            ) : (
              <p className="t-meta mt-1 text-ink-2">{p('אין עדיין מחיר')}</p>
            )}
            <p className="t-meta mt-1 text-ink-2">
              {p('רק סכום שנרשם על התקלות האלה')}
            </p>
          </div>
          {store.categories.map((category) => (
            <div key={category.key} className="border-t border-border first:border-t-0">
              <p className="t-caption px-4 pt-3 text-ink-3">{category.label}</p>
              <ul>
                {category.rows.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={row.href}
                      className={cn(
                        'flex min-w-0 items-start justify-between gap-3 px-4 py-3 hover:bg-surface/70',
                        row.overdue && 'edge edge-overdue',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="t-body block text-ink">{row.problem}</span>
                        <span
                          className={cn(
                            't-meta mt-1 block',
                            row.overdue
                              ? 'font-semibold text-[var(--tenant)]'
                              : 'text-ink-3',
                          )}
                        >
                          {row.openFor}
                        </span>
                        {ticketCost[row.id] ? (
                          <span className="t-meta t-num mt-1 block text-ink-2">
                            {ticketCost[row.id]}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          't-caption shrink-0',
                          row.awaiting
                            ? 'font-semibold text-[var(--tenant)]'
                            : 'text-ink-2',
                        )}
                      >
                        {row.status}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3 px-4 pb-3 max-md:flex-col max-md:items-stretch">
                <p className="t-meta min-w-0 text-ink-2">{category.advice}</p>
                {category.urgent ? (
                  <Button asChild variant="primary" size="sm" className="shrink-0 max-md:w-full">
                    <Link href={category.actionHref}>{category.actionLabel}</Link>
                  </Button>
                ) : (
                  <Link href={category.actionHref} className="t-meta shrink-0 text-ink">
                    {category.actionLabel}
                  </Link>
                )}
              </div>
              {category.prevention ? (
                <p className="t-meta px-4 pb-3 text-ink-2">{category.prevention}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function AriHomeBoard({
  model,
  stats,
  ticketCost = {},
  storeCost = {},
  recordedSummary = null,
  notice,
}: {
  model: AriHomeModel
  stats: AriHomeStats
  ticketCost?: Record<string, string>
  storeCost?: Record<string, string>
  recordedSummary?: string | null
  notice: string | null
}) {
  const p = usePhrase()
  const nowStores = model.stores.filter(storeNeedsDecision)
  const quietStores = model.stores.filter((store) => !storeNeedsDecision(store))
  const [openStore, setOpenStore] = useState<string | null>(
    () => model.stores.find(storeNeedsDecision)?.id ?? model.stores[0]?.id ?? null,
  )
  const metrics: {
    href: string
    label: string
    value: number
    accent: boolean
  }[] = [
    {
      href: '/ops/tickets?view=open',
      label: p('פתוחות'),
      value: stats.open,
      accent: false,
    },
    {
      href: '/ops/tickets?view=resolved',
      label: p('נסגרו היום'),
      value: stats.closedToday,
      accent: false,
    },
    {
      href: '/ops/tickets?view=attention',
      label: p('באיחור'),
      value: stats.overdue,
      accent: stats.overdue > 0,
    },
    {
      href: '/ops/tickets?view=urgent',
      label: p('מחכות לאישור'),
      value: stats.awaitingApproval,
      accent: stats.awaitingApproval > 0,
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <p role="status" className="t-body text-ink">
          {notice}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        {metrics.map((metric) => (
          <Link
            key={metric.label}
            href={metric.href}
            className="flex min-h-[5.75rem] min-w-0 flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-4"
          >
            <span
              className={cn(
                't-num block text-[2.125rem] font-semibold leading-none tracking-tight',
                metric.accent ? 'text-[var(--tenant)]' : 'text-ink',
              )}
            >
              {metric.value}
            </span>
            <span className="t-body mt-3 block text-ink-2">{metric.label}</span>
          </Link>
        ))}
      </div>

      {recordedSummary ? (
        <div className="flex items-baseline justify-between gap-3 border-b border-border py-1">
          <p className="t-meta text-ink-2">{p('נרשם על התקלות הפתוחות')}</p>
          <p className="t-body-strong t-num text-ink">{recordedSummary}</p>
        </div>
      ) : null}

      {model.stores.length === 0 ? (
        <p className="t-title rounded-[var(--radius-md)] bg-surface-sunken px-4 py-8 text-center text-ink-2">
          {p('הכל שקט')}
        </p>
      ) : (
        <>
          {nowStores.length > 0 ? (
            <section>
              <header className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h2 className="t-section text-ink">{p('עכשיו')}</h2>
                  <span aria-hidden className="clay-rule" />
                </div>
                <span className="t-meta t-num text-ink-3">{nowStores.length}</span>
              </header>
              <div className="store-stack">
                {nowStores.map((store) => (
                  <StoreFolder
                    key={store.id}
                    store={store}
                    tone="now"
                    open={openStore === store.id}
                    onToggle={() => setOpenStore(openStore === store.id ? null : store.id)}
                    ticketCost={ticketCost}
                    storeCost={storeCost}
                  />
                ))}
              </div>
            </section>
          ) : (
            <p className="t-body rounded-[var(--radius-md)] bg-surface-sunken px-4 py-4 text-ink-2">
              {p('הכל שקט')}
            </p>
          )}

          {quietStores.length > 0 ? (
            <section>
              <header className="mb-3 flex items-end justify-between gap-3">
                <h2 className="t-section text-ink-2">{p('שקט')}</h2>
                <span className="t-meta t-num text-ink-3">{quietStores.length}</span>
              </header>
              <div className="flex flex-col gap-2">
                {quietStores.map((store) => (
                  <StoreFolder
                    key={store.id}
                    store={store}
                    tone="quiet"
                    open={openStore === store.id}
                    onToggle={() => setOpenStore(openStore === store.id ? null : store.id)}
                    ticketCost={ticketCost}
                    storeCost={storeCost}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      {model.moreStores > 0 ? (
          <div className="px-1 py-3">
            <Link href="/ops/tickets?view=open" className="t-body-strong text-ink">
              {p('עוד סניפים')}
              <span className="t-num"> {model.moreStores}</span>
            </Link>
          </div>
        ) : null}
    </div>
  )
}
