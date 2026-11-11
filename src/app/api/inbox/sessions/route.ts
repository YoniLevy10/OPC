import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError } from '@/lib/auth/types'
import {
  listInboxSessions,
  assignSessionStore,
  markSessionInboxStatus,
  setSessionTakeover,
} from '@/modules/inbox/service'
import { captureError } from '@/lib/monitoring'

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request)
    const { sessions, backend } = await listInboxSessions(actor)
    return NextResponse.json({ sessions, backend })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'GET /api/inbox/sessions' })
    return NextResponse.json({ error: 'שגיאה' }, { status: 500 })
  }
}

const patchSchema = z
  .object({
    wa_id: z.string().min(5),
    human_takeover: z.boolean().optional(),
    store_id: z.string().uuid().nullable().optional(),
    customer_name: z.string().trim().max(120).nullable().optional(),
    /** handled = bot/closed; waiting = human takeover */
    status: z.enum(['handled', 'waiting']).optional(),
  })
  .refine((d) => d.human_takeover !== undefined || d.status !== undefined || d.store_id !== undefined || d.customer_name !== undefined, {
    message: 'human_takeover or status required',
  })

export async function PATCH(request: Request) {
  try {
    const actor = await requireActor(request)
    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 })
    }
    if (parsed.data.store_id !== undefined || parsed.data.customer_name !== undefined) {
      const session = await assignSessionStore(parsed.data.wa_id, parsed.data.store_id, parsed.data.customer_name, actor)
      return NextResponse.json({ session })
    }
    const session =
      parsed.data.status !== undefined
        ? await markSessionInboxStatus(parsed.data.wa_id, actor, parsed.data.status)
        : await setSessionTakeover(
            parsed.data.wa_id,
            actor,
            parsed.data.human_takeover!,
          )
    return NextResponse.json({ session })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'PATCH /api/inbox/sessions' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'שגיאה' },
      { status: 400 },
    )
  }
}
