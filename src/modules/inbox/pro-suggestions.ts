import type { Actor } from '@/lib/auth/types'
import { AuthError, actorHasHqAccess } from '@/lib/auth/types'
import { MEM_COUNTRY_ID } from '@/lib/data/memory-store'
import { listProfessionals } from '@/modules/professionals/service'
import {
  matchProfessionalsForFault,
  type FaultProMatch,
} from '@/modules/professionals/match-fault'
import { getById } from '@/modules/tickets/service'
import { canAccessInboxSession } from './authorization'

export type ProSuggestion = {
  id: string
  full_name: string
  phone: string | null
  phone_masked: string | null
  trade: string | null
  score: number
  reason: string
}

function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '****'
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`
}

/**
 * Rank Midrag / book professionals for a ticket category (Ari picker).
 */
export async function suggestProfessionalsForTicket(input: {
  actor: Actor
  ticketId: string
  limit?: number
}): Promise<{
  ticketId: string
  category: string
  suggestions: ProSuggestion[]
}> {
  if (!actorHasHqAccess(input.actor)) {
    throw new AuthError('אין הרשאה להצעות מקצוענים', 403)
  }

  const ticket = await getById(input.ticketId)
  if (!ticket) throw new Error('התקלה לא נמצאה')

  if (
    !canAccessInboxSession(input.actor, {
      store_id: ticket.store_id,
      country_id: ticket.country_id ?? MEM_COUNTRY_ID,
      region_id: ticket.region_id ?? null,
      organization_id: ticket.organization_id ?? null,
    })
  ) {
    throw new AuthError('אין הרשאה לתקלה זו', 403)
  }

  const category = String(ticket.category || 'other')
  const { professionals } = await listProfessionals({ limit: 200 })
  const matched: FaultProMatch[] = matchProfessionalsForFault(
    professionals.map((p) => ({
      id: p.id,
      full_name: p.full_name,
      phone: p.phone,
      trade: p.trade,
      notes: p.notes,
      use_count: p.use_count,
    })),
    category,
  )

  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10)
  const suggestions = matched
    .filter((p) => Boolean(p.phone?.replace(/\D/g, '')))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      full_name: p.full_name,
      phone: p.phone,
      phone_masked: maskPhone(p.phone),
      trade: p.trade,
      score: p.score,
      reason: p.reason,
    }))

  return {
    ticketId: ticket.id,
    category,
    suggestions,
  }
}
