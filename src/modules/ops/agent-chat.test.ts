import { beforeEach, describe, expect, it } from 'vitest'
import type { BundleCard } from '@/modules/whatsapp/agent/bundle'
import type { StoreDocument } from '@/modules/documents/rules'
import {
  answerFromSnapshot,
  briefForAri,
  duePapersFrom,
  harvestOpsLinks,
  repeatGearFrom,
  shouldShortCircuitPapersGear,
  type GearAsset,
  type GearTicket,
  type OpsSnapshot,
} from './agent-chat'
import {
  ariSystemPrompt,
  estimateRepairRangeText,
  findBookProText,
  listAwaitingApprovalsText,
  listOpenByStoreText,
  recommendBundlesText,
  setSpendDecisionText,
  summarizeDuePapersText,
} from './agent-tools'
import { createSpend, listSpends, resetOpsLedger } from '@/lib/data/ops-ledger'
import { formatPersonalRating } from '@/modules/notes/personal-rating'
import { resetAriWaMemory, rememberAriWaExchange, recentAriWaTurns } from './agent-wa-memory'

function card(partial: Partial<BundleCard>): BundleCard {
  return {
    id: 'bundle:1',
    kind: 'bundle',
    storeId: 's1',
    storeName: 'דיזנגוף',
    category: 'plumbing',
    ticketIds: ['a', 'b'],
    sentence: '2 נזילות בסניף דיזנגוף. אנדי יכול לטפל בכולן בביקור אחד.',
    costLine: 'אין עדיין מחיר',
    professionalName: 'אנדי',
    professionalId: 'p1',
    professionalSource: 'book',
    ...partial,
  }
}

const snapshot: OpsSnapshot = {
  open: [
    {
      id: 'a',
      storeName: 'דיזנגוף',
      category: 'plumbing',
      summary: 'ברז בשירותים',
      displayNumber: 'OC-12',
    },
    {
      id: 'b',
      storeName: 'דיזנגוף',
      category: 'plumbing',
      summary: 'כיור במטבח',
      displayNumber: 'OC-13',
    },
    {
      id: 'c',
      storeName: 'חיפה',
      category: 'hvac',
      summary: 'המזגן לא מקרר',
      displayNumber: 'OC-14',
    },
  ],
  cards: [card({})],
}

