import type { MemberRole } from '@/lib/auth/types'
import type { Locale } from '@/lib/i18n/locale'
import { phrase } from '@/lib/i18n/phrases'

/**
 * Product roles for Optical Center (pilot).
 *
 * The DB still has the legacy 8-value `member_role` enum for backward
 * compatibility. New assignments and the Users UI only use these four.
 * Older roles keep working but map into the same capability buckets.
 */

export type ProductRole =
  | 'global_admin'
  | 'global_maintenance'
  | 'store_employee'
  | 'internal_technician'

export const PRODUCT_ROLES: readonly ProductRole[] = [
  'global_admin',
  'global_maintenance',
  'store_employee',
  'internal_technician',
] as const

export const PRODUCT_ROLE_LABELS_HE: Record<ProductRole, string> = {
  global_admin: 'מנהל מערכת',
  global_maintenance: 'תפעול',
  store_employee: 'חנות',
  internal_technician: 'טכנאי',
}

/** Short “who can what” for the Users admin (OC pilot: HQ = Ari only). */
export const PRODUCT_ROLE_HELP_HE: Record<ProductRole, string> = {
  global_admin:
    'ארי / HQ — גישה להכל במערכת (בלי הגבלת סניף או מדינה)',
  global_maintenance:
    'לא נדרש בפיילוט ארי־יחיד — נשמר לתאימות עתידית',
  store_employee: 'שטח: WhatsApp + פורטל חנות — דיווח ומעקב',
  internal_technician: 'שטח: רואה רק עבודות ששויכו אליו ב־/tech',
}

export function productRoleLabel(role: ProductRole, locale: Locale = 'he'): string {
  return phrase(locale, PRODUCT_ROLE_LABELS_HE[role])
}

export function productRoleHelp(role: ProductRole, locale: Locale = 'he'): string {
  return phrase(locale, PRODUCT_ROLE_HELP_HE[role])
}

export const PRODUCT_ROLE_OPTIONS: {
  value: ProductRole
  label: string
}[] = PRODUCT_ROLES.map((value) => ({
  value,
  label: PRODUCT_ROLE_LABELS_HE[value],
}))

export function productRoleOptions(locale: Locale = 'he'): {
  value: ProductRole
  label: string
}[] {
  return PRODUCT_ROLES.map((value) => ({
    value,
    label: productRoleLabel(value, locale),
  }))
}

export function isProductRole(role: string): role is ProductRole {
  return (PRODUCT_ROLES as readonly string[]).includes(role)
}

export function isAssignableRole(role: MemberRole): role is ProductRole {
  return isProductRole(role)
}

/** Display label for any DB role (legacy → nearest product label). */
export function roleLabelHe(role: MemberRole | string): string {
  return roleLabel(role, 'he')
}

/** Display label for any DB role (legacy → nearest product label). */
export function roleLabel(role: MemberRole | string, locale: Locale = 'he'): string {
  switch (role) {
    case 'global_admin':
      return productRoleLabel('global_admin', locale)
    case 'global_maintenance':
    case 'country_manager':
    case 'regional_manager':
      return role === 'global_maintenance'
        ? productRoleLabel('global_maintenance', locale)
        : phrase(locale, '{role} (ישן)', {
            role: productRoleLabel('global_maintenance', locale),
          })
    case 'store_employee':
    case 'store_manager':
      return role === 'store_employee'
        ? productRoleLabel('store_employee', locale)
        : phrase(locale, '{role} (ישן)', {
            role: productRoleLabel('store_employee', locale),
          })
    case 'internal_technician':
    case 'external_provider':
      return role === 'internal_technician'
        ? productRoleLabel('internal_technician', locale)
        : phrase(locale, '{role} (ישן)', {
            role: productRoleLabel('internal_technician', locale),
          })
    default:
      return role
  }
}

/** HQ portal: admins + ops. Store managers are store-portal only. */
export function hqProductRoles(): MemberRole[] {
  return [
    'global_admin',
    'global_maintenance',
    'country_manager',
    'regional_manager',
  ]
}

export function storeProductRoles(): MemberRole[] {
  return ['store_employee', 'store_manager']
}

export function techProductRoles(): MemberRole[] {
  return ['internal_technician', 'external_provider']
}

export function canManageUsersRole(role: MemberRole): boolean {
  return role === 'global_admin'
}

/** System admin (Ari / HQ owner) — full access, no country/store scope. */
export function isGlobalAdminRole(role: MemberRole | string): boolean {
  return role === 'global_admin'
}

export function actorIsGlobalAdmin(actor: {
  memberships: Array<{ role: string }>
}): boolean {
  return actor.memberships.some((m) => isGlobalAdminRole(m.role))
}
