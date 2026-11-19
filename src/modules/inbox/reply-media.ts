import type { Actor } from '@/lib/auth/types'
import {
  memAddInboxMessage,
  memGetSession,
  memListSessions,
  memSetSessionTakeover,
  supabaseReady,
} from '@/lib/data/memory-store'
import { AuthError, testAuthAllowed } from '@/lib/auth/types'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessInboxSession } from './authorization'
import {
  sendWhatsAppAudio,
  sendWhatsAppMedia,
  type OutboundMediaKind,
  outboundMediaLiveEnabled,
} from '@/modules/whatsapp/send'
import { shouldForceDryRunForOpsStart } from './service'
import { humanPauseUntilIso } from '@/modules/whatsapp/human-pause'

const INBOX_MEDIA_BUCKET = 'ticket-media'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_VIDEO_BYTES = 15 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

export type InboxOutboundKind = OutboundMediaKind | 'audio'

/** Classify a local file for WhatsApp outbound (image / video / PDF / audio). */
export function classifyInboxOutboundFile(
  file: File,
): { ok: true; kind: InboxOutboundKind } | { ok: false; error: string } {
  const mime = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()
  if (
    mime.startsWith('image/') ||
    /\.(jpe?g|png|webp|gif)$/i.test(name)
  ) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: 'תמונה גדולה מ-5MB' }
    }
    return { ok: true, kind: 'image' }
  }
  if (
    (mime.startsWith('video/') && !mime.includes('webm')) ||
    /\.(mp4|mov)$/i.test(name)
  ) {
    if (file.size > MAX_VIDEO_BYTES) {
      return { ok: false, error: 'סרטון גדול מ-15MB' }
    }
    return { ok: true, kind: 'video' }
  }
  if (
    mime.startsWith('audio/') ||
    mime === 'video/webm' ||
    /\.(webm|ogg|oga|mp3|m4a|wav)$/i.test(name)
  ) {
    if (file.size > MAX_AUDIO_BYTES) {
      return { ok: false, error: 'הקלטה גדולה מ-10MB' }
    }
    return { ok: true, kind: 'audio' }
  }
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    if (file.size > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: 'מסמך גדול מ-15MB' }
    }
    return { ok: true, kind: 'document' }
  }
  return {
    ok: false,
    error: 'סוג קובץ לא נתמך — תמונה, וידאו, PDF או קול',
  }
}

/** Upload desk attachment; falls back to data URL in memory/demo. */
export async function uploadInboxMediaFile(
  waId: string,
  file: File,
  kind: InboxOutboundKind,
): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer())
  const mime =
    file.type ||
    (kind === 'image'
      ? 'image/jpeg'
      : kind === 'video'
        ? 'video/mp4'
        : kind === 'audio'
          ? 'audio/webm'
          : 'application/pdf')

  if (await supabaseReady()) {
    try {
      const supabase = createAdminClient()
      const ext =
        kind === 'document'
          ? 'pdf'
          : kind === 'audio'
            ? mime.includes('ogg')
              ? 'ogg'
              : mime.includes('mp3')
                ? 'mp3'
                : 'webm'
            : kind === 'video'
              ? mime.includes('webm')
                ? 'webm'
                : 'mp4'
              : mime.includes('png')
                ? 'png'
                : 'jpg'
      const safeWa = waId.replace(/\D/g, '') || 'session'
      const path = `inbox/${safeWa}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error } = await supabase.storage
        .from(INBOX_MEDIA_BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: true })
      if (!error) {
        const { data } = supabase.storage.from(INBOX_MEDIA_BUCKET).getPublicUrl(path)
        if (data.publicUrl) return data.publicUrl
      }
    } catch {
      /* fall through to data URL */
    }
  }

  return `data:${mime};base64,${bytes.toString('base64')}`
}

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

/** Desk voice note — dry-run unless outbound media live flag is on. */
export async function replyAudioToSession(input: {
  actor: Actor
  waId: string
  audio: Uint8Array
  mime?: string
  ticketId?: string | null
}): Promise<{
  message: {
    id: string
    direction: 'outbound'
    body: string
    media_url: string
    media_kind: 'audio'
    created_at: string
    ticket_id: string | null
  }
  send: Awaited<ReturnType<typeof sendWhatsAppAudio>>
  safeDryRun: boolean
}> {
  const waId = input.waId.replace(/\D/g, '') || input.waId
  if (!waId) throw new Error('מזהה WhatsApp חסר')
  if (!input.audio.length) throw new Error('הקלטה ריקה')

  if (!(await supabaseReady())) {
    if (!testAuthAllowed() && process.env.MAINTAINOS_FORCE_MEMORY !== '1') {
      throw new AuthError('Inbox backend unavailable', 503)
    }
    const session = memListSessions().find((s) => s.wa_id === waId)
    if (!session || !canAccessInboxSession(input.actor, session)) {
      throw new AuthError('אין הרשאה לשיחה זו', 403)
    }
  } else {
    const session = memGetSession(waId)
    if (session && !canAccessInboxSession(input.actor, session)) {
      throw new AuthError('אין הרשאה לשיחה זו', 403)
    }
  }

  const forceDryRun =
    !outboundMediaLiveEnabled() ||
    process.env.MAINTAINOS_FORCE_MEMORY === '1' ||
    shouldForceDryRunForOpsStart(null)

  const mime = input.mime || 'audio/webm'
  const mediaUrl = `data:${mime};base64,${Buffer.from(input.audio).toString('base64')}`

  const send = await sendWhatsAppAudio({
    toWaId: waId,
    audio: input.audio,
    forceDryRun,
    purpose: 'ops_reply',
  })

  if (!send.ok && !send.dryRun) {
    throw new Error(send.error || 'שליחת הקלטה נכשלה')
  }

  const message = memAddInboxMessage({
    wa_id: waId,
    direction: 'outbound',
    body: '🎤 הודעה קולית',
    ticket_id: input.ticketId ?? null,
    media_url: mediaUrl,
    media_kind: 'audio',
  })

  try {
    memSetSessionTakeover(waId, true, {
      human_takeover_until: humanPauseUntilIso(),
    })
  } catch {
    /* session may be missing */
  }

  return {
    message: {
      id: message.id,
      direction: 'outbound',
      body: message.body,
      media_url: mediaUrl,
      media_kind: 'audio',
      created_at: message.created_at,
      ticket_id: message.ticket_id,
    },
    send: {
      ...send,
      ok: send.ok || Boolean(send.dryRun),
      dryRun: Boolean(send.dryRun) || forceDryRun,
    },
    safeDryRun: Boolean(send.dryRun) || forceDryRun,
  }
}
