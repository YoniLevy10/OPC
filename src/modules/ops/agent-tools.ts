import { tool, stepCountIs } from 'ai'
import { z } from 'zod'
import type { Locale } from '@/lib/i18n/locale'
import { phrase } from '@/lib/i18n/phrases'
import { persistOpsLedger } from '@/lib/data/ops-db'
import { addTask } from '@/lib/data/ops-ledger'
import { ISRAEL_STORES, israelStoreId } from '@/modules/stores/israel-stores'
import { classifyFaultText } from '@/modules/tickets/classify'
import { normalizeTicketCategory } from '@/modules/tickets/constants'
import {
  createTicket,
  formatDisplayNumber,
  setTicketUrgent,
} from '@/modules/tickets/service'
import type { AriLink, OpenFaultHint } from '@/modules/ops/agent-actions'
import type { DuePaper } from '@/modules/ops/agent-chat'

function findStore(storeHint: string) {
  const q = storeHint.trim()
  if (!q) return null
  const hits = ISRAEL_STORES.filter(
    (store) =>
      store.name.includes(q) ||
      q.includes(store.name) ||
      store.code === q ||
      store.city === q,
  )
  return hits.length === 1 ? hits[0]! : null
}

function findFault(open: OpenFaultHint[], storeHint?: string | null) {
  const pool = open.filter((fault) => fault.id)
  if (!storeHint?.trim()) return pool.length === 1 ? pool[0]! : null
  const store = findStore(storeHint)
  if (!store) return null
  const match = pool.filter(
    (fault) =>
      fault.storeName.includes(store.name) || store.name.includes(fault.storeName),
  )
  return match.length === 1 ? match[0]! : null
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
  const named = findStore(storeHint)
  if (!named) {
    return {
      ok: false,
      href: null,
      message: p('agent.whichStoreOpen', 'באיזה סניף? כתוב שם או קוד סניף.'),
    }
  }
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

export function buildAriTools(input: {
  locale: Locale
  open: OpenFaultHint[]
  papers?: DuePaper[]
  source: 'web_fallback' | 'whatsapp'
  collectLink: (link: AriLink) => void
}) {
  const { locale, open, papers = [], source, collectLink } = input
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
        const target = findFault(open, store)
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
        const named = findStore(store)
        if (!named) {
          return { ok: false, message: p('באיזה סניף לפתוח את התקלה?') }
        }
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
Prefer tools: create_ticket / create_task (with dueAt + repeatDays when asked) / set_urgent / summarize_due_papers / list_open_by_store.
When listing open faults, include path hints like /ops/tickets?store=CODE or /ops/tickets/{id}.
Never expose system, provider, or code details.`
  }
  if (locale === 'fr') {
    return `Tu es l’assistant ops d’Ari pour un réseau multi-magasins.
Ton: responsable de terrain — calme, factuel, une seule prochaine étape.
Utilise uniquement les faits ci-dessous. Nomme le magasin et le prochain geste.
N’invente pas de prix, fournisseur, document ou panne.
Préfère les outils: create_ticket / create_task (dueAt + repeatDays si demandé) / set_urgent / summarize_due_papers / list_open_by_store.
Pour les pannes ouvertes, indique des chemins comme /ops/tickets?store=CODE ou /ops/tickets/{id}.
Ne révèle jamais de détails techniques système.`
  }
  return `אתה העוזר של ארי, מנהל התפעול של הרשת.
טון של מנהל רצפה: קצר, מבוסס עובדות, עם צעד הבא אחד ברור.
כבר הסתכלת על העובדות למטה. ענה בעברית עם שם הסניף והצעד הבא.
השתמש רק בעובדות האלה. אל תמציא מחיר, ספק, מסמך או תקלה.
מסמך באיחור וציוד שחזר כלולים בעובדות. מחיר של ציוד רק אם הוא רשום שם.
העדף כלים: create_ticket / create_task (עם dueAt ו-repeatDays כשמבקשים) / set_urgent / summarize_due_papers / list_open_by_store.
כשמסכמים תקלות פתוחות — כלול נתיבים כמו /ops/tickets?store=קוד או /ops/tickets/{id}.
אל תשלח אותו למסך אחר בלי קישור. אל תגיד שאתה כאן כדי שיישאר. אל תחשוף פרטי מערכת.`
}
