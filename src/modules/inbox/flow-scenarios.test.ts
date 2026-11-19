import { beforeEach, describe, expect, it } from 'vitest'
import type { Actor } from '@/lib/auth/types'
import {
  MEM_COUNTRY_ID,
  memGet,
  memGetSession,
  memListSessions,
  memListTickets,
  memReset,
  memUpsertSession,
} from '@/lib/data/memory-store'
import { processInboundMessage } from '@/modules/whatsapp/intake'
import type { InboundMessage } from '@/modules/whatsapp/types'
import { suggestProfessionalsForTicket } from '@/modules/inbox/pro-suggestions'
import { forwardTicketPackToProfessional } from '@/modules/inbox/forward-pro'
import {
  lockedEngagementFor,
  resetEngagementsForTests,
} from '@/modules/engagements/service'
import { assign, createTicket, updateStatus } from '@/modules/tickets/service'
import { DEMO_TECH_ID } from '@/lib/data/memory-store'
import { GET as lifecycleNudge } from '@/app/api/cron/lifecycle-nudge/route'

process.env.MAINTAINOS_FORCE_MEMORY = '1'
process.env.MAINTAINOS_ALLOW_TEST_AUTH = '1'
process.env.WHATSAPP_AI_INTAKE_ENABLED = 'false'
delete process.env.WHATSAPP_AI_ENABLED
delete process.env.MAINTAINOS_WA_OUTBOUND_MEDIA_LIVE
delete process.env.MAINTAINOS_WA_CONFIRM_REMINDERS_LIVE

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
    waId: partial.waId ?? '972509880011',
    phoneNumberId: null,
    text: partial.text ?? null,
    mediaUrl: partial.mediaUrl ?? null,
    mediaKind: partial.mediaKind ?? null,
    timestamp: null,
    sourceHint: 'demo',
  }
}

