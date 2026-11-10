import { memAddMessage, memGet, supabaseReady } from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'
import { normalizePhoneDigits } from '@/lib/phone'
import { ISRAEL_STORES } from '@/modules/stores/israel-stores'
import { formatIls } from '@/modules/spend/true-cost'
import {
  appendEvent,
  getById,
  listTickets,
  updateStatus,
  type TicketDetail,
} from '@/modules/tickets/service'
import { ticketIsUrgent } from '@/modules/tickets/urgent'
import {
  STORE_CONFIRM_BUTTON_TITLE,
  STORE_REJECT_BUTTON_TITLE,
  storeConfirmButtonId,
  storeRejectButtonId,
} from '@/modules/tickets/wa-store-confirm'
import { sendWhatsAppText } from '@/modules/whatsapp/send'
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
  /** Present on the lock that just ran. Not a stored column. */
  handoff?: { ok: boolean; line: string }
}

const memory: Engagement[] = []
const handoffSent = new Map<string, { ok: boolean; line: string }>()

export function resetEngagementsForTests() {
  memory.splice(0, memory.length)
  handoffSent.clear()
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
    if (!error && data) return data.map((row) => rowToEngagement(row))
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

function handoffText(input: {
  name: string
  phone: string
  amount: number
  scope?: string | null
}): string {
  return [
    'ארי אישר את הטיפול.',
    `איש המקצוע: ${input.name}`,
    `טלפון: ${input.phone}`,
    input.scope?.trim() ? `עבודה: ${input.scope.trim()}` : null,
    `מחיר שאושר: ${formatIls(input.amount)}`,
    'תאמו איתו ישירות את מועד ההגעה.',
    'כשהעבודה תסתיים, אשרו אם התקלה סודרה.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

export type StoreHandoff = { ok: boolean; line: string }

async function recordHandoff(input: {
  ticketId: string
  body: string
  delivered: boolean
  line: string
}) {
  const ready = await supabaseReady()
  if (ready) {
    const supabase = createSystemClient('engagements')
    await supabase.from('ticket_messages').insert({
      ticket_id: input.ticketId,
      channel: 'whatsapp',
      direction: 'outbound',
      body: input.body,
      raw: { kind: 'engagement_locked', delivered: input.delivered, line: input.line },
    })
    return
  }
  if (memGet(input.ticketId)) {
    memAddMessage(input.ticketId, {
      channel: 'whatsapp',
      direction: 'outbound',
      body: input.body,
    })
  }
}

/** Sends the store handoff only after the engagement row exists. A repeat of the same key does not send twice. */
async function tellStore(input: {
  ticketId: string
  storeCode: string
  reporterPhone: string | null
  body: string
  idempotencyKey: string
}): Promise<StoreHandoff> {
  const cached = handoffSent.get(input.idempotencyKey)
  if (cached?.ok) return cached

  const manager = ISRAEL_STORES.find((store) => store.code === input.storeCode)
    ?.managerPhone
  const phones = [manager, input.reporterPhone]
    .map((phone) => normalizePhoneDigits(phone))
    .filter((phone): phone is string => phone != null && phone.length >= 9)
    .filter((phone, index, all) => all.indexOf(phone) === index)

  if (phones.length === 0) {
    const missed: StoreHandoff = {
      ok: false,
      line: 'אין מספר למנהל החנות. הפרטים נשמרו ולא נשלחו.',
    }
    await recordHandoff({
      ticketId: input.ticketId,
      body: input.body,
      delivered: false,
      line: missed.line,
    })
    return missed
  }

  const ready = await supabaseReady()
  let delivered = false
  let lastError = 'ההודעה למנהל החנות לא יצאה'
  for (const phone of phones) {
    try {
      const sent = await sendWhatsAppText({
        toWaId: phone,
        text: input.body,
        ticketId: input.ticketId,
        purpose: 'status_update',
        forceDryRun: !ready,
        buttons: [
          { id: storeConfirmButtonId(input.ticketId), title: STORE_CONFIRM_BUTTON_TITLE },
          { id: storeRejectButtonId(input.ticketId), title: STORE_REJECT_BUTTON_TITLE },
        ],
      })
      if (sent.ok && !sent.dryRun && !sent.skippedByPolicy) {
        delivered = true
      } else if (!sent.ok) {
        lastError = sent.error || lastError
      } else {
        lastError = 'הפרטים נשמרו. ההודעה לא נמסרה בוואטסאפ.'
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError
    }
  }

  const result: StoreHandoff = delivered
    ? { ok: true, line: 'מנהל החנות קיבל את הפרטים' }
    : { ok: false, line: lastError }
  await recordHandoff({
    ticketId: input.ticketId,
    body: input.body,
    delivered,
    line: result.line,
  })
  if (delivered) handoffSent.set(input.idempotencyKey, result)
  return result
}

export async function lockEngagement(input: {
  ticketId: string
  bundledTicketIds?: string[]
  midragSpId?: string | null
  professionalName: string
  professionalPhone: string
  approvedAmount: number
  approvedBy: string
  scope?: string | null
}): Promise<Engagement> {
  const name = input.professionalName.trim()
  const phone = input.professionalPhone.trim()
  if (name.length < 2) throw new Error('חסר שם של איש המקצוע')
  if (phone.replace(/\D/g, '').length < 9) throw new Error('חסר טלפון של איש המקצוע')
  if (!(input.approvedAmount > 0)) throw new Error('חסר מחיר שסוכם')

  const ticket = await getById(input.ticketId)
  if (!ticket) throw new Error('תקלה לא נמצאה')
  if (await lockedEngagementFor(ticket.id)) {
    throw new Error('המחיר כבר נעול. לשינוי צריך לבטל ולחזור לתור')
  }
  if (!WAITING.has(ticket.status) && ticket.status !== 'in_progress') {
    throw new Error('התקלה כבר לא ממתינה לאישור')
  }

  const bundled = [...new Set(input.bundledTicketIds ?? [])].filter(
    (id) => id && id !== ticket.id,
  )
  for (const id of bundled) {
    if (await lockedEngagementFor(id)) {
      throw new Error('אחת התקלות שסומנו כבר בביקור אחר')
    }
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

  const ids = [engagement.ticketId, ...engagement.bundledTicketIds]
  for (const id of ids) {
    await updateStatus(id, 'engaged', null)
    await appendEvent(id, 'engagement_locked', null, {
      engagementId: engagement.id,
      professionalName: engagement.professionalName,
      professionalPhone: engagement.professionalPhone,
      approvedAmount: engagement.approvedAmount,
      approvedBy: engagement.approvedBy,
      scope: input.scope?.trim() || null,
      bundled: engagement.bundledTicketIds,
    })
  }

  const handoff = await tellStore({
    ticketId: engagement.ticketId,
    storeCode: engagement.storeCode,
    reporterPhone: ticket.reporter_phone,
    idempotencyKey: `engagement:${engagement.id}`,
    body: handoffText({
      name: engagement.professionalName,
      phone: engagement.professionalPhone,
      amount: engagement.approvedAmount,
      scope: input.scope,
    }),
  })
  engagement.handoff = handoff
  await appendEvent(engagement.ticketId, 'store_handoff', null, {
    engagementId: engagement.id,
    ok: handoff.ok,
    line: handoff.line,
  })

  return engagement
}

export async function cancelEngagement(ticketId: string): Promise<Engagement | null> {
  const current = await lockedEngagementFor(ticketId)
  if (!current) return null
  current.status = 'cancelled'
  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    await supabase.from('engagements').update({ status: 'cancelled' }).eq('id', current.id)
  }
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
  current.closedAt = closedAt
  if (await supabaseReady()) {
    const supabase = createSystemClient('engagements')
    await supabase.from('engagements').update({ closed_at: closedAt }).eq('id', current.id)
  }
}

export async function engagementTicketIds(ticketId: string): Promise<string[]> {
  const current = await lockedEngagementFor(ticketId)
  if (!current) return [ticketId]
  return [current.ticketId, ...current.bundledTicketIds]
}

export async function closedEngagementCosts(): Promise<ClosedEngagementCost[]> {
  const rows = await listEngagements()
  const closed = rows.filter((row) => row.status === 'locked' && row.closedAt)
  const tickets = await listTickets({ limit: 1000 }).catch(() => ({ tickets: [] }))
  const categoryById = new Map(tickets.tickets.map((ticket) => [ticket.id, ticket.category]))
  return closed.map((row) => ({
    storeCode: row.storeCode,
    storeName: row.storeName,
    approvedAmount: row.approvedAmount,
    closedAt: row.closedAt as string,
    category: categoryById.get(row.ticketId) ?? null,
  }))
}
