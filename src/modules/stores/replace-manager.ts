import { createSystemClient } from '@/lib/supabase/system'
import { normalizePhoneDigits } from '@/lib/phone'
import {
  memFindStoreById,
  supabaseReady,
} from '@/lib/data/memory-store'
import {
  listStores,
  updateStore,
  type StoreRecord,
} from '@/modules/stores/service'

const MANAGER_LABEL = 'מנהל חנות'

/**
 * Replace store manager: updates stores.manager_* and syncs store_phones.
 * Old primary manager phone loses automatic store identity.
 */
export async function replaceStoreManager(input: {
  storeId: string
  managerName: string
  managerPhone: string
  managerNameEn?: string | null
}): Promise<StoreRecord> {
  const name = input.managerName.trim()
  const phoneRaw = input.managerPhone.trim()
  if (name.length < 2) throw new Error('חסר שם מנהל/ת')
  const waId = normalizePhoneDigits(phoneRaw)
  if (!waId || waId.length < 9) throw new Error('מספר טלפון מנהל לא תקין')

  const displayPhone = phoneRaw

  let oldPhone: string | null = null
  if (await supabaseReady()) {
    const { stores } = await listStores({ includeInactive: true })
    oldPhone = stores.find((s) => s.id === input.storeId)?.manager_phone ?? null
  } else {
    oldPhone = memFindStoreById(input.storeId)?.manager_phone ?? null
  }

  const updated = await updateStore(input.storeId, {
    manager_name: name,
    manager_name_en: input.managerNameEn?.trim() || null,
    manager_phone: displayPhone,
  })

  if (!(await supabaseReady())) {
    return updated
  }

  const supabase = createSystemClient('replace_store_manager')
  const oldDigits = normalizePhoneDigits(oldPhone)

  await supabase
    .from('store_phones')
    .update({ is_primary: false })
    .eq('store_id', input.storeId)
    .eq('is_primary', true)

  if (oldDigits && oldDigits !== waId) {
    await supabase
      .from('store_phones')
      .update({ is_primary: false, label: 'מנהל קודם' })
      .eq('wa_id', oldDigits)
  }

  const { data: existing } = await supabase
    .from('store_phones')
    .select('id, store_id')
    .eq('wa_id', waId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('store_phones')
      .update({
        store_id: input.storeId,
        is_primary: true,
        label: MANAGER_LABEL,
      })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await supabase.from('store_phones').insert({
      store_id: input.storeId,
      wa_id: waId,
      is_primary: true,
      label: MANAGER_LABEL,
    })
    if (error) throw new Error(error.message)
  }

  return updated
}
