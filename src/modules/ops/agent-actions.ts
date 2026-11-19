import { getPublicAppUrl } from '@/lib/auth/app-url'
import { persistOpsLedger } from '@/lib/data/ops-db'
import { addDocument, addTask, listTasks } from '@/lib/data/ops-ledger'
import { expiryFromText } from '@/modules/drive/import'
import { ISRAEL_STORES, israelStoreId, type IsraelStoreSeed } from '@/modules/stores/israel-stores'
import { classifyFaultText } from '@/modules/tickets/classify'
import { normalizeTicketCategory } from '@/modules/tickets/constants'
import { repairRangeLine } from '@/modules/recommendations/estimate'
import {
  createTicket,
  formatDisplayNumber,
  setTicketUrgent,
  type TicketSource,
} from '@/modules/tickets/service'
import type { Locale } from '@/lib/i18n/locale'
import { phrase } from '@/lib/i18n/phrases'

type Turn = { role: 'user' | 'assistant'; text: string }

export type AriLink = { href: string; label: string }

export type AriAct = { reply: string; links: AriLink[] }

export type OpenFaultHint = {
  id?: string
  storeName: string
  summary: string
  displayNumber: string | null
}

const CREATE_TASK =
  /(?:פתח|תפתח|צור|תיצור|תוסיף|הוסף|רשום|תרשום)\s+(?:לי\s+)?(?:על\s+(?:זה\s+)?)?משימה|תזכיר לי|(?:create|open|add|make)\s+(?:a\s+)?task|(?:créer|ouvrir|ouvre|ajoute[rz]?)\s+(?:une\s+)?tâche/i
const CREATE_TICKET =
  /(?:פתח|תפתח|צור|תיצור|תוסיף|הוסף|רשום|תרשום|דווח)\s+(?:לי\s+)?(?:על\s+(?:זה\s+)?)?(?:תקלה|קריאה)(?!\s+ה)|(?:create|open|report)\s+(?:a\s+)?(?:fault|ticket)|(?:créer|ouvrir|ouvre|signale[rz]?)\s+(?:une\s+)?panne/i
