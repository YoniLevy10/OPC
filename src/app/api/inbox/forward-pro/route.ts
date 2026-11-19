import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError } from '@/lib/auth/types'
import { forwardTicketPackToProfessional } from '@/modules/inbox/forward-pro'
import { captureError } from '@/lib/monitoring'

const bodySchema = z.object({
  ticketId: z.string().trim().min(1).max(80),
  professionalId: z.string().trim().min(1).max(80),
})

/** HQ: share ticket summary + media with a Midrag professional (dry-run default). */
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request)
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 })
    }
    const result = await forwardTicketPackToProfessional({
      actor,
      ticketId: parsed.data.ticketId,
      professionalId: parsed.data.professionalId,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'POST /api/inbox/forward-pro' })
    const message = err instanceof Error ? err.message : 'שגיאה'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
