import { matchProfessionalsForFault, type FaultPro } from '@/modules/professionals/match-fault'
import { formatIls } from '@/modules/spend/true-cost'
import {
  normalizeTicketCategory,
  type TicketPriority,
} from '@/modules/tickets/constants'
import { findRecurrences, suggestPrevention, type HistoryTicket } from '@/modules/tickets/recurrence'
import { getSlaBreachKind } from '@/modules/tickets/sla'
import { rankKnownVendors, type VendorOutcome } from '@/modules/vendors/outcomes'
import { applyIntakeRules } from './rules'

const HAZARD_RULES = new Set([
  'water_electric',
  'safety_hazard',
  'significant_water_leak',
])

const NOUN: Record<string, string> = {
  plumbing: 'נזילות',
  hvac: 'תקלות מיזוג',
  electrical: 'תקלות חשמל',
  security: 'תקלות אבטחה',
  it: 'תקלות מחשוב',
  cleaning: 'עבודות ניקיון',
  other: 'תקלות',
}

const SINGULAR: Record<string, string> = {
  plumbing: 'נזילה',
  hvac: 'מיזוג',
  electrical: 'חשמל',
  security: 'אבטחה',
  it: 'מחשוב',
  cleaning: 'ניקיון',
  other: 'תקלה',
}

export type BundleFault = {
  id: string
  storeId: string
  storeName: string
  category: string
  priority: string
  status: string
  summary: string
  createdAt: string
  slaResolveBy?: string | null
  resolvedAt?: string | null
  firstResponseAt?: string | null
  /** Store district. Used to suggest a combined visit nearby. */
  regionId?: string | null
  /** Ari's flag. When set, it wins over priority. */
  urgent?: boolean | null
  /** Already on a service visit or waiting for a vendor. */
  dispatched?: boolean
}

export type BundleCard = {
  id: string
  kind: 'bundle' | 'urgent' | 'prevention'
  storeId: string
  storeName: string
  category: string
  ticketIds: string[]
  sentence: string
  costLine: string | null
  professionalName: string | null
  professionalId: string | null
  /** outcome = someone who already succeeded here. book = directory match. */
  professionalSource: 'outcome' | 'book' | null
}

const OPEN = new Set([
  'new',
  'triaged',
  'assigned',
  'awaiting_info',
  'in_progress',
  'waiting_parts',
])

export function categoryNoun(category: string, singular = false): string {
  const key = normalizeTicketCategory(category)
  return (singular ? SINGULAR : NOUN)[key] ?? (singular ? 'תקלה' : 'תקלות')
}

/** Same trade after normalize (electrical_hazard → electrical). */
export function categoriesCanBundle(a: string, b: string): boolean {
  return normalizeTicketCategory(a) === normalizeTicketCategory(b)
}

export function faultNeedsNow(fault: BundleFault, now = new Date()): boolean {
  if (fault.urgent === false) return false
  if (fault.urgent === true) return true
  if (fault.priority === 'critical' || fault.priority === 'high') return true
  const breach = getSlaBreachKind({
    sla_resolve_by: fault.slaResolveBy,
    status: fault.status,
    resolved_at: fault.resolvedAt,
    first_response_at: fault.firstResponseAt,
    now,
  })
  if (breach === 'resolve') return true
  const rules = applyIntakeRules({ text: fault.summary })
  return rules.applied.some((rule) => HAZARD_RULES.has(rule.id))
}

function costLine(category: string, outcomes: VendorOutcome[]): string {
  const prices = outcomes
    .filter(
      (row) =>
        normalizeTicketCategory(row.category) === category &&
        row.success &&
        row.price != null &&
        row.price > 0,
    )
    .map((row) => Math.round(row.price as number))
  if (prices.length === 0) return 'אין עדיין מחיר'
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  if (low === high) return `נרשם מחיר אחד: ${formatIls(low)}`
  return `טווח לפי מחירים שנרשמו: ${formatIls(low)}–${formatIls(high)}`
}

