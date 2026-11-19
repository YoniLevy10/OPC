import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '@/lib/auth/types'
import {
  memListInboxMessages,
  memListProfessionals,
  memListTickets,
  memReset,
  memUpsertProfessional,
  memUpsertSession,
  MEM_COUNTRY_ID,
} from '@/lib/data/memory-store'
import { processInboundMessage } from '@/modules/whatsapp/intake'
import type { InboundMessage } from '@/modules/whatsapp/types'
import { botShouldStaySilent } from '@/modules/inbox/thread-kinds'
import { forwardTicketPackToProfessional } from '@/modules/inbox/forward-pro'
import {
  classifyInboxOutboundFile,
  replyMediaToSession,
} from '@/modules/inbox/reply-media'
import { sendWhatsAppMedia, outboundMediaLiveEnabled } from '@/modules/whatsapp/send'

process.env.MAINTAINOS_FORCE_MEMORY = '1'
process.env.MAINTAINOS_ALLOW_TEST_AUTH = '1'
process.env.WHATSAPP_AI_INTAKE_ENABLED = 'false'
delete process.env.WHATSAPP_AI_ENABLED
delete process.env.MAINTAINOS_WA_OUTBOUND_MEDIA_LIVE
delete process.env.MAINTAINOS_WA_CONFIRM_REMINDERS_LIVE

function hqActor(): Actor {
  return {
    id: 'ari',
    email: 'ari@example.com',
    memberships: [
      {
        id: 'm1',
        profile_id: 'ari',
        organization_id: 'org',
        role: 'global_admin',
        country_id: MEM_COUNTRY_ID,
        region_id: null,
        store_id: null,
      },
    ],
    authVia: 'test_bearer',
  }
}

function msg(
  partial: Partial<InboundMessage> & { text?: string | null },
): InboundMessage {
  return {
    messageId: partial.messageId ?? `m_${Math.random().toString(36).slice(2)}`,
    waId: partial.waId ?? '972509990001',
    phoneNumberId: null,
    text: partial.text ?? null,
    mediaUrl: partial.mediaUrl ?? null,
    mediaKind: partial.mediaKind ?? null,
    timestamp: null,
    sourceHint: 'demo',
  }
}

describe('OC-22 desk: bot silence, media dry-run, forward pack', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    process.env.MAINTAINOS_ALLOW_TEST_AUTH = '1'
    delete process.env.MAINTAINOS_WA_OUTBOUND_MEDIA_LIVE
    memReset()
  })

  it('botShouldStaySilent for pro_coord / never', () => {
    expect(botShouldStaySilent({ thread_kind: 'pro_coord', bot_mode: 'auto' })).toBe(
      true,
    )
    expect(botShouldStaySilent({ thread_kind: 'store_manager', bot_mode: 'never' })).toBe(
      true,
    )
    expect(botShouldStaySilent({ thread_kind: 'store_manager', bot_mode: 'auto' })).toBe(
      false,
    )
  })

  it('pro_coord inbound does not open a store ticket or bot reply', async () => {
    const waId = '972509990042'
    memUpsertSession({
      wa_id: waId,
      country_id: MEM_COUNTRY_ID,
      store_id: 'il-store-172',
      store_code: '172',
      state: 'done',
      pending_description: null,
      thread_kind: 'pro_coord',
      bot_mode: 'never',
      human_takeover: true,
      human_takeover_until: new Date(Date.now() + 60_000).toISOString(),
    })
    const before = memListTickets().length
    const r = await processInboundMessage(
      msg({
        waId,
        text: 'המזגן לא עובד אצל המקצוען',
        mediaUrl: 'https://example.com/x.jpg',
        mediaKind: 'image',
      }),
      { skipOutboundGraph: true },
    )
    expect(r.ok).toBe(true)
    expect(r.reply).toBeNull()
    expect(r.ticketId).toBeFalsy()
    expect(memListTickets().length).toBe(before)
  })

  it('outbound media defaults to dry-run', async () => {
    expect(outboundMediaLiveEnabled()).toBe(false)
    const send = await sendWhatsAppMedia({
      toWaId: '972501111111',
      kind: 'image',
      link: 'https://example.com/a.jpg',
      caption: 'בדיקה',
    })
    expect(send.ok).toBe(true)
    expect(send.dryRun).toBe(true)
  })

  it('classifyInboxOutboundFile accepts image video pdf', () => {
    expect(
      classifyInboxOutboundFile(
        new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }),
      ),
    ).toEqual({ ok: true, kind: 'image' })
    expect(
      classifyInboxOutboundFile(
        new File([new Uint8Array([1])], 'a.mp4', { type: 'video/mp4' }),
      ),
    ).toEqual({ ok: true, kind: 'video' })
    expect(
      classifyInboxOutboundFile(
        new File([new Uint8Array([1])], 'a.pdf', { type: 'application/pdf' }),
      ),
    ).toEqual({ ok: true, kind: 'document' })
    expect(
      classifyInboxOutboundFile(
        new File([new Uint8Array([1])], 'a.webm', { type: 'audio/webm' }),
      ),
    ).toEqual({ ok: true, kind: 'audio' })
    expect(
      classifyInboxOutboundFile(
        new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' }),
      ).ok,
    ).toBe(false)
  })

  it('replyMediaToSession records inbox message in dry-run', async () => {
    const waId = '972509990055'
    memUpsertSession({
      wa_id: waId,
      country_id: MEM_COUNTRY_ID,
      store_id: 'il-store-172',
      store_code: '172',
      state: 'done',
      pending_description: null,
      human_takeover: true,
      human_takeover_until: new Date(Date.now() + 60_000).toISOString(),
    })
    const result = await replyMediaToSession({
      actor: hqActor(),
      waId,
      link: 'https://example.com/desk.jpg',
      kind: 'image',
      caption: 'תמונה מהדלפק',
    })
    expect(result.safeDryRun).toBe(true)
    expect(result.send.dryRun).toBe(true)
    const msgs = memListInboxMessages(waId)
    expect(msgs.some((m) => m.media_url === 'https://example.com/desk.jpg')).toBe(
      true,
    )
  })

  it('forwardTicketPackToProfessional opens pro_coord thread in dry-run', async () => {
    await processInboundMessage(msg({ text: 'STORE_172', waId: '972509990066' }), {
      skipOutboundGraph: true,
    })
    const opened = await processInboundMessage(
      msg({
        waId: '972509990066',
        text: 'נזילה מהתקרה בחנות',
        mediaUrl: 'https://example.com/leak.jpg',
        mediaKind: 'image',
      }),
      { skipOutboundGraph: true },
    )
    expect(opened.ticketId).toBeTruthy()

    const pro = memUpsertProfessional({
      full_name: 'פבל בדיקה',
      phone: '0501234999',
      trade: 'אינסטלציה',
      source: 'manual',
    })
    expect(memListProfessionals({ activeOnly: true }).some((p) => p.id === pro.id)).toBe(
      true,
    )

    const result = await forwardTicketPackToProfessional({
      actor: hqActor(),
      ticketId: opened.ticketId!,
      professionalId: pro.id,
    })
    expect(result.dryRun).toBe(true)
    expect(result.sends.length).toBeGreaterThan(0)
    expect(result.sessionWaId).toMatch(/^\d+$/)
    const session = memListInboxMessages(result.sessionWaId)
    expect(session.length).toBeGreaterThan(0)
  })
})
