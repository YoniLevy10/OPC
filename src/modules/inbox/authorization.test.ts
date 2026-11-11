import { describe, expect, it } from 'vitest'
import type { Actor } from '@/lib/auth/types'
import { canAccessInboxSession } from './authorization'

const actor = (role: Actor['memberships'][number]['role'], scope: Partial<Actor['memberships'][number]> = {}) => ({
  memberships: [{ id: 'm', profile_id: 'p', organization_id: 'org', role, country_id: 'il', region_id: 'north', store_id: 's1', ...scope }],
}) as Actor
const session = { store_id: 's1', country_id: 'il', region_id: 'north' }

describe('inbox session authorization', () => {
  it('allows HQ roles and exact country, region, and store scopes', () => {
    expect(canAccessInboxSession(actor('global_admin'), session)).toBe(true)
    expect(canAccessInboxSession(actor('global_maintenance'), session)).toBe(true)
    expect(canAccessInboxSession(actor('country_manager'), session)).toBe(true)
    expect(canAccessInboxSession(actor('regional_manager'), session)).toBe(true)
    expect(canAccessInboxSession(actor('store_manager'), session)).toBe(true)
    expect(canAccessInboxSession(actor('store_employee'), session)).toBe(true)
  })
  it('denies cross-tenant scopes and never uses phone identity as scope', () => {
    expect(canAccessInboxSession(actor('country_manager'), { ...session, country_id: 'other' })).toBe(false)
    expect(canAccessInboxSession(actor('regional_manager'), { ...session, region_id: 'south' })).toBe(false)
    expect(canAccessInboxSession(actor('store_employee'), { ...session, store_id: 's2' })).toBe(false)
    expect(canAccessInboxSession(actor('internal_technician'), session)).toBe(false)
    expect(canAccessInboxSession(actor('global_admin'), { ...session, organization_id: 'other' })).toBe(false)
  })
})
