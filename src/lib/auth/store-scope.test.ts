import { describe, expect, it } from 'vitest'
import type { Actor } from './types'
import { canManageStore, canMutateAssetStore, canReadAssetStore, resolveStoreCreationScope } from './store-scope'
const actor = (role: Actor['memberships'][number]['role'], values: Partial<Actor['memberships'][number]> = {}) => ({ memberships: [{ id: 'm', profile_id: 'p', organization_id: 'org', role, country_id: 'il', region_id: 'north', store_id: 's1', ...values }] }) as Actor
const store = { id: 's1', organization_id: 'org', country_id: 'il', region_id: 'north' }
describe('store scope authorization', () => {
  it('rejects wrong store/country/org targets', () => {
    expect(canManageStore(actor('country_manager'), { ...store, country_id: 'other' })).toBe(false)
    expect(canManageStore(actor('global_admin'), { ...store, organization_id: 'other' })).toBe(false)
  })
  it('limits staff to store reads and reserves mutations for scoped HQ', () => {
    expect(canReadAssetStore(actor('store_employee'), store)).toBe(true)
    expect(canReadAssetStore(actor('store_employee'), { ...store, id: 's2' })).toBe(false)
    expect(canMutateAssetStore(actor('store_manager'), store)).toBe(false)
    expect(canMutateAssetStore(actor('country_manager'), store)).toBe(true)
  })
  it('derives create scope from a matching membership', () => {
    expect(resolveStoreCreationScope(actor('country_manager'), { country_id: 'il', organization_id: 'org' })).toEqual({ country_id: 'il', organization_id: 'org' })
    expect(() => resolveStoreCreationScope(actor('country_manager'), { country_id: 'other' })).toThrow()
  })
})
