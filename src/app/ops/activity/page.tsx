import Link from 'next/link'
import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { PhoneFold, PhoneFoldStack } from '@/components/layout/phone-fold'
import { ActivityLog } from './activity-log'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { listRecentAuditEvents } from '@/modules/audit/service'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'
import { cn } from '@/lib/utils'

export const dynamic = 'force-dynamic'

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function presetRange(key: string | undefined): { from?: string; to?: string } {
  const today = new Date()
  const to = ymd(today)
  if (key === '7d') {
    const from = new Date(today)
    from.setUTCDate(from.getUTCDate() - 6)
    return { from: ymd(from), to }
  }
  if (key === '30d') {
    const from = new Date(today)
    from.setUTCDate(from.getUTCDate() - 29)
    return { from: ymd(from), to }
  }
  if (key === 'month') {
    const from = `${to.slice(0, 7)}-01`
    return { from, to }
  }
  return {}
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; range?: string }>
}) {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')

  const sp = await searchParams
  const preset = presetRange(sp.range)
  const from = sp.from ?? preset.from
  const to = sp.to ?? preset.to

  const { events, slaCount, backend } = await listRecentAuditEvents(180, {
    from,
    to,
  })

  const rangeLabel =
    from && to
      ? `${from} – ${to}`
      : from
        ? p('מ-{from}', { from })
        : to
          ? p('עד-{to}', { to })
          : p('כל התקופה')

  const presets = [
    { key: undefined as string | undefined, label: p('כל התקופה') },
    { key: '7d', label: p('7 ימים') },
    { key: '30d', label: p('30 ימים') },
    { key: 'month', label: p('החודש') },
  ]

  return (
    <OpsAppShell>
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 stagger">
        <OpsPageHero
          title={p('היסטוריה')}
          status={`${events.length} ${p('ביומן')} · ${rangeLabel}${
            backend === 'memory' ? p(' · זיכרון') : ''
          }`}
        />
        <p className="t-meta text-ink-2">{p('יומן פעולות על תקלות')}</p>

        <PhoneFoldStack>
          <PhoneFold title={p('סינון')} summary={rangeLabel}>
            <div className="flex flex-wrap gap-2">
              {presets.map((row) => {
                const href = row.key
                  ? `/ops/activity?range=${row.key}`
                  : '/ops/activity'
                const active =
                  (row.key == null && !sp.range && !sp.from && !sp.to) ||
                  sp.range === row.key
                return (
                  <Link
                    key={row.label}
                    href={href}
                    className={cn(
                      't-control h-8 rounded-[var(--radius-md)] border px-2.5',
                      active
                        ? 'border-[var(--tenant)] bg-[var(--tenant-soft)] text-ink'
                        : 'border-border bg-surface text-ink-2 hover:text-ink',
                    )}
                  >
                    {row.label}
                  </Link>
                )
              })}
            </div>
          </PhoneFold>

          <PhoneFold
            title={p('יומן')}
            summary={`${events.length} ${p('פעולות')}`}
          >
            <ActivityLog events={events} slaCount={slaCount} />
          </PhoneFold>
        </PhoneFoldStack>
      </div>
    </OpsAppShell>
  )
}
