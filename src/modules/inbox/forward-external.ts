import type { Actor } from '@/lib/auth/types'
import { AuthError, actorHasHqAccess } from '@/lib/auth/types'
import {
  MEM_COUNTRY_ID,
  memAddInboxMessage,
  memGet,
  memListSessions,
  memUpsertSession,
  supabaseReady,
} from '@/lib/data/memory-store'
import { normalizePhoneDigits } from '@/lib/phone'
import { phonesMatch } from '@/modules/whatsapp/classify'
import { humanPauseUntilIso } from '@/modules/whatsapp/human-pause'
import {
  sendWhatsAppMedia,
  sendWhatsAppText,
  type OutboundMediaKind,
} from '@/modules/whatsapp/send'
import { getById } from '@/modules/tickets/service'
import {
  fetchTicketAttachments,
  mergeEvidence,
} from '@/modules/tickets/attachments'
import { canAccessInboxSession } from './authorization'

export type ForwardExternalResult = {
  sessionWaId: string
  created: boolean
  dryRun: boolean
  sends: Array<{ kind: string; ok: boolean; dryRun: boolean }>
  summaryPreview: string
  engagementLocked: false
}

function mediaKindFromEvidence(
  kind: string | null | undefined,
): OutboundMediaKind | null {
  if (kind === 'image' || kind === 'video' || kind === 'document') return kind
  if (kind === 'audio') return null
  return 'image'
}

/**
 * Share ticket pack with an external phone (not Midrag book).
 * Opens pro_coord; does NOT lock engagement.
 */
export async function forwardTicketPackToExternalPhone(input: {
  actor: Actor
  ticketId: string
  phone: string
  name?: string | null
  forceDryRun?: boolean
}): Promise<ForwardExternalResult> {
  if (!actorHasHqAccess(input.actor)) {
    throw new AuthError('אין הרשאה לשיתוף תקלה למספר חיצוני', 403)
  }

  const ticket = await getById(input.ticketId)
  if (!ticket) throw new Error('התקלה לא נמצאה')

  const waId = normalizePhoneDigits(input.phone)
  if (!waId || waId.length < 9) throw new Error('מספר טלפון לא תקין')

  if (
    !canAccessInboxSession(input.actor, {
      store_id: ticket.store_id,
      country_id: ticket.country_id ?? MEM_COUNTRY_ID,
      region_id: ticket.region_id ?? null,
      organization_id: ticket.organization_id ?? null,
    })
  ) {
    throw new AuthError('אין הרשאה לתקלה זו', 403)
  }

  const forceDryRun =
    input.forceDryRun !== false &&
    process.env.MAINTAINOS_WA_OUTBOUND_MEDIA_LIVE !== '1'

  const displayName = input.name?.trim() || null
  const pauseUntil = humanPauseUntilIso()
  const existing = memListSessions().find((s) => phonesMatch(s.wa_id, waId))
  let created = false
  if (!existing) {
    memUpsertSession({
      wa_id: waId,
      country_id: ticket.country_id || MEM_COUNTRY_ID,
      store_id: ticket.store_id,
      store_code: ticket.stores?.code ?? null,
      customer_name: displayName,
      state: 'done',
      pending_description: null,
      human_takeover: true,
      human_takeover_until: pauseUntil,
      thread_kind: 'pro_coord',
      bot_mode: 'never',
      linked_professional_id: null,
      linked_ticket_id: ticket.id,
      last_inbound: null,
    })
    created = true
  } else {
    memUpsertSession({
      ...existing,
      store_id: ticket.store_id,
      store_code: ticket.stores?.code ?? existing.store_code,
      customer_name: displayName ?? existing.customer_name ?? null,
      human_takeover: true,
      human_takeover_until: pauseUntil,
      thread_kind: 'pro_coord',
      bot_mode: 'never',
      linked_ticket_id: ticket.id,
      pending_description: existing.pending_description,
    })
  }

  const storeLabel =
    ticket.stores?.name ||
    ticket.stores?.code ||
    ticket.store_id ||
    'סניף'
  const summary = [
    `תקלה ${ticket.display_number || ticket.number || ticket.id}`,
    `סניף: ${storeLabel}`,
    `תיאור: ${(ticket.description || ticket.title || '').trim().slice(0, 500)}`,
    displayName ? `עבור: ${displayName}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const sends: ForwardExternalResult['sends'] = []

  const textSend = await sendWhatsAppText({
    toWaId: waId,
    text: summary,
    forceDryRun,
    purpose: 'ops_reply',
  })
  sends.push({
    kind: 'text',
    ok: textSend.ok,
    dryRun: Boolean(textSend.dryRun),
  })
  memAddInboxMessage({
    wa_id: waId,
    direction: 'outbound',
    body: summary,
    ticket_id: ticket.id,
  })

  const attachments = await fetchTicketAttachments(ticket.id)
  const memTicket = memGet(ticket.id)
  const evidence = mergeEvidence(
    attachments,
    memTicket?.messages ?? ticket.messages ?? [],
  )

  for (const item of evidence.slice(0, 8)) {
    const kind = mediaKindFromEvidence(item.kind)
    if (!kind) continue
    const mediaSend = await sendWhatsAppMedia({
      toWaId: waId,
      kind,
      link: item.url,
      caption: `מדיה לתקלה ${ticket.display_number || ''}`.trim(),
      forceDryRun,
      purpose: 'ops_reply',
    })
    sends.push({
      kind,
      ok: mediaSend.ok,
      dryRun: Boolean(mediaSend.dryRun),
    })
    memAddInboxMessage({
      wa_id: waId,
      direction: 'outbound',
      body: `מדיה (${kind})`,
      ticket_id: ticket.id,
      media_url: item.url,
      media_kind: kind,
    })
  }

  void supabaseReady

  return {
    sessionWaId: waId,
    created,
    dryRun: forceDryRun || sends.every((s) => s.dryRun),
    sends,
    summaryPreview: summary,
    engagementLocked: false,
  }
}
