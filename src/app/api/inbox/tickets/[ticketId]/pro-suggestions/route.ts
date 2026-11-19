import { NextResponse } from 'next/server'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError } from '@/lib/auth/types'
import { suggestProfessionalsForTicket } from '@/modules/inbox/pro-suggestions'
import { captureError } from '@/lib/monitoring'

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ ticketId: string }> },
) {
  try {
    const actor = await requireActor(_request)
    const { ticketId } = await ctx.params
    if (!ticketId?.trim()) {
      return NextResponse.json({ error: 'חסר מזהה תקלה' }, { status: 400 })
    }
    const result = await suggestProfessionalsForTicket({
      actor,
      ticketId: ticketId.trim(),
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, {
      route: 'GET /api/inbox/tickets/[ticketId]/pro-suggestions',
    })
    const message = err instanceof Error ? err.message : 'שגיאה'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
