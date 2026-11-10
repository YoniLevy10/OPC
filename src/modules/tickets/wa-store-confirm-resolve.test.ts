import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  memCreate, memFindStoreById, memLinkStorePhone, memReset, MEM_COUNTRY_ID,
} from '@/lib/data/memory-store'
import { israelStoresAsRows } from '@/modules/stores/israel-stores'
import { storeConfirmButtonId } from './wa-store-confirm'
import { listAwaitingStoreConfirm, resolveStoreConfirmTarget, senderAuthorizedForTicket } from './wa-store-confirm-resolve'

const store = israelStoresAsRows().find((row) => row.code === '6006')!
const otherStore = israelStoresAsRows().find((row) => row.code === '6004')!
const manager = '972501112233'
const ari = '972548102688'
const originalPhones = [store.id, otherStore.id].map((id) => ({ id, phone: memFindStoreById(id)?.manager_phone ?? null }))

describe('WhatsApp confirmation requires current manager authority', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    memReset()
    memFindStoreById(store.id)!.manager_phone = '050-111-2233'
    memFindStoreById(otherStore.id)!.manager_phone = '0509998877'
  })
  afterEach(() => {
    for (const original of originalPhones) memFindStoreById(original.id)!.manager_phone = original.phone
  })

  function seed(reporterPhone = ari) {
    return memCreate({ store, description: 'תקלה שנפתחה עבור הסניף', category: 'hvac', priority: 'high', status: 'engaged', reporterPhone })
  }

  it('accepts the current manager even when Ari reported the fault', async () => {
    const ticket = seed()
    expect(await resolveStoreConfirmTarget({ waId: manager, interactiveId: storeConfirmButtonId(ticket.id), supabase: null }))
      .toEqual({ outcome: 'ok', ticketId: ticket.id })
    expect(await listAwaitingStoreConfirm({ waId: manager, supabase: null }))
      .toEqual({ ok: true, tickets: [expect.objectContaining({ id: ticket.id })] })
  })

  it('denies Ari as original reporter when he is not the store manager', async () => {
    const ticket = seed()
    expect(await resolveStoreConfirmTarget({ waId: ari, interactiveId: storeConfirmButtonId(ticket.id), supabase: null }))
      .toEqual({ outcome: 'unauthorized' })
    expect(await listAwaitingStoreConfirm({ waId: ari, supabase: null })).toEqual({ ok: true, tickets: [] })
  })

  it('denies a linked store phone that is not the manager contact', async () => {
    const ticket = seed(ari)
    memLinkStorePhone(ari, store.id, MEM_COUNTRY_ID)
    expect(await resolveStoreConfirmTarget({ waId: ari, interactiveId: storeConfirmButtonId(ticket.id), supabase: null }))
      .toEqual({ outcome: 'unauthorized' })
  })

  it('revokes the previous manager immediately after the current directory changes', async () => {
    const ticket = seed(manager)
    memFindStoreById(store.id)!.manager_phone = '0509998877'
    expect(await resolveStoreConfirmTarget({ waId: manager, interactiveId: storeConfirmButtonId(ticket.id), supabase: null }))
      .toEqual({ outcome: 'unauthorized' })
    expect(await resolveStoreConfirmTarget({ waId: '972509998877', interactiveId: storeConfirmButtonId(ticket.id), supabase: null }))
      .toEqual({ outcome: 'ok', ticketId: ticket.id })
  })

  it('denies another store manager and a branch without a configured manager', async () => {
    const ticket = seed()
    expect(await resolveStoreConfirmTarget({ waId: '972509998877', interactiveId: storeConfirmButtonId(ticket.id), supabase: null }))
      .toEqual({ outcome: 'unauthorized' })
    memFindStoreById(store.id)!.manager_phone = null
    expect(await resolveStoreConfirmTarget({ waId: manager, interactiveId: storeConfirmButtonId(ticket.id), supabase: null }))
      .toEqual({ outcome: 'unauthorized' })
  })

  it('uses the live store by ID in database mode, never the supplied reporter phone', async () => {
    const lookupId = vi.fn()
    const client = { from: (table: string) => {
      expect(table).toBe('stores')
      return { select: () => ({ eq: (_column: string, id: string) => {
        lookupId(id)
        return { maybeSingle: async () => ({ data: { manager_phone: '050-111-2233', is_active: true }, error: null }) }
      } }) }
    } } as unknown as SupabaseClient
    expect(await senderAuthorizedForTicket({ waId: ari, ticketId: 'ticket', storeId: store.id, reporterPhone: ari, supabase: client })).toBe(false)
    expect(await senderAuthorizedForTicket({ waId: manager, ticketId: 'ticket', storeId: store.id, reporterPhone: ari, supabase: client })).toBe(true)
    expect(lookupId).toHaveBeenCalledWith(store.id)
  })

  it('fails closed when the real manager directory cannot be read', async () => {
    const client = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'directory unavailable' } }) }) }) }) } as unknown as SupabaseClient
    await expect(senderAuthorizedForTicket({ waId: manager, ticketId: 'ticket', storeId: store.id, reporterPhone: manager, supabase: client })).rejects.toThrow('directory unavailable')
  })

  it('scopes free-text lookup to exact matching manager stores and filters unrelated rows', async () => {
    const scopes = vi.fn()
    const pattern = vi.fn()
    const rows = [
      { id: 'managed-ticket', store_id: store.id, updated_at: '2026-11-10T12:00:00Z' },
      { id: 'unrelated-ticket', store_id: 'other-org-store', updated_at: '2026-11-10T12:00:00Z' },
    ]
    const ticketQuery = {
      in: (column: string, values: string[]) => { scopes(column, values); return ticketQuery },
      is: () => ticketQuery,
      order: () => ticketQuery,
      limit: async () => ({ data: rows, error: null }),
    }
    const client = { from: (table: string) => ({ select: () => table === 'stores'
      ? { eq: () => ({ ilike: (_column: string, value: string) => {
        pattern(value)
        return { limit: async () => ({ data: [
          { id: store.id, manager_phone: '050-111-2233' },
          { id: 'other-org-store', manager_phone: '972500000001' },
        ], error: null }) }
      } }) }
      : ticketQuery }) } as unknown as SupabaseClient

    expect(await listAwaitingStoreConfirm({ waId: manager, supabase: client })).toEqual({
      ok: true,
      tickets: [expect.objectContaining({ id: 'managed-ticket', store_id: store.id })],
    })
    expect(scopes).toHaveBeenCalledWith('store_id', [store.id])
    expect(pattern).toHaveBeenCalledWith('%5%0%1%1%1%2%2%3%3%')
  })

  it('does not fall back to reporter identity if the manager directory search fails', async () => {
    const client = { from: () => ({ select: () => ({ eq: () => ({ ilike: () => ({ limit: async () => ({ data: null, error: { message: 'manager directory unavailable' } }) }) }) }) }) } as unknown as SupabaseClient
    expect(await listAwaitingStoreConfirm({ waId: manager, supabase: client })).toEqual({ ok: false, reason: 'unavailable' })
  })
})
