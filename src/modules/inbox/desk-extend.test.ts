import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '@/lib/auth/types'
import {
  MEM_COUNTRY_ID,
  memGet,
  memGetSession,
  memListInboxMessages,
  memReset,
  memUpsertSession,
} from '@/lib/data/memory-store'
import {
  lockedEngagementFor,
  resetEngagementsForTests,
} from '@/modules/engagements/service'
import { processInboundMessage } from '@/modules/whatsapp/intake'
import type { InboundMessage } from '@/modules/whatsapp/types'
import { forwardTicketPackToExternalPhone } from '@/modules/inbox/forward-external'
import {
  classifyInboxOutboundFile,
  replyAudioToSession,
} from '@/modules/inbox/reply-media'
import {
  correctClassification,
  updateDescription,
} from '@/modules/tickets/service'

process.env.MAINTAINOS_FORCE_MEMORY = '1'
process.env.MAINTAINOS_ALLOW_TEST_AUTH = '1'
process.env.WHATSAPP_AI_INTAKE_ENABLED = 'false'
delete process.env.WHATSAPP_AI_ENABLED
delete process.env.MAINTAINOS_WA_OUTBOUND_MEDIA_LIVE

const dry = { skipOutboundGraph: true as const }

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
    waId: partial.waId ?? '972509880200',
    phoneNumberId: null,
    text: partial.text ?? null,
    mediaUrl: partial.mediaUrl ?? null,
    mediaKind: partial.mediaKind ?? null,
    timestamp: null,
    sourceHint: 'demo',
  }
}

describe('desk extend: edit / external forward / voice', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    process.env.MAINTAINOS_ALLOW_TEST_AUTH = '1'
    delete process.env.MAINTAINOS_WA_OUTBOUND_MEDIA_LIVE
    memReset()
    resetEngagementsForTests()
  })

  it('edits description priority category', async () => {
    const waId = '972509880201'
    await processInboundMessage(msg({ text: 'STORE_172', waId }), dry)
    const opened = await processInboundMessage(
      msg({
        waId,
        text: 'המזגן הראשי לא מקרר ויש נזילה',
        mediaUrl: 'https://example.com/edit-proof.jpg',
        mediaKind: 'image',
      }),
      dry,
    )
    expect(opened.ticketId).toBeTruthy()
    const id = opened.ticketId!

    await updateDescription(id, 'תיאור מעודכן מהכרטיס', 'ari')
    await correctClassification(id, {
      category: 'electrical',
      priority: 'critical',
      reason: 'עריכה מכרטיס תקלה',
      actorId: 'ari',
    })

    const ticket = memGet(id)
    expect(ticket?.description).toBe('תיאור מעודכן מהכרטיס')
    expect(ticket?.category).toBe('electrical')
    expect(ticket?.priority).toBe('critical')
    expect(ticket?.events.length).toBeGreaterThan(0)
  })

  it('external forward opens pro_coord without engagement lock', async () => {
    const waId = '972509880203'
    await processInboundMessage(msg({ text: 'STORE_172', waId }), dry)
    const opened = await processInboundMessage(
      msg({
        waId,
        text: 'המזגן הראשי לא מקרר ויש נזילה',
        mediaUrl: 'https://example.com/ext-proof.jpg',
        mediaKind: 'image',
      }),
      dry,
    )
    expect(opened.ticketId).toBeTruthy()

    const result = await forwardTicketPackToExternalPhone({
      actor: hqActor(),
      ticketId: opened.ticketId!,
      phone: '0509988776',
      name: 'טכנאי חיצוני',
    })
    expect(result.engagementLocked).toBe(false)
    expect(result.dryRun).toBe(true)
    expect(result.sends.length).toBeGreaterThan(0)
    expect(result.sessionWaId).toMatch(/^\d+$/)

    const session = memGetSession(result.sessionWaId)
    expect(session?.thread_kind).toBe('pro_coord')
    expect(session?.bot_mode).toBe('never')
    expect(session?.customer_name).toBe('טכנאי חיצוני')
    expect(await lockedEngagementFor(opened.ticketId!)).toBeNull()
  })

  it('classify accepts audio and replyAudioToSession dry-runs', async () => {
    expect(
      classifyInboxOutboundFile(
        new File([new Uint8Array([1, 2, 3])], 'v.webm', {
          type: 'audio/webm',
        }),
      ),
    ).toEqual({ ok: true, kind: 'audio' })

    const waId = '972509880204'
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

    const result = await replyAudioToSession({
      actor: hqActor(),
      waId,
      audio: new Uint8Array([1, 2, 3, 4]),
      mime: 'audio/webm',
    })
    expect(result.safeDryRun).toBe(true)
    expect(result.message.media_kind).toBe('audio')
    expect(
      memListInboxMessages(waId).some((m) => m.media_kind === 'audio'),
    ).toBe(true)
  })
})
