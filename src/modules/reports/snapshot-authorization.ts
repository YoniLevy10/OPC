import type { Actor } from '@/lib/auth/types'
import { hqProductRoles } from '@/lib/auth/roles'

const HQ_ROLES = hqProductRoles()

/** Resolve only one organization with a role allowed by report snapshot RLS. */
export function organizationForReportSnapshot(actor: Pick<Actor, 'memberships'>): string | null {
  const memberships = actor.memberships.filter((membership) =>
    (membership.role === 'global_admin' || membership.role === 'global_maintenance') || membership.role === 'store_manager',
  )
  const organizationIds = [...new Set(memberships.map((membership) => membership.organization_id))]
  if (organizationIds.length !== 1) return null
  const organizationId = organizationIds[0]
  // Store managers may read snapshots but cannot INSERT per migration policy.
  return memberships.some((membership) =>
    membership.organization_id === organizationId && HQ_ROLES.includes(membership.role),
  ) ? organizationId : null
}

export function reportSnapshotTicketScope(actor: Pick<Actor, 'memberships'>, organizationId: string) {
  const memberships = actor.memberships.filter((membership) =>
    membership.organization_id === organizationId &&
    (HQ_ROLES.includes(membership.role) || membership.role === 'store_manager'),
  )
  const hq = actor.memberships.some((membership) =>
    membership.organization_id === organizationId && (membership.role === 'global_admin' || membership.role === 'global_maintenance'),
  )
  const storeIds = [...new Set(memberships.filter((membership) => membership.role === 'store_manager').map((membership) => membership.store_id).filter((id): id is string => Boolean(id)))]
  return hq ? { organizationId, storeIds: null as string[] | null } : { organizationId, storeIds }
}
