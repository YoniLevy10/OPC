import { plainStatus } from '@/components/ops/plain-labels'
import type { ReportLanguage } from './spoken-language'

export type ReporterTicket = {
  displayNumber: string
  status: string
  spendApproved: boolean | null
}

export function isStatusQuestion(text: string | null | undefined): boolean {
  if (!text) return false
  return /מה המצב|מה קורה|סטטוס|איפה הפנ|איפה הפנייה|עודכן|what(?:'s| is) the status|o[ùu] en est|quel est le statut/i.test(
    text,
  )
}

export function statusReply(
  tickets: ReporterTicket[],
  opts?: { knownManager?: boolean },
): string {
  if (tickets.length === 0) {
    return opts?.knownManager
      ? 'אין כרגע פנייה פתוחה מהמספר שלך. אפשר לשלוח את הדיווח ישירות.'
      : 'לא מצאתי פנייה פתוחה מהמספר הזה. אפשר לשלוח את קוד הסניף ואז את הדיווח.'
  }
  return tickets
    .slice(0, 3)
    .map((ticket) => {
      const money =
        ticket.spendApproved == null
          ? 'הדיווח נקלט. אין בקשת הוצאה שממתינה לאישור.'
          : ticket.spendApproved
            ? 'ההוצאה אושרה.'
            : 'הבקשה נקלטת וממתינה לאישור. היא עדיין לא אושרה.'
      return `פנייה ${ticket.displayNumber}: ${plainStatus(ticket.status)}.\n${money}`
    })
    .join('\n\n')
}

export function handoffReply(lang: ReportLanguage = 'he'): string {
  if (lang === 'en') {
    return 'I could not understand the report. Passing it to a person, who will get back to you.'
  }
  if (lang === 'fr') {
    return 'Je n’ai pas compris le signalement. Je le transmets à une personne, qui vous recontactera.'
  }
  return 'לא הצלחתי להבין את הדיווח. מעבירים אותו לאדם, והוא יחזור אליך.'
}

export function voiceNeedsReviewReply(lang: ReportLanguage = 'he'): string {
  if (lang === 'en') {
    return 'Got the recording. I could not understand it — what is the fault, where is it, and what is not working?'
  }
  if (lang === 'fr') {
    return 'Enregistrement reçu. Je n’ai pas compris — quelle est la panne, où, et qu’est-ce qui ne marche pas ?'
  }
  return 'ההקלטה התקבלה. לא הצלחתי להבין אותה — מה התקלה, איפה ומה לא עובד?'
}
