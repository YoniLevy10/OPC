import 'server-only'

import { notifyAri } from '@/modules/notify/ari'
import { logEvent } from '@/lib/logging'

/**
 * Desk alert + Web Push when a ticket opens (any channel).
 * Never throws — create must succeed even if notify fails.
 */
export async function notifyAriNewTicket(input: {
  ticketId: string
  displayNumber: string | null
  storeName: string | null
  storeCode: string | null
  description: string
  priority?: string | null
}): Promise<void> {
  const display =
    input.displayNumber?.trim() ||
    input.ticketId.slice(0, 8)
  const place =
    [input.storeCode ? `#${input.storeCode}` : null, input.storeName?.trim()]
      .filter(Boolean)
      .join(' · ') || 'סניף'
  const summary = input.description.replace(/\s+/g, ' ').trim().slice(0, 120)
  const urgency =
    input.priority === 'critical' || input.priority === 'high'
      ? 'דחוף'
      : null
  const lines = [
    `תקלה חדשה · ${display}`,
    place,
    urgency,
    summary || null,
  ].filter(Boolean)

  try {
    await notifyAri(lines.join('\n'), {
      ticketId: input.ticketId,
      kind: 'ticket_created',
      title: `תקלה חדשה · ${display}`,
      url: `/ops/tickets/${input.ticketId}`,
      tag: `ticket-${input.ticketId}`,
    })
  } catch (err) {
    logEvent('notify:new-ticket', 'warn', 'failed', {
      ticketId: input.ticketId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
