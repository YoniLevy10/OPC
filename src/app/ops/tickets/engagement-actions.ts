'use server'

import { revalidatePath } from 'next/cache'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import {
  cancelEngagement,
  lockEngagement,
} from '@/modules/engagements/service'
import { setTicketUrgent } from '@/modules/tickets/service'
import { getById } from '@/modules/tickets/service'
import { canMutateHqTicket, type Actor } from '@/lib/auth/types'
import { engagementTicketIds } from '@/modules/engagements/service'

async function actorName() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) throw new Error('נדרשת כניסה')
  const allowed =
    !actor ||
    actor.memberships.some(
      (membership) =>
        membership.role === 'global_admin' ||
        membership.role === 'global_maintenance',
    )
  if (!allowed) throw new Error('רק ארי מאשר עסקה')
  return { id: actor?.id ?? null, name: actor?.full_name || 'ארי', actor }
}

async function authorizePlan(actor: Actor | null, ids: string[]) {
  if (!actor && shouldAllowDemoEntry()) return
  if (!actor) throw new Error('נדרשת כניסה')
  for (const id of [...new Set(ids)]) {
    const ticket = await getById(id)
    if (!ticket || !canMutateHqTicket(actor, ticket) || !actor.memberships.some((membership) =>
      membership.organization_id === ticket.organization_id &&
      (membership.role === 'global_admin' || membership.role === 'global_maintenance'),
    )) throw new Error('אין הרשאה לנהל את תוכנית הביקור')
  }
}

export async function lockEngagementAction(formData: FormData) {
  const actor = await actorName()
  const ticketId = String(formData.get('ticketId') ?? '')
  const picked = String(formData.get('midrag') ?? '')
  const [midragSpId, encodedName] = picked.split('::')
  const typedName = String(formData.get('professional_name') ?? '').trim()
  const professionalName =
    typedName || (encodedName ? decodeURIComponent(encodedName) : '')
  const bundled = formData
    .getAll('bundle')
    .map((value) => String(value))
    .filter(Boolean)
  await authorizePlan(actor.actor, [ticketId, ...bundled])
  await lockEngagement({
    ticketId,
    bundledTicketIds: bundled,
    midragSpId: midragSpId || null,
    professionalName,
    professionalPhone: String(formData.get('professional_phone') ?? ''),
    approvedAmount: Number(formData.get('approved_amount')),
    approvedBy: actor.name,
  })
  revalidatePath(`/ops/tickets/${ticketId}`)
  revalidatePath('/ops/approvals')
  revalidatePath('/ops/dashboard')
  revalidatePath('/ops/reports')
}

export async function cancelEngagementAction(formData: FormData) {
  const actor = await actorName()
  const ticketId = String(formData.get('ticketId') ?? '')
  await authorizePlan(actor.actor, await engagementTicketIds(ticketId))
  await cancelEngagement(ticketId)
  revalidatePath(`/ops/tickets/${ticketId}`)
  revalidatePath('/ops/approvals')
  revalidatePath('/ops/dashboard')
}

export async function setUrgentAction(formData: FormData) {
  const actor = await actorName()
  const ticketId = String(formData.get('ticketId') ?? '')
  await authorizePlan(actor.actor, [ticketId])
  const urgent = formData.get('urgent') === '1'
  await setTicketUrgent(ticketId, urgent, actor.id)
  revalidatePath(`/ops/tickets/${ticketId}`)
  revalidatePath('/ops/approvals')
  revalidatePath('/ops/dashboard')
}
