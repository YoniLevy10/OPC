import { NextResponse } from 'next/server'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError, type Actor } from '@/lib/auth/types'
import { storeProductRoles } from '@/lib/auth/roles'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { confirmStoreFix } from '@/modules/tickets/store-confirm'
import { getById } from '@/modules/tickets/service'
import { captureError } from '@/lib/monitoring'

export const runtime = 'nodejs'

/**
 * Store confirms a resolved ticket → auto-close.
 * Store feedback belongs to the responsible store. HQ approval of work is
 * separate and cannot manufacture the store's confirmation.
 * Explicit anonymous meeting demos retain their existing test entry.
 */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params
    let actorLabel = 'store'
    let actor: Actor | null = null
    try {
      actor = await requireActor(request)
      actorLabel =
        actor.full_name || actor.email || actor.id || 'store'
    } catch (err) {
      if (!(err instanceof AuthError) || !shouldAllowDemoEntry()) {
        if (err instanceof AuthError) return authErrorResponse(err)
        throw err
      }
      actorLabel = 'demo-store'
    }

    const ticket = await getById(id)
    if (!ticket) {
      return NextResponse.json({ error: 'תקלה לא נמצאה' }, { status: 404 })
    }
    if (
      actor &&
      !actor.memberships.some(
        (membership) =>
          storeProductRoles().includes(membership.role) &&
          membership.organization_id === ticket.organization_id &&
          membership.store_id === ticket.store_id,
      )
    ) {
      throw new AuthError('אין הרשאה לאשר תיקון בחנות זו', 403)
    }

    const result = await confirmStoreFix({
      ticketId: id,
      actorLabel,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'POST /api/tickets/[id]/confirm' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'שגיאה' },
      { status: 400 },
    )
  }
}
