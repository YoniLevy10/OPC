import type { Locale } from '@/lib/i18n/locale'
import { phrase } from '@/lib/i18n/phrases'

/** Intake FSM → product language (never raw snake_case in UI). */
const INTAKE_STATE_HE: Record<string, string> = {
  awaiting_store: 'ממתין לסניף',
  awaiting_description: 'ממתין לתיאור',
  awaiting_clarification: 'ממתין להבהרה',
  awaiting_media: 'ממתין לתמונה',
  done: 'טופל',
  collecting: 'אוסף פרטים',
}

/** Meta template names → customer-facing labels (Meta id stays server-side). */
const TEMPLATE_LABEL_HE: Record<string, string> = {
  maintainos_followup: 'הודעת מעקב',
  maintainos_desk_alert: 'התראת דסק',
  maintainos_ticket_update: 'עדכון תקלה',
}

const TEMPLATE_PREFIX = /^\[תבנית\]\s*/i

export function intakeStateLabel(state: string, locale: Locale = 'he'): string {
  const he = INTAKE_STATE_HE[state]
  if (!he) return state.includes('_') ? phrase(locale, 'בטיפול') : state
  return phrase(locale, he)
}

export function templateDisplayName(
  metaName: string,
  locale: Locale = 'he',
): string {
  const key = metaName.trim()
  const he = TEMPLATE_LABEL_HE[key] ?? 'הודעת תבנית'
  return phrase(locale, he)
}

/** Rewrite stored `[תבנית] maintainos_followup` bodies for the desk UI. */
export function humanizeMessageBody(
  body: string,
  locale: Locale = 'he',
): string {
  const trimmed = body.trim()
  if (!TEMPLATE_PREFIX.test(trimmed)) return body
  const metaName = trimmed.replace(TEMPLATE_PREFIX, '').trim()
  if (!metaName) return phrase(locale, 'הודעת תבנית')
  return templateDisplayName(metaName, locale)
}

export function humanizeTemplateLabel(
  templateName: string,
  locale: Locale = 'he',
): string {
  return templateDisplayName(templateName, locale)
}
