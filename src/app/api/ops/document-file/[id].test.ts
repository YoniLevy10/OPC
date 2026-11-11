import { describe, expect, it } from 'vitest'
import { canReadStoreDocument } from '@/modules/documents/store-document-access'

describe('canReadStoreDocument', () => {
  it('requires HQ scope to match the document store organization and geography', () => {
    for (const role of ['global_admin', 'global_maintenance', 'country_manager', 'regional_manager']) {
      expect(canReadStoreDocument([{ role, store_id: null, organization_id: 'org-a', country_id: 'country-a', region_id: 'region-a' }], 'store-b', { id: 'store-b', organization_id: 'org-a', country_id: 'country-a', region_id: 'region-a' })).toBe(true)
    }
  })

  it('denies cross-country and cross-region HQ documents', () => {
    expect(canReadStoreDocument([{ role: 'country_manager', organization_id: 'org-a', country_id: 'country-a' }], 'store-b', { id: 'store-b', organization_id: 'org-a', country_id: 'country-b', region_id: 'r' })).toBe(false)
    expect(canReadStoreDocument([{ role: 'regional_manager', organization_id: 'org-a', region_id: 'r1' }], 'store-b', { id: 'store-b', organization_id: 'org-a', country_id: 'c', region_id: 'r2' })).toBe(false)
  })

  it('allows store staff to read only documents belonging to their store', () => {
    const membership = [{ role: 'store_manager', store_id: 'store-a' }]
    expect(canReadStoreDocument(membership, 'store-a')).toBe(true)
    expect(canReadStoreDocument(membership, 'store-b')).toBe(false)
    expect(canReadStoreDocument(membership, null)).toBe(false)
  })

  it('does not grant access to memberships without a matching store or role', () => {
    expect(canReadStoreDocument([{ role: 'store_employee' }], 'store-a')).toBe(false)
    expect(canReadStoreDocument([{ role: 'internal_technician', store_id: 'store-a' }], 'store-a')).toBe(false)
    expect(canReadStoreDocument([], 'store-a')).toBe(false)
  })
})
