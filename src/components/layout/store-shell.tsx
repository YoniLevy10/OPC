'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ClipboardList, PlusCircle } from 'lucide-react'
import { LocaleSwitcher } from '@/components/i18n/locale-switcher'
import { usePhrase } from '@/components/i18n/locale-provider'
import { LogoutButton } from '@/components/auth/logout-button'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { BrandMark } from '@/components/brand/brand-mark'
import { PhoneShell, PhoneTabBar } from '@/components/mobile'

export function StoreShell({
  children,
  storeName,
  storeCode,
}: {
  children: React.ReactNode
  storeName?: string
  storeCode?: string
}) {
  const pathname = usePathname() ?? ''
  const p = usePhrase()

  const tabs = [
    {
      href: '/store',
      label: p('התקלות שלי'),
      icon: ClipboardList,
      match: '/store',
    },
    {
      href: '/store/report',
      label: p('דיווח גיבוי'),
      icon: PlusCircle,
      match: '/store/report',
    },
  ]

  // Exact match for home so /store/tickets/* does not light up "report"
  const tabItems = tabs.map((item) => ({
    ...item,
    match: item.href === '/store' ? '__store_home__' : item.match,
  }))
  const activePath =
    pathname === '/store' || pathname.startsWith('/store/tickets')
      ? '__store_home__'
      : pathname

  return (
    <PhoneShell
      padForTabBar
      enablePullToRefresh
      mainClassName="max-w-lg"
      header={
        <header className="apple-glass safe-pt sticky top-0 z-20 shrink-0 border-b border-border bg-background md:static">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <BrandMark size={32} className="rounded-[var(--radius-md)]" alt="" />
              <div className="min-w-0">
                <p className="t-body-strong truncate text-ink">
                  {p('Optical Center · חנות')}
                </p>
                {storeName ? (
                  <p className="t-caption truncate text-ink-3">
                    {storeName}
                    {storeCode ? ` · #${storeCode}` : ''}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <LocaleSwitcher />
              <ThemeToggle compact />
              <LogoutButton size="sm" variant="secondary" />
            </div>
          </div>
          {/* Desktop / larger: keep segmented links in header */}
          <nav
            aria-label={p('ניווט חנות')}
            className="mx-auto hidden max-w-lg gap-2 px-4 pb-3 md:flex"
          >
            {tabs.map((item) => {
              const active =
                item.href === '/store'
                  ? pathname === '/store' || pathname.startsWith('/store/tickets')
                  : pathname === item.match || pathname.startsWith(`${item.match}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={
                    active
                      ? 't-control flex-1 rounded-md bg-tenant-soft py-2.5 text-center font-medium text-tenant'
                      : 't-control flex-1 rounded-md py-2.5 text-center text-ink-3'
                  }
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </header>
      }
      tabBar={
        <PhoneTabBar
          pathname={activePath}
          ariaLabel={p('ניווט חנות')}
          items={tabItems}
        />
      }
    >
      {children}
    </PhoneShell>
  )
}
