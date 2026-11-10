'use client'

import { useRef, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { BackButton } from '@/components/layout/back-button'
import { SkipLink } from '@/components/layout/skip-link'
import { LiveSync } from '@/components/layout/live-sync'
import { PullToRefresh } from '@/components/layout/pull-to-refresh'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { BrandMark } from '@/components/brand/brand-mark'
import { cn } from '@/lib/utils'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'
import { usePhrase } from '@/components/i18n/locale-provider'
import { LogoutButton } from '@/components/auth/logout-button'
import { SideDrawer } from '@/components/ui/overlay'

/**
 * The technician is a field worker on a phone, often one-handed, often with bad
 * signal. This shell is deliberately NOT the HQ shell:
 *
 *  - no HQ navigation of any kind
 *  - no bottom tab bar (there is only one destination — the job list)
 *  - the primary action is sticky at the thumb, not buried in a sidebar
 */
export function TechShell({
  children,
  title,
  subtitle,
  backHref,
  backLabel = 'חזרה לעבודות',
  eyebrow,
  actions,
  headerActions,
  enablePullToRefresh,
}: {
  children: React.ReactNode
  title: string
  subtitle?: React.ReactNode
  backHref?: string
  backLabel?: string
  eyebrow?: string
  actions?: React.ReactNode
  headerActions?: React.ReactNode
  enablePullToRefresh?: boolean
}) {
  const p = usePhrase()
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsRef = useRef<HTMLButtonElement>(null)
  const body = (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        'mx-auto w-full max-w-xl px-4 pt-5 outline-none',
        actions ? 'pb-actions scroll-pb-actions' : 'pb-8',
      )}
    >
      {children}
    </main>
  )

  return (
    <div className="ops-atmosphere dvh-screen text-ink">
      <SkipLink />
      <LiveSync />
      <header className="apple-glass safe-pt sticky top-0 z-20 border-b border-border bg-background">
        <div className="mx-auto flex max-w-xl items-start gap-2.5 px-4 py-3.5">
          {backHref ? <BackButton href={backHref} label={backLabel} /> : null}
          {!backHref ? (
            <BrandMark size={32} className="mt-0.5 rounded-[var(--radius-md)]" alt="" />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="t-caption text-ink-3">{p(eyebrow ?? 'Optical Center · טכנאי')}</p>
            <h1 className="t-title mt-0.5 break-words text-ink">{p(title)}</h1>
            {subtitle ? (
              <div className="t-meta mt-0.5 truncate text-ink-2">{subtitle}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            <div className="hidden items-center gap-1 md:flex">
              <LocaleSwitcher />
              <ThemeToggle compact />
              <LogoutButton size="touch" className="shrink-0" />
            </div>
            <button
              ref={optionsRef}
              type="button"
              aria-label={p('אפשרויות תצוגה וחשבון')}
              aria-expanded={optionsOpen}
              aria-haspopup="dialog"
              onClick={() => setOptionsOpen(true)}
              className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] text-ink-2 hover:bg-surface-sunken md:hidden"
            >
              <Ellipsis className="h-6 w-6" aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {enablePullToRefresh ? <PullToRefresh>{body}</PullToRefresh> : body}

      {actions ? (
        <div
          aria-label={p('פעולות עבודה')}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background"
          style={{ paddingBottom: 'var(--safe-b)' }}
        >
          <div className="safe-x mx-auto w-full max-w-xl py-3">{actions}</div>
        </div>
      ) : null}
      <SideDrawer open={optionsOpen} onOpenChange={setOptionsOpen} title={p('אפשרויות תצוגה וחשבון')} returnFocusRef={optionsRef}>
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-3">
            <span className="t-body text-ink-2">{p('שפה')}</span>
            <LocaleSwitcher />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="t-body text-ink-2">{p('ערכת נושא')}</span>
            <ThemeToggle compact />
          </div>
          <LogoutButton size="touch" variant="secondary" className="w-full" />
        </div>
      </SideDrawer>
    </div>
  )
}

export { techHref } from '@/lib/tech-href'
