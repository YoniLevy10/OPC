'use client'

import { BackButton } from '@/components/layout/back-button'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { BrandMark } from '@/components/brand/brand-mark'
import { PhoneShell, PhoneActionDock } from '@/components/mobile'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'
import { usePhrase } from '@/components/i18n/locale-provider'
import { LogoutButton } from '@/components/auth/logout-button'

/**
 * Field technician shell — PhoneKit chrome, not HQ.
 *
 *  - no HQ navigation / no tab bar (one destination: jobs)
 *  - primary action sticky at the thumb via PhoneActionDock
 *  - page titles live in OpsPageHero; header is brand / back only
 */
export function TechShell({
  children,
  title,
  backHref,
  backLabel = 'חזרה לעבודות',
  actions,
  headerActions,
  enablePullToRefresh = true,
}: {
  children: React.ReactNode
  /** Compact header context on detail (next to back). */
  title?: string
  backHref?: string
  backLabel?: string
  actions?: React.ReactNode
  headerActions?: React.ReactNode
  enablePullToRefresh?: boolean
}) {
  const p = usePhrase()
  const hasDock = Boolean(actions)

  return (
    <PhoneShell
      enablePullToRefresh={enablePullToRefresh}
      padForTabBar={false}
      padForDock={hasDock}
      mainClassName="max-w-lg"
      header={
        <header className="apple-glass safe-pt sticky top-0 z-20 shrink-0 border-b border-border bg-background md:static">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {backHref ? (
                <BackButton href={backHref} label={backLabel} />
              ) : (
                <BrandMark size={32} className="rounded-[var(--radius-md)]" alt="" />
              )}
              <div className="min-w-0">
                {backHref ? (
                  <>
                    <p className="t-caption truncate text-ink-3">
                      {p('Optical Center · טכנאי')}
                    </p>
                    {title ? (
                      <p className="t-body-strong truncate text-ink">{p(title)}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="t-body-strong truncate text-ink">
                    {p('Optical Center · טכנאי')}
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {headerActions}
              <LocaleSwitcher />
              <ThemeToggle compact />
              <LogoutButton size="sm" variant="secondary" className="shrink-0" />
            </div>
          </div>
        </header>
      }
      dock={
        hasDock ? (
          <PhoneActionDock label={p('פעולות עבודה')} aboveTabBar={false}>
            {actions}
          </PhoneActionDock>
        ) : undefined
      }
    >
      {children}
    </PhoneShell>
  )
}

export { techHref } from '@/lib/tech-href'
