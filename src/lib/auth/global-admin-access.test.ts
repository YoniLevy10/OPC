import { describe, expect, it } from 'vitest'
import type { Actor, TicketScopeRow } from './types'
import {
  actorIsGlobalAdmin,
  canMutateHqTicket,
  canReadTicket,
} from './types'
import {
  canManageStore,
  canMutateAssetStore,
  canReadAssetStore,
  resolveStoreCreationScope,
} from './store-scope'
import { canAccessInboxSession } from '@/modules/inbox/authorization'
import { canReadStoreDocument } from '@/modules/documents/store-document-access'
import { requireStoresMutate } from '@/modules/stores/service'
import { requireUsersAdmin } from '@/modules/users/service'

function adminActor(overrides: Partial<Actor['memberships'][number]> = {}): Actor {
  return {
    id: 'ari',
    memberships: [
      {
        id: 'm',
        profile_id: 'ari',
        organization_id: 'org',
        role: 'global_admin',
        country_id: null,
        region_id: null,
        store_id: null,
        ...overrides,
      },
    ],
    authVia: 'supabase_session',
  }
}

const ticket: TicketScopeRow = {
  id: 't1',
  organization_id: 'other-org',
  country_id: 'fr',
  region_id: 'paris',
  store_id: 's9',
  assigned_to: null,
  status: 'new',
}

describe('global_admin full system access', () => {
  it('recognizes system admin even without country', () => {
    expect(actorIsGlobalAdmin(adminActor())).toBe(true)
  })

  it('reads and mutates tickets across org/country', () => {
    const actor = adminActor()
    expect(canReadTicket(actor, ticket)).toBe(true)
    expect(canMutateHqTicket(actor, ticket)).toBe(true)
  })

  it('manages stores and assets anywhere', () => {
    const actor = adminActor()
    const store = {
      id: 's9',
      organization_id: 'other-org',
      country_id: 'fr',
      region_id: null,
    }
    expect(canManageStore(actor, store)).toBe(true)
    expect(canReadAssetStore(actor, store)).toBe(true)
    expect(canMutateAssetStore(actor, store)).toBe(true)
    expect(() => requireStoresMutate(actor)).not.toThrow()
    expect(resolveStoreCreationScope(actor, {})).toMatchObject({
      organization_id: 'org',
    })
  })

  it('opens inbox and documents without scope match', () => {
    const actor = adminActor()
    expect(
      canAccessInboxSession(actor, {
        store_id: 's9',
        country_id: 'fr',
        organization_id: 'other-org',
      }),
    ).toBe(true)
    expect(
      canReadStoreDocument(
        actor.memberships,
        's9',
        {
          id: 's9',
          organization_id: 'other-org',
          country_id: 'fr',
          region_id: null,
        },
      ),
    ).toBe(true)
  })

  it('can manage users', () => {
    expect(() => requireUsersAdmin(adminActor())).not.toThrow()
  })
})
