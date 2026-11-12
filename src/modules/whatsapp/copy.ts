import type { TicketPriority } from '@/modules/tickets/constants'
import { TICKET_PRIORITY_LABELS_HE } from '@/modules/tickets/constants'
import type { ReportLanguage } from './spoken-language'

const PRIORITY_LABELS: Record<ReportLanguage, Record<TicketPriority, string>> = {
  he: TICKET_PRIORITY_LABELS_HE,
  en: {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
  },
  fr: {
    critical: 'Critique',
    high: 'Élevée',
    medium: 'Moyenne',
    low: 'Faible',
  },
}

export type WaCopy = {
  askStore: string
  storeNotFound: (code: string) => string
  askDescription: (storeName: string, managerName?: string | null) => string
  needDescription: string
  confirmed: (displayNumber: string, storeName: string) => string
  confirmedIntake: (params: {
    displayNumber: string
    storeName: string
    summary: string
    priority: TicketPriority
    duplicateHint?: string | null
  }) => string
  openedVoiceFault: (summary: string) => string
  openedManyFaults: (summaries: string[]) => string
  duplicateHint: (displayNumber: string) => string
  mediaNotSaved: string
  mediaAttached: (displayNumber: string) => string
  nonIssueAck: string
  countryMissing: string
  genericError: string
  humanTakeoverAck: string | null
}

const HE: WaCopy = {
  askStore:
    'שלום! לדיווח תקלה יש לשלוח את קוד החנות (למשל 172) או לסרוק את ה־QR / NFC בחנות.',
  storeNotFound: (code: string) =>
    `לא מצאתי חנות עם הקוד ${code}. בדקו את הקוד ונסו שוב (מספרים בלבד).`,
  askDescription: (storeName: string, managerName?: string | null) => {
    const name = managerName?.trim()
    if (name) {
      return `שלום ${name}, מה שלומך?\nבבקשה תארו את התקלה בחנות ${storeName}. אפשר גם לצרף תמונה.`
    }
    return `שלום, מה שלומך?\nזוהתה חנות: ${storeName}.\nבבקשה תארו את התקלה. אפשר גם לצרף תמונה.`
  },
  needDescription: 'נא לתאר את התקלה בטקסט (או לצרף תמונה עם תיאור קצר).',
  confirmed: (displayNumber: string, storeName: string) =>
    `הדיווח התקבל ✓\nמספר תקלה: ${displayNumber}\nחנות: ${storeName}\nהצוות קיבל את הדיווח.`,
  confirmedIntake: (params) => {
    const assetLine = params.summary.replace(/\s+/g, ' ').trim()
    const lines = [
      `פתחתי תקלה #${params.displayNumber} ✅`,
      `${assetLine} · חנות ${params.storeName}`,
      `עדיפות ${PRIORITY_LABELS.he[params.priority]}`,
      'צוות התחזוקה קיבל את הדיווח.',
    ]
    if (params.duplicateHint) {
      lines.push(`שימו לב: ${params.duplicateHint}`)
    }
    return lines.join('\n')
  },
  openedVoiceFault: (summary: string) => `פתחתי תקלה: ${summary}`,
  openedManyFaults: (summaries: string[]) =>
    `פתחתי ${summaries.length} תקלות:\n${summaries.map((line) => `• ${line}`).join('\n')}`,
  duplicateHint: (displayNumber: string) =>
    `ייתכן שקיימת תקלה דומה פתוחה ${displayNumber}`.trim(),
  mediaNotSaved:
    'הדיווח נקלט, אך לא הצלחנו לשמור את התמונה. אפשר לשלוח אותה שוב בהודעה נפרדת.',
  mediaAttached: (displayNumber: string) =>
    `קיבלתי את התמונה ✓\nצורפה לתקלה #${displayNumber}`,
  nonIssueAck:
    'בשמחה. אם יש תקלה נוספת — כתבו אותה כאן (או שלחו STORE_ וקוד החנות).',
  countryMissing:
    'לא זוהתה מדינה עבור מספר הוואטסאפ. פנו לתמיכה או בדקו את הגדרות הסביבה.',
  genericError: 'אירעה תקלה זמנית בקליטת הדיווח. נסו שוב בעוד רגע.',
  humanTakeoverAck: null,
}

