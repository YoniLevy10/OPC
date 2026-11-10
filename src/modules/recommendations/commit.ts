import { ISRAEL_STORES } from '@/modules/stores/israel-stores'
import {
  addTask,
  applySpendDecision,
  createSpend,
  deskDecisionPhones,
  listSpends,
} from '@/lib/data/ops-ledger'
import { persistOpsLedger } from '@/lib/data/ops-db'
import { createServiceVisit } from '@/modules/visits/service'
import { phonesMatch } from '@/modules/whatsapp/classify'
import { notifyManagerInWindow } from '@/modules/whatsapp/window-reply'

export function encodeBundleScope(vendorId: string | null, ticketIds: string[]): string {
  return `bundle|vendor=${vendorId ?? ''}|tickets=${ticketIds.join(',')}`
}

export function parseBundleScope(
  scope: string | null | undefined,
): { vendorId: string | null; ticketIds: string[] } | null {
  if (!scope?.startsWith('bundle|')) return null
  const vendor = scope.match(/vendor=([^|]*)/)?.[1]?.trim() || null
  const tickets =
    scope
      .match(/tickets=([^|]*)/)?.[1]
      ?.split(',')
      .map((id) => id.trim())
      .filter(Boolean) ?? []
  if (tickets.length === 0) return null
  return { vendorId: vendor || null, ticketIds: tickets }
}

export function sameTicketSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((id, index) => id === right[index])
}

export function parseVisitButton(
  interactiveId: string | null | undefined,
): { spendId: string; approve: boolean } | null {
  if (!interactiveId) return null
  const yes = interactiveId.match(/^visit_yes:(.+)$/)
  if (yes?.[1]) return { spendId: yes[1], approve: true }
  const no = interactiveId.match(/^visit_no:(.+)$/)
  if (no?.[1]) return { spendId: no[1], approve: false }
  return null
}

export function findPendingBundle(ticketIds: string[]) {
  return (
    listSpends().find((spend) => {
      if (spend.status !== 'pending') return false
      const parsed = parseBundleScope(spend.scope)
      return parsed ? sameTicketSet(parsed.ticketIds, ticketIds) : false
    }) ?? null
  )
}

export type BundleRequest = {
  storeId: string
  storeCode: string
  storeName: string
  sentence: string
  vendorId: string | null
  vendorName: string | null
  ticketIds: string[]
  averageAmount: number | null
}

function managerPhone(storeCode: string): string | null {
  return ISRAEL_STORES.find((store) => store.code === storeCode)?.managerPhone ?? null
}

export async function requestBundleVisit(
  input: BundleRequest,
  actor: string,
): Promise<{ spendId: string; notice: string }> {
  const existing = findPendingBundle(input.ticketIds)
  if (existing) return { spendId: existing.id, notice: 'כבר יש הזמנה ממתינה.' }

  const phone = managerPhone(input.storeCode)

  const spend = createSpend({
    storeId: input.storeId,
    storeCode: input.storeCode,
    storeName: input.storeName,
    ticketId: input.ticketIds[0] ?? null,
    reason: input.sentence,
    vendorName: input.vendorName,
    requestedAmount: input.averageAmount ?? 0,
    scope: encodeBundleScope(input.vendorId, input.ticketIds),
    urgent: false,
    actor,
    requestedBy: actor,
    originWaId: phone,
  })
  applySpendDecision(spend.id, 'approved', actor, input.averageAmount ?? null)
  const smsLine = 'הביקור תוכנן. פרטי בעל המקצוע יישלחו אחרי נעילת מחיר.'
  if (input.ticketIds.length > 0) {
    try {
      await createServiceVisit({
        storeId: input.storeId,
        ticketIds: input.ticketIds,
        notes: input.sentence,
        idempotencyKey: `bundle:${spend.id}`,
      })
    } catch {
      addTask({
        title: 'הביקור לא נשמר',
        storeId: input.storeId,
        storeCode: input.storeCode,
        assignee: null,
        dueAt: null,
        ticketId: input.ticketIds[0] ?? null,
        documentId: null,
        spendId: spend.id,
        needsClarification: true,
        clarification: 'ארי ביקש לתכנן ביקור והשמירה נכשלה',
      })
    }
  }
  const managerText = `ארי הזמין ביקור אחד לסניף ${input.storeName}. ${smsLine}`
  const window = phone ? await notifyManagerInWindow(phone, managerText) : 'held'
  await persistOpsLedger()
  return {
    spendId: spend.id,
    notice:
      window === 'sent'
        ? 'הביקור הוזמן. המנהל עודכן בוואטסאפ.'
        : 'הביקור הוזמן. חלון 24 השעות סגור, לא נשלחה הודעה בתשלום.',
  }
}

export async function decideBundleVisit(input: {
  spendId: string
  approve: boolean
  actor: string
  /** Set when the decision arrives from WhatsApp. The app path leaves this empty. */
  senderPhone?: string | null
}): Promise<{ reply: string }> {
  const spend = listSpends().find((row) => row.id === input.spendId)
  if (!spend) return { reply: 'לא מצאתי הזמנה ממתינה.' }
  const parsed = parseBundleScope(spend.scope)
  if (!parsed) return { reply: 'זו לא הזמנת ביקור.' }

  if (input.senderPhone) {
    const manager = managerPhone(spend.storeCode)
    const allowed =
      (manager && phonesMatch(input.senderPhone, manager)) ||
      deskDecisionPhones().some((phone) => phonesMatch(input.senderPhone!, phone))
    if (!allowed) return { reply: 'אין הרשאה לאשר את ההזמנה מהמספר הזה.' }
  }

  if (!input.approve) {
    if (spend.status === 'pending') {
      applySpendDecision(spend.id, 'rejected', input.actor)
      await persistOpsLedger()
    }
    return { reply: 'ההזמנה נדחתה. לא נשלח בעל מקצוע.' }
  }

  if (spend.status !== 'approved') {
    applySpendDecision(spend.id, 'approved', input.actor, spend.requestedAmount || null)
  }

  await createServiceVisit({
    storeId: spend.storeId,
    ticketIds: parsed.ticketIds,
    notes: spend.reason,
    idempotencyKey: `bundle:${spend.id}`,
  })
  await persistOpsLedger()
  return { reply: 'הביקור תוכנן. פרטי בעל המקצוע יישלחו אחרי נעילת מחיר.' }
}
