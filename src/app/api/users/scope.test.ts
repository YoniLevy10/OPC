import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, type Actor, type Membership } from '@/lib/auth/types'
import { MEM_ORG_ID, MEM_COUNTRY_ID, memFindStoreByCode, memCreateStore } from '@/lib/data/memory-store'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), list: vi.fn(), create: vi.fn(), patch: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/auth/request-actor', () => ({ requireActor: mocks.actor, authErrorResponse: (error: AuthError) => Response.json({ error: error.message }, { status: error.status }) }))
vi.mock('@/modules/users/service', () => ({
  listUsers: mocks.list, createUser: mocks.create, patchUser: mocks.patch, deleteUser: mocks.remove,
  requireUsersAdmin: (actor: Actor) => { if (!actor.memberships.some((membership) => membership.role === 'global_admin')) throw new AuthError('denied', 403) },
}))
import { GET, POST } from './route'
import { PATCH, DELETE } from './[id]/route'

process.env.MAINTAINOS_FORCE_MEMORY = '1'
const OTHER_ORG = '99999999-9999-4999-8999-999999999991'
const OTHER_COUNTRY = '99999999-9999-4999-8999-999999999992'
const OWN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FOREIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const MIXED = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ORPHAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const OWN_MEM = 'aaaaaaaa-1111-4111-8111-111111111111'
const FOREIGN_MEM = 'bbbbbbbb-1111-4111-8111-111111111111'
const MIXED_OWN_MEM = 'cccccccc-1111-4111-8111-111111111111'
const MIXED_FOREIGN_MEM = 'cccccccc-2222-4222-8222-222222222222'
function membership(id: string, profile: string, organization = MEM_ORG_ID, role: Membership['role'] = 'global_maintenance'): Membership {
  return { id, profile_id: profile, organization_id: organization, role, country_id: null, region_id: null, store_id: null }
}
const rows = [
  { id: OWN, email: 'own@example.test', full_name: 'Own', phone: null, memberships: [membership(OWN_MEM, OWN)] },
  { id: FOREIGN, email: 'foreign@example.test', full_name: 'Foreign', phone: null, memberships: [membership(FOREIGN_MEM, FOREIGN, OTHER_ORG)] },
  { id: MIXED, email: 'mixed@example.test', full_name: 'Mixed', phone: null, memberships: [membership(MIXED_OWN_MEM, MIXED), membership(MIXED_FOREIGN_MEM, MIXED, OTHER_ORG)] },
  { id: ORPHAN, email: 'orphan@example.test', full_name: 'Orphan', phone: null, memberships: [] },
]
const admin: Actor = { id: 'admin', authVia: 'supabase_session', memberships: [membership('admin-membership', 'admin', MEM_ORG_ID, 'global_admin')] }
const foreignStore = memCreateStore({ code: '99091', name: 'Foreign', country_id: OTHER_COUNTRY, organization_id: OTHER_ORG, region_id: 'foreign' })
const ownStore = memFindStoreByCode('6006')!
const body = { full_name: 'New', email: 'new@example.test', role: 'global_maintenance', password: 'password-for-test' }
const request = (value?: unknown, method = 'POST') => new Request('http://localhost/api/users', { method, ...(value === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }) })
const context = (id: string) => ({ params: Promise.resolve({ id }) })

