import type { Actor } from '@/lib/auth/types'
import { actorIsGlobalAdmin } from '@/lib/auth/roles'

type InboxScope = {
  store_id?: string | null
  id?: string
  country_id: string | null
  region_id?: string | null
  organization_id?: string | null
}

/** Pure session-level authorization. Store scope is authoritative; wa_id is never a scope key. */
export function canAccessInboxSession(actor: Actor, session: InboxScope): boolean {
  // מנהל מערכת = הכל (כולל שיחות בכל ארגון/מדינה בפיילוט).
  if (actorIsGlobalAdmin(actor)) return true
  return actor.memberships.some((m) => {
    if (session.organization_id && m.organization_id !== session.organization_id)
      return false
    switch (m.role) {
      case 'global_maintenance':
        return true
      case 'country_manager':
        return Boolean(
          m.country_id && session.country_id && m.country_id === session.country_id,
        )
      case 'regional_manager':
        return Boolean(
          m.region_id && session.region_id && m.region_id === session.region_id,
        )
      case 'store_manager':
      case 'store_employee':
        return Boolean(
          m.store_id && session.store_id && m.store_id === session.store_id,
        )
      default:
        return false
    }
  })
}
