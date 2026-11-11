'use client'

import { cn } from '@/lib/utils'
import { SkipLink } from '@/components/layout/skip-link'
import { LiveSync } from '@/components/layout/live-sync'
import { PullToRefresh } from '@/components/layout/pull-to-refresh'

/**
 * Shared phone chrome: safe-area, optional header, scroll main, tab/dock slots.
 * Desktop chrome stays in AppShell — this is the mobile composition contract.
 */
export function PhoneShell({
  children,
  header,
  tabBar,
  dock,
  fillMain = false,
  enablePullToRefresh = true,
  className,
  mainClassName,
  padForTabBar = true,
  padForDock = false,
}: {
  children: React.ReactNode
  header?: React.ReactNode
  tabBar?: React.ReactNode
  dock?: React.ReactNode
  fillMain?: boolean
  enablePullToRefresh?: boolean
  className?: string
  mainClassName?: string
  /** Reserve space for PhoneTabBar */
  padForTabBar?: boolean
  /** Reserve space for PhoneActionDock */
  padForDock?: boolean
}) {
  const body = (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        'mx-auto min-w-0 w-full outline-none max-md:overflow-x-clip',
        fillMain
          ? 'ops-main-fill min-h-0 flex-1 px-0'
          : 'scroll-edge-fade min-h-0 flex-1 overflow-x-clip overflow-y-auto overscroll-y-auto px-4 pt-5',
        padForTabBar && !fillMain && 'phone-pad-tab',
        padForDock && 'phone-pad-dock',
        mainClassName,
      )}
    >
      {children}
    </main>
  )

  return (
    <div
      className={cn(
        'ops-atmosphere phone-shell dvh-screen flex min-w-0 flex-col overflow-x-hidden text-ink',
        fillMain && 'ops-shell-fill',
        className,
      )}
    >
      <SkipLink />
      <LiveSync />
      {header}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {enablePullToRefresh && !fillMain ? (
          <PullToRefresh className="flex min-h-0 flex-1 flex-col">{body}</PullToRefresh>
        ) : (
          body
        )}
      </div>
      {dock}
      {tabBar}
    </div>
  )
}
