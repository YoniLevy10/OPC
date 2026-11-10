import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { AssetsAdmin, type AssetTicketHint } from './assets-admin'
import { fetchStores } from '@/modules/stores/data'
import { listTickets } from '@/modules/tickets/service'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { listSpends } from '@/lib/data/ops-ledger'
import { spendAmountForTrueCost, spendsContributeToTrueCost } from '@/modules/spend/true-cost'
import { PartsStock } from '../inventory/parts-stock'
import { PhoneFold } from '@/components/layout/phone-fold'
import { visibleStores } from '@/lib/auth/store-asset-scope'
import { listAssets } from '@/modules/assets/service'
import { MEM_ORG_ID } from '@/lib/data/memory-store'

export const dynamic = 'force-dynamic'

export default async function AssetsPage() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')

  const [{ stores }, ticketResult, assetResult] = await Promise.all([
    actor ? visibleStores(actor, true) : fetchStores({ includeInactive: true }),
    listTickets(500).catch(() => ({
      tickets: [],
      backend: 'memory' as const,
    })),
    listAssets(),
  ])
  const allowedStoreIds = new Set(stores.map((store) => store.id))
  const allowedAssetIds = new Set(assetResult.assets.filter((asset) => allowedStoreIds.has(asset.store_id)).map((asset) => asset.id))
  const canReadWarehouse = !actor || actor.memberships.some((member) =>
    member.organization_id === MEM_ORG_ID && ['global_admin', 'global_maintenance'].includes(member.role),
  )

  const tickets: AssetTicketHint[] = (ticketResult.tickets ?? []).filter((ticket) => allowedStoreIds.has(ticket.store_id)).map((t) => ({
    id: t.id,
    store_id: t.store_id,
    asset_id: (t as { asset_id?: string | null }).asset_id ?? null,
    status: t.status,
    title: (t as { title?: string | null }).title ?? null,
    description: t.description,
    created_at: t.created_at,
    display_number: t.display_number,
    number: t.number,
  }))

  const assetTrueCost: Record<string, number> = {}
  for (const spend of listSpends()) {
    if (!spend.assetId || !allowedStoreIds.has(spend.storeId) || !allowedAssetIds.has(spend.assetId) || !spendsContributeToTrueCost(spend)) continue
    assetTrueCost[spend.assetId] =
      (assetTrueCost[spend.assetId] ?? 0) + spendAmountForTrueCost(spend)
  }

  return (
    <OpsAppShell>
      <div className="flex flex-col gap-5 stagger">
        <OpsPageHero
          title="ציוד וחלקים"
          status="למעלה הציוד בסניף. למטה החלקים במחסן."
        />
        <section id="store" className="flex flex-col gap-3">
          <div>
            <h2 className="t-section text-ink">בסניף</h2>
            <p className="t-meta mt-1 text-ink-2">המזגן, המנעול והקופה, עם העלות שנרשמה עליהם.</p>
          </div>
        <AssetsAdmin
          stores={stores.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
          }))}
          tickets={tickets}
          assetTrueCost={assetTrueCost}
        />
        </section>
        {canReadWarehouse ? <PhoneFold title="חלקים במחסן" summary="מלאי">
        <PartsStock />
        </PhoneFold> : null}
      </div>
    </OpsAppShell>
  )
}