/** Open Ari's ops home / dashboard — must run before CREATE_TASK/TICKET. */
const OPEN_HOME =
  /(?:פתח|תפתח|תראה|הראה|שלח|תן)\s+(?:לי\s+)?(?:את\s+)?(?:הבית|לוח(?:\s+הבקרה)?|הדשבורד|dashboard)|^(?:הבית|לוח הבקרה)\s*\??$|(?:open|show|send)\s+(?:the\s+)?(?:home|dashboard)|(?:ouvrir|ouvre|montre[rz]?|envoie[rz]?)\s+(?:l['’])?(?:accueil|tableau de bord|dashboard)|^accueil\s*\??$/i
const OPEN_QUEUE =
  /(?:פתח|תפתח|תראה|הראה|שלח)\s+(?:לי\s+)?(?:את\s+)?(?:התור|תור התקלות|רשימת התקלות|התקלות(?:\s+הפתוחות)?)|(?:open|show)\s+(?:the\s+)?(?:queue|faults?|tickets?)|(?:ouvrir|ouvre|montre[rz]?)\s+(?:la\s+)?(?:file|pannes?)/i
const OPEN_APPROVALS =
  /(?:פתח|תפתח|תראה|הראה|שלח)\s+(?:לי\s+)?(?:את\s+)?(?:האישורים|מסך האישורים|הוצאות(?:\s+ממתינות)?)|(?:open|show)\s+(?:the\s+)?approvals?|(?:ouvrir|ouvre|montre[rz]?)\s+(?:les\s+)?approbations?/i
const OPEN_DOCS =
  /(?:פתח|תפתח|תראה|הראה|שלח)\s+(?:לי\s+)?(?:את\s+)?(?:המסמכים|מסמכים ותוקף|התקינה)|(open|show)\s+(?:the\s+)?documents?|(?:ouvrir|ouvre|montre[rz]?)\s+(?:les\s+)?documents?/i

/** Turn a relative /ops path into a public URL WhatsApp can open. */
export function absoluteOpsHref(href: string): string {
  const raw = href.trim()
  if (!raw) return getPublicAppUrl()
  if (/^https?:\/\//i.test(raw)) return raw
  const path = raw.startsWith('/') ? raw : `/${raw}`
  return `${getPublicAppUrl()}${path}`
}

/** Rewrite relative /ops/… paths in prose to absolute URLs WhatsApp can open. */
export function absolutizeOpsPathsInText(text: string): string {
  const base = getPublicAppUrl()
  return text.replace(
    /(^|[^A-Za-z0-9])(\/ops\/[A-Za-z0-9/_?=#%-]+)/g,
    (_full, prefix: string, path: string) => `${prefix}${base}${path}`,
  )
}

/** Append absolute screen links so WA replies are actionable, not just claims. */
export function formatAriReplyWithLinks(
  reply: string,
  links: AriLink[],
  locale: Locale = 'he',
): string {
  const text = absolutizeOpsPathsInText(reply.trim())
  if (!links.length) return text
  const lines: string[] = []
  const seen = new Set<string>()
  for (const link of links) {
    const url = absoluteOpsHref(link.href)
    if (!url || seen.has(url)) continue
    if (text.includes(url)) continue
    seen.add(url)
    const label = link.label?.trim() || phrase(locale, 'למסך')
    lines.push(`${label}: ${url}`)
  }
  if (!lines.length) return text
  return text ? `${text}\n\n${lines.join('\n')}` : lines.join('\n')
}

export async function actForAri(input: {
  message: string
  history?: Turn[]
  open?: OpenFaultHint[]
  source?: Extract<TicketSource, 'web_fallback' | 'whatsapp'>
  locale?: Locale
}): Promise<AriAct | null> {
  const locale = input.locale ?? 'he'
  const p = (he: string, vars?: Record<string, string | number>) => phrase(locale, he, vars)
  const message = input.message.trim()
  if (OPEN_HOME.test(message)) {
    return say(p('הנה הבית — לוח הבקרה שלך.'), {
      href: '/ops/dashboard',
      label: p('הבית'),
    })
  }
  if (OPEN_QUEUE.test(message)) {
    return say(p('הנה תור התקלות.'), {
      href: '/ops/tickets',
      label: p('תור תקלות'),
    })
  }
  if (OPEN_APPROVALS.test(message)) {
    return say(p('הנה מסך האישורים.'), {
      href: '/ops/approvals',
      label: p('אישורים'),
    })
  }
  if (OPEN_DOCS.test(message)) {
    return say(p('הנה המסמכים והתוקף.'), {
      href: '/ops/documents',
      label: p('מסמכים'),
    })
  }
  if (
    (/סמן/.test(message) && /דחופ/.test(message)) ||
    /mark\s+(?:as\s+)?urgent|urgent\s+(?:this|fault)|marque[rz]?\s+(?:comme\s+)?urgente?/i.test(
      message,
    )
  ) {
    const urgent = !/לא דחופ|not urgent|pas urgente?/i.test(message)
    const named = pickStore(message)
    const pool = (input.open ?? []).filter((fault) => fault.id)
    const match = named.store
      ? pool.filter(
          (fault) =>
            fault.storeName.includes(named.store!.name) ||
            named.store!.name.includes(fault.storeName),
        )
      : pool
    const target = match.length === 1 ? match[0] : null
    if (!target?.id) return say(p('איזו תקלה לסמן? כתוב את שם הסניף.'))
    await setTicketUrgent(target.id, urgent, null)
    return say(
      urgent
        ? p('סימנתי את התקלה ב{store} כדחופה.', { store: target.storeName })
        : p('הורדתי את הדחיפות ב{store}.', { store: target.storeName }),
    )
  }
  const task = CREATE_TASK.test(message)
  const ticket = CREATE_TICKET.test(message)
  const permit = /כיבוי אש|אישור כיבוי|רישיון|fire permit|permis (?:incendie|feu)|autorisation/i.test(
    message,
  )
  if (!task && !ticket && !permit) return null

  const historyText = (input.history ?? [])
    .filter((turn) => turn.role === 'assistant')
    .slice(-2)
    .map((turn) => turn.text)
    .join('\n')
  const named = pickStore(message)
  const remembered = pickStore(historyText)
  const store = named.store ?? (named.ambiguous.length === 0 ? remembered.store : null)
  const body = cleanBody(message, store?.name ?? null)
  const blurb = blurbFrom(historyText)

  if (named.ambiguous.length > 1) {
    const joiner = locale === 'fr' ? ' et ' : locale === 'en' ? ' and ' : ' ו'
    return say(
      p('באיזה סניף? יש {names}.', {
        names: named.ambiguous.map((row) => row.name).slice(0, 3).join(joiner),
      }),
    )
  }

  // Explicit «תפתח משימה …» wins over permit/doc intake (e.g. recurring fire-check task).
  if (!ticket && !task && permit) {
    const title = (body.length >= 3 ? body : blurb) || p('חידוש אישור')
    if (!store) {
      const created = addTask({
        title: title.slice(0, 200),
        storeId: null,
        storeCode: null,
        assignee: null,
        dueAt: null,
        ticketId: null,
        documentId: null,
        spendId: null,
        needsClarification: true,
        clarification: p('באיזה סניף האישור?'),
      })
      await persistOpsLedger().catch(() => undefined)
      return say(p('רשמתי משימה לחידוש אישור. חסר סניף.'), taskLink(created.id, locale))
    }
    const expiry = expiryFromText(message)
    const doc = addDocument({
      storeId: israelStoreId(store.stableKey ?? store.code),
      storeCode: store.code,
      storeName: store.name,
      docType: /חשמל|electr/i.test(message) ? 'electrical' : 'fire',
      sourceUrl: null,
      extractedExpiry: expiry,
      computedNextCheck: null,
      owner: null,
      intakeStatus: expiry ? 'ingested' : 'needs_review',
      intakeReason: expiry ? null : p('תאריך התוקף לא ברור'),
    })
    await persistOpsLedger().catch(() => undefined)
    const kind =
      doc.docType === 'electrical' ? p('אישור חשמל') : p('אישור כיבוי אש')
    return say(
      expiry
        ? p('רשמתי {kind} בסניף {store}.', { kind, store: store.name })
        : p('רשמתי אישור לסניף {store}. חסר תאריך תוקף.', { store: store.name }),
      { href: '/ops/documents', label: p('מסמכים') },
    )
  }

  if (task) {
    const title = (body.length >= 3 ? body : blurb) || ''
    if (title.length < 3) return say(p('מה לרשום במשימה?'))
    const existing = listTasks().find((row) => !row.done && row.title.trim() === title)
    if (existing) {
      return say(p('המשימה כבר רשומה: {title}.', { title: existing.title }), taskLink(existing.id, locale))
    }
    const dueAt = parseDueAt(message)
    const repeatDays = parseRepeatDays(message)
    const created = addTask({
      title: title.slice(0, 200),
      storeId: store ? israelStoreId(store.stableKey ?? store.code) : null,
      storeCode: store?.code ?? null,
      assignee: null,
      dueAt,
      ticketId: null,
      documentId: null,
      spendId: null,
      needsClarification: false,
      clarification: null,
      repeatDays,
    })
    await persistOpsLedger().catch(() => undefined)
    const bits = [
      store
        ? p('רשמתי משימה: {title}. בסניף {store}.', { title, store: store.name })
        : p('רשמתי משימה: {title}.', { title }),
      dueAt ? p('לתאריך {date}.', { date: dueAt.slice(0, 10) }) : '',
      repeatDays ? p('חוזר כל {days} ימים.', { days: repeatDays }) : '',
    ].filter(Boolean)
    return say(bits.join(' '), taskLink(created.id, locale))
  }

  if (!store) {
    return say(
      body.length >= 3
        ? p('באיזה סניף לפתוח את «{body}»?', { body })
        : p('מה התקלה, ובאיזה סניף?'),
    )
  }
  const description = (body.length >= 3 ? body : blurb) || ''
  if (description.length < 3) return say(p('מה התקלה ב{store}?', { store: store.name }))

  const force = /בכל זאת|חדשה|עוד אחת|anyway|new one|quand même|encore une/i.test(message)
  const duplicate = force
    ? null
    : (input.open ?? []).find(
        (fault) => fault.storeName === store.name && sharesWords(fault.summary, description),
      )
  if (duplicate) {
    const number = duplicate.displayNumber ? `${duplicate.displayNumber}: ` : ''
    const link = duplicate.id
      ? {
          href: `/ops/tickets/${duplicate.id}`,
          label: duplicate.displayNumber || p('לתקלה'),
        }
      : null
    return say(
      p('התקלה כבר פתוחה ב{store}. {number}{summary}.', {
        store: store.name,
        number,
        summary: duplicate.summary,
      }),
      link,
    )
  }

  try {
    const classified = classifyFaultText(`${message} ${description}`)
    const category = normalizeTicketCategory(classified.category)
    const created = await createTicket({
      storeCode: store.code,
      description,
      title: description.slice(0, 80),
      category,
      priority: classified.priority,
      source: input.source ?? 'web_fallback',
      reporterName: 'ארי',
      language: locale,
    })
    const number = created.display_number || formatDisplayNumber(created.number) || ''
    const label = number ? `${number}. ` : ''
    const next =
      classified.priority === 'critical' || classified.priority === 'high'
        ? p('הצעד הוא לאשר איש מקצוע ומחיר.')
        : /נזיל|חשמל|מזגן|מיזוג|אבטחה|מצלמ|דלת|leak|electr|hvac|clim|serrure|fuite/i.test(message)
          ? p('הצעד הוא לאשר איש מקצוע ומחיר.')
          : p('היא נשארת בתור לשילוב ביקור.')
    return say(
      p('פתחתי תקלה ב{store}: {description}. {label}{next} {range}', {
        store: store.name,
        description,
        label,
        next,
        range: repairRangeLine(category),
      }),
      {
        href: `/ops/tickets/${created.id}`,
        label: number || p('לתקלה'),
      },
    )
  } catch {
    return say(p('לא הצלחתי לפתוח את התקלה.'))
  }
}

function say(reply: string, link?: AriLink | null): AriAct {
  return { reply, links: link ? [link] : [] }
}

function taskLink(id: string, locale: Locale): AriLink {
  return { href: `/ops/tasks#task-${id}`, label: phrase(locale, 'למשימה') }
}

function pickStore(text: string): { store: IsraelStoreSeed | null; ambiguous: IsraelStoreSeed[] } {
  if (!text) return { store: null, ambiguous: [] }
  const exact = unique(
    ISRAEL_STORES.filter(
      (store) => text.includes(store.name) || new RegExp(`(?:סניף\\s*)?${store.code}\\b`).test(text),
    ),
  )
  if (exact.length === 1) return { store: exact[0]!, ambiguous: [] }
  if (exact.length > 1) return { store: null, ambiguous: exact }
  const byCity = unique(ISRAEL_STORES.filter((store) => store.city.length >= 3 && text.includes(store.city)))
  if (byCity.length === 1) return { store: byCity[0]!, ambiguous: [] }
  return { store: null, ambiguous: byCity }
}

function unique(stores: IsraelStoreSeed[]): IsraelStoreSeed[] {
  const seen = new Set<string>()
  return stores.filter((store) => {
    if (seen.has(store.code)) return false
    seen.add(store.code)
    return true
  })
}

function cleanBody(message: string, storeName: string | null): string {
  let body = message.replace(CREATE_TASK, ' ').replace(CREATE_TICKET, ' ')
  body = body.replace(/על זה|את זה|בסניף הזה|בכל זאת|עוד אחת|anyway|quand même|encore une/gi, ' ')
  body = body
    .replace(/מחר|tomorrow|demain/gi, ' ')
    .replace(/בעוד\s+\d+\s*(?:ימים|יום|שבועות|שבוע)/g, ' ')
    .replace(/(?:in|dans)\s+\d+\s*(?:days?|jours?|weeks?|semaines?)/gi, ' ')
    .replace(/(?:חוזר\s+)?כל\s+(?:\d+\s*ימים|\d+\s*יום|שנה|חודש|90|30|365)/g, ' ')
    .replace(/(?:every|tous les)\s+\d+\s*(?:days?|jours?)/gi, ' ')
    .replace(/לתאריך\s+\S+/g, ' ')
  if (storeName) body = body.replace(storeName, ' ')
  for (const store of ISRAEL_STORES) {
    if (store.city.length >= 3 && body.includes(store.city)) body = body.replace(store.city, ' ')
    if (new RegExp(`(?:סניף\\s*)?${store.code}\\b`).test(body)) {
      body = body.replace(new RegExp(`סניף\\s*${store.code}\\b|${store.code}\\b`), ' ')
    }
  }
  return body
    .replace(/בסניף|סניף|magasin|store/gi, ' ')
    .replace(/(?:^|\s)[בלמ](?=\s|$)/g, ' ')
    .replace(/(20\d{2})[-/.](\d{2})[-/.](\d{2})/g, ' ')
    .replace(/(\d{1,2})[./](\d{1,2})[./](20\d{2})/g, ' ')
    .replace(/[,\s:\-–]+/g, ' ')
    .trim()
}

function blurbFrom(text: string): string | null {
  const colon = text.match(/:\s*([^.]{4,80})/)
  return colon?.[1]?.trim() || null
}

function sharesWords(summary: string, description: string): boolean {
  const words = description.split(/\s+/).filter((word) => word.length >= 4)
  return words.some((word) => summary.includes(word))
}

/** Parse due date from Ari's Hebrew / ISO / FR / EN phrasing (UTC midnight). */
export function parseDueAt(text: string, now = new Date()): string | null {
  const dated = expiryFromText(text)
  if (dated) return dated
  const utcDay = (offsetDays: number) => {
    const due = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays),
    )
    return due.toISOString()
  }
  if (/מחר|tomorrow|demain/i.test(text)) return utcDay(1)
  const days = text.match(/בעוד\s+(\d+)\s*ימ/) || text.match(/(?:in|dans)\s+(\d+)\s*(?:days?|jours?)/i)
  if (days) return utcDay(Number(days[1]))
  const weeks = text.match(/בעוד\s+(\d+)\s*שבוע/) || text.match(/(?:in|dans)\s+(\d+)\s*(?:weeks?|semaines?)/i)
  if (weeks) return utcDay(Number(weeks[1]) * 7)
  return null
}

/** Parse repeat cadence aligned with Agent A presets (30 / 90 / 365). */
export function parseRepeatDays(text: string): number | null {
  if (/כל\s*שנה|שנתי|every\s*year|annuel|tous les ans/i.test(text)) return 365
  if (/כל\s*חודש|חודשי|every\s*month|mensuel|tous les mois/i.test(text)) return 30
  const numbered =
    text.match(/(?:חוזר\s+)?כל\s+(\d+)\s*ימ/) ||
    text.match(/(?:every|tous les)\s+(\d+)\s*(?:days?|jours?)/i)
  if (numbered) {
    const days = Number(numbered[1])
    return Number.isFinite(days) && days > 0 ? days : null
  }
  if (/כל\s*365|every\s*365|tous les 365/i.test(text)) return 365
  if (/כל\s*90|every\s*90|tous les 90/i.test(text)) return 90
  if (/כל\s*30|every\s*30|tous les 30/i.test(text)) return 30
  return null
}