describe('OC-22 flow glue scenarios S1–S6', () => {
  beforeEach(() => {
    process.env.MAINTAINOS_FORCE_MEMORY = '1'
    process.env.MAINTAINOS_ALLOW_TEST_AUTH = '1'
    process.env.WHATSAPP_AI_INTAKE_ENABLED = 'false'
    delete process.env.WHATSAPP_AI_ENABLED
    delete process.env.MAINTAINOS_WA_OUTBOUND_MEDIA_LIVE
    delete process.env.MAINTAINOS_WA_CONFIRM_REMINDERS_LIVE
    memReset()
    resetEngagementsForTests()
  })

  it('S1 text-only manager does not open a ticket', async () => {
    const waId = '972509880101'
    await processInboundMessage(msg({ text: 'STORE_172', waId }), dry)
    const before = memListTickets().length
    const r = await processInboundMessage(
      msg({ waId, text: 'המזגן לא עובד בלי תמונה' }),
      dry,
    )
    expect(r.ticketId).toBeFalsy()
    expect(memListTickets().length).toBe(before)
    expect(r.reply || '').toMatch(/תמונה|סרטון/i)
  })

  it('S2 description + image opens ticket with media', async () => {
    const waId = '972509880102'
    await processInboundMessage(msg({ text: 'STORE_172', waId }), dry)
    const before = memListTickets().length
    const r = await processInboundMessage(
      msg({
        waId,
        text: 'המזגן הראשי לא מקרר ויש נזילה',
        mediaUrl: 'https://example.com/hvac-proof.jpg',
        mediaKind: 'image',
      }),
      dry,
    )
    expect(r.ticketId).toBeTruthy()
    expect(memListTickets().length).toBe(before + 1)
    const ticket = memGet(r.ticketId!)
    expect(ticket?.category).toBe('hvac')
    expect(
      ticket?.messages.some(
        (m) => m.media_url === 'https://example.com/hvac-proof.jpg',
      ),
    ).toBe(true)
  })

  it('S3 HVAC ticket gets Midrag hvac suggestion from book', async () => {
    const waId = '972509880103'
    await processInboundMessage(msg({ text: 'STORE_172', waId }), dry)
    const opened = await processInboundMessage(
      msg({
        waId,
        text: 'המזגן הראשי לא מקרר ויש נזילה',
        mediaUrl: 'https://example.com/hvac-proof.jpg',
        mediaKind: 'image',
      }),
      dry,
    )
    expect(opened.ticketId).toBeTruthy()
    const { suggestions, category } = await suggestProfessionalsForTicket({
      actor: hqActor(),
      ticketId: opened.ticketId!,
    })
    expect(category).toBe('hvac')
    expect(suggestions.length).toBeGreaterThan(0)
    // Seed trade is "תיקון מזגנים" (plural נ) — match via מזגנ stem, not final-nun מזגן.
    expect(
      suggestions.some(
        (s) =>
          s.id === 'pro-demo-hvac-uri' ||
          /מזגנ|מיזוג|hvac/i.test(s.trade || '') ||
          /מזגנ|מיזוג|hvac/i.test(s.reason),
      ),
    ).toBe(true)
    expect(suggestions[0]?.phone).toBeTruthy()
  })

  it('S4 Ari picks pro → forward opens pro_coord dry-run + engagement', async () => {
    const waId = '972509880104'
    await processInboundMessage(msg({ text: 'STORE_172', waId }), dry)
    const opened = await processInboundMessage(
      msg({
        waId,
        text: 'המזגן הראשי לא מקרר ויש נזילה',
        mediaUrl: 'https://example.com/hvac-proof.jpg',
        mediaKind: 'image',
      }),
      dry,
    )
    expect(opened.ticketId).toBeTruthy()
    const { suggestions } = await suggestProfessionalsForTicket({
      actor: hqActor(),
      ticketId: opened.ticketId!,
    })
    const pro = suggestions[0]
    expect(pro).toBeTruthy()

    const result = await forwardTicketPackToProfessional({
      actor: hqActor(),
      ticketId: opened.ticketId!,
      professionalId: pro!.id,
    })
    expect(result.dryRun).toBe(true)
    expect(result.sends.length).toBeGreaterThan(0)
    expect(result.engagementLocked).toBe(true)
    expect(result.engagementId).toBeTruthy()

    const session = memGetSession(result.sessionWaId)
    expect(session?.thread_kind).toBe('pro_coord')
    expect(session?.bot_mode).toBe('never')
    expect(session?.linked_professional_id).toBe(pro!.id)
    expect(session?.linked_ticket_id).toBe(opened.ticketId)

    const engagement = await lockedEngagementFor(opened.ticketId!)
    expect(engagement?.professionalId || engagement?.professionalName).toBeTruthy()
    expect(memGet(opened.ticketId!)?.status).toBe('engaged')
  })

  it('S5 inbound on pro_coord does not open ticket or bot reply', async () => {
    const proWa = '972501112233'
    memUpsertSession({
      wa_id: proWa,
      country_id: MEM_COUNTRY_ID,
      store_id: 'il-store-172',
      store_code: '172',
      state: 'done',
      pending_description: null,
      thread_kind: 'pro_coord',
      bot_mode: 'never',
      linked_professional_id: 'pro-demo-hvac-uri',
      human_takeover: true,
      human_takeover_until: new Date(Date.now() + 60_000).toISOString(),
    })
    const before = memListTickets().length
    const r = await processInboundMessage(
      msg({
        waId: proWa,
        text: 'אפשר לבוא מחר עם הצעת מחיר',
        mediaUrl: 'https://example.com/quote.jpg',
        mediaKind: 'image',
      }),
      dry,
    )
    expect(r.ok).toBe(true)
    expect(r.reply).toBeNull()
    expect(r.ticketId).toBeFalsy()
    expect(memListTickets().length).toBe(before)
    expect(
      memListSessions().some(
        (s) => s.wa_id === proWa && s.thread_kind === 'pro_coord',
      ),
    ).toBe(true)
  })

  it('S6 resolve → reminder ladder advances; confirm stops', async () => {
    let ticket = await createTicket({
      storeCode: '172',
      description: 'נזילה לאישור',
      category: 'plumbing',
      priority: 'medium',
      source: 'demo',
      reporterPhone: '972501234567',
    })
    ticket = await assign(ticket.id, DEMO_TECH_ID)
    ticket = await updateStatus(ticket.id, 'in_progress', null)
    ticket = await updateStatus(ticket.id, 'resolved', null, {
      proofAlreadyAttached: true,
    })

    const mem = memGet(ticket.id)!
    mem.resolved_at = new Date(Date.now() - 25 * 3600_000).toISOString()
    mem.awaiting_store_confirm_since = mem.resolved_at
    mem.confirm_reminder_level = 0
    mem.store_confirmed_at = null

    const res = await lifecycleNudge(
      new Request('http://localhost/api/cron/lifecycle-nudge'),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      ok: boolean
      nudged: number
      live: boolean
      levels: number[]
    }
    expect(json.ok).toBe(true)
    expect(json.live).toBe(false)
    expect(json.nudged).toBeGreaterThanOrEqual(1)
    expect(Math.max(...json.levels, 0)).toBe(4)
    expect(memGet(ticket.id)?.confirm_reminder_level).toBe(4)

    memGet(ticket.id)!.store_confirmed_at = new Date().toISOString()
    const again = await lifecycleNudge(
      new Request('http://localhost/api/cron/lifecycle-nudge'),
    )
    const againJson = (await again.json()) as { nudged: number }
    expect(againJson.nudged).toBe(0)
  })
})
