import { tool, stepCountIs } from 'ai'
import { z } from 'zod'
import type { Locale } from '@/lib/i18n/locale'
import { phrase } from '@/lib/i18n/phrases'
import { persistOpsLedger } from '@/lib/data/ops-db'
import { addTask, applySpendDecision } from '@/lib/data/ops-ledger'
import { formatIls } from '@/modules/spend/true-cost'
import type { SpendRequest } from '@/modules/spend/policy'
import { ISRAEL_STORES, israelStoreId, type IsraelStoreSeed } from '@/modules/stores/israel-stores'
import { classifyFaultText } from '@/modules/tickets/classify'
import { normalizeTicketCategory } from '@/modules/tickets/constants'
import {
  createTicket,
  formatDisplayNumber,
  setTicketUrgent,
} from '@/modules/tickets/service'
import type { AriLink, OpenFaultHint } from '@/modules/ops/agent-actions'
import type { DuePaper, PriceBand, WaitingSpendHint, BookProHint } from '@/modules/ops/agent-chat'
import { parsePersonalRating } from '@/modules/notes/personal-rating'
import {
  matchProfessionalsForFault,
  type FaultPro,
} from '@/modules/professionals/match-fault'
import { repairRangeLine } from '@/modules/recommendations/estimate'
import type { BundleCard } from '@/modules/whatsapp/agent/bundle'
import { lockEngagement } from '@/modules/engagements/service'
import type { Professional } from '@/modules/professionals/types'

type StoreHit =
  | { kind: 'one'; store: IsraelStoreSeed }
  | { kind: 'many'; stores: IsraelStoreSeed[] }
  | { kind: 'none' }

function storeHits(storeHint: string): StoreHit {
  const q = storeHint.trim()
  if (!q) return { kind: 'none' }
  const exact = uniqueStores(
    ISRAEL_STORES.filter(
      (store) =>
        store.name === q ||
        store.code === q ||
        store.city === q ||
        store.name.includes(q) ||
        q.includes(store.name),
    ),
  )
  if (exact.length === 1) return { kind: 'one', store: exact[0]! }
  if (exact.length > 1) return { kind: 'many', stores: exact }
  const byCity = uniqueStores(
    ISRAEL_STORES.filter((store) => store.city.length >= 2 && (store.city.includes(q) || q.includes(store.city))),
  )
  if (byCity.length === 1) return { kind: 'one', store: byCity[0]! }
  if (byCity.length > 1) return { kind: 'many', stores: byCity }
  return { kind: 'none' }
}

function uniqueStores(stores: IsraelStoreSeed[]): IsraelStoreSeed[] {
  const seen = new Set<string>()
  return stores.filter((store) => {
    if (seen.has(store.code)) return false
    seen.add(store.code)
    return true
  })
}

function findStore(storeHint: string): IsraelStoreSeed | null {
  const hit = storeHits(storeHint)
  return hit.kind === 'one' ? hit.store : null
}

function clarifyStores(stores: IsraelStoreSeed[], locale: Locale): string {
  const names = stores
    .slice(0, 3)
    .map((store) => store.name)
    .join(' / ')
  return agentPhrase(locale, 'agent.whichStoreOptions', 'באיזה סניף? {names}', { names })
}

function resolveStoreMessage(storeHint: string, locale: Locale): {
  store: IsraelStoreSeed | null
  message: string | null
} {
  const hit = storeHits(storeHint)
  if (hit.kind === 'one') return { store: hit.store, message: null }
  if (hit.kind === 'many') return { store: null, message: clarifyStores(hit.stores, locale) }
  return {
    store: null,
    message: agentPhrase(locale, 'agent.whichStoreOpen', 'באיזה סניף? כתוב שם או קוד סניף.'),
  }
}

type FaultHit =
  | { kind: 'one'; fault: OpenFaultHint }
  | { kind: 'many'; faults: OpenFaultHint[] }
  | { kind: 'none' }

function faultHits(open: OpenFaultHint[], storeHint?: string | null): FaultHit {
  const pool = open.filter((fault) => fault.id)
  if (!storeHint?.trim()) {
    if (pool.length === 1) return { kind: 'one', fault: pool[0]! }
    if (pool.length > 1) return { kind: 'many', faults: pool }
    return { kind: 'none' }
  }
  const resolved = storeHits(storeHint)
  if (resolved.kind === 'many') return { kind: 'none' }
  if (resolved.kind === 'none') return { kind: 'none' }
  const store = resolved.store
  const match = pool.filter(
    (fault) =>
      fault.storeName.includes(store.name) || store.name.includes(fault.storeName),
  )
  if (match.length === 1) return { kind: 'one', fault: match[0]! }
  if (match.length > 1) return { kind: 'many', faults: match }
  return { kind: 'none' }
}

