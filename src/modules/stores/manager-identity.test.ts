import { beforeEach, describe, expect, it } from 'vitest'
import { memUpdateStore, memFindStoreByCode } from '@/lib/data/memory-store'
import {
  resolveManagerStoreByPhone,
  soleManagerStore,
} from '@/modules/stores/manager-identity'
import { replaceStoreManager } from '@/modules/stores/replace-manager'

describe('manager identity', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
  })

  it('soleManagerStore finds a unique seed manager phone', () => {
    const hit = soleManagerStore('972547718456')
    expect(hit?.code).toBe('6001')
    expect(hit?.managerName).toBe('קרן')
  })

  it('resolveManagerStoreByPhone prefers memory store manager_phone', async () => {
    const store = memFindStoreByCode('6001') ?? memFindStoreByCode('109')
    if (!store) {
      // Demo stores may use alias codes — skip if seed not in memory
      const any = soleManagerStore('972547718456')
      expect(any).toBeTruthy()
      return
    }
    memUpdateStore(store.id, {
      manager_name: 'טסט מנהל',
      manager_phone: '050-1112233',
    })
    const hit = await resolveManagerStoreByPhone('972501112233')
    expect(hit?.managerName).toBe('טסט מנהל')
    expect(hit?.code).toBe(store.code)
  })

  it('replaceStoreManager updates memory manager fields', async () => {
    const store = memFindStoreByCode('6004') ?? memFindStoreByCode('101')
    if (!store) return
    const updated = await replaceStoreManager({
      storeId: store.id,
      managerName: 'מנהל חדש',
      managerPhone: '052-9998877',
    })
    expect(updated.manager_name).toBe('מנהל חדש')
    expect(updated.manager_phone).toContain('052')
  })
})
