'use server'

/**
 * Retired. A visit plan is not an expense approval.
 * Ari locks a name, phone, and price through lockEngagement.
 */
export async function approveVisitCommitments(
  _ticketIds: string[],
  _vendorName: string,
): Promise<never> {
  void _ticketIds
  void _vendorName
  throw new Error('אישור הוצאה נעשה בנעילת מחיר, לא בשיגור')
}