describe('users API organization boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue(admin)
    mocks.list.mockResolvedValue(rows)
    mocks.create.mockResolvedValue(rows[0])
    mocks.patch.mockResolvedValue(rows[0])
    mocks.remove.mockResolvedValue(undefined)
  })

  it('requires authenticated administration rather than an ordinary role', async () => {
    mocks.actor.mockRejectedValue(new AuthError('login', 401))
    expect((await GET(request(undefined, 'GET'))).status).toBe(401)
    mocks.actor.mockResolvedValue({ ...admin, memberships: [membership('ordinary', 'admin')] })
    expect((await GET(request(undefined, 'GET'))).status).toBe(403)
    expect((await POST(request(body))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('returns only users in an administered organization and redacts their other memberships', async () => {
    const response = await GET(request(undefined, 'GET'))
    const { users } = await response.json()
    expect(users.map((user: { id: string }) => user.id)).toEqual([OWN, MIXED])
    expect(users.find((user: { id: string }) => user.id === MIXED).memberships).toEqual([rows[2]!.memberships[0]])
    expect(JSON.stringify(users)).not.toContain(OTHER_ORG)
    expect(JSON.stringify(users)).not.toContain('foreign@example.test')
  })

  it('does not allow an admin in another organization to create an elevated role in an ordinary membership organization', async () => {
    const ordinaryOrganization = '88888888-8888-4888-8888-888888888888'
    mocks.actor.mockResolvedValue({ ...admin, memberships: [membership('ordinary', 'admin', ordinaryOrganization), membership('foreign-admin', 'admin', OTHER_ORG, 'global_admin')] })
    expect((await POST(request({ ...body, organization_id: ordinaryOrganization }))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects a forged organization and caller-selected existing profile ID', async () => {
    expect((await POST(request({ ...body, organization_id: OTHER_ORG }))).status).toBe(403)
    expect((await POST(request({ ...body, id: FOREIGN }))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('does not rebind or reset any existing account by email', async () => {
    expect((await POST(request({ ...body, email: 'foreign@example.test' }))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects foreign store and country assignments before creating an Auth user', async () => {
    expect((await POST(request({ ...body, role: 'store_employee', store_id: foreignStore.id }))).status).toBe(403)
    expect((await POST(request({ ...body, country_id: OTHER_COUNTRY }))).status).toBe(403)
    expect((await POST(request({ ...body, role: 'store_employee' }))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('derives organization and store hierarchy from a matching administrator membership', async () => {
    const response = await POST(request({ ...body, role: 'store_employee', store_id: ownStore.id }))
    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ organization_id: MEM_ORG_ID, country_id: MEM_COUNTRY_ID, region_id: ownStore.region_id, store_id: ownStore.id }))
  })

  it('rejects foreign users and foreign membership IDs, including IDs belonging to another profile', async () => {
    expect((await PATCH(request({ full_name: 'No' }, 'PATCH'), context(FOREIGN))).status).toBe(403)
    expect((await PATCH(request({ role: 'global_admin', membership_id: FOREIGN_MEM }, 'PATCH'), context(OWN))).status).toBe(403)
    expect((await PATCH(request({ role: 'global_admin', membership_id: MIXED_FOREIGN_MEM }, 'PATCH'), context(MIXED))).status).toBe(403)
    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it('does not change global profile fields shared with an unadministered tenant', async () => {
    expect((await PATCH(request({ full_name: 'Changed elsewhere' }, 'PATCH'), context(MIXED))).status).toBe(403)
    expect((await PATCH(request({ email: 'foreign@example.test' }, 'PATCH'), context(OWN))).status).toBe(403)
    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it('allows an explicitly owned membership update without exposing foreign memberships', async () => {
    mocks.patch.mockResolvedValue(rows[2])
    const response = await PATCH(request({ role: 'global_admin', membership_id: MIXED_OWN_MEM }, 'PATCH'), context(MIXED))
    expect(response.status).toBe(200)
    expect(mocks.patch).toHaveBeenCalledWith(MIXED, expect.objectContaining({ membership_id: MIXED_OWN_MEM, role: 'global_admin' }))
    expect((await response.json()).user.memberships).toHaveLength(1)
  })

  it('normalizes an omitted membership ID to the authorized target membership and validates new scope', async () => {
    expect((await PATCH(request({ role: 'global_admin' }, 'PATCH'), context(OWN))).status).toBe(200)
    expect(mocks.patch).toHaveBeenCalledWith(OWN, expect.objectContaining({ membership_id: OWN_MEM }))
    mocks.patch.mockClear()
    expect((await PATCH(request({ role: 'store_employee', store_id: foreignStore.id }, 'PATCH'), context(OWN))).status).toBe(403)
    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it.each([FOREIGN, MIXED, ORPHAN])('does not delete an unowned or shared global profile (%s)', async (id) => {
    expect((await DELETE(request(undefined, 'DELETE'), context(id))).status).toBe(403)
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('retains deletion for a profile entirely within the admin organization', async () => {
    expect((await DELETE(request(undefined, 'DELETE'), context(OWN))).status).toBe(200)
    expect(mocks.remove).toHaveBeenCalledWith(OWN, admin.id)
  })
})