describe('answerFromSnapshot', () => {
  it('quotes the bundle it actually computed', () => {
    const reply = answerFromSnapshot('מה כדאי לאחד?', snapshot)
    expect(reply).toContain('2 נזילות')
    expect(reply).toContain('אנדי')
  })

  it('lists the faults of a named store', () => {
    const reply = answerFromSnapshot('מה פתוח בדיזנגוף?', snapshot)
    expect(reply).toContain('OC-12')
    expect(reply).toContain('ברז')
    expect(reply).not.toContain('המזגן')
  })

  it('names the store that actually needs him when the question names another', () => {
    const reply = answerFromSnapshot('מה קורה באילת?', snapshot)
    expect(reply).toContain('דיזנגוף')
    expect(reply).not.toContain('אילת')
  })

  it('answers the worst store and then stays on it', () => {
    const live: OpsSnapshot = {
      ...snapshot,
      open: snapshot.open.map((fault) =>
        fault.id === 'c' ? { ...fault, overdue: true, verb: 'לשייך', assigned: false } : fault,
      ),
    }
    const first = answerFromSnapshot('איזה סניף הכי דחוף?', live)
    expect(first).toContain('חיפה')
    expect(first).toContain('המזגן')
    const more = answerFromSnapshot('תיתן לי קצת יותר מידע', live, 'he', [
      { role: 'assistant', text: first },
    ])
    expect(more).toContain('חיפה')
    expect(more).toContain('המזגן')
    expect(more).not.toContain('בדשבורד')
  })

  it('says the floor is quiet when nothing is open', () => {
    expect(answerFromSnapshot('מה המצב?', { open: [], cards: [] })).toBe(
      'אין תקלות פתוחות. הכל שקט.',
    )
  })

  it('answers the same facts in English', () => {
    const reply = answerFromSnapshot("What's open?", snapshot, 'en')
    expect(reply).toContain('3 open')
    expect(reply).toContain('leaks')
    expect(reply).toContain('אנדי')
  })

  it('gives a range only from recorded prices of that fault type', () => {
    const reply = answerFromSnapshot('מה טווח המחיר למיזוג?', {
      ...snapshot,
      bands: [
        { category: 'hvac', low: 2400, high: 4100 },
        { category: 'electrical', low: 1800, high: 1800 },
      ],
    })
    expect(reply).toContain('₪2,400–₪4,100')
    expect(reply).not.toContain('₪1,800')
    expect(reply).not.toContain('כ־')
  })

  it('says there is no range when nothing was recorded', () => {
    expect(answerFromSnapshot('כמה זה יעלה?', snapshot)).toContain('אין טווח')
  })

  it('answers a bundle question in French', () => {
    const reply = answerFromSnapshot('Que faut-il regrouper ?', snapshot, 'fr')
    expect(reply).toContain('fuites')
    expect(reply).toContain('אנדי')
    expect(reply).toContain('visite')
  })

  it('names an overdue document even when nothing is open', () => {
    const reply = answerFromSnapshot('מה המצב?', {
      open: [],
      cards: [],
      papers: [{ storeName: 'דיזנגוף', label: 'כיבוי אש', overdue: true }],
    })
    expect(reply).toContain('כיבוי אש')
    expect(reply).toContain('באיחור')
    expect(reply).not.toContain('הכל שקט')
  })

  it('names repeating equipment and a price only when one was recorded', () => {
    const priced = answerFromSnapshot('איזה ציוד חוזר?', {
      open: [],
      cards: [],
      gear: [
        {
          storeName: 'חיפה',
          name: 'מזגן מרכזי',
          times: 3,
          openSummary: 'לא מקרר',
          cost: 2400,
        },
      ],
    })
    expect(priced).toContain('מזגן מרכזי')
    expect(priced).toContain('3')
    expect(priced).toContain('₪2,400')
    const bare = answerFromSnapshot('איזה ציוד חוזר?', {
      open: [],
      cards: [],
      gear: [
        {
          storeName: 'חיפה',
          name: 'מזגן מרכזי',
          times: 3,
          openSummary: 'לא מקרר',
          cost: null,
        },
      ],
    })
    expect(bare).toContain('מזגן מרכזי')
    expect(bare).not.toContain('₪')
  })

  it('adds the store document when he asks about that store', () => {
    const reply = answerFromSnapshot('מה פתוח בדיזנגוף?', {
      ...snapshot,
      papers: [{ storeName: 'דיזנגוף', label: 'טימפנומטר', overdue: false }],
    })
    expect(reply).toContain('טימפנומטר')
    expect(reply).toContain('פחות מחודש')
    expect(reply).not.toContain('המזגן')
  })
})

const NOW = new Date('2026-11-01T00:00:00.000Z')

