import { AuthError, type Actor } from '@/lib/auth/types'
import { MEM_ORG_ID, MEM_COUNTRY_ID, memFindStoreById, memListStores, supabaseReady } from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'
import type { CreateUserInput, PatchUserInput, UserRow } from './service'

export function userAdminOrganizations(actor: Actor): Set<string> {
  const organizations = new Set(actor.memberships.filter((membership) => membership.role === 'global_admin').map((membership) => membership.organization_id))
  if (organizations.size === 0) throw new AuthError('אין הרשאת ניהול משתמשים', 403)
  return organizations
}

export function visibleUsers(actor: Actor, users: UserRow[]): UserRow[] {
  const organizations = userAdminOrganizations(actor)
  return users.flatMap((user) => {
    const memberships = user.memberships.filter((membership) => organizations.has(membership.organization_id))
    return memberships.length ? [{ ...user, memberships }] : []
  })
}

function requireOwnedUser(actor: Actor, user: UserRow | undefined, wholeProfile: boolean): UserRow {
  const organizations = userAdminOrganizations(actor)
  if (!user || user.memberships.length === 0 || !user.memberships.some((membership) => organizations.has(membership.organization_id)) ||
    (wholeProfile && user.memberships.some((membership) => !organizations.has(membership.organization_id)))) {
    throw new AuthError('אין הרשאה לשנות משתמש זה', 403)
  }
  return user
}

/** Resolve assignment records before an Auth/profile write, rather than trusting IDs from the client. */
async function membershipScope(organizationId: string, input: {
  role: CreateUserInput['role']; country_id?: string | null; region_id?: string | null; store_id?: string | null
}) {
  let countryId = input.country_id ?? null
  let regionId = input.region_id ?? null
  const storeId = input.store_id ?? null
  const live = await supabaseReady()
  const client = live ? createSystemClient('user_assignment_scope') : null
  if (storeId) {
    const result = client ? await client.from('stores').select('id, organization_id, country_id, region_id').eq('id', storeId).maybeSingle() : null
    if (result?.error) throw new Error(result.error.message)
    const store = client ? result?.data : memFindStoreById(storeId)
    if (!store || store.organization_id !== organizationId || (countryId && countryId !== store.country_id) || (regionId && regionId !== store.region_id)) {
      throw new AuthError('שיוך החנות אינו בתחום הארגון והמדינה המורשים', 403)
    }
    countryId = store.country_id
    regionId = store.region_id
  }
  if (input.role === 'store_employee' && !storeId) throw new AuthError('חשבון חנות מחייב שיוך לחנות מורשית', 403)
  if (regionId && !storeId) {
    const result = client ? await client.from('regions').select('id, country_id').eq('id', regionId).maybeSingle() : null
    if (result?.error) throw new Error(result.error.message)
    const region = client ? result?.data : memListStores({ countryId: countryId || MEM_COUNTRY_ID, activeOnly: false }).find((store) => store.region_id === regionId)
    if (!region || (countryId && countryId !== region.country_id)) throw new AuthError('האזור אינו בתחום המדינה המורשית', 403)
    countryId = region.country_id
  }
  if (countryId) {
    const result = client ? await client.from('countries').select('id').eq('id', countryId).eq('organization_id', organizationId).maybeSingle() : null
    if (result?.error) throw new Error(result.error.message)
    const countryOwned = client ? Boolean(result?.data) : memListStores({ countryId, activeOnly: false }).some((store) => store.organization_id === organizationId)
    if (!countryOwned) throw new AuthError('המדינה אינה בתחום הארגון המורשה', 403)
  }
  return { country_id: countryId, region_id: regionId, store_id: storeId }
}

export async function authorizeUserCreation(actor: Actor, input: CreateUserInput, users: UserRow[]): Promise<CreateUserInput> {
  const organizations = userAdminOrganizations(actor)
  const organizationId = input.organization_id ?? (organizations.size === 1 ? [...organizations][0] : undefined)
  if (!organizationId || !organizations.has(organizationId) || input.id) throw new AuthError('אין הרשאה ליצור משתמש בתחום המבוקש', 403)
  if (users.some((user) => user.email?.trim().toLowerCase() === input.email.trim().toLowerCase())) {
    throw new AuthError('המייל כבר רשום במערכת; יצירת משתמש אינה משנה חשבון קיים', 403)
  }
  const countryId = input.country_id === undefined && input.role === 'internal_technician' && organizationId === MEM_ORG_ID ? MEM_COUNTRY_ID : input.country_id
  const scope = await membershipScope(organizationId, { ...input, country_id: countryId })
  return { ...input, ...scope, organization_id: organizationId }
}

export async function authorizeUserPatch(actor: Actor, profileId: string, input: PatchUserInput, users: UserRow[]): Promise<PatchUserInput> {
  const profileChange = input.full_name !== undefined || input.email !== undefined || input.phone !== undefined
  const user = requireOwnedUser(actor, users.find((row) => row.id === profileId), profileChange)
  if (input.email && users.some((row) => row.id !== profileId && row.email?.trim().toLowerCase() === input.email!.trim().toLowerCase())) {
    throw new AuthError('המייל כבר משויך לחשבון אחר', 403)
  }
  const membershipChange = input.membership_id !== undefined || input.role !== undefined || input.country_id !== undefined || input.region_id !== undefined || input.store_id !== undefined
  if (!membershipChange) return input
  const organizations = userAdminOrganizations(actor)
  const candidates = user.memberships.filter((membership) => organizations.has(membership.organization_id))
  const membership = input.membership_id ? candidates.find((row) => row.id === input.membership_id) : candidates.length === 1 ? candidates[0] : undefined
  if (!membership) throw new AuthError('יש לבחור חברות מורשית של המשתמש המבוקש', 403)
  const role = input.role ?? membership.role
  const scope = await membershipScope(membership.organization_id, {
    role,
    country_id: input.country_id === undefined ? membership.country_id : input.country_id,
    region_id: input.region_id === undefined ? membership.region_id : input.region_id,
    store_id: input.store_id === undefined ? membership.store_id : input.store_id,
  })
  return { ...input, ...scope, role, membership_id: membership.id }
}

export function authorizeUserDeletion(actor: Actor, profileId: string, users: UserRow[]) {
  requireOwnedUser(actor, users.find((row) => row.id === profileId), true)
}
