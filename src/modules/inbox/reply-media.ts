import type { Actor } from '@/lib/auth/types'
import {
  memAddInboxMessage,
  memGetSession,
  memListSessions,
  supabaseReady,
} from '@/lib/data/memory-store'
import { AuthError, testAuthAllowed } from '@/lib/auth/types'
import { canAccessInboxSession } from './authorization'
import {
  sendWhatsAppMedia,
  type OutboundMediaKind,
  outboundMediaLiveEnabled,
} from '@/modules/whatsapp/send'
import { shouldForceDryRunForOpsStart } from './service'
import { humanPauseUntilIso } from '@/modules/whatsapp/human-pause'
import { memSetSessionTakeover } from '@/lib/data/memory-store'

export async function replyMediaToSession(input: {
  actor: Actor
  waId: string
  link: string
  kind: OutboundMediaKind
  caption?: string
  filename?: string
  ticketId?: string | null
}): Promise<{
  message: {
    id: string
    direction: 'outbound'
    body: string
    media_url: string
    media_kind: OutboundMediaKind
    created_at: string
    ticket_id: string | null
  }
  send: Awaited<ReturnType<typeof sendWhatsAppMedia>>
  safeDryRun: boolean
}> {
  const waId = input.waId.replace(/\D/g, '') || input.waId
  if (!waId) throw new Error('מזהה WhatsApp חסר')

  if (!(await supabaseReady())) {
    if (!testAuthAllowed() && process.env.MAINTAINOS_FORCE_MEMORY !== '1') {
      throw new AuthError('Inbox backend unavailable', 503)
    }
    const session = memListSessions().find((s) => s.wa_id === waId)
    if (!session || !canAccessInboxSession(input.actor, session)) {
      throw new AuthError('אין הרשאה לשיחה זו', 403)
    }
  } else {
    // Access check via memory session if present; otherwise allow HQ memory dry path.
    const session = memGetSession(waId)
    if (session && !canAccessInboxSession(input.actor, session)) {
      throw new AuthError('אין הרשאה לשיחה זו', 403)
    }
  }

  // Outbound media stays dry-run until MAINTAINOS_WA_OUTBOUND_MEDIA_LIVE=1.
  const forceDryRun =
    !outboundMediaLiveEnabled() ||
    process.env.MAINTAINOS_FORCE_MEMORY === '1' ||
    shouldForceDryRunForOpsStart(null)

  const send = await sendWhatsAppMedia({
    toWaId: waId,
    kind: input.kind,
    link: input.link,
    caption: input.caption,
    filename: input.filename,
    forceDryRun,
    purpose: 'ops_reply',
  })

  if (!send.ok && !send.dryRun) {
    throw new Error(send.error || 'שליחת מדיה נכשלה')
  }

  const body =
    input.caption?.trim() ||
    (input.kind === 'image'
      ? '📷 תמונה'
      : input.kind === 'video'
        ? '🎬 וידאו'
        : '📄 מסמך')

  const message = memAddInboxMessage({
    wa_id: waId,
    direction: 'outbound',
    body,
    ticket_id: input.ticketId ?? null,
    media_url: input.link,
    media_kind: input.kind,
  })

  try {
    memSetSessionTakeover(waId, true, {
      human_takeover_until: humanPauseUntilIso(),
    })
  } catch {
    /* session may be missing in edge cases */
  }

  return {
    message: {
      id: message.id,
      direction: 'outbound',
      body: message.body,
      media_url: input.link,
      media_kind: input.kind,
      created_at: message.created_at,
      ticket_id: message.ticket_id,
    },
    send,
    safeDryRun: Boolean(send.dryRun) || forceDryRun,
  }
}