function clarifyFaults(faults: OpenFaultHint[], locale: Locale): string {
  const names = faults
    .slice(0, 3)
    .map((fault) => {
      const number = fault.displayNumber ? `${fault.displayNumber} ` : ''
      return `${number}${fault.storeName}`
    })
    .join(' / ')
  return agentPhrase(locale, 'agent.whichFaultOptions', 'באיזו תקלה? {names}', { names })
}

/** Localize with agent.* / ari.* keys; Hebrew falls back to the source sentence. */
function agentPhrase(
  locale: Locale,
  key: string,
  he: string,
  vars?: Record<string, string | number>,
) {
  const raw = locale === 'he' ? he : phrase(locale, key, vars)
  let text = locale !== 'he' && raw === key ? he : raw
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}

export function summarizeDuePapersText(
  papers: DuePaper[],
  locale: Locale,
  storeHint?: string | null,
): { message: string; href: string; count: number } {
  const p = (key: string, he: string, vars?: Record<string, string | number>) =>
    agentPhrase(locale, key, he, vars)
  let rows = papers
  const named = storeHint?.trim() ? findStore(storeHint) : null
  if (storeHint?.trim()) {
    const hit = storeHits(storeHint)
    if (hit.kind === 'many') {
      return {
        count: 0,
        href: '/ops/documents',
        message: clarifyStores(hit.stores, locale),
      }
    }
    rows = named
      ? rows.filter(
          (row) =>
            row.storeName.includes(named.name) ||
            named.name.includes(row.storeName) ||
            row.storeName.includes(named.city),
        )
      : rows.filter((row) => row.storeName.includes(storeHint.trim()))
  }
  if (rows.length === 0) {
    return {
      count: 0,
      href: '/ops/documents',
      message: named
        ? p('agent.papersNoneStore', 'אין מסמך באיחור או בחודש הקרוב בסניף {store}.', {
            store: named.name,
          })
        : p('agent.papersNone', 'אין מסמך באיחור או בחודש הקרוב.'),
    }
  }
  const shown = rows.slice(0, 8)
  const lines = shown.map((row) =>
    row.overdue
      ? p('agent.paperLate', '{label} בסניף {store} כבר באיחור.', {
          label: row.label,
          store: row.storeName,
        })
      : p('agent.paperSoon', '{label} בסניף {store} בעוד פחות מחודש.', {
          label: row.label,
          store: row.storeName,
        }),
  )
  if (rows.length > shown.length) {
    lines.push(
      p('agent.papersMore', 'ועוד {count}.', { count: rows.length - shown.length }),
    )
  }
  const lead = named
    ? p('agent.papersLeadStore', 'מסמכים לחידוש ב{store}:', { store: named.name })
    : p('agent.papersLead', 'מסמכים לחידוש:')
  return {
    count: rows.length,
    href: '/ops/documents',
    message: `${lead}\n${lines.join('\n')}\n${p('agent.papersPath', 'מסמכים: /ops/documents')}`,
  }
}

export function listOpenByStoreText(
  open: OpenFaultHint[],
  storeHint: string,
  locale: Locale,
): { message: string; href: string | null; ok: boolean } {
  const p = (key: string, he: string, vars?: Record<string, string | number>) =>
    agentPhrase(locale, key, he, vars)
  const resolved = resolveStoreMessage(storeHint, locale)
  if (!resolved.store) {
    return {
      ok: false,
      href: null,
      message: resolved.message ?? p('agent.whichStoreOpen', 'באיזה סניף? כתוב שם או קוד סניף.'),
    }
  }
  const named = resolved.store
  const rows = open.filter(
    (fault) =>
      fault.storeName.includes(named.name) || named.name.includes(fault.storeName),
  )
  const queueHref = `/ops/tickets?store=${encodeURIComponent(named.code)}`
  if (rows.length === 0) {
    return {
      ok: true,
      href: queueHref,
      message: p('agent.openNoneStore', 'אין תקלות פתוחות בסניף {store}. תור: {path}', {
        store: named.name,
        path: queueHref,
      }),
    }
  }
  const lines = rows.slice(0, 8).map((fault) => {
    const number = fault.displayNumber ? `${fault.displayNumber}: ` : ''
    const path = fault.id ? `/ops/tickets/${fault.id}` : queueHref
    return `${number}${fault.summary} → ${path}`
  })
  if (rows.length > 8) {
    lines.push(p('agent.openMore', 'ועוד {count}.', { count: rows.length - 8 }))
  }
  return {
    ok: true,
    href: queueHref,
    message: [
      p('agent.openLead', '{store}: {count} פתוחות.', {
        store: named.name,
        count: rows.length,
      }),
      ...lines,
      p('agent.openQueuePath', 'תור הסניף: {path}', { path: queueHref }),
    ].join('\n'),
  }
}

