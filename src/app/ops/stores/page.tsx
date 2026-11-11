import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Store } from 'lucide-react'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { EmptyState } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { StoreSearch } from './store-search'
import { StoreCreateForm } from './store-create-form'
import { StoreQrAccordion } from './store-qr-accordion'
import { StoreBoard, type StoreGroupModel } from './store-board'
import { fetchStores } from '@/modules/stores/data'
import { resolveWhatsAppBusinessPhone } from '@/modules/stores/business-phone'
import { storeWhatsAppDeepLink } from '@/modules/stores/whatsapp-link'
import { listTickets } from '@/modules/tickets/service'
import { OPEN_TICKET_STATUSES } from '@/modules/tickets/constants'
import { queueHref } from '@/modules/tickets/queue'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { scopeTicketsForActor } from '@/lib/auth/ticket-scope'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'
import { cn } from '@/lib/utils'
import {
  IL_ZONE_CODES,
  parseZoneParam,
  zoneFromRegionId,
  zoneLabel,
  type IlZoneCode,
} from '@/modules/stores/regions'

export const dynamic = 'force-dynamic'

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; region?: string }>
}) {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) {
    redirect('/login')
  }

  const sp = await searchParams
  const q = (sp.q ?? '').trim().toLowerCase()
  const zoneFilter = parseZoneParam(sp.region)
  const [{ stores }, businessPhone] = await Promise.all([
    fetchStores({ includeInactive: true }),
    resolveWhatsAppBusinessPhone(),
  ])

  // Same open slice as /ops/tickets?view=open — not "newest 500 of all statuses".
  const openResult = await listTickets({
    limit: 1000,
    statuses: [...OPEN_TICKET_STATUSES],
  }).catch(() => ({
    tickets: [] as Awaited<ReturnType<typeof listTickets>>['tickets'],
    backend: 'memory' as const,
  }))
  const openTickets = actor
    ? scopeTicketsForActor(actor, openResult.tickets ?? [])
    : (openResult.tickets ?? [])

  const openCountByStoreId = new Map<string, number>()
  const openCountByStoreCode = new Map<string, number>()
  for (const t of openTickets) {
    if (t.source === 'demo') continue
    if (t.store_id) {
      openCountByStoreId.set(
        t.store_id,
        (openCountByStoreId.get(t.store_id) ?? 0) + 1,
      )
    }
    const code = t.stores?.code
    if (code) {
      openCountByStoreCode.set(code, (openCountByStoreCode.get(code) ?? 0) + 1)
    }
  }

  function openCountFor(store: { id: string; code: string }) {
    return (
      openCountByStoreId.get(store.id) ??
      openCountByStoreCode.get(store.code) ??
      0
    )
  }

  const byZone = new Map<IlZoneCode, number>()
  for (const code of IL_ZONE_CODES) byZone.set(code, 0)
  for (const s of stores) {
    if (s.is_active === false) continue
    const zone = zoneFromRegionId(s.region_id)
    if (zone) byZone.set(zone, (byZone.get(zone) ?? 0) + 1)
  }
  const activeCount = stores.filter((s) => s.is_active !== false).length

  const filtered = stores
    .filter((s) => {
      if (zoneFilter && zoneFromRegionId(s.region_id) !== zoneFilter) {
        return false
      }
      if (!q) return true
      const hay =
        `${s.code} ${s.name} ${s.city ?? ''} ${s.address ?? ''} ${s.manager_name ?? ''} ${s.manager_phone ?? ''} ${s.area_manager ?? ''}`.toLowerCase()
      return hay.includes(q)
    })
    .sort((a, b) => {
      const openDelta = openCountFor(b) - openCountFor(a)
      if (openDelta !== 0) return openDelta
      return a.name.localeCompare(b.name, 'he')
    })

  const canMutate =
    actor?.memberships.some(
      (m) => m.role === 'global_admin' || m.role === 'country_manager',
    ) || shouldAllowDemoEntry()

  function zoneHref(code: IlZoneCode | '') {
    const params = new URLSearchParams()
    if (sp.q) params.set('q', sp.q)
    if (code) params.set('region', code)
    const qs = params.toString()
    return qs ? `/ops/stores?${qs}` : '/ops/stores'
  }

  const locale = await getLocale()
  const p = (text: string) => phrase(locale, text)
  const openStores = filtered.filter((s) => openCountFor(s) > 0).length

  function toCard(s: (typeof filtered)[number]) {
    const openCount = openCountFor(s)
    const inactive = s.is_active === false
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      city: s.city,
      inactive,
      openCount,
      href: queueHref({ view: 'open', store: s.code }),
      status: inactive
        ? p('מושבת')
        : openCount > 0
          ? `${openCount} ${openCount === 1 ? p('פתוחה') : p('פתוחות')}`
          : p('שקט'),
    }
  }

  const groups: StoreGroupModel[] = IL_ZONE_CODES.flatMap((code) => {
    const rows = filtered.filter((s) => zoneFromRegionId(s.region_id) === code)
    if (rows.length === 0) return []
    return [{ code, label: zoneLabel(code, locale), stores: rows.map(toCard) }]
  })
  const ungrouped = filtered.filter((s) => !zoneFromRegionId(s.region_id))
  if (ungrouped.length > 0) {
    groups.push({ code: 'other', label: p('בלי מחוז'), stores: ungrouped.map(toCard) })
  }

  return (
    <OpsAppShell>
      <div className="ari-home flex flex-col gap-5">
        <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <h1 className="t-title text-ink">{p('חנויות')}</h1>
            <p className="t-meta mt-1 text-ink-2">
              {activeCount} {p('סניפים פעילים')}
              {openStores > 0 ? ` · ${openStores} ${p('עם תקלות פתוחות')}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/api/stores/qr-batch?format=pdf" target="_blank" rel="noopener">
                {p('הדפסת QR לכל הרשת')}
              </Link>
            </Button>
            {canMutate ? <StoreCreateForm /> : null}
          </div>
        </header>

        <div
          role="group"
          aria-label={p('סינון לפי מחוז')}
          className="flex gap-2 overflow-x-auto pb-1 scrollbar-none"
        >
          <Link
            href={zoneHref('')}
            className={cn(
              't-body inline-flex min-h-[var(--tap)] shrink-0 items-center rounded-full px-4',
              !zoneFilter
                ? 'bg-ink text-[var(--tenant-contrast)]'
                : 'bg-surface text-ink-2',
            )}
          >
            {p('הכל')} · {activeCount}
          </Link>
          {IL_ZONE_CODES.map((code) => (
            <Link
              key={code}
              href={zoneHref(code)}
              className={cn(
                't-body inline-flex min-h-[var(--tap)] shrink-0 items-center rounded-full px-4',
                zoneFilter === code
                  ? 'bg-ink text-[var(--tenant-contrast)]'
                  : 'bg-surface text-ink-2',
              )}
            >
              {zoneLabel(code, locale)} · {byZone.get(code) ?? 0}
            </Link>
          ))}
        </div>

        <StoreSearch initialQ={sp.q ?? ''} region={zoneFilter} />

        {groups.length === 0 ? (
          <EmptyState
            title={p('לא נמצאו חנויות')}
            description={p('נסו שם, מספר, עיר או מחוז.')}
            icon={Store}
          />
        ) : (
          <StoreBoard groups={groups} />
        )}

        <StoreQrAccordion
          stores={filtered
            .filter((s) => s.is_active !== false)
            .map((s) => ({
              id: s.id,
              code: s.code,
              name: s.name,
              deepLink: businessPhone
                ? storeWhatsAppDeepLink(s.code, businessPhone)
                : null,
            }))}
        />
      </div>
    </OpsAppShell>
  )
}
