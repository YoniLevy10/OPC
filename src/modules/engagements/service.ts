import { memAddMessage, memFindStoreById, memGet, supabaseReady } from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'
import { normalizePhoneDigits } from '@/lib/phone'
import { formatIls } from '@/modules/spend/true-cost'
import {
  appendEvent,
  getById,
  listTickets,
  updateStatus,
  type TicketDetail,
} from '@/modules/tickets/service'
import { ticketIsUrgent } from '@/modules/tickets/urgent'
import { sendWhatsAppText } from '@/modules/whatsapp/send'
import { buildVisitPlan } from '@/modules/visits/plan'
import { captureError } from '@/lib/monitoring'
import type { ClosedEngagementCost } from './cost'

export type Engagement = {
  id: string
  organizationId: string
  storeId: string
  storeCode: string
  storeName: string
  ticketId: string
  bundledTicketIds: string[]
  midragSpId: string | null
  professionalName: string
  professionalPhone: string
  approvedAmount: number
  approvedBy: string
  approvedAt: string
  status: 'locked' | 'cancelled'
  closedAt: string | null
  /** Delivery evidence is persisted separately in each store's ticket events. */
  handoffs?: EngagementHandoff[]
}

export type EngagementHandoff = {
  storeId: string
  storeCode: string
  storeName: string
  ticketIds: string[]
  status: 'sent' | 'dry_run' | 'failed' | 'missing_contact'
  error: string | null
  attemptedAt: string
  waMessageId: string | null
  canRetry: boolean
}

// Next's route and page bundles can instantiate this module independently.
// Share the demo ledger exactly as the ticket memory backend shares its records.
const localState = globalThis as typeof globalThis & {
  __opcEngagements?: Engagement[]
  __opcEngagementInFlight?: Set<string>
}
const memory = localState.__opcEngagements ??= []
const inFlightTickets = localState.__opcEngagementInFlight ??= new Set<string>()

export class EngagementInputError extends Error {}
export class EngagementRecoveryError extends Error {}

export function resetEngagementsForTests() {
  memory.splice(0, memory.length)
}

const WAITING = new Set(['new', 'triaged', 'awaiting_info', 'assigned'])

function rowToEngagement(row: Record<string, unknown>): Engagement {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id ?? ''),
    storeId: String(row.store_id ?? ''),
    storeCode: String(row.store_code ?? ''),
    storeName: String(row.store_name ?? ''),
    ticketId: String(row.ticket_id),
    bundledTicketIds: Array.isArray(row.bundled_ticket_ids)
      ? row.bundled_ticket_ids.map(String)
      : [],
    midragSpId: (row.midrag_sp_id as string | null) ?? null,
    professionalName: String(row.professional_name ?? ''),
    professionalPhone: String(row.professional_phone ?? ''),
    approvedAmount: Number(row.approved_amount),
    approvedBy: String(row.approved_by ?? ''),
    approvedAt: String(row.approved_at ?? row.created_at ?? ''),
    status: row.status === 'cancelled' ? 'cancelled' : 'locked',
    closedAt: (row.closed_at as string | null) ?? null,
  }
}

export async function listEngagements(): Promise<Engagement[]> {
  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    const { data, error } = await supabase
      .from('engagements')
      .select('*')
      .order('approved_at', { ascending: false })
      .limit(2000)
    if (error) throw new Error(error.message)
    return (data ?? []).map((row) => rowToEngagement(row))
  }
  return [...memory].sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1))
}

export async function lockedEngagementFor(ticketId: string): Promise<Engagement | null> {
  const rows = await listEngagements()
  return (
    rows.find(
      (row) =>
        row.status === 'locked' &&
        (row.ticketId === ticketId || row.bundledTicketIds.includes(ticketId)),
    ) ?? null
  )
}

export async function findTicketAwaitingAri(): Promise<TicketDetail | null> {
  const { tickets } = await listTickets({
    limit: 150,
    statuses: [...WAITING],
  })
  const waiting = tickets
    .filter((ticket) => WAITING.has(ticket.status) && ticketIsUrgent(ticket))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  for (const ticket of waiting) {
    const locked = await lockedEngagementFor(ticket.id)
    if (!locked) {
      const full = await getById(ticket.id)
      if (full) return full
    }
  }
  return null
}

async function loadEngagementTickets(engagement: Engagement): Promise<TicketDetail[]> {
  const tickets = await Promise.all(
    [engagement.ticketId, ...engagement.bundledTicketIds].map((id) => getById(id)),
  )
  if (tickets.some((ticket) => !ticket)) throw new Error('תקלה בביקור לא נמצאה')
  const loaded = tickets as TicketDetail[]
  if (loaded.some((ticket) => ticket.organization_id !== engagement.organizationId || ticket.country_id !== loaded[0]?.country_id)) {
    throw new Error('תקלות הביקור אינן באותו ארגון ומדינה')
  }
  return loaded
}

