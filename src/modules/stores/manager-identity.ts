import { createSystemClient } from '@/lib/supabase/system'
import { supabaseReady, memListStores } from '@/lib/data/memory-store'
import { phonesMatch } from '@/modules/whatsapp/classify'
import { ISRAEL_STORES } from './israel-stores'

export type ManagerStoreHit = {
  code: string
  name: string
  managerName: string
  managerPhone: string
  storeId?: string
}

/** Seed-only lookup. Prefer resolveManagerStoreByPhone for production. */
export function soleManagerStore(waId: string): ManagerStoreHit | null {
  const hits = ISRAEL_STORES.filter(
    (store) => store.managerPhone && phonesMatch(waId, store.managerPhone),
  )
  if (hits.length !== 1) return null
  const hit = hits[0]
  return {
    code: hit.code,
    name: hit.name,
    managerName: hit.managerName,
    managerPhone: hit.managerPhone,
  }
}

function soleFromRows(
  waId: string,
  rows: Array<{
    id?: string
    code: string
    name: string
    manager_name?: string | null
    manager_phone?: string | null
  }>,
): ManagerStoreHit | null {
  const hits = rows.filter(
    (row) => row.manager_phone && phonesMatch(waId, row.manager_phone),
  )
  if (hits.length !== 1) return null
  const hit = hits[0]
  return {
    code: hit.code,
    name: hit.name,
    managerName: hit.manager_name?.trim() || '',
    managerPhone: hit.manager_phone!,
    storeId: hit.id,
  }
}

/**
 * Resolve the one store this phone manages.
 * Order: DB stores.manager_phone → store_phones primary → ISRAEL_STORES seed.
 */
export async function resolveManagerStoreByPhone(
  waId: string,
): Promise<ManagerStoreHit | null> {
  if (await supabaseReady()) {
    try {
      const supabase = createSystemClient('manager_identity')
      const { data: stores, error } = await supabase
        .from('stores')
        .select('id, code, name, manager_name, manager_phone')
        .eq('is_active', true)
        .not('manager_phone', 'is', null)
      if (!error && stores?.length) {
        const fromStores = soleFromRows(waId, stores)
        if (fromStores) return fromStores
      }

      const { data: phones } = await supabase
        .from('store_phones')
        .select('wa_id, is_primary, label, store_id, stores ( id, code, name, manager_name, manager_phone )')
        .eq('is_primary', true)
      if (phones?.length) {
        const matched = phones.filter((row) => phonesMatch(waId, String(row.wa_id)))
        if (matched.length === 1) {
          const rawStore = matched[0].stores as unknown
          const store = (Array.isArray(rawStore) ? rawStore[0] : rawStore) as
            | {
                id: string
                code: string
                name: string
                manager_name?: string | null
                manager_phone?: string | null
              }
            | null
            | undefined
          if (store?.code) {
            return {
              code: store.code,
              name: store.name,
              managerName: store.manager_name?.trim() || '',
              managerPhone: store.manager_phone || String(matched[0].wa_id),
              storeId: store.id,
            }
          }
        }
      }
    } catch {
      // fall through to memory / seed
    }
  }

  const memHit = soleFromRows(
    waId,
    memListStores({ activeOnly: true }).map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      manager_name: s.manager_name,
      manager_phone: s.manager_phone,
    })),
  )
  if (memHit) return memHit

  return soleManagerStore(waId)
}

/** Manager phone for handoff / SMS — DB store row first, seed fallback. */
export async function managerPhoneForStoreCode(
  storeCode: string,
): Promise<string | null> {
  if (!storeCode.trim()) return null
  if (await supabaseReady()) {
    try {
      const supabase = createSystemClient('manager_phone')
      const { data } = await supabase
        .from('stores')
        .select('manager_phone')
        .eq('code', storeCode.trim())
        .maybeSingle()
      if (data?.manager_phone?.trim()) return data.manager_phone.trim()
    } catch {
      // fall through
    }
  }
  const mem = memListStores({ activeOnly: false }).find(
    (s) => s.code === storeCode.trim(),
  )
  if (mem?.manager_phone?.trim()) return mem.manager_phone.trim()
  return (
    ISRAEL_STORES.find((s) => s.code === storeCode.trim())?.managerPhone ?? null
  )
}

/** Manager display name for WhatsApp greeting — DB / memory / seed. */
export async function managerNameForStoreCode(
  storeCode: string,
): Promise<string | null> {
  if (!storeCode.trim()) return null
  if (await supabaseReady()) {
    try {
      const supabase = createSystemClient('manager_name')
      const { data } = await supabase
        .from('stores')
        .select('manager_name')
        .eq('code', storeCode.trim())
        .maybeSingle()
      if (data?.manager_name?.trim()) return data.manager_name.trim()
    } catch {
      // fall through
    }
  }
  const mem = memListStores({ activeOnly: false }).find(
    (s) => s.code === storeCode.trim(),
  )
  if (mem?.manager_name?.trim()) return mem.manager_name.trim()
  return (
    ISRAEL_STORES.find((s) => s.code === storeCode.trim())?.managerName?.trim() ||
    null
  )
}