export function listAwaitingApprovalsText(
  spends: WaitingSpendHint[],
  locale: Locale,
): { message: string; href: string; count: number; ok: boolean } {
  const p = (key: string, he: string, vars?: Record<string, string | number>) =>
    agentPhrase(locale, key, he, vars)
  const href = '/ops/approvals'
  if (spends.length === 0) {
    return {
      ok: true,
      count: 0,
      href,
      message: p('agent.approvalsNone', 'אין הוצאה שממתינה לאישור. אישורים: {path}', {
        path: href,
      }),
    }
  }
  const lines = spends.slice(0, 8).map((spend) => {
    const vendor = spend.vendorName ? ` · ${spend.vendorName}` : ''
    const status =
      spend.status === 'needs_info'
        ? p('agent.approvalNeedsInfo', 'מבקשים מידע')
        : p('agent.approvalPending', 'ממתין')
    return `${spend.storeName}: ${formatIls(spend.amount)} — ${spend.reason}${vendor} (${status})`
  })
  if (spends.length > 8) {
    lines.push(p('agent.approvalsMore', 'ועוד {count}.', { count: spends.length - 8 }))
  }
  return {
    ok: true,
    count: spends.length,
    href,
    message: [
      p('agent.approvalsLead', '{count} ממתינות לאישור:', { count: spends.length }),
      ...lines,
      p('agent.approvalsPath', 'אישורים: {path}', { path: href }),
    ].join('\n'),
  }
}

export function setSpendDecisionText(input: {
  spends: WaitingSpendHint[]
  decision: 'approved' | 'rejected' | 'needs_info'
  spendId?: string | null
  storeHint?: string | null
  locale: Locale
}): { ok: boolean; message: string; href: string | null; spendId?: string } {
  const { spends, decision, locale } = input
  const p = (key: string, he: string, vars?: Record<string, string | number>) =>
    agentPhrase(locale, key, he, vars)
  const href = '/ops/approvals'
  let pool = spends
  const spendId = input.spendId?.trim()
  if (spendId) {
    pool = spends.filter((row) => row.id === spendId)
  } else if (input.storeHint?.trim()) {
    const hit = storeHits(input.storeHint)
    if (hit.kind === 'many') {
      return { ok: false, message: clarifyStores(hit.stores, locale), href: null }
    }
    if (hit.kind === 'one') {
      pool = spends.filter(
        (row) =>
          row.storeName.includes(hit.store.name) ||
          hit.store.name.includes(row.storeName) ||
          row.storeName.includes(hit.store.city),
      )
    } else {
      const q = input.storeHint.trim()
      pool = spends.filter(
        (row) => row.storeName.includes(q) || row.reason.includes(q),
      )
    }
  }
  if (pool.length === 0) {
    return {
      ok: false,
      href,
      message: p(
        'agent.spendNotFound',
        'לא מצאתי הוצאה ממתינה להתאמה. מה הסניף או הסכום?',
      ),
    }
  }
  if (pool.length > 1) {
    const names = pool
      .slice(0, 3)
      .map((row) => `${row.storeName} ${formatIls(row.amount)}`)
      .join(' / ')
    return {
      ok: false,
      href: null,
      message: p('agent.whichSpend', 'איזו הוצאה? {names}', { names }),
    }
  }
  const target = pool[0]!
  try {
    applySpendDecision(target.id, decision, 'ארי')
    const verdict =
      decision === 'approved'
        ? p('agent.spendApproved', 'אישרתי')
        : decision === 'rejected'
          ? p('agent.spendRejected', 'דחיתי')
          : p('agent.spendNeedsInfo', 'ביקשתי מידע נוסף על')
    return {
      ok: true,
      href,
      spendId: target.id,
      message: p(
        'agent.spendDecided',
        '{verdict} את ההוצאה ב{store}: {reason} ({amount}). אישורים: {path}',
        {
          verdict,
          store: target.storeName,
          reason: target.reason,
          amount: formatIls(target.amount),
          path: href,
        },
      ),
    }
  } catch {
    return {
      ok: false,
      href,
      message: p('agent.spendFailed', 'לא הצלחתי לעדכן את ההוצאה.'),
    }
  }
}

