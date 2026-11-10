import { beforeEach, describe, expect, it } from 'vitest'
import { memCreate, memGet, memReset } from '@/lib/data/memory-store'
import { israelStoresAsRows } from '@/modules/stores/israel-stores'
import { STORE_CONFIRMATION_REQUIRED_HE, updateStatus } from './service'
import { confirmStoreFix } from './store-confirm'

const store = israelStoresAsRows().find((row) => row.code === '6006')!

describe('final closure requires store feedback for this treatment cycle', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    memReset()
  })

  it('does not close a work approval as if it were store feedback', async () => {
    const ticket = memCreate({ store, description: 'עבודה שאושרה', category: 'hvac', priority: 'high', status: 'engaged' })
    await expect(updateStatus(ticket.id, 'closed', 'ari')).rejects.toThrow(STORE_CONFIRMATION_REQUIRED_HE)
    expect(memGet(ticket.id)?.status).toBe('engaged')
    expect(memGet(ticket.id)?.closed_at).toBeNull()
  })

  it('does not close an unconfirmed repair when the quality hold has expired', async () => {
    const ticket = memCreate({ store, description: 'תיקון בלי משוב', category: 'hvac', priority: 'high', status: 'resolved' })
    memGet(ticket.id)!.quality_hold_until = new Date(Date.now() - 1000).toISOString()
    await expect(updateStatus(ticket.id, 'closed')).rejects.toThrow(STORE_CONFIRMATION_REQUIRED_HE)
    expect(memGet(ticket.id)?.status).toBe('resolved')
  })

  it('does not let an Ari hold override manufacture store feedback', async () => {
    const ticket = memCreate({ store, description: 'חריגת ארי', category: 'hvac', priority: 'high', status: 'resolved' })
    await expect(updateStatus(ticket.id, 'closed', 'ari', {
      actorRoles: ['global_maintenance'],
      qualityHoldOverride: true,
      overrideReason: 'החרגה מתועדת',
    })).rejects.toThrow(STORE_CONFIRMATION_REQUIRED_HE)
    expect(memGet(ticket.id)?.store_confirmed_at).toBeNull()
  })

  it('allows final closure after actual stored feedback and hold expiry', async () => {
    const ticket = memCreate({ store, description: 'תיקון שאושר בחנות', category: 'hvac', priority: 'high', status: 'resolved' })
    const row = memGet(ticket.id)!
    row.quality_hold_until = new Date(Date.now() - 1000).toISOString()
    await confirmStoreFix({ ticketId: ticket.id, actorLabel: 'מנהל החנות' })
    expect(memGet(ticket.id)?.status).toBe('closed')
    expect(memGet(ticket.id)?.store_confirmed_by).toBe('מנהל החנות')
  })

  it('invalidates old feedback when the store reopens a failed repair', async () => {
    const ticket = memCreate({ store, description: 'תיקון שחזר', category: 'hvac', priority: 'high', status: 'resolved' })
    const row = memGet(ticket.id)!
    row.store_confirmed_at = new Date().toISOString()
    row.store_confirmed_by = 'אישור קודם'
    await updateStatus(ticket.id, 'in_progress')
    expect(row.store_confirmed_at).toBeNull()
    expect(row.store_confirmed_by).toBeNull()
    await updateStatus(ticket.id, 'resolved', 'ari', {
      actorRoles: ['global_maintenance'], overrideReason: 'דיווח תיקון חדש',
    })
    row.quality_hold_until = new Date(Date.now() - 1000).toISOString()
    await expect(updateStatus(ticket.id, 'closed')).rejects.toThrow(STORE_CONFIRMATION_REQUIRED_HE)
  })
})
