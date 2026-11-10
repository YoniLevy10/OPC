import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactNode, type ElementType } from 'react'
import { MEM_ORG_ID } from '@/lib/data/memory-store'

const state = vi.hoisted(() => ({ actor: null as unknown, visible: vi.fn(), fallback: vi.fn() }))
vi.mock('@/lib/auth/server-actor', () => ({ getServerActor: async () => state.actor }))
vi.mock('@/lib/auth/home-path', () => ({ shouldAllowDemoEntry: () => false }))
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('login required') } }))
vi.mock('@/lib/auth/store-asset-scope', () => ({ visibleStores: state.visible }))
vi.mock('@/modules/stores/data', async (original) => ({ ...await original<typeof import('@/modules/stores/data')>(), fetchStores: state.fallback }))
vi.mock('@/modules/assets/service', () => ({ listAssets: async () => ({ assets: [
  { id: 'own-asset', store_id: 'own-store' }, { id: 'foreign-asset', store_id: 'foreign-store' },
] }) }))
vi.mock('@/modules/tickets/service', () => ({ listTickets: async () => ({ tickets: [
  { id: 'own-ticket', store_id: 'own-store', asset_id: 'own-asset', description: 'Own fault' },
  { id: 'foreign-ticket', store_id: 'foreign-store', asset_id: 'foreign-asset', description: 'Private foreign fault' },
] }) }))
vi.mock('@/lib/data/ops-ledger', () => ({ listSpends: () => [
  { storeId: 'own-store', assetId: 'own-asset', status: 'approved', requestedAmount: 100, approvedAmount: 100, actualAmount: null },
  { storeId: 'foreign-store', assetId: 'foreign-asset', status: 'approved', requestedAmount: 999, approvedAmount: 999, actualAmount: null },
  { storeId: 'own-store', assetId: 'foreign-asset', status: 'approved', requestedAmount: 777, approvedAmount: 777, actualAmount: null },
] }))
vi.mock('./assets-admin', () => ({ AssetsAdmin: () => null }))
vi.mock('../inventory/parts-stock', () => ({ PartsStock: () => null }))

import AssetsPage from './page'
import { AssetsAdmin } from './assets-admin'
import { PartsStock } from '../inventory/parts-stock'

function findElement(node: ReactNode, type: ElementType): Record<string, unknown> | null {
  if (!isValidElement(node)) return null
  if (node.type === type) return node.props as Record<string, unknown>
  for (const child of Children.toArray((node.props as { children?: ReactNode }).children)) {
    const found = findElement(child, type)
    if (found) return found
  }
  return null
}

describe('assets SSR tenant data', () => {
  beforeEach(() => {
    state.actor = { memberships: [{ role: 'global_maintenance', organization_id: MEM_ORG_ID }] }
    state.visible.mockReset().mockResolvedValue({ stores: [{ id: 'own-store', code: '6006', name: 'Own branch' }], backend: 'memory' })
    state.fallback.mockReset()
  })

  it('passes only authorized store options, ticket hints and matching asset costs to the browser', async () => {
    const page = await AssetsPage()
    const props = findElement(page, AssetsAdmin)
    expect(props?.stores).toEqual([{ id: 'own-store', code: '6006', name: 'Own branch' }])
    expect((props?.tickets as { id: string }[]).map((ticket) => ticket.id)).toEqual(['own-ticket'])
    expect(props?.assetTrueCost).toEqual({ 'own-asset': 100 })
    expect(state.visible).toHaveBeenCalledWith(state.actor, true)
    expect(state.fallback).not.toHaveBeenCalled()
    expect(findElement(page, PartsStock)).not.toBeNull()
  })

  it.each([
    { role: 'global_admin', organization_id: 'another-organization' },
    { role: 'country_manager', organization_id: MEM_ORG_ID, country_id: 'one-country' },
  ])('does not expose the pilot-wide warehouse to a different organization or scoped role ($role)', async (membership) => {
    state.actor = { memberships: [membership] }
    expect(findElement(await AssetsPage(), PartsStock)).toBeNull()
  })

  it('does not render tenant data without authentication outside explicit demo mode', async () => {
    state.actor = null
    await expect(AssetsPage()).rejects.toThrow('login required')
    expect(state.visible).not.toHaveBeenCalled()
  })
})
