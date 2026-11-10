import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  countries: [{ id: 'country-a', organization_id: 'org-a' }, { id: 'country-b', organization_id: 'org-b' }],
  regions: [{ id: 'region-a', country_id: 'country-a' }, { id: 'region-b', country_id: 'country-b' }],
  error: null as { message: string } | null,
  reads: vi.fn(),
}))
vi.mock('@/lib/data/memory-store', async (original) => ({ ...await original<typeof import('@/lib/data/memory-store')>(), supabaseReady: async () => true }))
vi.mock('@/lib/supabase/system', () => ({ createSystemClient: () => ({
  from: (table: 'countries' | 'regions') => {
    const filters: Record<string, string> = {}
    const query = {
      select: () => query,
      eq: (field: string, value: string) => { filters[field] = value; return query },
      maybeSingle: async () => {
        state.reads(table, filters)
        const records: Record<string, string>[] = state[table]
        return { error: state.error, data: records.find((row) => Object.entries(filters).every(([field, value]) => row[field] === value)) ?? null }
      },
    }
    return query
  },
}) }))

import { validateStoreHierarchy } from './store-asset-scope'

describe('live store hierarchy validation', () => {
  beforeEach(() => { state.error = null; state.reads.mockClear() })

  it('rejects a foreign country using both country and organization filters', async () => {
    await expect(validateStoreHierarchy('org-a', 'country-b', 'region-b')).rejects.toThrow('המדינה אינה שייכת')
    expect(state.reads).toHaveBeenCalledExactlyOnceWith('countries', { id: 'country-b', organization_id: 'org-a' })
  })

  it('rejects a region in another country even when the organization is authorized', async () => {
    await expect(validateStoreHierarchy('org-a', 'country-a', 'region-b')).rejects.toThrow('האזור אינו שייך')
    expect(state.reads).toHaveBeenLastCalledWith('regions', { id: 'region-b', country_id: 'country-a' })
  })

  it('does not authorize a live write when the hierarchy lookup fails', async () => {
    state.error = { message: 'lookup unavailable' }
    await expect(validateStoreHierarchy('org-a', 'country-a', 'region-a')).rejects.toThrow('lookup unavailable')
  })

  it('accepts the verified country and region without substituting a pilot default', async () => {
    await expect(validateStoreHierarchy('org-a', 'country-a', 'region-a')).resolves.toBe('region-a')
  })
})