function groupByStore(tickets: TicketDetail[]): TicketDetail[][] {
  const groups = new Map<string, TicketDetail[]>()
  for (const ticket of tickets) {
    const group = groups.get(ticket.store_id) ?? []
    group.push(ticket)
    groups.set(ticket.store_id, group)
  }
  return [...groups.values()]
}

async function responsibleManagerPhone(ticket: TicketDetail): Promise<string | null> {
  if (!(await supabaseReady())) {
    const store = memFindStoreById(ticket.store_id)
    if (!store || store.organization_id !== ticket.organization_id || store.country_id !== ticket.country_id) {
      return null
    }
    return normalizePhoneDigits(store.manager_phone)
  }
  const supabase = createSystemClient('engagements')
  const { data, error } = await supabase.from('stores')
    .select('manager_phone')
    .eq('id', ticket.store_id)
    .eq('organization_id', ticket.organization_id)
    .eq('country_id', ticket.country_id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return normalizePhoneDigits(data?.manager_phone)
}

function handoffText(engagement: Engagement, tickets: TicketDetail[]): string {
  const storeName = tickets[0]?.stores?.name || tickets[0]?.stores?.code || 'החנות'
  const shared = tickets.length < 1 + engagement.bundledTicketIds.length ? 'לכל העבודות בביקור המשולב' : 'לביקור'
  return [
    `ארי אישר את הטיפול ב${storeName}.`,
    `איש המקצוע: ${engagement.professionalName}`,
    `טלפון: ${engagement.professionalPhone}`,
    `מחיר שאושר ${shared}: ${formatIls(engagement.approvedAmount)}`,
    'העבודות שאושרו בחנות שלכם:',
    ...tickets.map((ticket) => `• ${ticket.display_number || ticket.id} · ${ticket.title || ticket.description}`),
    'מנהל החנות אחראי לתאם ישירות עם איש המקצוע את מועד ההגעה והביצוע.',
    'לאחר סיום העבודה, אשרו בנפרד כל תקלה שטופלה.',
  ].join('\n')
}

async function savedHandoffs(engagement: Engagement, tickets: TicketDetail[]): Promise<EngagementHandoff[]> {
  return groupByStore(tickets).flatMap((group) => {
    const events = group.flatMap((ticket) => ticket.events)
      .filter((event) => event.event_type === 'engagement_handoff' && event.payload.engagementId === engagement.id)
      .sort((a, b) => Number(b.payload.attempt ?? 0) - Number(a.payload.attempt ?? 0) || b.created_at.localeCompare(a.created_at))
    const latest = events[0]?.payload.handoff as EngagementHandoff | undefined
    const anchor = group[0]!
    return [latest ?? {
      storeId: anchor.store_id,
      storeCode: anchor.stores?.code ?? '',
      storeName: anchor.stores?.name ?? '',
      ticketIds: group.map((ticket) => ticket.id),
      status: 'failed' as const,
      error: 'פרטי הביקור עדיין לא נשלחו לחנות',
      attemptedAt: engagement.approvedAt,
      waMessageId: null,
      canRetry: true,
    }]
  })
}

export async function getEngagementHandoffs(ticketId: string): Promise<EngagementHandoff[]> {
  const engagement = await lockedEngagementFor(ticketId)
  if (!engagement) return []
  return savedHandoffs(engagement, await loadEngagementTickets(engagement))
}

async function sendStoreHandoffs(engagement: Engagement, tickets: TicketDetail[], retry: boolean): Promise<EngagementHandoff[]> {
  const prior = retry ? await savedHandoffs(engagement, tickets) : []
  const results: EngagementHandoff[] = []
  const ready = await supabaseReady()
  for (const group of groupByStore(tickets)) {
    const anchor = group[0]!
    const previous = prior.find((result) => result.storeId === anchor.store_id)
    if (previous && (!previous.canRetry || previous.status === 'sent' || previous.status === 'dry_run')) {
      results.push(previous)
      continue
    }
    const remaining = group.filter((ticket) => ticket.status !== 'closed')
    if (remaining.length === 0 && previous) {
      results.push({ ...previous, canRetry: false, error: 'החנות כבר אישרה את הטיפול; לא נשלחת הודעת תיאום נוספת' })
      continue
    }
    const body = handoffText(engagement, remaining)
    const handoff: EngagementHandoff = {
      storeId: anchor.store_id,
      storeCode: anchor.stores?.code ?? '',
      storeName: anchor.stores?.name ?? '',
      ticketIds: group.map((ticket) => ticket.id),
      status: 'failed',
      error: null,
      attemptedAt: new Date().toISOString(),
      waMessageId: null,
      canRetry: true,
    }
    const attempt = group.flatMap((ticket) => ticket.events).filter((event) =>
      event.event_type === 'engagement_handoff' && event.payload.engagementId === engagement.id,
    ).length + 1
    let attemptSaved = false
    try {
      // A crash after sending but before saving the outcome must not cause an automatic duplicate.
      await appendEvent(anchor.id, 'engagement_handoff', null, {
        engagementId: engagement.id,
        attempt,
        handoff: { ...handoff, canRetry: false, error: 'קיים ניסיון שליחה ללא תוצאה שמורה; יש לבדוק מסירה לפני שליחה נוספת' },
      })
      attemptSaved = true
      const phone = await responsibleManagerPhone(anchor)
      if (!phone || phone.length < 9) {
        handoff.status = 'missing_contact'
        handoff.error = 'חסר מספר טלפון תקין למנהל החנות; יש לעדכן בחנות ולנסות שוב'
      } else {
        // Retry is owned by the explicit store handoff, not a second generic queue.
        const sent = await sendWhatsAppText({
          toWaId: phone,
          text: body,
          ticketId: anchor.id,
          purpose: 'status_update',
          forceDryRun: !ready,
          skipFailureQueue: true,
        })
        handoff.waMessageId = sent.waMessageId
        if (sent.ok && sent.dryRun) handoff.status = 'dry_run'
        else if (sent.ok && sent.waMessageId) handoff.status = 'sent'
        else handoff.error = sent.error || 'לא התקבל אישור שליחה מ־WhatsApp'
        handoff.canRetry = handoff.status === 'failed'
      }
    } catch (error) {
      handoff.error = error instanceof Error ? error.message : 'שליחת הפרטים לחנות נכשלה'
    }
    try {
      await appendEvent(anchor.id, 'engagement_handoff', null, { engagementId: engagement.id, attempt: attempt + 1, handoff })
    } catch (error) {
      captureError(error, { route: 'engagement.handoff.outcome', storeId: anchor.store_id })
      handoff.status = 'failed'
      handoff.error = 'תוצאת השליחה לא נשמרה; יש לבדוק מסירה לפני ניסיון נוסף'
      handoff.canRetry = !attemptSaved
    }
    // Failed attempts belong to the audit, not a conversation bubble implying a sent message.
    if (ready && (handoff.status === 'sent' || handoff.status === 'dry_run')) {
      const supabase = createSystemClient('engagements')
      const { error } = await supabase.from('ticket_messages').insert({
        ticket_id: anchor.id,
        channel: 'whatsapp',
        direction: 'outbound',
        body,
        wa_message_id: handoff.waMessageId,
        raw: { kind: 'engagement_locked', engagementId: engagement.id, deliveryStatus: handoff.status },
      })
      if (error) captureError(new Error(error.message), { route: 'engagement.handoff.message', storeId: anchor.store_id })
    } else if (!ready && (handoff.status === 'sent' || handoff.status === 'dry_run') && memGet(anchor.id)) {
      memAddMessage(anchor.id, { channel: 'whatsapp', direction: 'outbound', body })
    }
    results.push(handoff)
  }
  return results
}

function hasApprovalEvent(ticket: TicketDetail, engagement: Engagement): boolean {
  return ticket.events.some((event) => event.event_type === 'engagement_locked' && event.payload.engagementId === engagement.id)
}

/** Resume the saved approval, including a crash between saving its price and updating its tickets. */
async function completeEngagementApproval(engagement: Engagement): Promise<Engagement> {
  const tickets = await loadEngagementTickets(engagement)
  const otherLocks = (await listEngagements()).filter((row) => row.status === 'locked' && row.id !== engagement.id)
  const ready = await supabaseReady()
  // Validate the entire saved scope before resuming any step. A later, different workflow is never overwritten.
  for (const ticket of tickets) {
    if (otherLocks.some((row) => row.ticketId === ticket.id || row.bundledTicketIds.includes(ticket.id))) {
      throw new EngagementRecoveryError('אחת התקלות משויכת לאישור אחר; נדרשת בדיקה ידנית')
    }
    const confirmed = ready
      ? (ticket as TicketDetail & { store_confirmed_at?: string | null }).store_confirmed_at
      : memGet(ticket.id)?.store_confirmed_at
    if (ticket.status === 'closed' && confirmed && hasApprovalEvent(ticket, engagement)) continue
    if (ticket.status === 'engaged') continue
    if ((WAITING.has(ticket.status) || ticket.status === 'in_progress') && !hasApprovalEvent(ticket, engagement) && !engagement.closedAt) continue
    throw new EngagementRecoveryError('מצב אחת התקלות השתנה מאז האישור; נדרשת בדיקה ידנית לפני המשך')
  }
  if (engagement.closedAt && tickets.some((ticket) => ticket.status !== 'closed')) {
    throw new EngagementRecoveryError('מצב סגירת הביקור אינו תואם לתקלות; נדרשת בדיקה ידנית')
  }
  for (const ticket of tickets) {
    if (ticket.status === 'closed') continue
    if (ticket.status !== 'engaged') await updateStatus(ticket.id, 'engaged', null)
    if (!hasApprovalEvent(ticket, engagement)) {
      await appendEvent(ticket.id, 'engagement_locked', null, {
        engagementId: engagement.id,
        professionalName: engagement.professionalName,
        professionalPhone: engagement.professionalPhone,
        approvedAmount: engagement.approvedAmount,
        approvedBy: engagement.approvedBy,
        bundled: engagement.bundledTicketIds,
      })
    }
  }
  const refreshed = await loadEngagementTickets(engagement)
  const handoffs = refreshed.every((ticket) => ticket.status === 'closed')
    ? await savedHandoffs(engagement, refreshed)
    : await sendStoreHandoffs(engagement, refreshed, true)
  return { ...engagement, handoffs }
}

/** Caller must authorize the full saved group, including when replaying an identical request. */
export async function resumeEngagementApproval(ticketId: string): Promise<Engagement> {
  const engagement = await lockedEngagementFor(ticketId)
  if (!engagement) throw new EngagementRecoveryError('אין ביקור מאושר לשחזור')
  const ids = [engagement.ticketId, ...engagement.bundledTicketIds]
  if (ids.some((id) => inFlightTickets.has(id))) throw new EngagementInputError('הביקור כבר נמצא בתהליך שליחה')
  ids.forEach((id) => inFlightTickets.add(id))
  try {
    return await completeEngagementApproval(engagement)
  } finally {
    ids.forEach((id) => inFlightTickets.delete(id))
  }
}

/** Resends only failed stores after reconciling the saved approval; never approves another price. */
export async function retryEngagementHandoffs(ticketId: string): Promise<Engagement> {
  return resumeEngagementApproval(ticketId)
}

export type LockEngagementInput = {
  ticketId: string
  bundledTicketIds?: string[]
  midragSpId?: string | null
  professionalName: string
  professionalPhone: string
  approvedAmount: number
  approvedBy: string
}

/** Prevent overlapping approvals within this worker; the database also locks the lead ticket. */
export async function lockEngagement(input: LockEngagementInput): Promise<Engagement> {
  const ids = [...new Set([input.ticketId, ...(input.bundledTicketIds ?? [])].map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0 || ids.length > 40) throw new EngagementInputError('יש לבחור בין תקלה אחת ל־40 תקלות')
  if (ids.some((id) => inFlightTickets.has(id))) throw new EngagementInputError('אחת התקלות כבר נמצאת בתהליך אישור')
  ids.forEach((id) => inFlightTickets.add(id))
  try {
    return await lockEngagementInternal(input)
  } finally {
    ids.forEach((id) => inFlightTickets.delete(id))
  }
}

async function lockEngagementInternal(input: LockEngagementInput): Promise<Engagement> {
  const name = input.professionalName.trim()
  const phone = input.professionalPhone.trim()
  if (name.length < 2) throw new EngagementInputError('חסר שם של איש המקצוע')
  if (!normalizePhoneDigits(phone) || phone.replace(/\D/g, '').length < 9) throw new EngagementInputError('חסר טלפון של איש המקצוע')
  if (!Number.isFinite(input.approvedAmount) || !(input.approvedAmount > 0)) throw new EngagementInputError('חסר מחיר תקין שסוכם')
  if (!input.approvedBy.trim()) throw new EngagementInputError('חסר הגורם המאשר')

  const ticket = await getById(input.ticketId)
  if (!ticket) throw new EngagementInputError('תקלה לא נמצאה')
  if (await lockedEngagementFor(ticket.id)) {
    throw new EngagementInputError('המחיר כבר נעול. לשינוי צריך לבטל ולחזור לתור')
  }

  const bundled = [...new Set((input.bundledTicketIds ?? []).map((id) => id.trim()))].filter(
    (id) => id && id !== ticket.id,
  )
  const selected = await Promise.all([ticket.id, ...bundled].map((id) => getById(id)))
  if (selected.some((row) => !row)) throw new EngagementInputError('אחת התקלות שסומנו לא נמצאה')
  const tickets = selected as TicketDetail[]
  for (const row of tickets) {
    if (!row.organization_id || !row.country_id || row.organization_id !== ticket.organization_id || row.country_id !== ticket.country_id) {
      throw new EngagementInputError('כל התקלות בביקור חייבות להשתייך לאותו ארגון ולאותה מדינה')
    }
    if (!WAITING.has(row.status) && row.status !== 'in_progress') {
      throw new EngagementInputError('אחת התקלות כבר לא ממתינה לאישור')
    }
    if (row.id !== ticket.id && await lockedEngagementFor(row.id)) {
      throw new EngagementInputError('אחת התקלות שסומנו כבר בביקור אחר')
    }
  }
  const plan = buildVisitPlan(tickets.map((row) => ({
    id: row.id,
    label: row.display_number || row.id,
    storeId: row.store_id,
    storeCode: row.stores?.code ?? '',
    category: row.category,
    city: row.stores?.city,
  })))
  if (plan.length !== 1 || !plan[0]?.ready) {
    throw new EngagementInputError('יש לאשר ביקור נפרד לכל מקצוע ועיר; נדרש סיווג ומיקום מלאים לכל תקלה')
  }

  const now = new Date().toISOString()
  const engagement: Engagement = {
    id: crypto.randomUUID(),
    organizationId: ticket.organization_id,
    storeId: ticket.store_id,
    storeCode: ticket.stores?.code ?? '',
    storeName: ticket.stores?.name ?? '',
    ticketId: ticket.id,
    bundledTicketIds: bundled,
    midragSpId: input.midragSpId?.trim() || null,
    professionalName: name,
    professionalPhone: phone,
    approvedAmount: input.approvedAmount,
    approvedBy: input.approvedBy,
    approvedAt: now,
    status: 'locked',
    closedAt: null,
  }

  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    const { data, error } = await supabase
      .from('engagements')
      .insert({
        organization_id: engagement.organizationId,
        store_id: engagement.storeId,
        store_code: engagement.storeCode,
        store_name: engagement.storeName,
        ticket_id: engagement.ticketId,
        bundled_ticket_ids: engagement.bundledTicketIds,
        midrag_sp_id: engagement.midragSpId,
        professional_name: engagement.professionalName,
        professional_phone: engagement.professionalPhone,
        approved_amount: engagement.approvedAmount,
        approved_by: engagement.approvedBy,
        approved_at: engagement.approvedAt,
        status: 'locked',
      })
      .select('*')
      .single()
    if (error || !data) throw new Error(error?.message || 'נעילת המחיר נכשלה')
    Object.assign(engagement, rowToEngagement(data))
  } else {
    memory.unshift(engagement)
  }

  return completeEngagementApproval(engagement)
}

export async function cancelEngagement(ticketId: string): Promise<Engagement | null> {
  const current = await lockedEngagementFor(ticketId)
  if (!current) return null
  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    const { error } = await supabase.from('engagements').update({ status: 'cancelled' }).eq('id', current.id)
    if (error) throw new Error(error.message)
  }
  current.status = 'cancelled'
  const ids = [current.ticketId, ...current.bundledTicketIds]
  for (const id of ids) {
    const ticket = await getById(id)
    if (ticket?.status === 'engaged') {
      await updateStatus(id, 'new', null)
    }
    await appendEvent(id, 'engagement_cancelled', null, {
      engagementId: current.id,
    })
  }
  return current
}

export async function markEngagementClosed(ticketId: string, closedAt: string) {
  const current = await lockedEngagementFor(ticketId)
  if (!current || current.closedAt) return
  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    const { error } = await supabase.from('engagements').update({ closed_at: closedAt }).eq('id', current.id)
    if (error) throw new Error(error.message)
  }
  current.closedAt = closedAt
}

export async function engagementTicketIds(ticketId: string): Promise<string[]> {
  const current = await lockedEngagementFor(ticketId)
  if (!current) return [ticketId]
  return [current.ticketId, ...current.bundledTicketIds]
}

export async function closedEngagementCosts(): Promise<ClosedEngagementCost[]> {
  const rows = await listEngagements()
  return rows
    .filter((row) => row.status === 'locked' && row.closedAt)
    .map((row) => ({
      storeCode: row.storeCode,
      storeName: row.storeName,
      approvedAmount: row.approvedAmount,
      closedAt: row.closedAt as string,
    }))
}