export function findBookProText(input: {
  professionals: BookProHint[]
  category?: string | null
  city?: string | null
  name?: string | null
  locale: Locale
}): { ok: boolean; message: string; href: string; count: number } {
  const { locale } = input
  const p = (key: string, he: string, vars?: Record<string, string | number>) =>
    agentPhrase(locale, key, he, vars)
  const href = '/ops/professionals'
  let rows = [...input.professionals]
  const rawCategory = input.category?.trim() ?? ''
  const category = rawCategory
    ? categoryFromHint(rawCategory) ??
      (normalizeTicketCategory(rawCategory) === 'other' && !/^[a-z_]+$/i.test(rawCategory)
        ? null
        : normalizeTicketCategory(rawCategory))
    : null
  if (category && category !== 'other') {
    const matched = matchProfessionalsForFault(
      rows.map(
        (pro): FaultPro => ({
          id: pro.id,
          full_name: pro.name,
          phone: pro.phone,
          trade: pro.trade,
          notes: pro.notes,
          use_count: pro.useCount,
        }),
      ),
      category,
    )
    const ids = new Set(matched.map((row) => row.id))
    rows = rows.filter((pro) => ids.has(pro.id))
  }
  const city = input.city?.trim()
  if (city) {
    rows = rows.filter((pro) => {
      const blob = `${pro.notes ?? ''} ${pro.trade ?? ''} ${pro.name}`.toLowerCase()
      return blob.includes(city.toLowerCase()) || cityMatchesStoreCity(city, blob)
    })
  }
  const name = input.name?.trim()
  if (name && name.length >= 2) {
    rows = rows.filter((pro) => pro.name.includes(name))
  }
  rows = [...rows].sort(
    (a, b) =>
      b.rating - a.rating ||
      b.useCount - a.useCount ||
      a.name.localeCompare(b.name, 'he'),
  )
  if (rows.length === 0) {
    return {
      ok: true,
      count: 0,
      href,
      message: p(
        'agent.bookNone',
        'אין איש מקצוע בספר שמתאים. ספר אנשי מקצוע: {path}',
        { path: href },
      ),
    }
  }
  const lines = rows.slice(0, 5).map((pro) => {
    const trade = pro.trade ? ` · ${pro.trade}` : ''
    const rating =
      pro.rating > 0
        ? p('agent.bookRating', ' · דירוג {rating}/5', { rating: pro.rating })
        : ''
    const uses =
      pro.useCount > 0
        ? p('agent.bookUses', ' · {count} שימושים', { count: pro.useCount })
        : ''
    return `${pro.name}${trade}${rating}${uses}`
  })
  if (rows.length > 5) {
    lines.push(p('agent.bookMore', 'ועוד {count}.', { count: rows.length - 5 }))
  }
  return {
    ok: true,
    count: rows.length,
    href,
    message: [
      p('agent.bookLead', 'מהספר:'),
      ...lines,
      p('agent.bookPath', 'ספר אנשי מקצוע: {path}', { path: href }),
    ].join('\n'),
  }
}

