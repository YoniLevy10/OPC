import { createSystemClient } from '@/lib/supabase/system'
import {
  MEM_COUNTRY_ID,
  MEM_ORG_ID,
  memCreateStore,
  memFindStoreByCode,
  memFindStoreById,
  memListStores,
  memUpdateStore,
  supabaseReady,
  type MemStore,
} from '@/lib/data/memory-store'
import { AuthError, type Actor } from '@/lib/auth/types'
import { actorIsGlobalAdmin } from '@/lib/auth/roles'
import type { StoreRow } from '@/modules/stores/data'
import {
  canonicalStoreCode,
  IL_REGION_IDS,
  type IsraelStoreSeed,
} from '@/modules/stores/israel-stores'
import { replaceStoreManager } from '@/modules/stores/replace-manager'

function resolveDbRegionId(region?: string | null): string {
  if (!region?.trim()) return IL_REGION_IDS.TA
  const raw = region.trim()
  if (raw.length > 8) return raw
  const upper = raw.toUpperCase() as IsraelStoreSeed['region']
  if (upper in IL_REGION_IDS) return IL_REGION_IDS[upper]
  const SLUG: Record<string, IsraelStoreSeed['region']> = {
    ta: 'TA',
    ctr: 'CTR',
    jlm: 'JLM',
    hfa: 'HFA',
    n: 'N',
    s: 'S',
  }
  const code = SLUG[raw.toLowerCase()] ?? 'TA'
  return IL_REGION_IDS[code]
}

export type StoreRecord = StoreRow & {
  organization_id?: string
  country_id?: string
  is_active: boolean
}

export function requireStoresMutate(actor: Actor) {
  const ok =
    actorIsGlobalAdmin(actor) ||
    actor.memberships.some(
      (m) =>
        m.role === 'global_maintenance' || m.role === 'country_manager',
    )
  if (!ok) {
    throw new AuthError('אין הרשאת ניהול חנויות', 403)
  }
}

function toRecord(s: MemStore): StoreRecord {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    city: s.city,
    address: s.address,
    region_id: s.region_id,
    organization_id: s.organization_id,
    country_id: s.country_id,
    is_active: s.is_active,
    manager_name: s.manager_name ?? null,
    manager_name_en: s.manager_name_en ?? null,
    manager_phone: s.manager_phone ?? null,
    area_manager: s.area_manager ?? null,
    store_phone: s.store_phone ?? null,
    store_email: s.store_email ?? null,
  }
}

const STORE_COLUMNS =
  'id, code, name, city, address, region_id, organization_id, country_id, is_active, manager_name, manager_name_en, manager_phone, area_manager, store_phone, store_email'

export async function listStores(opts?: {
  includeInactive?: boolean
}): Promise<{ stores: StoreRecord[]; backend: 'supabase' | 'memory' }> {
  if (!(await supabaseReady())) {
    return {
      stores: memListStores({ activeOnly: !opts?.includeInactive }).map(toRecord),
      backend: 'memory',
    }
  }

  const supabase = createSystemClient('stores_list')
  let query = supabase
    .from('stores')
    .select(STORE_COLUMNS)
    .order('code')
  if (!opts?.includeInactive) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return {
    stores: (data ?? []) as StoreRecord[],
    backend: 'supabase',
  }
}

export async function getStoreByCode(
  code: string,
): Promise<{ store: StoreRecord | null; backend: 'supabase' | 'memory' }> {
  if (!(await supabaseReady())) {
    const store = memFindStoreByCode(code) ?? null
    return { store: store ? toRecord(store) : null, backend: 'memory' }
  }

  const supabase = createSystemClient('stores_get')
  const lookup = canonicalStoreCode(code)
  const { data, error } = await supabase
    .from('stores')
    .select(STORE_COLUMNS)
    .in('code', lookup === code ? [code] : [code, lookup])
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return { store: (data as StoreRecord | null) ?? null, backend: 'supabase' }
}

export type CreateStoreInput = {
  code: string
  name: string
  city?: string | null
  address?: string | null
  region_id?: string
  country_id?: string
  organization_id?: string
  /** Area / district manager (מנהל מחוז). */
  area_manager?: string | null
  /** Store manager — required for WA identity on new stores. */
  manager_name?: string | null
  manager_name_en?: string | null
  manager_phone?: string | null
}

