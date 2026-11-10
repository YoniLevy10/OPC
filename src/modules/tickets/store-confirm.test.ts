import { describe, expect, it, beforeEach } from 'vitest'
import {
  memReset,
  memCreate,
  memAddMessage,
  memGet,
  DEMO_TECH_ID,
} from '@/lib/data/memory-store'
import { updateStatus } from '@/modules/tickets/service'
import { confirmStoreFix, rejectStoreFix } from './store-confirm'
import {
  closedEngagementCosts,
  lockEngagement,
  lockedEngagementFor,
  resetEngagementsForTests,
} from '@/modules/engagements/service'
import { israelStoresAsRows } from '@/modules/stores/israel-stores'

function attachPair(ticketId: string) {
  memAddMessage(ticketId, {
    channel: 'tech',
    direction: 'inbound',
    body: 'before',
    media_url: 'https://cdn.example/before.jpg',
    proof_role: 'before',
  })
  memAddMessage(ticketId, {
    channel: 'tech',
    direction: 'inbound',
    body: 'after',
    media_url: 'https://cdn.example/after.jpg',
    proof_role: 'after',
  })
}

describe('store confirm close', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    memReset()
    resetEngagementsForTests()
  })

  it('closes immediately on store feedback even during the quality window', async () => {
    const store = israelStoresAsRows().find((s) => s.code === '6006')!
    const created = memCreate({
      store,
      description: 'מזגן לא מקרר',
      priority: 'high',
      category: 'hvac',
      status: 'assigned',
      assigned_to: DEMO_TECH_ID,
    })
    await updateStatus(created.id, 'in_progress')
    attachPair(created.id)
    await updateStatus(created.id, 'resolved')

    const result = await confirmStoreFix({
      ticketId: created.id,
      actorLabel: 'מנהל חנות',
    })
    expect(result.status).toBe('closed')
    expect(result.pending_final_close).toBe(false)
    expect(result.store_confirmed_at).toBeTruthy()
    expect(memGet(created.id)?.status).toBe('closed')
    expect(memGet(created.id)?.quality_hold_until).toBeTruthy()
  })

  it('closes after quality hold has ended', async () => {
    const store = israelStoresAsRows().find((s) => s.code === '6006')!
    const created = memCreate({
      store,
      description: 'hold הסתיים',
      priority: 'medium',
      category: 'hvac',
      status: 'assigned',
      assigned_to: DEMO_TECH_ID,
    })
    await updateStatus(created.id, 'in_progress')
    attachPair(created.id)
    await updateStatus(created.id, 'resolved')
    const mem = memGet(created.id)!
    mem.quality_hold_until = new Date(Date.now() - 1000).toISOString()

    const result = await confirmStoreFix({
      ticketId: created.id,
      actorLabel: 'מנהל חנות',
    })
    expect(result.status).toBe('closed')
    expect(result.store_confirmed_at).toBeTruthy()
  })

  it('rejects confirm when ticket is still in progress', async () => {
    const store = israelStoresAsRows().find((s) => s.code === '6029')!
    const created = memCreate({
      store,
      description: 'קצר חשמלי',
      priority: 'critical',
      category: 'electrical',
      status: 'in_progress',
      assigned_to: DEMO_TECH_ID,
    })
    await expect(
      confirmStoreFix({ ticketId: created.id, actorLabel: 'store' }),
    ).rejects.toThrow(/אושר או סומן כנפתר/)
  })

  it('closes an approved visit immediately when the store confirms', async () => {
    const store = israelStoresAsRows().find((s) => s.code === '6006')!
    const created = memCreate({
      store,
      description: 'מזגן לא מקרר',
      priority: 'high',
      category: 'hvac',
    })
    await lockEngagement({
      ticketId: created.id,
      professionalName: 'פבל',
      professionalPhone: '0501234567',
      approvedAmount: 450,
      approvedBy: 'ארי',
    })

    const result = await confirmStoreFix({
      ticketId: created.id,
      actorLabel: 'מנהל חנות',
    })
    expect(result.status).toBe('closed')
    expect(result.pending_final_close).toBe(false)
    expect(memGet(created.id)?.status).toBe('closed')
    expect((await lockedEngagementFor(created.id))?.closedAt).toBe(result.store_confirmed_at)
    expect(await closedEngagementCosts()).toHaveLength(1)
  })

  it.each([
    { storeCode: '6006', first: 'lead' },
    { storeCode: '6006', first: 'side' },
    { storeCode: '6004', first: 'lead' },
    { storeCode: '6004', first: 'side' },
  ])('confirms only the named ticket in a bundle ($storeCode, $first first)', async ({ storeCode, first }) => {
    const stores = israelStoresAsRows()
    const lead = memCreate({
      store: stores.find((store) => store.code === '6006')!,
      description: 'מזגן לא מקרר',
      priority: 'high',
      category: 'hvac',
    })
    const side = memCreate({
      store: stores.find((store) => store.code === storeCode)!,
      description: 'ניקוי מסנן מזגן',
      priority: 'low',
      category: 'hvac',
    })
    const visit = await lockEngagement({
      ticketId: lead.id,
      bundledTicketIds: [side.id],
      professionalName: 'פבל',
      professionalPhone: '0501234567',
      approvedAmount: 450,
      approvedBy: 'ארי',
    })
    const confirmed = first === 'lead' ? lead : side
    const remaining = first === 'lead' ? side : lead

    const result = await confirmStoreFix({ ticketId: confirmed.id, actorLabel: 'מנהל ראשון' })
    expect(result.id).toBe(confirmed.id)
    expect(result.status).toBe('closed')
    expect(memGet(confirmed.id)?.store_confirmed_by).toBe('מנהל ראשון')
    expect(memGet(remaining.id)?.status).toBe('engaged')
    expect(memGet(remaining.id)?.store_confirmed_at).toBeFalsy()
    expect(memGet(remaining.id)?.events.some((event) => event.event_type === 'store_confirmed')).toBe(false)
    expect((await lockedEngagementFor(lead.id))?.closedAt).toBeNull()
    expect(await closedEngagementCosts()).toEqual([])

    // Repeating the first feedback must not confirm any other ticket.
    await confirmStoreFix({ ticketId: confirmed.id, actorLabel: 'מנהל ראשון' })
    expect(memGet(remaining.id)?.status).toBe('engaged')
    expect((await lockedEngagementFor(lead.id))?.closedAt).toBeNull()

    const final = await confirmStoreFix({ ticketId: remaining.id, actorLabel: 'מנהל שני' })
    expect(final.id).toBe(remaining.id)
    expect(memGet(remaining.id)?.status).toBe('closed')
    expect(memGet(remaining.id)?.store_confirmed_by).toBe('מנהל שני')
    expect(memGet(confirmed.id)?.store_confirmed_by).toBe('מנהל ראשון')
    expect((await lockedEngagementFor(lead.id))?.closedAt).toBe(final.store_confirmed_at)
    expect(await closedEngagementCosts()).toEqual([{
      storeCode: visit.storeCode,
      storeName: visit.storeName,
      approvedAmount: 450,
      closedAt: final.store_confirmed_at,
    }])
  })

  it('returns an approved visit to Ari when the store says it is not fixed', async () => {
    const store = israelStoresAsRows().find((s) => s.code === '6006')!
    const created = memCreate({
      store,
      description: 'מזגן לא מקרר',
      priority: 'high',
      category: 'hvac',
    })
    await lockEngagement({
      ticketId: created.id,
      professionalName: 'פבל',
      professionalPhone: '0501234567',
      approvedAmount: 450,
      approvedBy: 'ארי',
    })
    await rejectStoreFix({ ticketId: created.id, actorLabel: 'מנהל חנות' })
    expect(memGet(created.id)?.status).toBe('new')
  })
})