function cityMatchesStoreCity(city: string, blob: string): boolean {
  const q = city.trim()
  if (q.length < 2) return false
  if (/(תל.?אביב|ת״א|ת"א)/.test(q) && /תל.?אביב|ת״א|ת"א|שינקין|אבן גבירול/.test(blob)) {
    return true
  }
  return ISRAEL_STORES.some(
    (store) =>
      (store.city.includes(q) || q.includes(store.city)) &&
      blob.includes(store.city.toLowerCase()),
  )
}

function categoryFromHint(text: string): string | null {
  if (/נזיל|אינסטל|ברז|כיור|leak|plumb/i.test(text)) return 'plumbing'
  if (/מזגן|מיזוג|קירור|hvac|clim/i.test(text)) return 'hvac'
  if (/חשמל|electric/i.test(text)) return 'electrical'
  if (/מנעול|אבטחה|דלת|lock|security/i.test(text)) return 'security'
  if (/קופה|מחשב|רשת|\bit\b/i.test(text)) return 'it'
  if (/ניקיון|clean/i.test(text)) return 'cleaning'
  return null
}

export function recommendBundlesText(
  cards: BundleCard[],
  locale: Locale,
  storeHint?: string | null,
): { ok: boolean; message: string; href: string | null; count: number } {
  const p = (key: string, he: string, vars?: Record<string, string | number>) =>
    agentPhrase(locale, key, he, vars)
  let rows = cards.filter((card) => card.kind === 'bundle' || card.kind === 'prevention')
  if (storeHint?.trim()) {
    const hit = storeHits(storeHint)
    if (hit.kind === 'many') {
      return { ok: false, message: clarifyStores(hit.stores, locale), href: null, count: 0 }
    }
    if (hit.kind === 'one') {
      rows = rows.filter(
        (card) =>
          card.storeName.includes(hit.store.name) ||
          hit.store.name.includes(card.storeName),
      )
    } else {
      const q = storeHint.trim()
      rows = rows.filter((card) => card.storeName.includes(q))
    }
  }
  if (rows.length === 0) {
    const urgents = cards.filter((card) => card.kind === 'urgent').slice(0, 2)
    if (urgents.length > 0) {
      return {
        ok: true,
        count: urgents.length,
        href: '/ops/tickets',
        message: [
          p(
            'agent.bundleUrgentOnly',
            'אין חבילה לאיחוד — יש דחוף שמטופל מיד, בלי לחכות.',
          ),
          ...urgents.map((card) => card.sentence),
        ].join('\n'),
      }
    }
    return {
      ok: true,
      count: 0,
      href: '/ops/tickets',
      message: p(
        'agent.bundleNone',
        'אין עכשיו המלצת איחוד. דחוף מטופל מיד, בלי לחכות.',
      ),
    }
  }
  const lines = rows.slice(0, 3).map((card) => {
    const why =
      card.kind === 'prevention'
        ? p('agent.bundleWhyPrevent', 'למה לאחד: התקלה חזרה — ביקור אחד חוסך קריאה נוספת.')
        : card.professionalName
          ? p(
              'agent.bundleWhyPro',
              'למה לאחד: {name} יכול לטפל בכולן בביקור אחד.',
              { name: card.professionalName },
            )
          : p(
              'agent.bundleWhySame',
              'למה לאחד: אותה קטגוריה באותו סניף — ביקור אחד במקום כמה.',
            )
    const cost =
      card.costLine && card.costLine !== 'אין עדיין מחיר' ? `\n${card.costLine}` : ''
    return `${card.sentence}\n${why}${cost}`
  })
  return {
    ok: true,
    count: rows.length,
    href: '/ops/tickets',
    message: lines.join('\n\n'),
  }
}

export function estimateRepairRangeText(input: {
  bands: PriceBand[]
  category?: string | null
  locale: Locale
}): { ok: boolean; message: string; grounded: boolean } {
  const { locale } = input
  const p = (key: string, he: string, vars?: Record<string, string | number>) =>
    agentPhrase(locale, key, he, vars)
  const rawCategory = input.category?.trim() ?? ''
  const category = rawCategory
    ? categoryFromHint(rawCategory) ??
      (normalizeTicketCategory(rawCategory) === 'other' && !/^[a-z_]+$/i.test(rawCategory)
        ? null
        : normalizeTicketCategory(rawCategory))
    : null
  let bands = input.bands
  if (category) bands = bands.filter((band) => band.category === category)
  if (bands.length > 0) {
    const lines = bands.map((band) => {
      const label = categoryLabel(band.category, locale)
      const money =
        band.low === band.high
          ? formatIls(band.low)
          : `${formatIls(band.low)}–${formatIls(band.high)}`
      return p(
        'agent.rangeRecorded',
        '{label}: {money} (לפי מחיר שנרשם)',
        { label, money },
      )
    })
    return {
      ok: true,
      grounded: true,
      message: [
        p(
          'agent.rangeLead',
          'הטווח הוא הקצוות של מחירים שכבר נרשמו מאותו סוג.',
        ),
        ...lines,
      ].join('\n'),
    }
  }
  if (category) {
    return {
      ok: true,
      grounded: true,
      message: repairRangeLine(category, null),
    }
  }
  return {
    ok: false,
    grounded: true,
    message: p(
      'agent.rangeNeedCategory',
      'לאיזו קטגוריה להעריך טווח? מיזוג / נזילה / חשמל…',
    ),
  }
}

const NOUN: Record<Locale, Record<string, string>> = {
  he: {
    plumbing: 'נזילות',
    hvac: 'תקלות מיזוג',
    electrical: 'תקלות חשמל',
    security: 'תקלות אבטחה',
    it: 'תקלות מחשוב',
    cleaning: 'עבודות ניקיון',
    other: 'תקלות',
  },
  en: {
    plumbing: 'leaks',
    hvac: 'HVAC faults',
    electrical: 'electrical faults',
    security: 'security faults',
    it: 'IT faults',
    cleaning: 'cleaning jobs',
    other: 'faults',
  },
  fr: {
    plumbing: 'fuites',
    hvac: 'pannes de climatisation',
    electrical: 'pannes électriques',
    security: 'pannes de sécurité',
    it: 'pannes informatiques',
    cleaning: 'travaux de nettoyage',
    other: 'pannes',
  },
}

function categoryLabel(category: string, locale: Locale): string {
  return NOUN[locale][category] ?? NOUN[locale].other ?? category
}

export function waitingSpendsFrom(spends: SpendRequest[]): WaitingSpendHint[] {
  return spends
    .filter((spend) => spend.status === 'pending' || spend.status === 'needs_info')
    .map((spend) => ({
      id: spend.id,
      storeName: spend.storeName || spend.storeCode || 'סניף',
      reason: spend.reason,
      amount: spend.requestedAmount,
      status: spend.status as 'pending' | 'needs_info',
      vendorName: spend.vendorName,
    }))
}

export function bookProsFrom(professionals: Professional[]): BookProHint[] {
  return professionals
    .filter((pro) => pro.is_active !== false)
    .map((pro) => {
      const rating = parsePersonalRating(pro.notes).rating
      return {
        id: pro.id,
        name: pro.full_name,
        phone: pro.phone,
        trade: pro.trade,
        notes: pro.notes,
        rating,
        useCount: pro.use_count ?? 0,
      }
    })
}

export function buildAriTools(input: {
  locale: Locale
  open: OpenFaultHint[]
  papers?: DuePaper[]
  waitingSpends?: WaitingSpendHint[]
  bookPros?: BookProHint[]
  cards?: BundleCard[]
  bands?: PriceBand[]
  source: 'web_fallback' | 'whatsapp'
  collectLink: (link: AriLink) => void
}) {
  const {
    locale,
    open,
    papers = [],
    waitingSpends = [],
    bookPros = [],
    cards = [],
    bands = [],
    source,
    collectLink,
  } = input
  const p = (he: string, vars?: Record<string, string | number>) =>
    phrase(locale, he, vars)
  const ap = (key: string, he: string, vars?: Record<string, string | number>) =>
    agentPhrase(locale, key, he, vars)

  return {
    set_urgent: tool({
      description:
        'Mark an open fault as urgent or not urgent for a store Ari named.',
      inputSchema: z.object({
        store: z.string().describe('Store name or code'),
        urgent: z.boolean().describe('true = urgent, false = clear urgency'),
      }),
      execute: async ({ store, urgent }) => {
        const hit = faultHits(open, store)
        if (hit.kind === 'many') {
          return { ok: false, message: clarifyFaults(hit.faults, locale) }
        }
        const storeHit = storeHits(store)
        if (storeHit.kind === 'many') {
          return { ok: false, message: clarifyStores(storeHit.stores, locale) }
        }
        const target = hit.kind === 'one' ? hit.fault : null
        if (!target?.id) {
          return { ok: false, message: p('איזו תקלה לסמן? כתוב את שם הסניף.') }
        }
        await setTicketUrgent(target.id, urgent, null)
        return {
          ok: true,
          message: urgent
            ? p('סימנתי את התקלה ב{store} כדחופה.', { store: target.storeName })
            : p('הורדתי את הדחיפות ב{store}.', { store: target.storeName }),
        }
      },
    }),
    create_ticket: tool({
      description: 'Open a new fault ticket for a store with a short description.',
      inputSchema: z.object({
        store: z.string().describe('Store name or code'),
        description: z.string().min(3).describe('What happened'),
        priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      }),
      execute: async ({ store, description, priority }) => {
        const resolved = resolveStoreMessage(store, locale)
        if (!resolved.store) {
          return { ok: false, message: resolved.message ?? p('באיזה סניף לפתוח את התקלה?') }
        }
        const named = resolved.store
        try {
          const classified = classifyFaultText(description)
          const category = normalizeTicketCategory(classified.category)
          const created = await createTicket({
            storeCode: named.code,
            description,
            title: description.slice(0, 80),
            category,
            priority: priority ?? classified.priority,
            source,
            reporterName: 'ארי',
            language: locale,
          })
          const number =
            created.display_number || formatDisplayNumber(created.number) || ''
          collectLink({
            href: `/ops/tickets/${created.id}`,
            label: number || p('לתקלה'),
          })
          return {
            ok: true,
            message: p('פתחתי תקלה ב{store}: {description}.', {
              store: named.name,
              description,
            }),
            ticketId: created.id,
            displayNumber: number || null,
            category,
            priority: priority ?? classified.priority,
          }
        } catch {
          return { ok: false, message: p('לא הצלחתי לפתוח את התקלה.') }
        }
      },
    }),
    create_task: tool({
      description:
        'Create an ops task / reminder for Ari. Supports due date and repeat cadence (days).',
      inputSchema: z.object({
        title: z.string().min(3).describe('Task title'),
        store: z.string().optional().describe('Optional store name or code'),
        dueAt: z
          .string()
          .optional()
          .describe('Optional due date ISO or YYYY-MM-DD'),
        repeatDays: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Optional repeat every N days (30 / 90 / 365)'),
      }),
      execute: async ({ title, store, dueAt, repeatDays }) => {
        if (store?.trim()) {
          const hit = storeHits(store)
          if (hit.kind === 'many') {
            return { ok: false, message: clarifyStores(hit.stores, locale) }
          }
        }
        const named = store ? findStore(store) : null
        const due = normalizeDueAt(dueAt ?? null)
        const repeat =
          repeatDays != null && Number.isFinite(repeatDays) && repeatDays > 0
            ? Math.floor(repeatDays)
            : null
        const created = addTask({
          title: title.slice(0, 200),
          storeId: named ? israelStoreId(named.stableKey ?? named.code) : null,
          storeCode: named?.code ?? null,
          assignee: null,
          dueAt: due,
          ticketId: null,
          documentId: null,
          spendId: null,
          needsClarification: false,
          clarification: null,
          repeatDays: repeat,
        })
        await persistOpsLedger().catch(() => undefined)
        collectLink({ href: `/ops/tasks#task-${created.id}`, label: p('למשימה') })
        const base = named
          ? p('רשמתי משימה: {title}. בסניף {store}.', {
              title,
              store: named.name,
            })
          : p('רשמתי משימה: {title}.', { title })
        const extras = [
          due
            ? ap('agent.taskDue', 'לתאריך {due}.', { due: due.slice(0, 10) })
            : '',
          repeat
            ? ap('agent.taskRepeat', 'חוזר כל {days} ימים.', { days: repeat })
            : '',
        ]
          .filter(Boolean)
          .join(' ')
        return {
          ok: true,
          message: extras ? `${base} ${extras}` : base,
          taskId: created.id,
          dueAt: due,
          repeatDays: repeat,
        }
      },
    }),
    summarize_due_papers: tool({
      description:
        'Summarize store documents that are overdue or due soon from the live ops snapshot.',
      inputSchema: z.object({
        store: z.string().optional().describe('Optional store filter'),
      }),
      execute: async ({ store }) => {
        const summary = summarizeDuePapersText(papers, locale, store)
        collectLink({
          href: summary.href,
          label: ap('agent.documentsLink', 'מסמכים'),
        })
        return { ok: true, message: summary.message, href: summary.href, count: summary.count }
      },
    }),
    list_open_by_store: tool({
      description:
        'List open faults for one store with ticket and queue path hints.',
      inputSchema: z.object({
        store: z.string().describe('Store name or code'),
      }),
      execute: async ({ store }) => {
        const summary = listOpenByStoreText(open, store, locale)
        if (summary.href) {
          collectLink({
            href: summary.href,
            label: ap('agent.queueLink', 'לתור הסניף'),
          })
        }
        return {
          ok: summary.ok,
          message: summary.message,
          href: summary.href,
        }
      },
    }),
    list_awaiting_approvals: tool({
      description:
        'List spends / approvals waiting for Ari, with link to /ops/approvals.',
      inputSchema: z.object({}),
      execute: async () => {
        const summary = listAwaitingApprovalsText(waitingSpends, locale)
        collectLink({
          href: summary.href,
          label: ap('agent.approvalsLink', 'לאישורים'),
        })
        return {
          ok: summary.ok,
          message: summary.message,
          href: summary.href,
          count: summary.count,
        }
      },
    }),
    set_spend_decision: tool({
      description:
        'Approve, reject, or request more info on a waiting spend (HQ/Ari only). Clarify when more than one match.',
      inputSchema: z.object({
        decision: z.enum(['approved', 'rejected', 'needs_info']),
        spendId: z.string().optional().describe('Spend id when known'),
        store: z.string().optional().describe('Store name/code to disambiguate'),
      }),
      execute: async ({ decision, spendId, store }) => {
        const result = setSpendDecisionText({
          spends: waitingSpends,
          decision,
          spendId,
          storeHint: store,
          locale,
        })
        if (result.href) {
          collectLink({
            href: result.href,
            label: ap('agent.approvalsLink', 'לאישורים'),
          })
        }
        await persistOpsLedger().catch(() => undefined)
        return {
          ok: result.ok,
          message: result.message,
          href: result.href,
          spendId: result.spendId,
        }
      },
    }),
    find_book_pro: tool({
      description:
        'Search the professionals book by trade/category, city, or name. Includes personal rating when set.',
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe('Fault category or trade hint (hvac / plumbing / מיזוג)'),
        city: z.string().optional().describe('City filter e.g. תל אביב'),
        name: z.string().optional().describe('Professional name fragment'),
      }),
      execute: async ({ category, city, name }) => {
        const summary = findBookProText({
          professionals: bookPros,
          category,
          city,
          name,
          locale,
        })
        collectLink({
          href: summary.href,
          label: ap('agent.bookLink', 'לספר אנשי מקצוע'),
        })
        return {
          ok: summary.ok,
          message: summary.message,
          href: summary.href,
          count: summary.count,
        }
      },
    }),
    recommend_bundles: tool({
      description:
        'Recommend which open faults to combine into one visit, with a Hebrew why-combine line.',
      inputSchema: z.object({
        store: z.string().optional().describe('Optional store filter'),
      }),
      execute: async ({ store }) => {
        const summary = recommendBundlesText(cards, locale, store)
        if (summary.href) {
          collectLink({
            href: summary.href,
            label: ap('agent.queueLink', 'לתור'),
          })
        }
        return {
          ok: summary.ok,
          message: summary.message,
          href: summary.href,
          count: summary.count,
        }
      },
    }),
    estimate_repair_range: tool({
      description:
        'Estimate repair price range from recorded category bands only — never invent numbers.',
      inputSchema: z.object({
        category: z
          .string()
          .optional()
          .describe('Fault category (hvac / plumbing / מיזוג)'),
      }),
      execute: async ({ category }) => {
        const summary = estimateRepairRangeText({ bands, category, locale })
        return {
          ok: summary.ok,
          message: summary.message,
          grounded: summary.grounded,
        }
      },
    }),
    draft_engagement: tool({
      description:
        'Lock a professional engagement (name/phone/amount) on an open fault — same path as the ticket UI.',
      inputSchema: z.object({
        store: z.string().describe('Store with the open fault'),
        name: z.string().min(2).describe('Professional name'),
        phone: z.string().min(9).describe('Professional phone'),
        amount: z.number().positive().optional().describe('Approved amount ILS'),
      }),
      execute: async ({ store, name, phone, amount }) => {
        const storeHit = storeHits(store)
        if (storeHit.kind === 'many') {
          return { ok: false, message: clarifyStores(storeHit.stores, locale) }
        }
        const hit = faultHits(open, store)
        if (hit.kind === 'many') {
          return { ok: false, message: clarifyFaults(hit.faults, locale) }
        }
        if (hit.kind !== 'one' || !hit.fault.id) {
          return {
            ok: false,
            message: ap(
              'agent.engageNeedFault',
              'באיזו תקלה לנעול שיבוץ? כתוב סניף עם תקלה פתוחה אחת.',
            ),
          }
        }
        try {
          const locked = await lockEngagement({
            ticketId: hit.fault.id,
            professionalName: name,
            professionalPhone: phone,
            approvedAmount: amount,
            approvedBy: 'ארי',
          })
          collectLink({
            href: `/ops/tickets/${hit.fault.id}`,
            label: hit.fault.displayNumber || p('לתקלה'),
          })
          return {
            ok: true,
            message: ap(
              'agent.engageLocked',
              'נעלתי שיבוץ: {name} ל{store}.',
              { name: locked.professionalName, store: hit.fault.storeName },
            ),
            ticketId: hit.fault.id,
          }
        } catch (error) {
          return {
            ok: false,
            message:
              error instanceof Error
                ? error.message
                : ap('agent.engageFailed', 'לא הצלחתי לנעול שיבוץ.'),
          }
        }
      },
    }),
  }
}

