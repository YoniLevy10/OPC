import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError } from '@/lib/auth/types'
import {
  startOpsChatWithPhone,
  startOpsChatWithStore,
} from '@/modules/inbox/service'
import { captureError } from '@/lib/monitoring'

const bodySchema = z
  .object({
    // Memory demo store ids are `il-store-172`; Supabase uses UUIDs.
    storeId: z.string().trim().min(1).max(80).optional(),
    phone: z.string().trim().min(8).max(24).optional(),
    name: z.string().trim().max(120).nullish(),
  })
  .refine((body) => Boolean(body.storeId) !== Boolean(body.phone), {
    message: 'storeId_xor_phone',
  })

/**
 * HQ: open or create an inbox thread with a store manager or free phone.
 * Never sends via Meta — create/open only. Live outbound for
 * business-initiated threads requires MAINTAINOS_WA_OPS_START_LIVE=1.
 */
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request)
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 })
    }
    const result = parsed.data.phone
      ? await startOpsChatWithPhone({
          actor,
          phone: parsed.data.phone,
          name: parsed.data.name,
        })
      : await startOpsChatWithStore({
          actor,
          storeId: parsed.data.storeId!,
        })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'POST /api/inbox/sessions/start' })
    const message = err instanceof Error ? err.message : 'שגיאה'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
