/** Pure bundle-scope helpers — safe for client components (no server-only imports). */

export function encodeBundleScope(vendorId: string | null, ticketIds: string[]): string {
  return `bundle|vendor=${vendorId ?? ''}|tickets=${ticketIds.join(',')}`
}

export function parseBundleScope(
  scope: string | null | undefined,
): { vendorId: string | null; ticketIds: string[] } | null {
  if (!scope?.startsWith('bundle|')) return null
  const vendor = scope.match(/vendor=([^|]*)/)?.[1]?.trim() || null
  const tickets =
    scope
      .match(/tickets=([^|]*)/)?.[1]
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean) ?? []
  if (tickets.length === 0) return null
  return { vendorId: vendor || null, ticketIds: tickets }
}

export function sameTicketSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((id, index) => id === right[index])
}
