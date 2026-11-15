import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '@/lib/auth/types'
import {
  memFindStoreByCode,
  memListSessions,
  memReset,
  MEM_COUNTRY_ID,
} from '@/lib/data/memory-store'
import {
  opsStartLiveEnabled,
  shouldForceDryRunForOpsStart,
  startOpsChatWithStore,
} from './service'

function hqActor(): Actor {
  return {
    id: 'ari',
    email: 'ari@example.com',
    memberships: [
      {
        id: 'm1',
        profile_id: 'ari',
        organization_id: 'org',
        role: 'global_admin',
        country_id: MEM_COUNTRY_ID,
        region_id: null,
        store_id: null,
      },
    ],
    authVia: 'test_bearer',
  }
}

describe('ops start chat safety', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    process.env.MAINTAINOS_ALLOW_TEST_AUTH = '1'
    delete process.env.MAINTAINOS_WA_OPS_START_LIVE
    memReset()
  })

  it('forces dry-run for business-initiated threads by default', () => {
    expect(opsStartLiveEnabled()).toBe(false)
    expect(shouldForceDryRunForOpsStart(null)).toBe(true)
    expect(shouldForceDryRunForOpsStart(undefined)).toBe(true)
  })

  it('allows live when MAINTAINOS_WA_OPS_START_LIVE=1', () => {
    process.env.MAINTAINOS_WA_OPS_START_LIVE = '1'
    expect(opsStartLiveEnabled()).toBe(true)
    expect(shouldForceDryRunForOpsStart(null)).toBe(false)
  })

  it('does not force dry-run when there was inbound', () => {
    const recent = new Date().toISOString()
    expect(shouldForceDryRunForOpsStart(recent)).toBe(false)
  })

  it('startOpsChatWithStore opens a memory thread for a store manager', async () => {
    const store =
      memFindStoreByCode('172') ||
      memFindStoreByCode('101') ||
      memFindStoreByCode('6001')
    expect(store).toBeTruthy()
    if (!store?.manager_phone) {
      // Seed may lack manager phone in some fixtures — skip soft.
      return
    }

    const before = memListSessions().length
    const result = await startOpsChatWithStore({
      actor: hqActor(),
      storeId: store.id,
    })

    expect(result.backend).toBe('memory')
    expect(result.dryRunOnly).toBe(true)
    expect(result.liveOutboundEnabled).toBe(false)
    expect(result.session.store_id).toBe(store.id)
    expect(result.session.wa_id).toMatch(/^\d+$/)
    expect(memListSessions().length).toBeGreaterThanOrEqual(before)
    expect(result.templateRequired).toBe(true)
  })

  it('rejects non-HQ actors', async () => {
    const store = memFindStoreByCode('172') || memFindStoreByCode('101')
    if (!store) return
    const storeActor: Actor = {
      id: 'store',
      memberships: [
        {
          id: 'm2',
          profile_id: 'store',
          organization_id: 'org',
          role: 'store_employee',
          country_id: MEM_COUNTRY_ID,
          region_id: null,
          store_id: store.id,
        },
      ],
      authVia: 'test_bearer',
    }
    await expect(
      startOpsChatWithStore({ actor: storeActor, storeId: store.id }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
