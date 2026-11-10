import 'server-only'

import {
  memGet,
  memAddEvent,
  supabaseReady,
} from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'
import { isSupabaseSchemaError } from '@/lib/supabase/schema-fallback'
import { updateStatus, appendEvent, getById } from '@/modules/tickets/service'
import {
  engagementTicketIds,
  markEngagementClosed,
  cancelEngagement,
} from '@/modules/engagements/service'
import { notifyReporter } from '@/modules/notifications/lifecycle-notify'
import { formatQualityHoldHe } from '@/modules/tickets/quality-hold'

/**
 * Store staff confirms the fix.
 * V2.1: store feedback closes the named fix immediately. Any existing
 * quality-window dates remain historical follow-up metadata, not a close gate.
 */
export async function confirmStoreFix(input: {
  ticketId: string
  actorLabel?: string | null
}): Promise<{
  id: string
  status: string
  store_confirmed_at: string
  quality_hold_until?: string | null
  pending_final_close?: boolean
}> {
  const now = new Date().toISOString()
  const actorLabel = input.actorLabel?.trim() || 'store'

  if (!(await supabaseReady())) {
    return confirmStoreFixMemoryFallback(input, now, actorLabel)
  }

  const supabase = createSystemClient('store_confirm')
  const { data: row, error } = await supabase
    .from('tickets')
    .select('id, status, store_confirmed_at, quality_hold_until')
    .eq('id', input.ticketId)
    .maybeSingle()

  if (error) {
    if (isSupabaseSchemaError(error)) {
      return confirmStoreFixMemoryFallback(input, now, actorLabel)
    }
    throw new Error(error.message)
  }
  if (!row) throw new Error('תקלה לא נמצאה')
  if (row.status === 'closed') {
    if (row.store_confirmed_at) await closeCompletedEngagement(input.ticketId, now)
    return {
      id: row.id,
      status: row.status,
      store_confirmed_at: (row.store_confirmed_at as string) ?? now,
      quality_hold_until: (row.quality_hold_until as string) ?? null,
    }
  }
  if (row.status !== 'resolved' && row.status !== 'engaged') {
    throw new Error('ניתן לאשר רק אחרי שהטיפול אושר או סומן כנפתר')
  }
  if (row.status === 'engaged') {
    return closeEngagedTicket(input.ticketId, now, actorLabel)
  }

  const { error: updErr } = await supabase
    .from('tickets')
    .update({
      store_confirmed_at: now,
      store_confirmed_by: actorLabel,
      updated_at: now,
    })
    .eq('id', input.ticketId)

  if (updErr) {
    if (isSupabaseSchemaError(updErr)) {
      return confirmStoreFixMemoryFallback(input, now, actorLabel)
    }
    throw new Error(updErr.message)
  }

  await appendEvent(input.ticketId, 'store_confirmed', null, { by: actorLabel })

  const holdUntil = (row.quality_hold_until as string | null) ?? null
  const closed = await updateStatus(input.ticketId, 'closed')
  const detail = await getById(closed.id)
  if (detail) await notifyReporter(detail, 'closed')

  return {
    id: closed.id,
    status: closed.status,
    store_confirmed_at: now,
    quality_hold_until: holdUntil,
    pending_final_close: false,
  }
}

async function confirmStoreFixMemoryFallback(
  input: { ticketId: string; actorLabel?: string | null },
  now: string,
  actorLabel: string,
) {
  const ticket = memGet(input.ticketId)
  if (!ticket) throw new Error('תקלה לא נמצאה')
  if (ticket.status === 'closed') {
    if (ticket.store_confirmed_at) await closeCompletedEngagement(input.ticketId, now)
    return {
      id: ticket.id,
      status: ticket.status,
      store_confirmed_at: ticket.store_confirmed_at ?? now,
      quality_hold_until: ticket.quality_hold_until ?? null,
    }
  }
  if (ticket.status !== 'resolved' && ticket.status !== 'engaged') {
    throw new Error('ניתן לאשר רק אחרי שהטיפול אושר או סומן כנפתר')
  }
  if (ticket.status === 'engaged') {
    return closeEngagedTicket(input.ticketId, now, actorLabel)
  }
  ticket.store_confirmed_at = now
  ticket.store_confirmed_by = actorLabel
  ticket.updated_at = now
  memAddEvent(ticket.id, 'store_confirmed', { by: actorLabel }, null)

  const closed = await updateStatus(ticket.id, 'closed')
  const detail = await getById(closed.id)
  if (detail) await notifyReporter(detail, 'closed')
  return {
    id: closed.id,
    status: closed.status,
    store_confirmed_at: now,
    quality_hold_until: ticket.quality_hold_until ?? null,
    pending_final_close: false,
  }
}

/** Human-readable hold status for store/HQ UI. */
export function storeConfirmHoldMessage(
  holdUntil: string | null | undefined,
  now = new Date(),
): string | null {
  return formatQualityHoldHe(holdUntil, now)
}

