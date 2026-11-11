'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

export type PhoneTabItem = {
  href: string
  label: string
  icon: LucideIcon
  match: string
  ariaLabel?: string
}

function isActive(pathname: string, match: string) {
  return pathname === match || pathname.startsWith(`${match}/`)
}

/**
 * Floating glass bottom tab bar. Parent supplies items + optional trailing slot
 * (e.g. "More" button that opens a drawer).
 */
export function PhoneTabBar({
  pathname,
  items,
  trailing,
  className,
  ariaLabel = 'ניווט תחתון',
}: {
  pathname: string
  items: PhoneTabItem[]
  trailing?: React.ReactNode
  className?: string
  ariaLabel?: string
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn('phone-tabbar fixed inset-x-3 z-30 md:hidden', className)}
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + var(--bottomnav-gap))',
      }}
    >
      <ul
        className="apple-glass flex overflow-hidden rounded-[28px]"
        style={{ height: 'var(--phone-tab-h)' }}
      >
        {items.map((item) => {
          const active = isActive(pathname, item.match)
          const Icon = item.icon
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                aria-label={item.ariaLabel ?? item.label}
                className={cn(
                  'press-scale flex h-full flex-col items-center justify-center gap-1 transition-colors duration-[var(--dur-1)]',
                  active ? 'nav-pill-active' : 'text-ink-3',
                )}
              >
                <Icon className="h-6 w-6" aria-hidden />
                <span className="t-caption">{item.label}</span>
              </Link>
            </li>
          )
        })}
        {trailing ? <li className="flex-1">{trailing}</li> : null}
      </ul>
    </nav>
  )
}
