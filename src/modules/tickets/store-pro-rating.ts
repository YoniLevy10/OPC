import 'server-only'

import {
  formatPersonalRating,
  parsePersonalRating,
} from '@/modules/notes/personal-rating'
import {
  getProfessional,
  updateProfessional,
} from '@/modules/professionals/service'
import { appendEvent, getById } from '@/modules/tickets/service'
import { captureError } from '@/lib/monitoring'
import { logEvent } from '@/lib/logging'

export const STORE_RATE_PRO_PROMPT =
  'תודה על תגובתך אנא דרג את איש המקצוע 1-5'

export const STORE_REJECT_THANKS =
  'תודה על תגובתך הנתונים מועברים לארי.'

export const STORE_RATE_PRO_REPROMPT =
  'אנא שלחו מספר בין 1 ל-5 לדירוג איש המקצוע.'

export const STORE_RATE_PRO_THANKS = 'תודה — הדירוג נקלט.'

/** Parse a bare 1–5 rating reply from WhatsApp. */
export function parseProRatingReply(text: string | null | undefined): number | null {
  if (!text) return null
  const trimmed = text.trim()
  if (!/^[1-5]$/.test(trimmed)) return null
  return Number(trimmed)
}

export async function applyStoreProRating(input: {
  ticketId: string
  professionalId: string
  rating: number
}): Promise<{ ok: boolean }> {
  const rating = Math.round(input.rating)
  if (rating < 1 || rating > 5) return { ok: false }

  const detail = await getById(input.ticketId).catch(() => null)
  const display =
    detail?.display_number ||
    (detail?.number != null ? `OC-${detail.number}` : input.ticketId.slice(0, 8))

  try {
    const { professional } = await getProfessional(input.professionalId)
    if (!professional) {
      logEvent('tickets:store_pro_rating', 'warn', 'professional_missing', {
        professionalId: input.professionalId,
        ticketId: input.ticketId,
      })
      return { ok: false }
    }

    const parsed = parsePersonalRating(professional.notes)
    const noteLine = `דירוג חנות אחרי תיקון · תקלה ${display}`
    const priorNote = parsed.note.trim()
    const nextNote = priorNote.includes(noteLine)
      ? priorNote
      : [priorNote, noteLine].filter(Boolean).join('\n')

    await updateProfessional(professional.id, {
      full_name: professional.full_name,
      phone: professional.phone,
      trade: professional.trade,
      company_name: professional.company_name,
      notes: formatPersonalRating(rating, nextNote),
    })

    await appendEvent(input.ticketId, 'store_rated_pro', null, {
      rating,
      professionalId: professional.id,
    })

    return { ok: true }
  } catch (err) {
    captureError(err, { route: 'store_pro_rating' })
    return { ok: false }
  }
}