function pickProfessional(
  category: string,
  professionals: FaultPro[],
  outcomes: VendorOutcome[],
): Pick<BundleCard, 'professionalName' | 'professionalId' | 'professionalSource'> {
  const known = rankKnownVendors(outcomes, category)[0]
  if (known) {
    return {
      professionalName: known.vendorName,
      professionalId: known.vendorId,
      professionalSource: 'outcome',
    }
  }
  const book = matchProfessionalsForFault(professionals, category)[0]
  if (book) {
    return {
      professionalName: book.full_name,
      professionalId: book.id,
      professionalSource: 'book',
    }
  }
  return { professionalName: null, professionalId: null, professionalSource: null }
}

function toHistory(fault: BundleFault): HistoryTicket {
  return {
    id: fault.id,
    storeId: fault.storeId,
    category: normalizeTicketCategory(fault.category),
    description: fault.summary,
    status: fault.status,
    createdAt: fault.createdAt,
  }
}

function samePlace(anchor: BundleFault, other: BundleFault): boolean {
  if (other.storeId === anchor.storeId) return true
  return Boolean(anchor.regionId && other.regionId && anchor.regionId === other.regionId)
}

function pickUrgentCompanions(fault: BundleFault, later: BundleFault[]): BundleFault[] {
  const nearby = later.filter((other) => samePlace(fault, other))
  const sameStore = nearby.filter((other) => other.storeId === fault.storeId)
  const sameTrade = sameStore.filter((other) =>
    categoriesCanBundle(fault.category, other.category),
  )
  // Prefer same store + same/companion trade; else any same-store; else district peers.
  if (sameTrade.length > 0) return sameTrade
  if (sameStore.length > 0) return sameStore
  return nearby.filter((other) => categoriesCanBundle(fault.category, other.category))
}

function urgentSentence(
  fault: BundleFault,
  companions: BundleFault[],
): string {
  const sameStore = companions.filter((row) => row.storeId === fault.storeId)
  const districtOnly = companions.filter((row) => row.storeId !== fault.storeId)
  const countLabel = (n: number) =>
    n === 1 ? 'תקלה לא דחופה אחת' : `${n} תקלות לא דחופות`

  if (sameStore.length === 0 && districtOnly.length === 0) {
    return `דחוף בסניף ${fault.storeName}. אין עכשיו תקלה לא דחופה לשלב.`
  }
  if (sameStore.length > 0 && districtOnly.length === 0) {
    return `דחוף בסניף ${fault.storeName}. כדאי לאחד לביקור אחד בסניף — אפשר לסגור גם ${countLabel(sameStore.length)}.`
  }
  if (sameStore.length > 0) {
    return `דחוף בסניף ${fault.storeName}. כדאי לאחד לביקור אחד בסניף — ${countLabel(sameStore.length)}. יש גם ${countLabel(districtOnly.length)} במחוז (לא באותו ביקור חנות).`
  }
  return `דחוף בסניף ${fault.storeName}. יש ${countLabel(districtOnly.length)} במחוז — לא באותו ביקור חנות.`
}

function bundleGroupKey(fault: BundleFault): string {
  return `${fault.storeId}:${normalizeTicketCategory(fault.category)}`
}

/**
 * An urgent fault suggests open non-urgent faults in the same store (preferred)
 * or same trade in the district. Visit planning stays same-store only.
 * Leftover non-urgent faults of the same / companion trade at one store can still be grouped.
 */
