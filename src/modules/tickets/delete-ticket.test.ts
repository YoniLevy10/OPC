import { beforeEach, describe, expect, it } from 'vitest'
import { memCreate, memFindStoreByCode, memGet } from '@/lib/data/memory-store'
import { deleteTicket } from './service'

process.env.MAINTAINOS_FORCE_MEMORY = '1'

describe('deleteTicket', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
  })

  it('removes a ticket from memory', async () => {
    const store = memFindStoreByCode('6005')
    expect(store).toBeTruthy()
    const created = memCreate({
      store: store!,
      description: 'נזילה לבדיקת מחיקה',
      priority: 'medium',
      category: 'plumbing',
      source: 'web_fallback',
    })
    expect(memGet(created.id)).toBeTruthy()

    const result = await deleteTicket(created.id)
    expect(result.id).toBe(created.id)
    expect(result.backend).toBe('memory')
    expect(memGet(created.id)).toBeUndefined()
  })

  it('fails when the ticket is missing', async () => {
    await expect(deleteTicket('missing-ticket-id')).rejects.toThrow(/לא נמצאה/)
  })
})