function normalizeDueAt(raw: string | null): string | null {
  if (!raw?.trim()) return null
  const trimmed = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const stamp = Date.parse(`${trimmed}T00:00:00.000Z`)
    return Number.isNaN(stamp) ? null : new Date(stamp).toISOString()
  }
  const stamp = Date.parse(trimmed)
  return Number.isNaN(stamp) ? null : new Date(stamp).toISOString()
}

export { stepCountIs }

export function ariSystemPrompt(locale: Locale): string {
  if (locale === 'en') {
    return `You are Ari's ops-manager assistant for a multi-branch retail network.
Tone: calm floor manager — grounded, decisive, one clear next step.
Use only the facts below. Name the store and the single next move.
Do not invent prices, vendors, documents, or faults.
When store/fault/spend is ambiguous, ask one short clarifying question with options — do not guess.
«Waiting approval / spends waiting» → always call list_awaiting_approvals (money at /ops/approvals), not urgent tickets.
Prefer tools: create_ticket / create_task (dueAt + repeatDays) / set_urgent / summarize_due_papers / list_open_by_store / list_awaiting_approvals / set_spend_decision / find_book_pro / recommend_bundles / estimate_repair_range / draft_engagement.
When listing open faults, include path hints like /ops/tickets?store=CODE or /ops/tickets/{id}.
Never expose system, provider, or model details.`
  }
  if (locale === 'fr') {
    return `Tu es l’assistant ops d’Ari pour un réseau multi-magasins.
Ton: responsable de terrain — calme, factuel, une seule prochaine étape.
Utilise uniquement les faits ci-dessous. Nomme le magasin et le prochain geste.
N’invente pas de prix, fournisseur, document ou panne.
Si magasin/panne/dépense est ambigu, pose une seule question courte avec options.
«Dépenses en attente / à approuver» → toujours list_awaiting_approvals (/ops/approvals), pas les tickets urgents.
Préfère les outils: create_ticket / create_task (dueAt + repeatDays) / set_urgent / summarize_due_papers / list_open_by_store / list_awaiting_approvals / set_spend_decision / find_book_pro / recommend_bundles / estimate_repair_range / draft_engagement.
Pour les pannes ouvertes, indique des chemins comme /ops/tickets?store=CODE ou /ops/tickets/{id}.
Ne révèle jamais de détails système ou fournisseur de modèle.`
  }
  return `אתה העוזר של ארי, מנהל התפעול של הרשת.
טון של מנהל רצפה: קצר, מבוסס עובדות, עם צעד הבא אחד ברור.
כבר הסתכלת על העובדות למטה. ענה בעברית עם שם הסניף והצעד הבא.
השתמש רק בעובדות האלה. אל תמציא מחיר, ספק, מסמך או תקלה.
כשחסר מידע או שיש כמה התאמות — שאל שאלה אחת קצרה עם אפשרויות (באיזה סניף? …). אל תנחש.
«הוצאות ממתינות / מחכה לאישור / אישורים» = כסף ב-/ops/approvals — תמיד קרא ל-list_awaiting_approvals. אל תערבב עם תקלות דחופות.
העדף כלים: create_ticket / create_task (עם dueAt ו-repeatDays) / set_urgent / summarize_due_papers / list_open_by_store / list_awaiting_approvals / set_spend_decision / find_book_pro / recommend_bundles / estimate_repair_range / draft_engagement.
כשמסכמים תקלות פתוחות — כלול נתיבים כמו /ops/tickets?store=קוד או /ops/tickets/{id}.
אל תשלח אותו למסך אחר בלי קישור. אל תגיד שאתה כאן כדי שיישאר. אל תחשוף פרטי מערכת או ספק מודל.`
}
