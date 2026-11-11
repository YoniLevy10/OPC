import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { UsersAdmin } from './users-admin'
import { fetchStores } from '@/modules/stores/data'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'

export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')
  const { stores } = await fetchStores()

  return (
    <OpsAppShell>
      <div className="flex w-full max-w-full flex-col gap-5 overflow-x-clip stagger">
        <OpsPageHero
          title="משתמשים"
          status="HQ לארי · חנות וטכנאי לשטח"
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
