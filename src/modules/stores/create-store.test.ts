import { beforeEach, describe, expect, it } from 'vitest'
import { createStore } from '@/modules/stores/service'
import { resolveManagerStoreByPhone } from '@/modules/stores/manager-identity'
import { memFindStoreByCode } from '@/lib/data/memory-store'

describe('createStore end-to-end fields', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
  })

  it('requires manager name and phone', async () => {
    await expect(
      createStore({
        code: '9991',
        name: 'בדיקה',
        area_manager: 'ונסה',
      }),
    ).rejects.toThrow(/מנהל/)
  })

  it('creates store with area manager + manager phone identity', async () => {
    const code = `9${String(Date.now()).slice(-4)}`
    const store = await createStore({
      code,
      name: 'סניף בדיקה',
      city: 'חולון',
      region_id: 'TA',
      area_manager: 'ונסה',
      manager_name: 'דנה',
      manager_phone: '052-1112233',
    })
    expect(store.code).toBe(code)
    expect(store.manager_name).toBe('דנה')
    expect(store.area_manager).toBe('ונסה')
    expect(store.manager_phone).toContain('052')

    const mem = memFindStoreByCode(code)
    expect(mem?.manager_name).toBe('דנה')

    const hit = await resolveManagerStoreByPhone('972521112233')
    expect(hit?.code).toBe(code)
  })
})