export function storeConfirmUrl(ticketId: string): string {
  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '')
  return `${appUrl}/store/tickets/${ticketId}`
}

/** A store's feedback confirms only the ticket it names, even in a shared visit. */
async function closeEngagedTicket(
  ticketId: string,
  now: string,
  actorLabel: string,
) {
  if (await supabaseReady()) {
    const supabase = createSystemClient('store_confirm')
    const { error } = await supabase
      .from('tickets')
      .update({
        store_confirmed_at: now,
        store_confirmed_by: actorLabel,
        updated_at: now,
      })
      .eq('id', ticketId)
    if (error) throw new Error(error.message)
  } else {
    const ticket = memGet(ticketId)
    if (!ticket) throw new Error('תקלה לא נמצאה')
    ticket.store_confirmed_at = now
    ticket.store_confirmed_by = actorLabel
    ticket.updated_at = now
  }
  await appendEvent(ticketId, 'store_confirmed', null, { by: actorLabel })
  const closed = await updateStatus(ticketId, 'closed')
  await closeCompletedEngagement(ticketId, now)
  const detail = await getById(ticketId)
  if (detail) await notifyReporter(detail, 'closed')
  return {
    id: closed.id,
    status: closed.status,
    store_confirmed_at: now,
    pending_final_close: false as const,
  }
}

/** Do not finish a visit or count its cost until every included fix is confirmed. */
async function closeCompletedEngagement(ticketId: string, now: string): Promise<void> {
  const ids = [...new Set(await engagementTicketIds(ticketId))]
  if (await supabaseReady()) {
    const supabase = createSystemClient('store_confirm')
    const { data, error } = await supabase
      .from('tickets')
      .select('id, status, store_confirmed_at')
      .in('id', ids)
    if (error) throw new Error(error.message)
    if (
      !data || data.length !== ids.length ||
      data.some((row) => row.status !== 'closed' || !row.store_confirmed_at)
    ) {
      return
    }
  } else if (ids.some((id) => {
    const ticket = memGet(id)
    return !ticket || ticket.status !== 'closed' || !ticket.store_confirmed_at
  })) {
    return
  }
  await markEngagementClosed(ticketId, now)
}

export async function rejectStoreFix(input: {
  ticketId: string
  actorLabel?: string | null
  reason?: string | null
}): Promise<{ id: string; status: string }> {
  const actorLabel = input.actorLabel?.trim() || 'store'
  const reason = input.reason?.trim() || 'לא נפתר — דיווח חנות בוואטסאפ'

  if (!(await supabaseReady())) {
    return rejectStoreFixMemoryFallback(input, actorLabel, reason)
  }

  const supabase = createSystemClient('store_confirm')
  const { data: row, error } = await supabase
    .from('tickets')
    .select('id, status')
    .eq('id', input.ticketId)
    .maybeSingle()

  if (error) {
    if (isSupabaseSchemaError(error)) {
      return rejectStoreFixMemoryFallback(input, actorLabel, reason)
    }
    throw new Error(error.message)
  }
  if (!row) throw new Error('תקלה לא נמצאה')
  if (row.status !== 'resolved' && row.status !== 'engaged') {
    throw new Error('ניתן לדווח «לא נפתר» רק על תקלה שממתינה לאישור החנות')
  }

  await appendEvent(input.ticketId, 'store_rejected', null, {
    by: actorLabel,
    reason,
  })
  if (row.status === 'engaged') {
    await cancelEngagement(input.ticketId)
    return { id: input.ticketId, status: 'new' }
  }
  const reopened = await updateStatus(input.ticketId, 'in_progress')
  return { id: reopened.id, status: reopened.status }
}

async function rejectStoreFixMemoryFallback(
  input: { ticketId: string; actorLabel?: string | null; reason?: string | null },
  actorLabel: string,
  reason: string,
) {
  const ticket = memGet(input.ticketId)
  if (!ticket) throw new Error('תקלה לא נמצאה')
  if (ticket.status !== 'resolved' && ticket.status !== 'engaged') {
    throw new Error('ניתן לדווח «לא נפתר» רק על תקלה שממתינה לאישור החנות')
  }
  memAddEvent(ticket.id, 'store_rejected', { by: actorLabel, reason }, null)
  if (ticket.status === 'engaged') {
    await cancelEngagement(ticket.id)
    return { id: ticket.id, status: 'new' }
  }
  const reopened = await updateStatus(ticket.id, 'in_progress')
  return { id: reopened.id, status: reopened.status }
}

export {
  STORE_CONFIRM_BUTTON_PREFIX,
  STORE_CONFIRM_BUTTON_TITLE,
  STORE_CONFIRM_WA_HINT,
  STORE_REJECT_BUTTON_PREFIX,
  STORE_REJECT_BUTTON_TITLE,
  isStoreConfirmReply,
  isStoreRejectReply,
  parseStoreConfirmButtonId,
  parseStoreRejectButtonId,
  storeConfirmButtonId,
  storeRejectButtonId,
  formatAwaitingConfirmChoice,
} from './wa-store-confirm'
