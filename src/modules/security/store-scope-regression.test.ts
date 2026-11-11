import { describe, expect, it } from 'vitest'
import { assertStoreHierarchy, resolveMemoryStore } from '@/modules/tickets/service'

describe('store hierarchy and country scope', () => {
  it('rejects incomplete store hierarchy instead of accepting an unscoped store', () => {
    const valid = { id: 'store-a', organization_id: 'org', country_id: 'il', region_id: 'center' }
    expect(() => assertStoreHierarchy(valid)).not.toThrow()
    expect(() => assertStoreHierarchy({ ...valid, organization_id: null })).toThrow(/organization hierarchy/)
    expect(() => assertStoreHierarchy({ ...valid, country_id: null })).toThrow(/country\/region hierarchy/)
    expect(() => assertStoreHierarchy({ ...valid, region_id: null })).toThrow(/country\/region hierarchy/)
  })

  it('does not resolve a store ID under a different requested country', () => {
    expect(() => resolveMemoryStore({ storeId: 'il-store-172', countryCode: 'FR', description: 'scope' }))
      .toThrow(/does not belong to the requested country/i)
    expect(resolveMemoryStore({ storeCode: '172', countryCode: 'FR', description: 'scope' }).id)
      .toBe('demo-fr-172')
  })
})
