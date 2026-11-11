import { describe, expect, it } from 'vitest'
import type { Actor } from '@/lib/auth/types'
import { resolveStoreCreationScope } from '@/lib/auth/store-scope'
import { requireStoresMutate } from '@/modules/stores/service'

function actor(
  role: Actor['memberships'][number]['role'],
  extras: Partial<Actor['memberships'][number]> = {},
): Actor {
  return {
    id: 'u1',
    memberships: [
      {
        id: 'm1',
        profile_id: 'u1',
        organization_id: '11111111-1111-1111-1111-111111111111',
        role,
        country_id: null,
        region_id: null,
        store_id: null,
        ...extras,
      },
    ],
    authVia: 'supabase_session',
  }
}

describe('store create HQ scope', () => {
  it('lets global_maintenance open stores on pilot IL defaults', () => {
    const a = actor('global_maintenance', {
      organization_id: '11111111-1111-1111-1111-111111111111',
      country_id: null,
    })
    expect(() => requireStoresMutate(a)).not.toThrow()
    expect(resolveStoreCreationScope(a, {})).toEqual({
      organization_id: '11111111-1111-1111-1111-111111111111',
      country_id: '22222222-2222-2222-2222-222222222222',
    })
  })

  it('fills pilot country when HQ membership has no country', () => {
    const a = actor('global_admin')
    expect(resolveStoreCreationScope(a, {}).country_id).toBe(
      '22222222-2222-2222-2222-222222222222',
    )
  })
})