function paper(partial: Partial<StoreDocument>): StoreDocument {
  return {
    id: 'd1',
    storeId: 's1',
    storeCode: '1',
    storeName: 'דיזנגוף',
    docType: 'fire',
    sourceUrl: null,
    extractedExpiry: '2026-10-01T00:00:00.000Z',
    computedNextCheck: null,
    owner: null,
    intakeStatus: 'ingested',
    intakeReason: null,
    version: 1,
    previousId: null,
    renewed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('duePapersFrom', () => {
  it('keeps overdue and month-ahead documents, and drops the rest', () => {
    const rows = duePapersFrom(
      [
        paper({}),
        paper({
          id: 'd2',
          storeName: 'חיפה',
          docType: 'hearing_a',
          extractedExpiry: '2026-11-20T00:00:00.000Z',
        }),
        paper({ id: 'd3', extractedExpiry: '2027-06-01T00:00:00.000Z' }),
        paper({ id: 'd4', renewed: true }),
      ],
      NOW,
    )
    expect(rows.map((row) => row.label)).toEqual(['כיבוי אש', 'טימפנומטר'])
    expect(rows[0]?.overdue).toBe(true)
    expect(rows[1]?.overdue).toBe(false)
  })
})

const asset: GearAsset = {
  id: 'asset-1',
  name: 'מזגן מרכזי',
  storeId: 's1',
  storeName: 'דיזנגוף',
}

function fault(partial: Partial<GearTicket>): GearTicket {
  return {
    id: 't1',
    assetId: 'asset-1',
    storeId: 's1',
    storeName: 'דיזנגוף',
    summary: 'המזגן לא מקרר',
    createdAt: '2026-10-01T00:00:00.000Z',
    status: 'resolved',
    ...partial,
  }
}

describe('briefForAri / ari tools helpers', () => {
  it('grounds the model brief in facts and one next step', () => {
    const brief = briefForAri({
      ...snapshot,
      open: snapshot.open.map((fault) =>
        fault.id === 'c' ? { ...fault, overdue: true, verb: 'לשייך' } : fault,
      ),
      papers: [{ storeName: 'דיזנגוף', label: 'כיבוי אש', overdue: true }],
      waitingSpends: [
        {
          id: 'sp1',
          storeName: 'חיפה',
          reason: 'החלפת מדחס',
          amount: 1800,
          status: 'pending',
          vendorName: null,
        },
      ],
      bookPros: [
        {
          id: 'p1',
          name: 'דני מיזוג',
          phone: '0501111111',
          trade: 'מיזוג אוויר',
          notes: formatPersonalRating(4, 'תל אביב'),
          rating: 4,
          useCount: 3,
        },
      ],
    })
    expect(brief).toContain('עובדות')
    expect(brief).toContain('צעד הבא')
    expect(brief).toContain('חיפה')
    expect(brief).toContain('/ops/tickets/')
    expect(brief).toContain('כיבוי אש')
    expect(brief).toContain('הוצאות ממתינות')
    expect(brief).toContain('דני מיזוג')
    expect(brief).toContain('id=c')
  })

  it('keeps an ops-manager system prompt with tool names', () => {
    expect(ariSystemPrompt('he')).toContain('צעד הבא')
    expect(ariSystemPrompt('he')).toContain('summarize_due_papers')
    expect(ariSystemPrompt('he')).toContain('list_awaiting_approvals')
    expect(ariSystemPrompt('he')).toContain('find_book_pro')
    expect(ariSystemPrompt('he')).toContain('/ops/approvals')
    expect(ariSystemPrompt('en')).toContain('list_open_by_store')
    expect(ariSystemPrompt('he')).toContain('שאלה אחת')
  })

  it('summarizes due papers from the snapshot instead of a stub', () => {
    const summary = summarizeDuePapersText(
      [
        { storeName: 'דיזנגוף', label: 'כיבוי אש', overdue: true },
        { storeName: 'חיפה', label: 'טימפנומטר', overdue: false },
      ],
      'he',
    )
    expect(summary.count).toBe(2)
    expect(summary.message).toContain('כיבוי אש')
    expect(summary.message).toContain('באיחור')
    expect(summary.message).toContain('/ops/documents')
    expect(summary.message).not.toContain('ברשימת העובדות')
  })

  it('lists open faults for a store with queue path hints', () => {
    const summary = listOpenByStoreText(
      [
        {
          id: 'a',
          storeName: 'חדרה',
          summary: 'נזילה בברז',
          displayNumber: 'OC-12',
        },
      ],
      'חדרה',
      'he',
    )
    expect(summary.ok).toBe(true)
    expect(summary.message).toContain('OC-12')
    expect(summary.message).toContain('/ops/tickets/a')
    expect(summary.message).toMatch(/\/ops\/tickets\?store=/)
  })

  it('clarifies when the store hint matches more than one branch', () => {
    const summary = listOpenByStoreText(
      [
        {
          id: 'a',
          storeName: 'תל אביב שינקין',
          summary: 'נזילה',
          displayNumber: 'OC-1',
        },
      ],
      'תל אביב',
      'he',
    )
    expect(summary.ok).toBe(false)
    expect(summary.message).toContain('באיזה סניף?')
    expect(summary.message).toMatch(/שינקין|אבן גבירול/)
  })

  it('lists waiting approvals with a path to /ops/approvals', () => {
    const summary = listAwaitingApprovalsText(
      [
        {
          id: 's1',
          storeName: 'חדרה',
          reason: 'תיקון מזגן',
          amount: 900,
          status: 'pending',
          vendorName: 'דני',
        },
      ],
      'he',
    )
    expect(summary.count).toBe(1)
    expect(summary.message).toContain('חדרה')
    expect(summary.message).toContain('/ops/approvals')
    expect(summary.href).toBe('/ops/approvals')
  })

  it('approves a unique waiting spend and clarifies when ambiguous', () => {
    resetOpsLedger()
    const one = createSpend({
      storeId: 's1',
      storeCode: '6005',
      storeName: 'חדרה',
      ticketId: null,
      reason: 'תיקון מזגן',
      vendorName: null,
      requestedAmount: 900,
      scope: null,
      urgent: false,
      actor: 'test',
    })
    createSpend({
      storeId: 's2',
      storeCode: '6004',
      storeName: 'תל אביב שינקין',
      ticketId: null,
      reason: 'חשמל',
      vendorName: null,
      requestedAmount: 400,
      scope: null,
      urgent: false,
      actor: 'test',
    })
    const waiting = listSpends()
      .filter((row) => row.status === 'pending')
      .map((row) => ({
        id: row.id,
        storeName: row.storeName,
        reason: row.reason,
        amount: row.requestedAmount,
        status: row.status as 'pending' | 'needs_info',
        vendorName: row.vendorName,
      }))
    const ambiguous = setSpendDecisionText({
      spends: waiting,
      decision: 'approved',
      locale: 'he',
    })
    expect(ambiguous.ok).toBe(false)
    expect(ambiguous.message).toContain('איזו הוצאה?')
    const ok = setSpendDecisionText({
      spends: waiting,
      decision: 'approved',
      spendId: one.id,
      locale: 'he',
    })
    expect(ok.ok).toBe(true)
    expect(ok.message).toContain('אישרתי')
    expect(ok.message).toContain('חדרה')
    expect(listSpends().find((row) => row.id === one.id)?.status).toBe('approved')
  })

  it('finds book professionals by trade with rating when present', () => {
    const summary = findBookProText({
      professionals: [
        {
          id: 'p1',
          name: 'יוסי מיזוג',
          phone: '0501234567',
          trade: 'מיזוג אוויר',
          notes: formatPersonalRating(5, 'תל אביב'),
          rating: 5,
          useCount: 4,
        },
        {
          id: 'p2',
          name: 'משה חשמל',
          phone: null,
          trade: 'חשמל',
          notes: null,
          rating: 0,
          useCount: 1,
        },
      ],
      category: 'מיזוג',
      city: 'תל אביב',
      locale: 'he',
    })
    expect(summary.count).toBe(1)
    expect(summary.message).toContain('יוסי מיזוג')
    expect(summary.message).toContain('דירוג 5/5')
    expect(summary.message).toContain('/ops/professionals')
    expect(summary.message).not.toContain('משה חשמל')
  })

  it('recommends bundles with a why-combine line', () => {
    const summary = recommendBundlesText(
      [
        card({
          sentence: '2 נזילות בסניף דיזנגוף. אנדי יכול לטפל בכולן בביקור אחד.',
          professionalName: 'אנדי',
        }),
      ],
      'he',
    )
    expect(summary.count).toBe(1)
    expect(summary.message).toContain('אנדי')
    expect(summary.message).toContain('למה לאחד')
  })

  it('estimates repair range only from recorded bands or kind catalog', () => {
    const grounded = estimateRepairRangeText({
      bands: [{ category: 'hvac', low: 2400, high: 4100 }],
      category: 'מיזוג',
      locale: 'he',
    })
    expect(grounded.ok).toBe(true)
    expect(grounded.grounded).toBe(true)
    expect(grounded.message).toContain('₪2,400')
    expect(grounded.message).toContain('שנרשם')
    const ask = estimateRepairRangeText({ bands: [], locale: 'he' })
    expect(ask.ok).toBe(false)
    expect(ask.message).toContain('קטגוריה')
  })
})

describe('Ari WhatsApp turn memory', () => {
  beforeEach(() => {
    resetAriWaMemory()
  })

  it('keeps the last turns for continuous context', () => {
    rememberAriWaExchange('wa-ari', 'מה פתוח בחדרה?', 'בחדרה יש נזילה.')
    rememberAriWaExchange('wa-ari', 'תפתח על זה משימה', 'רשמתי משימה.')
    const turns = recentAriWaTurns('wa-ari', 6)
    expect(turns).toHaveLength(4)
    expect(turns[0]?.text).toContain('חדרה')
    expect(turns[3]?.text).toContain('משימה')
  })
})

describe('harvestOpsLinks', () => {
  it('keeps tool-collected links and otherwise harvests /ops paths', () => {
    expect(
      harvestOpsLinks('ראה /ops/approvals', [
        { href: '/ops/professionals', label: 'לספר' },
      ]),
    ).toEqual([{ href: '/ops/professionals', label: 'לספר' }])
    const harvested = harvestOpsLinks(
      'אין הוצאות. אישורים: /ops/approvals ותקלה /ops/tickets/abc.',
    )
    expect(harvested.map((row) => row.href)).toEqual([
      '/ops/approvals',
      '/ops/tickets/abc',
    ])
    expect(harvested[0]?.label).toBe('לאישורים')
  })
})

describe('papers/gear short-circuit gate', () => {
  it('skips deterministic shortcut when the model path is active', () => {
    expect(shouldShortCircuitPapersGear('אילו מסמכים לחידוש?', true)).toBe(false)
    expect(shouldShortCircuitPapersGear('אילו מסמכים לחידוש?', false)).toBe(true)
    expect(shouldShortCircuitPapersGear('מה המצב?', false)).toBe(false)
  })

  it('still summarizes papers via the tool helper for the model path', () => {
    const summary = summarizeDuePapersText(
      [{ storeName: 'חדרה', label: 'כיבוי אש', overdue: true }],
      'he',
    )
    expect(summary.message).toContain('כיבוי אש')
    expect(summary.href).toBe('/ops/documents')
  })
})

describe('repeatGearFrom', () => {
  it('counts two faults on the same asset and keeps a recorded price', () => {
    const rows = repeatGearFrom(
      [asset],
      [fault({ id: 't1' }), fault({ id: 't2', status: 'new', summary: 'שוב לא מקרר' })],
      { 'asset-1': 1800 },
      NOW,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ times: 2, cost: 1800, openSummary: 'שוב לא מקרר' })
  })

  it('links a report that names the asset, and stays silent without a price', () => {
    const rows = repeatGearFrom(
      [asset],
      [
        fault({ id: 't1' }),
        fault({ id: 't2', assetId: null, summary: 'המזגן מרכזי נוזל' }),
      ],
      {},
      NOW,
    )
    expect(rows[0]?.times).toBe(2)
    expect(rows[0]?.cost).toBeNull()
  })

  it('ignores a single fault and a cancelled one', () => {
    expect(repeatGearFrom([asset], [fault({ id: 'only' })], {}, NOW)).toEqual([])
    expect(
      repeatGearFrom(
        [asset],
        [fault({ id: 't1' }), fault({ id: 't2', status: 'cancelled' })],
        { 'asset-1': 500 },
        NOW,
      ),
    ).toEqual([])
  })
})
