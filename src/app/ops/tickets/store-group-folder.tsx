'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function StoreGroupFolder({
  title,
  code,
  count,
  countLabel,
  defaultOpen = false,
  children,
}: {
  title: string
  code?: string | null
  count: number
  countLabel: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface">
      <button
        type="button"
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-start"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0">
          <span className="t-body-strong block truncate text-ink">{title}</span>
          {code && code !== title ? (
            <span className="t-meta t-num mt-0.5 block text-ink-3">{code}</span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="t-caption rounded-full bg-surface-sunken px-2.5 py-1 text-ink-2">
            <span className="t-num">{count}</span> {countLabel}
          </span>
          <ChevronDown
            className={cn(
              'h-5 w-5 text-ink-3 transition-transform',
              open && 'rotate-180',
            )}
            aria-hidden
          />
        </span>
      </button>
      {open ? <div className="border-t border-border">{children}</div> : null}
    </section>
  )
}
