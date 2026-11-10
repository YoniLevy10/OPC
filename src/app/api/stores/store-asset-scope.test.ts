import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError, type Actor, type MemberRole } from '@/lib/auth/types'
import {
  MEM_COUNTRY_ID, MEM_COUNTRY_FR_ID, MEM_ORG_ID,
  memCreateStore, memCreateAsset, memFindStoreByCode, memFindStoreById,
  memListAssets, memListStores,
} from '@/lib/data/memory-store'

const mocks = vi.hoisted(() => ({ actor: vi.fn() }))
vi.mock('@/lib/auth/request-actor', () => ({
  requireActor: mocks.actor,
  authErrorResponse: (error: AuthError) => Response.json({ error: error.message }, { status: error.status }),
}))
vi.mock('@/modules/stores/business-phone', () => ({ resolveWhatsAppBusinessPhone: async () => '972501234567' }))
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,test', toString: async () => '<svg/>', toBuffer: async () => new Uint8Array([1]) } }))
vi.mock('@/lib/monitoring', () => ({ captureError: vi.fn() }))

import { GET as storesGet, POST as storesPost } from './route'
import { PATCH as storePatch } from './[id]/route'
import { GET as assetsGet, POST as assetsPost } from '../assets/route'
import { PATCH as assetPatch, DELETE as assetDelete } from '../assets/[id]/route'
import { GET as batchQr } from './qr-batch/route'
import { GET as singleQr } from './qr/route'

process.env.MAINTAINOS_FORCE_MEMORY = '1'
const OTHER_ORG = '99999999-9999-4999-8999-999999999991'
const OTHER_COUNTRY = '99999999-9999-4999-8999-999999999992'
const ownStore = memFindStoreByCode('6006')!
const otherShop = memFindStoreByCode('6004')!
const foreignStore = memCreateStore({ code: '99101', name: 'Private foreign branch', country_id: OTHER_COUNTRY, organization_id: OTHER_ORG, region_id: 'foreign' })
const ownAsset = memCreateAsset({ store_id: ownStore.id, code: 'SCOPE-OWN', name: 'Own asset' })
const otherAsset = memCreateAsset({ store_id: otherShop.id, code: 'SCOPE-OTHER', name: 'Another shop asset' })
const foreignAsset = memCreateAsset({ store_id: foreignStore.id, code: 'SCOPE-FOREIGN', name: 'Private foreign asset' })

function actor(role: MemberRole = 'global_admin', patch: Partial<Actor['memberships'][number]> = {}): Actor {
  return { id: 'member', authVia: 'supabase_session', memberships: [{
    id: 'membership', profile_id: 'member', role, organization_id: MEM_ORG_ID,
    country_id: null, region_id: null, store_id: null, ...patch,
  }] }
}
function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`http://localhost${path}`, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
}
const context = (id: string) => ({ params: Promise.resolve({ id }) })

