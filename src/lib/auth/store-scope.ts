import { AuthError, type Actor } from '@/lib/auth/types'

type StoreScope = { id: string; organization_id?: string | null; country_id?: string | null; region_id?: string | null }

export function canManageStore(actor: Actor, store: StoreScope): boolean {
  return actor.memberships.some((m) =>
    Boolean(store.organization_id) && m.organization_id === store.organization_id &&
    (m.role === 'global_admin' ||
      (m.role === 'country_manager' && Boolean(m.country_id) && m.country_id === store.country_id)),
  )
}

export function canReadAssetStore(actor: Actor, store: StoreScope): boolean {
  return actor.memberships.some((m) =>
    Boolean(store.organization_id) && m.organization_id === store.organization_id &&
    (m.role === 'global_admin' || m.role === 'global_maintenance' ||
      (m.role === 'country_manager' && Boolean(m.country_id) && m.country_id === store.country_id) ||
      (m.role === 'regional_manager' && Boolean(m.region_id) && m.region_id === store.region_id) ||
      ((m.role === 'store_manager' || m.role === 'store_employee') && Boolean(m.store_id) && m.store_id === store.id)),
  )
}

export function canMutateAssetStore(actor: Actor, store: StoreScope): boolean {
  return actor.memberships.some((m) =>
    Boolean(store.organization_id) && m.organization_id === store.organization_id &&
    (m.role === 'global_admin' || m.role === 'global_maintenance' ||
      (m.role === 'country_manager' && Boolean(m.country_id) && m.country_id === store.country_id)),
  )
}

export function resolveStoreCreationScope(actor: Actor, requested: { country_id?: string; organization_id?: string }) {
  const membership = actor.memberships.find((m) =>
    (m.role === 'global_admin' || m.role === 'country_manager') &&
    Boolean(m.organization_id) && Boolean(m.country_id) &&
    (!requested.organization_id || requested.organization_id === m.organization_id) &&
    (!requested.country_id || requested.country_id === m.country_id),
  )
  if (!membership) throw new AuthError('אין הרשאה למדינה או לארגון', 403)
  return { organization_id: membership.organization_id, country_id: membership.country_id! }
}
