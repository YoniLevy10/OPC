import { createSystemClient } from '@/lib/supabase/system'
import { normalizePhoneDigits } from '@/lib/phone'
import { phonesMatch } from '@/modules/whatsapp/classify'
import {
  MEM_COUNTRY_ID,
  memFindStoreById,
  memGetSession,
  memLinkStorePhone,
  memListTickets,
  memUpsertSession,
  supabaseReady,
} from '@/lib/data/memory-store'
import {
  listStores,
  updateStore,
  type StoreRecord,
} from '@/modules/stores/service'

const MANAGER_LABEL = 'מנהל חנות'

/**
 * Replace store manager: updates stores.manager_* and syncs store_phones,
 * intake session contact, and ticket reporter name — one closed identity loop.
 * Old manager phone loses store_phones + sticky session store binding.
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

  const oldDigits = normalizePhoneDigits(oldPhone)

  if (!(await supabaseReady())) {
    memLinkStorePhone(waId, input.storeId, MEM_COUNTRY_ID)
    const session = memGetSession(waId)
    if (session) {
      memUpsertSession({
        ...session,
        customer_name: name,
        store_id: input.storeId,
        store_code: updated.code,
      })
    }
    if (oldDigits && oldDigits !== waId) {
      const oldSession = memGetSession(oldDigits)
      if (oldSession && oldSession.store_id === input.storeId) {
        memUpsertSession({
          ...oldSession,
          customer_name: null,
          store_id: null,
          store_code: null,
          state: 'awaiting_store',
          active_ticket_id: null,
        })
      }
    }
    for (const ticket of memListTickets()) {
      if (
        ticket.reporter_phone &&
        phonesMatch(ticket.reporter_phone, waId)
      ) {
        ticket.reporter_name = name
      }
    }
    return updated
  }

  const supabase = createSystemClient('replace_store_manager')

  await supabase
    .from('store_phones')
    .update({ is_primary: false })
    .eq('store_id', input.storeId)
    .eq('is_primary', true)

  // Fully revoke previous manager WA identity for this store.
  if (oldDigits && oldDigits !== waId) {
    await supabase.from('store_phones').delete().eq('wa_id', oldDigits)
    await supabase
      .from('intake_sessions')
      .update({
        customer_name: null,
        store_id: null,
        store_code: null,
        state: 'awaiting_store',
        active_ticket_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq('wa_id', oldDigits)
      .eq('store_id', input.storeId)
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

  // Inbox contact = store manager. Keep the WA session + open tickets in sync.
  await supabase
    .from('intake_sessions')
    .update({
      customer_name: name,
      store_id: input.storeId,
      store_code: updated.code,
      updated_at: new Date().toISOString(),
    })
    .eq('wa_id', waId)

  // Fuzzy phone match — tickets may store 05… or 972…
  const phoneClauses = [
    `reporter_phone.eq.${waId}`,
    `reporter_phone.ilike.%${waId.slice(-9)}`,
  ]
  if (waId.startsWith('972') && waId.length >= 12) {
    phoneClauses.push(`reporter_phone.eq.0${waId.slice(3)}`)
  }
  await supabase
    .from('tickets')
    .update({ reporter_name: name })
    .or(phoneClauses.join(','))

  return updated
}