export function recommendBundles(input: {
  open: BundleFault[]
  history?: BundleFault[]
  professionals?: FaultPro[]
  outcomes?: VendorOutcome[]
  now?: Date
}): BundleCard[] {
  const now = input.now ?? new Date()
  const professionals = input.professionals ?? []
  const outcomes = input.outcomes ?? []
  const history = (input.history ?? []).map(toHistory)
  const cards: BundleCard[] = []
  const groups = new Map<string, BundleFault[]>()
  const urgent: BundleFault[] = []
  const later: BundleFault[] = []

  for (const fault of input.open) {
    if (!fault.storeId || fault.dispatched || !OPEN.has(fault.status)) continue
    const category = normalizeTicketCategory(fault.category)
    const row = { ...fault, category }
    if (faultNeedsNow(row, now)) urgent.push(row)
    else later.push(row)
  }

  const claimed = new Set<string>()
  for (const fault of urgent) {
    const companions = pickUrgentCompanions(
      fault,
      later.filter((other) => !claimed.has(other.id)),
    )
    for (const companion of companions) claimed.add(companion.id)
    cards.push({
      id: `urgent:${fault.id}`,
      kind: 'urgent',
      storeId: fault.storeId,
      storeName: fault.storeName,
      category: fault.category,
      ticketIds: [fault.id, ...companions.map((row) => row.id)],
      sentence: urgentSentence(fault, companions),
      costLine: null,
      professionalName: null,
      professionalId: null,
      professionalSource: null,
    })
  }

  for (const fault of later) {
    if (claimed.has(fault.id)) continue
    const key = bundleGroupKey(fault)
    const list = groups.get(key) ?? []
    list.push(fault)
    groups.set(key, list)
  }

  for (const [key, members] of groups) {
    if (members.length < 2) continue
    const storeId = members[0]?.storeId || key.split(':')[0] || ''
    const category = normalizeTicketCategory(members[0]?.category || 'other')
    const storeName = members[0]?.storeName || 'הסניף'
    const newest = [...members].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0]
    const hits = newest ? findRecurrences(toHistory(newest), history, 180, now) : []
    const prevention = suggestPrevention(hits)
    if (prevention) {
      cards.push({
        id: `prevention:${key}`,
        kind: 'prevention',
        storeId,
        storeName,
        category,
        ticketIds: members.map((row) => row.id),
        sentence: `התקלה חזרה בסניף ${storeName}. כדאי בדיקה, לא הזמנה חוזרת.`,
        costLine: null,
        professionalName: null,
        professionalId: null,
        professionalSource: null,
      })
      continue
    }
    const pro = pickProfessional(category, professionals, outcomes)
    const noun = categoryNoun(category)
    const sentence = pro.professionalName
      ? `${members.length} ${noun} בסניף ${storeName}. כדאי לאחד לביקור אחד — ${pro.professionalName} יכול לטפל בכולן.`
      : `${members.length} ${noun} בסניף ${storeName}. כדאי לאחד לביקור אחד — חסר איש מקצוע.`
    cards.push({
      id: `bundle:${key}`,
      kind: 'bundle',
      storeId,
      storeName,
      category,
      ticketIds: members.map((row) => row.id),
      sentence,
      costLine: costLine(category, outcomes),
      ...pro,
    })
  }

  const rank = { urgent: 0, prevention: 1, bundle: 2 }
  return cards.sort(
    (a, b) => rank[a.kind] - rank[b.kind] || a.storeName.localeCompare(b.storeName, 'he'),
  )
}

/**
 * Companions Ari can add to one visit. A card may mention another store in the
 * same district; a visit row has one store_id, so those stay off the plan.
 */
export function sameStoreCompanionIds(
  cards: BundleCard[],
  storeIdByTicket: ReadonlyMap<string, string>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const card of cards) {
    for (const id of card.ticketIds) {
      const storeId = storeIdByTicket.get(id)
      if (!storeId) continue
      const companions = card.ticketIds.filter((other) => {
        if (other === id) return false
        return storeIdByTicket.get(other) === storeId
      })
      out[id] = [...new Set([...(out[id] ?? []), ...companions])]
    }
  }
  return out
}

/** Whether the store's own person should get the faults now. The manager's WhatsApp stays the ticket confirmation. */
export function intakeBundleHandoff(input: {
  storeId: string
  storeName: string
  category: string
  description: string
  priority: TicketPriority | string
  ticketId: string
  createdAt: string
  open: BundleFault[]
  now?: Date
}): 'now' | 'group' | 'wait' {
  const category = normalizeTicketCategory(input.category)
  const current: BundleFault = {
    id: input.ticketId,
    storeId: input.storeId,
    storeName: input.storeName,
    category,
    priority: input.priority,
    status: 'new',
    summary: input.description,
    createdAt: input.createdAt,
  }
  if (faultNeedsNow(current, input.now)) return 'now'
  const peers = input.open.filter(
    (fault) =>
      fault.storeId === input.storeId &&
      categoriesCanBundle(fault.category, category) &&
      !fault.dispatched &&
      OPEN.has(fault.status) &&
      !faultNeedsNow(fault, input.now),
  )
  const seen = new Set(peers.map((fault) => fault.id))
  if (!seen.has(current.id)) peers.push(current)
  return peers.length >= 2 ? 'group' : 'wait'
}
