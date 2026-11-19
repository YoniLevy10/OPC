import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError } from '@/lib/auth/types'
import { forwardTicketPackToExternalPhone } from '@/modules/inbox/forward-external'
import { captureError } from '@/lib/monitoring'

const bodySchema = z.object({
  ticketId: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(7).max(32),
  name: z.string().trim().max(120).optional().nullable(),
})

/** HQ: share ticket pack with an external phone (no engagement lock). */
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request)
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 })
    }
    const result = await forwardTicketPackToExternalPhone({
      actor,
      ticketId: parsed.data.ticketId,
      phone: parsed.data.phone,
      name: parsed.data.name ?? null,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'POST /api/inbox/forward-external' })
    const message = err instanceof Error ? err.message : 'שגיאה'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
