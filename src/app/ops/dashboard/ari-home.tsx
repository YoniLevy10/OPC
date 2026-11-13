'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { usePhrase } from '@/components/i18n/locale-provider'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { AriHomeModel, AriHomeStore } from '@/modules/ops/ari-home'
import { isNoPriceYet } from '@/modules/recommendations/estimate'
export type AriHomeStats = {
  open: number
  closedToday: number
  overdue: number
  awaitingApproval: number
}

function StoreFolder({
  store,
  open,
  onToggle,
  ticketCost,
  storeCost,
}: {
  store: AriHomeStore
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
  const recorded = range && !isNoPriceYet(range) ? range : null

  return (
    <article
      data-active={open ? 'true' : undefined}
      className={cn(
        'overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-1)] transition-shadow hover:shadow-[var(--shadow-2)]',
        open && 'col-span-full',
        !open && openHere > 0 && 'border-[color-mix(in_srgb,var(--tenant)_28%,var(--border))]',
      )}
    >
      <h3>
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={cn(
            'flex w-full text-start transition-colors hover:bg-surface-sunken/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--tenant)]',
            open
              ? 'min-h-[3.75rem] items-center justify-between gap-3 px-4 py-3'
              : 'h-full min-h-[4.5rem] flex-col justify-between gap-1.5 px-3 py-2.5',
          )}
        >
          <span className="min-w-0 w-full">
            <span className="t-body-strong block truncate text-ink">{store.name}</span>
            {store.code ? (
              <span className="t-meta t-num block text-ink-3">{store.code}</span>
            ) : null}
          </span>
          <span
            className={cn(
              'flex shrink-0 items-center gap-2',
              open ? 'justify-end' : 'w-full justify-between',
            )}
          >
            <span
              className={cn(
                't-caption t-num font-semibold',
                openHere > 0 ? 'text-[var(--tenant)]' : 'text-ink-3',
              )}
            >
              {openHere > 0
                ? `${openHere} ${openHere === 1 ? p('פתוחה') : p('פתוחות')}`
                : p('שקט')}
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-ink-3 transition-transform duration-[var(--dur-1)]',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </span>
        </button>
      </h3>

      {open ? (
        <div className="border-t border-border">
          {recorded ? (
            <div className="flex items-baseline justify-between gap-3 px-4 py-3">
              <p className="t-meta text-ink-3">{p('נרשם')}</p>
              <p className="t-body-strong t-num text-end text-ink">{recorded}</p>
            </div>
          ) : null}
          {store.categories.map((category) => (
            <section
              key={category.key}
              className={cn(
                'border-t border-border/80',
                !recorded && 'first:border-t-0',
              )}
            >
              <div className="flex items-center gap-3 px-4 py-2">
                <h4 className="t-caption text-ink-3">{category.label}</h4>
                {category.urgent ? (
                  <Button asChild variant="primary" size="sm" className="shrink-0">
                    <Link href={category.actionHref}>{category.actionLabel}</Link>
                  </Button>
                ) : (
                  <Link
                    href={category.actionHref}
                    className="t-meta shrink-0 text-ink"
                  >
                    {category.actionLabel}
                  </Link>
                )}
              </div>
              <ul className="divide-y divide-border">
                {category.rows.map((row) => {
                  const price = ticketCost[row.id]
                  const shownPrice =
                    price && !isNoPriceYet(price) ? price : null
                  return (
                    <li key={row.id}>
                      <Link
                        href={row.href}
                        className={cn(
                          'block min-w-0 px-4 py-3 transition-colors hover:bg-surface-sunken/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[var(--tenant)]',
                          row.overdue && 'edge edge-overdue',
                        )}
                      >
                        <span className="t-body block text-ink">{row.problem}</span>
                        <span className="t-meta mt-0.5 flex flex-wrap items-center gap-x-1.5 text-ink-3">
                          <span
                            className={cn(
                              row.overdue &&
                                'font-semibold text-[var(--tenant)]',
                            )}
                          >
                            {row.openFor}
                          </span>
                          <span aria-hidden>·</span>
                          <span
                            className={cn(
                              (row.awaiting || row.engaged) &&
                                'font-semibold text-[var(--tenant)]',
                            )}
                          >
                            {row.status}
                          </span>
                          {shownPrice ? (
                            <>
                              <span aria-hidden>·</span>
                              <span className="t-num">{shownPrice}</span>
                            </>
                          ) : null}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
              {category.prevention ? (
                <p className="t-meta border-t border-border px-4 py-3 text-ink-2">
                  {category.prevention}
                </p>
              ) : null}
            </section>
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
  // Start collapsed so the store grid stays scannable; expand one in place.
  const [openStore, setOpenStore] = useState<string | null>(null)
  const [storeQuery, setStoreQuery] = useState('')
  const storeQ = storeQuery.trim().toLowerCase()
  const visibleStores = storeQ
    ? model.stores.filter((store) =>
        `${store.name} ${store.code ?? ''}`.toLowerCase().includes(storeQ),
      )
    : model.stores
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

      <div className="phone-metrics grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
        {metrics.map((metric) => (
          <Link
            key={metric.label}
            href={metric.href}
            className="flex min-h-[3.75rem] min-w-0 flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-surface px-3 py-2.5 md:min-h-[5.25rem] md:px-4 md:py-4"
          >
            <span
              className={cn(
                't-display t-num block text-[1.5rem] font-semibold leading-none tracking-tight md:text-[2rem]',
                metric.accent ? 'text-[var(--tenant)]' : 'text-ink',
              )}
            >
              {metric.value}
            </span>
            <span className="t-caption mt-1.5 block text-ink-2 md:mt-3 md:text-[13.5px] md:font-normal md:leading-[1.5]">
              {metric.label}
            </span>
          </Link>
        ))}
      </div>

      {recordedSummary ? (
        <div className="flex items-baseline justify-between gap-3 border-b border-border py-1">
          <p className="t-meta text-ink-2">{p('נרשם על התקלות הפתוחות')}</p>
          <p className="t-body-strong t-num text-ink">{recordedSummary}</p>
        </div>
      ) : null}

      {model.stores.length > 0 ? (
        <section className="rounded-[var(--radius-xl)] border border-border/70 bg-surface-sunken/20 p-3 sm:p-4">
          <header className="mb-3 flex flex-col gap-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h2 className="t-section text-ink">{p('תקלות לפי חנות')}</h2>
                <span aria-hidden className="clay-rule" />
              </div>
              <span className="t-meta t-num text-ink-3">
                {storeQuery.trim()
                  ? `${visibleStores.length}/${model.stores.length}`
                  : model.stores.length}
              </span>
            </div>
            <SearchField
              value={storeQuery}
              onValueChange={setStoreQuery}
              placeholder={p('שם או קוד סניף')}
              className="w-full max-w-md"
            />
          </header>
          {visibleStores.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
              {visibleStores.map((store) => (
                <StoreFolder
                  key={store.id}
                  store={store}
                  open={openStore === store.id}
                  onToggle={() =>
                    setOpenStore(openStore === store.id ? null : store.id)
                  }
                  ticketCost={ticketCost}
                  storeCost={storeCost}
                />
              ))}
            </div>
          ) : (
            <p className="t-body rounded-[var(--radius-md)] bg-surface px-4 py-4 text-ink-2">
              {p('לא נמצאו חנויות')}
            </p>
          )}
        </section>
      ) : (
        <p className="t-title rounded-[var(--radius-md)] bg-surface-sunken px-4 py-8 text-center text-ink-2">
          {p('הכל שקט')}
        </p>
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
