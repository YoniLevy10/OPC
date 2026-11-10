import { AuthError, type Actor } from './types'
import { listStores, type StoreRecord } from '@/modules/stores/service'
import { MEM_COUNTRY_ID, MEM_COUNTRY_FR_ID, MEM_ORG_ID, memFindStoreById, memListAssets, memListStores, supabaseReady } from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'
import { REGION_UUID_TO_CODE, regionCodeFromId } from '@/modules/stores/regions'

type Access = 'read' | 'store_write' | 'asset_write'

/** Privileged data clients never replace the authenticated member's scope. */
export function canAccessStore(actor: Actor, store: StoreRecord, access: Access = 'read'): boolean {
  return actor.memberships.some((member) => {
    if (!store.organization_id || member.organization_id !== store.organization_id) return false
    if (access === 'store_write' && !['global_admin', 'country_manager'].includes(member.role)) return false
    if (access === 'asset_write' && !['global_admin', 'global_maintenance', 'country_manager'].includes(member.role)) return false
    if (member.role === 'global_admin' || member.role === 'global_maintenance') return true
    if (member.country_id && member.country_id !== store.country_id) return false
    if (member.role === 'country_manager') return Boolean(member.country_id && member.country_id === store.country_id)
    if (member.role === 'regional_manager') return Boolean(member.region_id && member.region_id === store.region_id)
    if (member.role === 'store_manager' || member.role === 'store_employee') return member.store_id === store.id
    return false
  })
}

export async function visibleStores(actor: Actor, includeInactive = true) {
  const countries = new Set([MEM_COUNTRY_ID, MEM_COUNTRY_FR_ID, ...actor.memberships.flatMap((member) => {
    const country = member.country_id ?? (member.store_id ? memFindStoreById(member.store_id)?.country_id : null)
    return country ? [country] : []
  })])
  const result = await supabaseReady()
    ? await listStores({ includeInactive })
    : { stores: [...countries].flatMap((countryId) => memListStores({ countryId, activeOnly: !includeInactive })), backend: 'memory' as const }
  return { ...result, stores: result.stores.filter((store) => canAccessStore(actor, store)) }
}

export async function requireStoreAccess(actor: Actor, id: string, access: Access): Promise<StoreRecord> {
  const store = await supabaseReady()
    ? (await listStores({ includeInactive: true })).stores.find((row) => row.id === id)
    : memFindStoreById(id)
  if (!store || !canAccessStore(actor, store, access)) throw new AuthError('אין גישה לחנות המבוקשת', 403)
  return store
}

export async function requireAssetWrite(actor: Actor, id: string) {
  let storeId: string | undefined
  if (await supabaseReady()) {
    const { data, error } = await createSystemClient('asset_scope').from('assets').select('store_id').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    storeId = data?.store_id
  } else {
    storeId = memListAssets().find((asset) => asset.id === id)?.store_id
  }
  if (!storeId) throw new AuthError('אין גישה לציוד המבוקש', 403)
  return requireStoreAccess(actor, storeId, 'asset_write')
}

/** Validate the actual hierarchy, including client-supplied country/region IDs. */
export async function validateStoreHierarchy(organizationId: string, countryId: string, rawRegion: string): Promise<string> {
  if (!(await supabaseReady())) {
    const stores = memListStores({ countryId, activeOnly: false })
    if (!stores.some((store) => store.organization_id === organizationId && store.country_id === countryId)) {
      throw new AuthError('המדינה אינה שייכת לארגון המבוקש', 403)
    }
    const code = regionCodeFromId(rawRegion)
    const region = countryId === MEM_COUNTRY_ID && code ? code.toLowerCase() : rawRegion
    if (!stores.some((store) => store.organization_id === organizationId && store.country_id === countryId && store.region_id === region)) {
      throw new AuthError('האזור אינו שייך למדינה המבוקשת', 403)
    }
    return region
  }
  const client = createSystemClient('store_hierarchy_scope')
  const country = await client.from('countries').select('id').eq('id', countryId).eq('organization_id', organizationId).maybeSingle()
  if (country.error) throw new Error(country.error.message)
  if (!country.data) throw new AuthError('המדינה אינה שייכת לארגון המבוקש', 403)
  const code = regionCodeFromId(rawRegion)
  const regionId = countryId === MEM_COUNTRY_ID && code
    ? Object.entries(REGION_UUID_TO_CODE).find(([, value]) => value === code)?.[0] ?? rawRegion
    : rawRegion
  const region = await client.from('regions').select('id').eq('id', regionId).eq('country_id', countryId).maybeSingle()
  if (region.error) throw new Error(region.error.message)
  if (!region.data) throw new AuthError('האזור אינו שייך למדינה המבוקשת', 403)
  return regionId
}

export async function storeCreationScope(actor: Actor, input: { organization_id?: string; country_id?: string; region_id?: string }) {
  const managers = actor.memberships.filter((member) => member.role === 'global_admin' || member.role === 'country_manager')
  const organizations = [...new Set(managers.map((member) => member.organization_id))]
  const organizationId = input.organization_id ?? (organizations.length === 1 ? organizations[0] : undefined)
  if (!organizationId) throw new AuthError('יש לבחור ארגון מורשה ליצירת החנות', 403)
  const candidates = managers.filter((member) => member.organization_id === organizationId)
  const countries = [...new Set(candidates.map((member) => member.country_id).filter((id): id is string => Boolean(id)))]
  const countryId = input.country_id ?? (countries.length === 1 ? countries[0] : organizationId === MEM_ORG_ID ? MEM_COUNTRY_ID : undefined)
  if (!countryId || !candidates.some((member) => member.role === 'global_admin' || member.country_id === countryId)) {
    throw new AuthError('אין הרשאה ליצור חנות בארגון ובמדינה המבוקשים', 403)
  }
  const regionId = await validateStoreHierarchy(organizationId, countryId, input.region_id ?? (countryId === MEM_COUNTRY_ID ? 'ta' : ''))
  return { organization_id: organizationId, country_id: countryId, region_id: regionId }
}
