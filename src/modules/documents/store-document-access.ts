/** HQ scope requires matching document store metadata, never role alone. */
export type DocumentStoreScope = { id: string; organization_id: string; country_id: string; region_id: string | null }
export function canReadStoreDocument(
  memberships: { role: string; store_id?: string | null; organization_id?: string | null; country_id?: string | null; region_id?: string | null }[],
  documentStoreId: string | null,
  documentStore?: DocumentStoreScope | null,
): boolean {
  if (!documentStoreId) return false
  if (memberships.some((m) => (m.role === 'store_manager' || m.role === 'store_employee') && m.store_id === documentStoreId)) return true
  if (!documentStore || documentStore.id !== documentStoreId) return false
  return memberships.some((m) => {
    if (m.organization_id !== documentStore.organization_id) return false
    if (m.role === 'global_admin' || m.role === 'global_maintenance') return true
    if (m.role === 'country_manager') return Boolean(m.country_id && m.country_id === documentStore.country_id)
    if (m.role === 'regional_manager') return Boolean(m.region_id && documentStore.region_id && m.region_id === documentStore.region_id)
    return false
  })
}
