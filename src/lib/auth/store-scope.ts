import { AuthError, type Actor } from '@/lib/auth/types'
import { actorIsGlobalAdmin } from '@/lib/auth/roles'

/** Israel pilot country id (matches seed / MEM_COUNTRY_ID). */
const PILOT_COUNTRY_ID = '22222222-2222-2222-2222-222222222222'
/** Optical Center org id (matches seed / MEM_ORG_ID). */
const PILOT_ORG_ID = '11111111-1111-1111-1111-111111111111'

type StoreScope = {
  id: string
  organization_id?: string | null
  country_id?: string | null
  region_id?: string | null
}

export function canManageStore(actor: Actor, store: StoreScope): boolean {
  if (actorIsGlobalAdmin(actor)) return true
  return actor.memberships.some(
    (m) =>
      Boolean(store.organization_id) &&
      m.organization_id === store.organization_id &&
      m.role === 'country_manager' &&
      Boolean(m.country_id) &&
      m.country_id === store.country_id,
  )
}

export function canReadAssetStore(actor: Actor, store: StoreScope): boolean {
  if (actorIsGlobalAdmin(actor)) return true
  return actor.memberships.some(
    (m) =>
      Boolean(store.organization_id) &&
      m.organization_id === store.organization_id &&
      (m.role === 'global_maintenance' ||
        (m.role === 'country_manager' &&
          Boolean(m.country_id) &&
          m.country_id === store.country_id) ||
        (m.role === 'regional_manager' &&
          Boolean(m.region_id) &&
          m.region_id === store.region_id) ||
        ((m.role === 'store_manager' || m.role === 'store_employee') &&
          Boolean(m.store_id) &&
          m.store_id === store.id)),
  )
}

export function canMutateAssetStore(actor: Actor, store: StoreScope): boolean {
  if (actorIsGlobalAdmin(actor)) return true
  return actor.memberships.some(
    (m) =>
      Boolean(store.organization_id) &&
      m.organization_id === store.organization_id &&
      (m.role === 'global_maintenance' ||
        (m.role === 'country_manager' &&
          Boolean(m.country_id) &&
          m.country_id === store.country_id)),
  )
}

function isHqCreateRole(role: string): boolean {
  return (
    role === 'global_admin' ||
    role === 'global_maintenance' ||
    role === 'country_manager'
  )
}

/**
 * HQ create-store scope.
 * Pilot: Ari (global_admin / global_maintenance) defaults to Optical Center IL
 * when membership has no country/org — so new stores are never blocked on empty scope.
 */
export function resolveStoreCreationScope(
  actor: Actor,
  requested: { country_id?: string; organization_id?: string },
) {
  const hq = actor.memberships.find((m) => isHqCreateRole(m.role))
  if (!hq) {
    throw new AuthError('אין הרשאה לפתיחת סניף', 403)
  }

  const pickOrg = (...ids: Array<string | null | undefined>) =>
    ids.find((id) => Boolean(id && String(id).trim())) ?? PILOT_ORG_ID
  const pickCountry = (...ids: Array<string | null | undefined>) =>
    ids.find((id) => Boolean(id && String(id).trim())) ?? PILOT_COUNTRY_ID

  if (hq.role === 'global_admin' || hq.role === 'global_maintenance' || actorIsGlobalAdmin(actor)) {
    return {
      organization_id: pickOrg(requested.organization_id, hq.organization_id),
      country_id: pickCountry(requested.country_id, hq.country_id),
    }
  }

  // country_manager — must match org/country when present on membership
  if (
    (!requested.organization_id ||
      requested.organization_id === hq.organization_id) &&
    (!requested.country_id || requested.country_id === hq.country_id)
  ) {
    return {
      organization_id: pickOrg(hq.organization_id),
      country_id: pickCountry(hq.country_id),
    }
  }

  throw new AuthError('אין הרשאה למדינה או לארגון', 403)
}
