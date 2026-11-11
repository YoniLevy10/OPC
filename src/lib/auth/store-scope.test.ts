import { describe, expect, it } from 'vitest'
import type { Actor } from './types'
import {
  canManageStore,
  canMutateAssetStore,
  canReadAssetStore,
  resolveStoreCreationScope,
} from './store-scope'
const PILOT_COUNTRY_ID = '22222222-2222-2222-2222-222222222222'

const actor = (
  role: Actor['memberships'][number]['role'],
  values: Partial<Actor['memberships'][number]> = {},
) =>
  ({
    memberships: [
      {
        id: 'm',
        profile_id: 'p',
        organization_id: 'org',
        role,
        country_id: 'il',
        region_id: 'north',
        store_id: 's1',
        ...values,
      },
    ],
  }) as Actor

const store = {
  id: 's1',
  organization_id: 'org',
  country_id: 'il',
  region_id: 'north',
}

describe('store scope authorization', () => {
  it('rejects wrong store/country/org targets for scoped roles', () => {
    expect(
      canManageStore(actor('country_manager'), {
        ...store,
        country_id: 'other',
      }),
    ).toBe(false)
  })

  it('gives global_admin full store access regardless of org/country', () => {
    expect(
      canManageStore(actor('global_admin', { country_id: null }), {
        ...store,
        organization_id: 'other',
      }),
    ).toBe(true)
    expect(
      canReadAssetStore(actor('global_admin', { country_id: null }), {
        ...store,
        organization_id: 'other',
      }),
    ).toBe(true)
    expect(
      canMutateAssetStore(actor('global_admin', { country_id: null }), {
        ...store,
        id: 'anywhere',
      }),
    ).toBe(true)
  })

  it('limits staff to store reads and reserves mutations for scoped HQ', () => {
    expect(canReadAssetStore(actor('store_employee'), store)).toBe(true)
    expect(
      canReadAssetStore(actor('store_employee'), { ...store, id: 's2' }),
    ).toBe(false)
    expect(canMutateAssetStore(actor('store_manager'), store)).toBe(false)
    expect(canMutateAssetStore(actor('country_manager'), store)).toBe(true)
  })

  it('derives create scope from a matching membership', () => {
    expect(
      resolveStoreCreationScope(actor('country_manager'), {
        country_id: 'il',
        organization_id: 'org',
      }),
    ).toEqual({ country_id: 'il', organization_id: 'org' })
    expect(() =>
      resolveStoreCreationScope(actor('country_manager'), {
        country_id: 'other',
      }),
    ).toThrow()
  })

  it('lets global_admin create stores without membership country_id', () => {
    expect(
      resolveStoreCreationScope(actor('global_admin', { country_id: null }), {}),
    ).toEqual({
      organization_id: 'org',
      country_id: PILOT_COUNTRY_ID,
    })
    expect(
      resolveStoreCreationScope(actor('global_admin', { country_id: null }), {
        country_id: '33333333-3333-3333-3333-333333333333',
      }),
    ).toEqual({
      organization_id: 'org',
      country_id: '33333333-3333-3333-3333-333333333333',
    })
  })

  it('lets global_admin manage stores in their org without country_id', () => {
    expect(
      canManageStore(actor('global_admin', { country_id: null }), store),
    ).toBe(true)
  })
})
