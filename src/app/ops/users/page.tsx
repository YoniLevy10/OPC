import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { UsersAdmin } from './users-admin'
import { fetchStores } from '@/modules/stores/data'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { visibleStores } from '@/lib/auth/store-asset-scope'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')
  const { stores } = actor ? await visibleStores(actor, true) : await fetchStores()

  return (
    <OpsAppShell>
      <div className="flex flex-col gap-5 stagger">
        <OpsPageHero
          title="משתמשים"
          status="ניהול גישה, תפקידים וסניפים"
        />
        <UsersAdmin
          actorId={actor?.id ?? null}
          stores={stores.map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
          }))}
        />
      </div>
    </OpsAppShell>
  )
}
