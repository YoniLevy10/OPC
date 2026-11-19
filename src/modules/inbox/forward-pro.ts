import type { Actor } from '@/lib/auth/types'
import { AuthError, actorHasHqAccess } from '@/lib/auth/types'
import {
  MEM_COUNTRY_ID,
  memAddInboxMessage,
  memGet,
  memListProfessionals,
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
import { getProfessional } from '@/modules/professionals/service'
import { getById } from '@/modules/tickets/service'
import {
  fetchTicketAttachments,
  mergeEvidence,
} from '@/modules/tickets/attachments'
import { lockEngagement } from '@/modules/engagements/service'
import { logEvent } from '@/lib/logging'
import { canAccessInboxSession } from './authorization'

export type ForwardTicketPackResult = {
  sessionWaId: string
  created: boolean
  dryRun: boolean
  sends: Array<{ kind: string; ok: boolean; dryRun: boolean }>
  summaryPreview: string
  engagementId: string | null
  engagementLocked: boolean
}

function mediaKindFromEvidence(
  kind: string | null | undefined,
): OutboundMediaKind | null {
  if (kind === 'image' || kind === 'video' || kind === 'document') return kind
  if (kind === 'audio') return null
  return 'image'
}

/**
 * Ari shares a ticket pack (summary + media) with a Midrag professional
 * on a pro_coord thread. Default dry-run (no live Graph).
 */
export async function forwardTicketPackToProfessional(input: {
  actor: Actor
  ticketId: string
  professionalId: string
  forceDryRun?: boolean
}): Promise<ForwardTicketPackResult> {
  if (!actorHasHqAccess(input.actor)) {
    throw new AuthError('אין הרשאה לשיתוף תקלה עם מקצוען', 403)
  }

  const ticket = await getById(input.ticketId)
  if (!ticket) throw new Error('התקלה לא נמצאה')

  const { professional } = await getProfessional(input.professionalId)
  const memPro =
    professional ??
    memListProfessionals({ activeOnly: false }).find(
      (p) => p.id === input.professionalId,
    )
  if (!memPro?.phone) {
    throw new Error('למקצוען אין מספר טלפון במאגר')
  }

  const waId = normalizePhoneDigits(memPro.phone)
  if (!waId) throw new Error('מספר מקצוען לא תקין')

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

  const pauseUntil = humanPauseUntilIso()
  const existing = memListSessions().find((s) => phonesMatch(s.wa_id, waId))
  let created = false
  if (!existing) {
    memUpsertSession({
      wa_id: waId,
      country_id: ticket.country_id || MEM_COUNTRY_ID,
      store_id: ticket.store_id,
      store_code: ticket.stores?.code ?? null,
      customer_name: memPro.full_name,
      state: 'done',
      pending_description: null,
      human_takeover: true,
      human_takeover_until: pauseUntil,
      thread_kind: 'pro_coord',
      bot_mode: 'never',
      linked_professional_id: memPro.id,
      linked_ticket_id: ticket.id,
      last_inbound: null,
    })
    created = true
  } else {
    memUpsertSession({
      ...existing,
      store_id: ticket.store_id,
      store_code: ticket.stores?.code ?? existing.store_code,
      customer_name: memPro.full_name,
      human_takeover: true,
      human_takeover_until: pauseUntil,
      thread_kind: 'pro_coord',
      bot_mode: 'never',
      linked_professional_id: memPro.id,
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
    memPro.full_name ? `עבור: ${memPro.full_name}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const sends: ForwardTicketPackResult['sends'] = []

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
  const evidence = mergeEvidence(attachments, memTicket?.messages ?? ticket.messages ?? [])

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

  let engagementId: string | null = null
  let engagementLocked = false
  try {
    const engagement = await lockEngagement({
      ticketId: ticket.id,
      professionalId: memPro.id,
      professionalName: memPro.full_name,
      professionalPhone: memPro.phone || waId,
      approvedBy: input.actor.id,
      approvedAmount: 0,
      scope: memPro.trade ?? ticket.category ?? null,
    })
    engagementId = engagement.id
    engagementLocked = true
  } catch (err) {
    // Already locked / wrong status — still deliver the WA pack to the pro.
    logEvent('inbox:forward_pro', 'warn', 'engagement_lock_skipped', {
      ticketId: ticket.id,
      professionalId: memPro.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  void supabaseReady

  return {
    sessionWaId: waId,
    created,
    dryRun: forceDryRun || sends.every((s) => s.dryRun),
    sends,
    summaryPreview: summary,
    engagementId,
    engagementLocked,
  }
}