describe('store and asset API tenant boundaries', () => {
  beforeEach(() => { mocks.actor.mockReset().mockResolvedValue(actor()) })

  it('requires authentication for catalogs and QR exports', async () => {
    mocks.actor.mockRejectedValue(new AuthError('login required', 401))
    expect((await storesGet(request('/api/stores'))).status).toBe(401)
    expect((await assetsGet(request('/api/assets'))).status).toBe(401)
    expect((await batchQr(request('/api/stores/qr-batch?format=json'))).status).toBe(401)
    expect((await singleQr(new NextRequest('http://localhost/api/stores/qr?code=6006'))).status).toBe(401)
  })

  it('filters stores and assets to the admin organization', async () => {
    const stores = await (await storesGet(request('/api/stores'))).json()
    expect(stores.stores.some((store: { id: string }) => store.id === ownStore.id)).toBe(true)
    expect(stores.stores.some((store: { id: string }) => store.id === foreignStore.id)).toBe(false)
    const assets = await (await assetsGet(request('/api/assets'))).json()
    expect(assets.assets.some((asset: { id: string }) => asset.id === ownAsset.id)).toBe(true)
    expect(assets.assets.some((asset: { id: string }) => asset.id === foreignAsset.id)).toBe(false)
  })

  it('limits a shop account to its own shop and equipment, including explicit store queries', async () => {
    mocks.actor.mockResolvedValue(actor('store_employee', { store_id: ownStore.id }))
    const stores = await (await storesGet(request('/api/stores'))).json()
    expect(stores.stores.map((store: { id: string }) => store.id)).toEqual([ownStore.id])
    const assets = await (await assetsGet(request('/api/assets'))).json()
    expect(assets.assets.some((asset: { id: string }) => asset.id === ownAsset.id)).toBe(true)
    expect(assets.assets.some((asset: { id: string }) => asset.id === otherAsset.id)).toBe(false)
    expect((await assetsGet(request(`/api/assets?store=${otherShop.id}`))).status).toBe(403)
  })

  it('enforces country and regional scopes for store catalogs', async () => {
    mocks.actor.mockResolvedValue(actor('country_manager', { country_id: MEM_COUNTRY_FR_ID }))
    const france = await (await storesGet(request('/api/stores'))).json()
    expect(france.stores.every((store: { country_id: string }) => store.country_id === MEM_COUNTRY_FR_ID)).toBe(true)
    expect(france.stores.length).toBeGreaterThan(0)
    mocks.actor.mockResolvedValue(actor('regional_manager', { country_id: MEM_COUNTRY_ID, region_id: 'ta' }))
    const region = await (await storesGet(request('/api/stores'))).json()
    expect(region.stores.every((store: { country_id: string; region_id: string }) => store.country_id === MEM_COUNTRY_ID && store.region_id === 'ta')).toBe(true)
  })

  it('does not turn technician login into access to the full catalog', async () => {
    mocks.actor.mockResolvedValue(actor('internal_technician'))
    expect((await (await storesGet(request('/api/stores'))).json()).stores).toEqual([])
    expect((await (await assetsGet(request('/api/assets'))).json()).assets).toEqual([])
  })

  it('rejects forged organization and country on store creation before a write', async () => {
    const count = memListStores({ activeOnly: false }).length
    expect((await storesPost(request('/api/stores', 'POST', { code: '99102', name: 'Forged', organization_id: OTHER_ORG, country_id: OTHER_COUNTRY }))).status).toBe(403)
    mocks.actor.mockResolvedValue(actor('country_manager', { country_id: MEM_COUNTRY_ID }))
    expect((await storesPost(request('/api/stores', 'POST', { code: '99102', name: 'Wrong country', country_id: OTHER_COUNTRY }))).status).toBe(403)
    expect(memListStores({ activeOnly: false })).toHaveLength(count)
  })

  it('rejects a country belonging to another organization even for an org admin', async () => {
    const count = memListStores({ activeOnly: false }).length
    expect((await storesPost(request('/api/stores', 'POST', { code: '99103', name: 'Wrong hierarchy', country_id: OTHER_COUNTRY, region_id: 'foreign' }))).status).toBe(403)
    expect(memListStores({ activeOnly: false })).toHaveLength(count)
  })

  it('derives permitted store defaults from a matching manager membership rather than the first unrelated role', async () => {
    const permitted = actor()
    permitted.memberships.unshift({ ...permitted.memberships[0]!, id: 'unrelated', role: 'store_employee', organization_id: OTHER_ORG, store_id: foreignStore.id })
    mocks.actor.mockResolvedValue(permitted)
    const response = await storesPost(request('/api/stores', 'POST', { code: '99104', name: 'Permitted new branch' }))
    expect(response.status).toBe(201)
    expect((await response.json()).store).toMatchObject({ organization_id: MEM_ORG_ID, country_id: MEM_COUNTRY_ID })
  })

  it('blocks foreign store edits and cross-country region reassignment without changing the records', async () => {
    const originalName = foreignStore.name
    expect((await storePatch(request('/api/stores/id', 'PATCH', { name: 'Overwritten' }), context(foreignStore.id))).status).toBe(403)
    expect(memFindStoreById(foreignStore.id)?.name).toBe(originalName)
    const originalRegion = ownStore.region_id
    expect((await storePatch(request('/api/stores/id', 'PATCH', { region_id: 'idf' }), context(ownStore.id))).status).toBe(403)
    expect(memFindStoreById(ownStore.id)?.region_id).toBe(originalRegion)
  })

  it('does not combine an admin role in another organization with an ordinary shop membership', async () => {
    const mixed = actor('store_employee', { store_id: ownStore.id })
    mixed.memberships.push({ ...mixed.memberships[0]!, id: 'foreign-admin', role: 'global_admin', organization_id: OTHER_ORG, store_id: null })
    mocks.actor.mockResolvedValue(mixed)
    expect((await assetPatch(request('/api/assets/id', 'PATCH', { name: 'No' }), context(ownAsset.id))).status).toBe(403)
    expect(memListAssets().find((asset) => asset.id === ownAsset.id)?.name).toBe('Own asset')
  })

  it('removes the memory-mode privilege bypass for asset creation and updates', async () => {
    mocks.actor.mockResolvedValue(actor('store_employee', { store_id: ownStore.id }))
    const count = memListAssets().length
    expect((await assetsPost(request('/api/assets', 'POST', { store_id: ownStore.id, code: 'UNAUTHORIZED', name: 'No' }))).status).toBe(403)
    expect((await assetPatch(request('/api/assets/id', 'PATCH', { name: 'No' }), context(ownAsset.id))).status).toBe(403)
    expect((await assetDelete(request('/api/assets/id', 'DELETE'), context(ownAsset.id))).status).toBe(403)
    expect(memListAssets()).toHaveLength(count)
  })

  it('blocks every asset mutation against another organization or country', async () => {
    const count = memListAssets().length
    expect((await assetsPost(request('/api/assets', 'POST', { store_id: foreignStore.id, code: 'BAD', name: 'No' }))).status).toBe(403)
    expect((await assetPatch(request('/api/assets/id', 'PATCH', { name: 'No' }), context(foreignAsset.id))).status).toBe(403)
    expect((await assetDelete(request('/api/assets/id', 'DELETE'), context(foreignAsset.id))).status).toBe(403)
    mocks.actor.mockResolvedValue(actor('country_manager', { country_id: MEM_COUNTRY_FR_ID }))
    expect((await assetDelete(request('/api/assets/id', 'DELETE'), context(ownAsset.id))).status).toBe(403)
    expect(memListAssets()).toHaveLength(count)
  })

  it('preserves allowed ops equipment CRUD within its organization', async () => {
    mocks.actor.mockResolvedValue(actor('global_maintenance'))
    const created = await assetsPost(request('/api/assets', 'POST', { store_id: ownStore.id, code: 'ALLOWED', name: 'Allowed' }))
    expect(created.status).toBe(201)
    const { asset } = await created.json()
    expect((await assetPatch(request('/api/assets/id', 'PATCH', { name: 'Updated' }), context(asset.id))).status).toBe(200)
    expect((await assetDelete(request('/api/assets/id', 'DELETE'), context(asset.id))).status).toBe(200)
    expect(memListAssets().some((row) => row.id === asset.id)).toBe(false)
  })

  it('scopes QR exports to authorized stores and disables public caching', async () => {
    mocks.actor.mockResolvedValue(actor('store_employee', { store_id: ownStore.id }))
    const batch = await batchQr(request('/api/stores/qr-batch?format=json'))
    expect(batch.status).toBe(200)
    expect(batch.headers.get('cache-control')).toContain('no-store')
    expect((await batch.json()).stores.map((store: { code: string }) => store.code)).toEqual([ownStore.code])
    expect((await singleQr(new NextRequest(`http://localhost/api/stores/qr?code=${foreignStore.code}&format=svg`))).status).toBe(403)
    const qr = await singleQr(new NextRequest(`http://localhost/api/stores/qr?code=${ownStore.code}&format=svg`))
    expect(qr.status).toBe(200)
    expect(qr.headers.get('cache-control')).toBe('private, no-store')
  })
})