export async function createStore(input: CreateStoreInput): Promise<StoreRecord> {
  const code = input.code.trim()
  const name = input.name.trim()
  if (!/^\d{1,6}$/.test(code)) {
    throw new Error('קוד חנות חייב להיות מספרי (עד 6 ספרות)')
  }
  if (!name) throw new Error('שם חנות חובה')

  const managerName = input.manager_name?.trim() || null
  const managerPhone = input.manager_phone?.trim() || null
  if (!managerName || managerName.length < 2) {
    throw new Error('חסר שם מנהל/ת חנות')
  }
  if (!managerPhone) {
    throw new Error('חסר טלפון מנהל/ת חנות — נדרש לזיהוי בוואטסאפ')
  }

  const areaManager = input.area_manager?.trim() || null

  if (!(await supabaseReady())) {
    const created = toRecord(
      memCreateStore({
        code,
        name,
        city: input.city,
        address: input.address,
        region_id: input.region_id ?? 'ta',
        country_id: input.country_id ?? MEM_COUNTRY_ID,
        organization_id: input.organization_id ?? MEM_ORG_ID,
        manager_name: managerName,
        manager_name_en: input.manager_name_en,
        manager_phone: managerPhone,
        area_manager: areaManager,
      }),
    )
    return replaceStoreManager({
      storeId: created.id,
      managerName,
      managerPhone,
      managerNameEn: input.manager_name_en,
    })
  }

  const supabase = createSystemClient('stores_create')
  const organizationId = input.organization_id ?? MEM_ORG_ID
  const countryId = input.country_id ?? MEM_COUNTRY_ID
  const regionId = resolveDbRegionId(input.region_id)

  const { data, error } = await supabase
    .from('stores')
    .insert({
      code,
      name,
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
      region_id: regionId,
      country_id: countryId,
      organization_id: organizationId,
      is_active: true,
      area_manager: areaManager,
      manager_name: managerName,
      manager_name_en: input.manager_name_en?.trim() || null,
      manager_phone: managerPhone,
    })
    .select(STORE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)

  // Sync store_phones so WA intake auto-links this manager to the new store.
  return replaceStoreManager({
    storeId: (data as StoreRecord).id,
    managerName,
    managerPhone,
    managerNameEn: input.manager_name_en,
  })
}

export type UpdateStoreInput = {
  code?: string
  name?: string
  city?: string | null
  address?: string | null
  region_id?: string
  is_active?: boolean
  manager_name?: string | null
  manager_name_en?: string | null
  manager_phone?: string | null
  area_manager?: string | null
}

export async function updateStore(
  id: string,
  patch: UpdateStoreInput,
): Promise<StoreRecord> {
  if (!(await supabaseReady())) {
    const existing = memFindStoreById(id)
    if (!existing) throw new Error('חנות לא נמצאה')
    return toRecord(memUpdateStore(id, patch))
  }

  const supabase = createSystemClient('stores_update')
  const payload: Record<string, unknown> = {}
  if (patch.code !== undefined) payload.code = patch.code.trim()
  if (patch.name !== undefined) payload.name = patch.name.trim()
  if (patch.city !== undefined) payload.city = patch.city?.trim() || null
  if (patch.address !== undefined) payload.address = patch.address?.trim() || null
  if (patch.region_id !== undefined) {
    // Form sends district codes (TA/CTR/…); DB column is uuid.
    payload.region_id = resolveDbRegionId(patch.region_id)
  }
  if (patch.is_active !== undefined) payload.is_active = patch.is_active
  if (patch.manager_name !== undefined) {
    payload.manager_name = patch.manager_name?.trim() || null
  }
  if (patch.manager_name_en !== undefined) {
    payload.manager_name_en = patch.manager_name_en?.trim() || null
  }
  if (patch.manager_phone !== undefined) {
    payload.manager_phone = patch.manager_phone?.trim() || null
  }
  if (patch.area_manager !== undefined) {
    payload.area_manager = patch.area_manager?.trim() || null
  }

  const { data, error } = await supabase
    .from('stores')
    .update(payload)
    .eq('id', id)
    .select(STORE_COLUMNS)
    .single()
  if (error) throw new Error(error.message)
  return data as StoreRecord
}
