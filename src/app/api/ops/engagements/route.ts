import { NextResponse } from 'next/server'
import { z } from 'zod'
import { authErrorResponse, requireActor } from '@/lib/auth/request-actor'
import { AuthError, canMutateHqTicket, type Actor } from '@/lib/auth/types'
import { normalizePhoneDigits } from '@/lib/phone'
import {
  EngagementInputError,
  lockEngagement,
  lockedEngagementFor,
  retryEngagementHandoffs,
  resumeEngagementApproval,
  type Engagement,
} from '@/modules/engagements/service'
import { getById } from '@/modules/tickets/service'
import { captureError } from '@/lib/monitoring'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const approveSchema = z.object({
  action: z.literal('approve').optional(),
  ticketId: z.string().uuid(),
  bundledTicketIds: z.array(z.string().uuid()).max(39).default([]),
  professionalName: z.string().trim().min(2).max(160),
  professionalPhone: z.string().trim().min(9).max(40).refine((phone) =>
    /^[+\d\s()-]+$/.test(phone) && Boolean(normalizePhoneDigits(phone)),
  ),
  approvedAmount: z.number().finite().positive(),
}).strict()

const retrySchema = z.object({
  action: z.literal('retry'),
  ticketId: z.string().uuid(),
}).strict()

function ticketIds(engagement: Engagement): string[] {
  return [...new Set([engagement.ticketId, ...engagement.bundledTicketIds])]
}

async function authorizeTickets(actor: Actor, ids: string[]) {
  // Validate the whole plan before any write or retry, including an existing
  // engagement's companions rather than trusting only its lead ticket.
  for (const id of ids) {
    const ticket = await getById(id)
    if (!ticket || !canMutateHqTicket(actor, ticket) || !actor.memberships.some((membership) =>
      membership.organization_id === ticket.organization_id &&
      (membership.role === 'global_admin' || membership.role === 'global_maintenance'),
    )) {
      throw new AuthError('אין הרשאה לאשר את תוכנית הביקור', 403)
    }
  }
}

function sameApproval(existing: Engagement, input: z.infer<typeof approveSchema>): boolean {
  const requested = [...new Set([input.ticketId, ...input.bundledTicketIds])].sort()
  const current = ticketIds(existing).sort()
  return requested.length === current.length && requested.every((id, index) => id === current[index]) &&
    existing.professionalName.trim() === input.professionalName &&
    normalizePhoneDigits(existing.professionalPhone) === normalizePhoneDigits(input.professionalPhone) &&
    existing.approvedAmount === input.approvedAmount
}

/** Ari approves a fault-led plan; store feedback remains a separate authority. */
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request)
    if (!actor.memberships.some((membership) =>
      membership.role === 'global_admin' || membership.role === 'global_maintenance',
    )) throw new AuthError('רק ארי רשאי לאשר עבודה ומחיר', 403)

    const parsed = z.union([approveSchema, retrySchema]).safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'יש לבחור תקלות ולהזין שם, טלפון ומחיר תקינים' }, { status: 400 })
    const input = parsed.data
    const existing = await lockedEngagementFor(input.ticketId)

    if (input.action === 'retry') {
      if (!existing) return NextResponse.json({ error: 'לא נמצאה עבודה מאושרת לשליחה חוזרת' }, { status: 404 })
      await authorizeTickets(actor, ticketIds(existing))
      const engagement = await retryEngagementHandoffs(input.ticketId)
      return NextResponse.json({ engagement, handoffs: engagement.handoffs ?? [] })
    }

    await authorizeTickets(actor, [...new Set([input.ticketId, ...input.bundledTicketIds])])
    if (existing) {
      await authorizeTickets(actor, ticketIds(existing))
      if (!sameApproval(existing, input)) {
        return NextResponse.json({ error: 'העבודה כבר אושרה בתנאים אחרים. שינוי מחיר, איש מקצוע או היקף דורש אישור מחדש' }, { status: 409 })
      }
      const engagement = await resumeEngagementApproval(existing.ticketId)
      return NextResponse.json({ engagement, handoffs: engagement.handoffs ?? [], replay: true })
    }

    const engagement = await lockEngagement({
      ticketId: input.ticketId,
      bundledTicketIds: input.bundledTicketIds,
      professionalName: input.professionalName,
      professionalPhone: input.professionalPhone,
      approvedAmount: input.approvedAmount,
      approvedBy: actor.full_name || actor.email || actor.id,
    })
    return NextResponse.json({ engagement, handoffs: engagement.handoffs ?? [] }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error)
    captureError(error, { route: 'POST /api/ops/engagements' })
    if (error instanceof EngagementInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'לא ניתן לשמור או לקרוא את אישור העבודה כרגע. בדקו את המצב לפני ניסיון חוזר' }, { status: 503 })
  }
}
