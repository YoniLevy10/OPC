'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import {
  cancelEngagement,
  lockEngagement,
} from '@/modules/engagements/service'
import { setTicketUrgent } from '@/modules/tickets/service'

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
  return { id: actor?.id ?? null, name: actor?.full_name || 'ארי' }
}

export async function lockPlannedVisitAction(input: {
  ticketIds: string[]
  professionalName: string
  professionalPhone: string
  approvedAmount?: number
  scope?: string | null
}): Promise<{
  engagementLocked: boolean
  handoffOk: boolean
  line: string
}> {
  try {
    const actor = await actorName()
    const ids = [...new Set(input.ticketIds.map((id) => id.trim()).filter(Boolean))]
    const ticketId = ids[0]
    if (!ticketId) {
      return {
        engagementLocked: false,
        handoffOk: false,
        line: 'אין תקלה לאשר',
      }
    }
    const locked = await lockEngagement({
      ticketId,
      bundledTicketIds: ids.slice(1),
      professionalName: input.professionalName,
      professionalPhone: input.professionalPhone,
      approvedAmount: input.approvedAmount,
      approvedBy: actor.name,
      scope: input.scope,
    })
    revalidatePath(`/ops/tickets/${ticketId}`)
    revalidatePath('/ops/approvals')
    revalidatePath('/ops/dashboard')
    revalidatePath('/ops/reports')
    revalidatePath('/ops/professionals')
    for (const id of ids) revalidatePath(`/store/tickets/${id}`)
    const handoffLine =
      locked.handoff?.line ?? 'הפרטים נשמרו. ההודעה למנהל החנות לא אומתה.'
    const smsLine = locked.proSms?.line
    return {
      engagementLocked: true,
      handoffOk: Boolean(locked.handoff?.ok),
      line: smsLine ? `${handoffLine} · ${smsLine}` : handoffLine,
    }
  } catch (error) {
    // Never throw — Next would POST-render /ops/tickets as a Server Components crash
    // (opaque digest in production) instead of a toast.
    return {
      engagementLocked: false,
      handoffOk: false,
      line: error instanceof Error ? error.message : 'תכנון הביקור נכשל',
    }
  }
}

export async function lockEngagementAction(formData: FormData) {
  const ticketId = String(formData.get('ticketId') ?? '')
  try {
    const actor = await actorName()
    const picked = String(formData.get('midrag') ?? '')
    const [midragSpId, encodedName] = picked.split('::')
    const typedName = String(formData.get('professional_name') ?? '').trim()
    const professionalName =
      typedName || (encodedName ? decodeURIComponent(encodedName) : '')
    const bundled = formData
      .getAll('bundle')
      .map((value) => String(value))
      .filter(Boolean)
    const professionalId = String(formData.get('professional_id') ?? '').trim() || null
    await lockEngagement({
      ticketId,
      bundledTicketIds: bundled,
      midragSpId: midragSpId || null,
      professionalId,
      professionalName,
      professionalPhone: String(formData.get('professional_phone') ?? ''),
      approvedAmount: formData.get('approved_amount')
        ? Number(formData.get('approved_amount'))
        : undefined,
      approvedBy: actor.name,
      scope: String(formData.get('scope') ?? '') || null,
    })
  } catch (error) {
    // Fail soft — a thrown server action leaves the ticket detail on a stale
    // client tree (form still open) even when memory already flipped to engaged.
    console.error(
      '[lockEngagementAction]',
      error instanceof Error ? error.message : error,
    )
    revalidatePath(`/ops/tickets/${ticketId}`)
    return
  }
  revalidatePath(`/ops/tickets/${ticketId}`)
  revalidatePath('/ops/approvals')
  revalidatePath('/ops/dashboard')
  revalidatePath('/ops/reports')
  revalidatePath('/ops/professionals')
  // Hard redirect so the client cannot keep the pre-lock EngagementPanel tree
  // after a successful lock (revalidatePath alone was leaving the form mounted).
  redirect(`/ops/tickets/${ticketId}`)
}

export async function cancelEngagementAction(formData: FormData) {
  await actorName()
  const ticketId = String(formData.get('ticketId') ?? '')
  await cancelEngagement(ticketId)
  revalidatePath(`/ops/tickets/${ticketId}`)
  revalidatePath('/ops/approvals')
  revalidatePath('/ops/dashboard')
}

export async function setUrgentAction(formData: FormData) {
  const actor = await actorName()
  const ticketId = String(formData.get('ticketId') ?? '')
  const urgent = formData.get('urgent') === '1'
  await setTicketUrgent(ticketId, urgent, actor.id)
  revalidatePath(`/ops/tickets/${ticketId}`)
  revalidatePath('/ops/approvals')
  revalidatePath('/ops/dashboard')
}
