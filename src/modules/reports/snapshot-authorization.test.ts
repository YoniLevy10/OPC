import { describe, expect, it } from 'vitest'
import type { Actor, MemberRole } from '@/lib/auth/types'
import { organizationForReportSnapshot, reportSnapshotTicketScope } from '@/modules/reports/snapshot-authorization'

const membership = (organization_id: string, role: MemberRole, store_id: string | null = null) => ({
  id: `${organization_id}-${role}`, profile_id: 'profile', organization_id, role,
  country_id: null, region_id: null, store_id,
})
const actor = (...memberships: ReturnType<typeof membership>[]) => ({ memberships }) as Actor

describe('report snapshot authorization', () => {
  it('requires exactly one in-scope organization and an insert-permitted HQ role', () => {
    expect(organizationForReportSnapshot(actor(membership('org-a', 'global_admin')))).toBe('org-a')
    expect(organizationForReportSnapshot(actor(membership('org-a', 'store_manager', 'store-a')))).toBeNull()
    // global_admin wins — snapshot org comes from the admin membership.
    expect(organizationForReportSnapshot(actor(membership('org-a', 'global_admin'), membership('org-b', 'global_maintenance')))).toBe('org-a')
    expect(organizationForReportSnapshot(actor(membership('org-a', 'internal_technician')))).toBeNull()
  })

  it('limits global HQ to organization scope and managers to assigned stores', () => {
    expect(reportSnapshotTicketScope(actor(membership('org-a', 'global_admin')), 'org-a')).toEqual({ organizationId: 'org-a', storeIds: null })
    expect(reportSnapshotTicketScope(actor(membership('org-a', 'store_manager', 'store-a')), 'org-a')).toEqual({ organizationId: 'org-a', storeIds: ['store-a'] })
    expect(reportSnapshotTicketScope(actor(membership('org-b', 'global_admin')), 'org-b')).toEqual({ organizationId: 'org-b', storeIds: null })
    expect(reportSnapshotTicketScope(actor(membership('org-a', 'country_manager')), 'org-a')).toEqual({ organizationId: 'org-a', storeIds: [] })
  })
})
