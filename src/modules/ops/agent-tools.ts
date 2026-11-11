import { tool, stepCountIs } from 'ai'
import { z } from 'zod'
import type { Locale } from '@/lib/i18n/locale'
import { phrase } from '@/lib/i18n/phrases'
import { persistOpsLedger } from '@/lib/data/ops-db'
import { addTask } from '@/lib/data/ops-ledger'
import { ISRAEL_STORES, israelStoreId } from '@/modules/stores/israel-stores'
import {
  createTicket,
  formatDisplayNumber,
  setTicketUrgent,
} from '@/modules/tickets/service'
import type { AriLink, OpenFaultHint } from '@/modules/ops/agent-actions'

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

export function buildAriTools(input: {
  locale: Locale
  open: OpenFaultHint[]
  source: 'web_fallback' | 'whatsapp'
  collectLink: (link: AriLink) => void
}) {
  const { locale, open, source, collectLink } = input
  const p = (he: string, vars?: Record<string, string | number>) =>
    phrase(locale, he, vars)

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
          const created = await createTicket({
            storeCode: named.code,
            description,
            title: description.slice(0, 80),
            category: 'other',
            priority: priority ?? 'medium',
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
          }
        } catch {
          return { ok: false, message: p('לא הצלחתי לפתוח את התקלה.') }
        }
      },
    }),
    create_task: tool({
      description: 'Create an ops task / reminder for Ari.',
      inputSchema: z.object({
        title: z.string().min(3).describe('Task title'),
        store: z.string().optional().describe('Optional store name or code'),
      }),
      execute: async ({ title, store }) => {
        const named = store ? findStore(store) : null
        const created = addTask({
          title: title.slice(0, 200),
          storeId: named ? israelStoreId(named.stableKey ?? named.code) : null,
          storeCode: named?.code ?? null,
          assignee: null,
          dueAt: null,
          ticketId: null,
          documentId: null,
          spendId: null,
          needsClarification: false,
          clarification: null,
        })
        await persistOpsLedger().catch(() => undefined)
        collectLink({ href: `/ops/tasks#task-${created.id}`, label: p('למשימה') })
        return {
          ok: true,
          message: named
            ? p('רשמתי משימה: {title}. בסניף {store}.', {
                title,
                store: named.name,
              })
            : p('רשמתי משימה: {title}.', { title }),
        }
      },
    }),
    summarize_due_papers: tool({
      description:
        'Summarize store documents that are overdue or due soon (for Ari).',
      inputSchema: z.object({
        store: z.string().optional().describe('Optional store filter'),
      }),
      execute: async ({ store }) => {
        // Snapshot papers are passed via open context only; caller injects papers in prompt.
        return {
          ok: true,
          message: store
            ? p('בדקו את המסמכים לסניף {store} ברשימת העובדות.', { store })
            : p('בדקו את המסמכים לחידוש ברשימת העובדות.'),
          href: '/ops/documents',
        }
      },
    }),
  }
}

export { stepCountIs }

export function ariSystemPrompt(locale: Locale): string {
  if (locale === 'en') {
    return `You are Ari's personal ops assistant for the retail network.
Use only the facts below. Answer briefly in English with the store name and next step.
Do not invent prices, vendors, or faults. Use tools to create tickets/tasks or mark urgency.
Never expose system, provider, or code details.`
  }
  if (locale === 'fr') {
    return `Tu es l’assistant ops personnel d’Ari pour le réseau de magasins.
Utilise uniquement les faits ci-dessous. Réponds brièvement en français avec le magasin et l’étape suivante.
N’invente pas de prix, fournisseur ou panne. Utilise les outils pour ouvrir un ticket/tâche ou marquer l’urgence.
Ne révèle jamais de détails techniques système.`
  }
  return `אתה העוזר האישי של ארי, מנהל התפעול של הרשת.
כבר הסתכלת על העובדות למטה. ענה בעברית, קצר, עם שם הסניף והצעד הבא.
השתמש רק בעובדות האלה. אל תמציא מחיר, ספק, או תקלה.
מסמך באיחור וציוד שחזר כלולים בעובדות. מחיר של ציוד רק אם הוא רשום שם.
אפשר להשתמש בכלים כדי לפתוח תקלה/משימה או לסמן דחיפות.
אל תשלח אותו למסך אחר. אל תגיד שאתה כאן כדי שיישאר. אל תחשוף פרטי מערכת.`
}