const EN: WaCopy = {
  askStore:
    'Hello! To report a fault, send the store code (for example 172) or scan the QR / NFC in the store.',
  storeNotFound: (code: string) =>
    `I could not find a store with code ${code}. Check the code and try again (numbers only).`,
  askDescription: (storeName: string, managerName?: string | null) => {
    const name = managerName?.trim()
    if (name) {
      return `Hi ${name}, how are you?\nPlease describe the fault at ${storeName}. You can also attach a photo.`
    }
    return `Hi, how are you?\nStore identified: ${storeName}.\nPlease describe the fault. You can also attach a photo.`
  },
  needDescription:
    'Please describe the fault in text (or attach a photo with a short description).',
  confirmed: (displayNumber: string, storeName: string) =>
    `Report received ✓\nTicket: ${displayNumber}\nStore: ${storeName}\nThe team has your report.`,
  confirmedIntake: (params) => {
    const assetLine = params.summary.replace(/\s+/g, ' ').trim()
    const lines = [
      `Opened ticket #${params.displayNumber} ✅`,
      `${assetLine} · Store ${params.storeName}`,
      `Priority ${PRIORITY_LABELS.en[params.priority]}`,
      'Maintenance has received the report.',
    ]
    if (params.duplicateHint) {
      lines.push(`Note: ${params.duplicateHint}`)
    }
    return lines.join('\n')
  },
  openedVoiceFault: (summary: string) => `Opened a ticket: ${summary}`,
  openedManyFaults: (summaries: string[]) =>
    `Opened ${summaries.length} tickets:\n${summaries.map((line) => `• ${line}`).join('\n')}`,
  duplicateHint: (displayNumber: string) =>
    `There may already be a similar open ticket ${displayNumber}`.trim(),
  mediaNotSaved:
    'The report was logged, but we could not save the photo. You can send it again in a separate message.',
  mediaAttached: (displayNumber: string) =>
    `Got the photo ✓\nAttached to ticket #${displayNumber}`,
  nonIssueAck:
    'Happy to help. If there is another fault — write it here (or send STORE_ and the store code).',
  countryMissing:
    'Could not detect a country for this WhatsApp number. Contact support or check environment settings.',
  genericError: 'A temporary error occurred while logging the report. Please try again shortly.',
  humanTakeoverAck: null,
}

const FR: WaCopy = {
  askStore:
    'Bonjour ! Pour signaler une panne, envoyez le code magasin (par exemple 172) ou scannez le QR / NFC en magasin.',
  storeNotFound: (code: string) =>
    `Je n’ai pas trouvé de magasin avec le code ${code}. Vérifiez le code et réessayez (chiffres uniquement).`,
  askDescription: (storeName: string, managerName?: string | null) => {
    const name = managerName?.trim()
    if (name) {
      return `Bonjour ${name}, comment allez-vous ?\nDécrivez la panne au magasin ${storeName}. Vous pouvez aussi joindre une photo.`
    }
    return `Bonjour, comment allez-vous ?\nMagasin identifié : ${storeName}.\nDécrivez la panne. Vous pouvez aussi joindre une photo.`
  },
  needDescription:
    'Veuillez décrire la panne en texte (ou joindre une photo avec une courte description).',
  confirmed: (displayNumber: string, storeName: string) =>
    `Signalement reçu ✓\nTicket : ${displayNumber}\nMagasin : ${storeName}\nL’équipe a reçu le signalement.`,
  confirmedIntake: (params) => {
    const assetLine = params.summary.replace(/\s+/g, ' ').trim()
    const lines = [
      `Ticket ouvert #${params.displayNumber} ✅`,
      `${assetLine} · Magasin ${params.storeName}`,
      `Priorité ${PRIORITY_LABELS.fr[params.priority]}`,
      'La maintenance a reçu le signalement.',
    ]
    if (params.duplicateHint) {
      lines.push(`Attention : ${params.duplicateHint}`)
    }
    return lines.join('\n')
  },
  openedVoiceFault: (summary: string) => `Ticket ouvert : ${summary}`,
  openedManyFaults: (summaries: string[]) =>
    `J’ai ouvert ${summaries.length} tickets :\n${summaries.map((line) => `• ${line}`).join('\n')}`,
  duplicateHint: (displayNumber: string) =>
    `Un ticket similaire est peut-être déjà ouvert ${displayNumber}`.trim(),
  mediaNotSaved:
    'Le signalement est enregistré, mais nous n’avons pas pu enregistrer la photo. Vous pouvez la renvoyer dans un message séparé.',
  mediaAttached: (displayNumber: string) =>
    `Photo reçue ✓\nJointe au ticket #${displayNumber}`,
  nonIssueAck:
    'Avec plaisir. S’il y a une autre panne — écrivez-la ici (ou envoyez STORE_ et le code magasin).',
  countryMissing:
    'Pays non détecté pour ce numéro WhatsApp. Contactez le support ou vérifiez la configuration.',
  genericError:
    'Une erreur temporaire est survenue lors de l’enregistrement. Réessayez dans un instant.',
  humanTakeoverAck: null,
}

const BY_LANG: Record<ReportLanguage, WaCopy> = {
  he: HE,
  en: EN,
  fr: FR,
}

/** Fault-opening WhatsApp copy in the reporter’s language (he / en / fr). */
export function waCopy(lang: ReportLanguage = 'he'): WaCopy {
  return BY_LANG[lang] ?? HE
}

/** Hebrew default — existing call sites and tests. Prefer `waCopy(lang)` in intake. */
export const WA_COPY = waCopy('he')
