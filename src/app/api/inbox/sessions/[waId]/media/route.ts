import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError } from '@/lib/auth/types'
import { replyMediaToSession } from '@/modules/inbox/reply-media'
import { captureError } from '@/lib/monitoring'

const bodySchema = z.object({
  link: z.string().url().max(2048),
  kind: z.enum(['image', 'video', 'document']).default('image'),
  caption: z.string().max(1024).optional(),
  filename: z.string().max(200).optional(),
  ticketId: z.string().uuid().nullable().optional(),
})

export async function POST(
  request: Request,
  ctx: { params: Promise<{ waId: string }> },
) {
  try {
    const actor = await requireActor(request)
    const { waId } = await ctx.params
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 })
    }
    const result = await replyMediaToSession({
      actor,
      waId,
      link: parsed.data.link,
      kind: parsed.data.kind,
      caption: parsed.data.caption,
      filename: parsed.data.filename,
      ticketId: parsed.data.ticketId ?? null,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'POST /api/inbox/sessions/[waId]/media' })
    const message = err instanceof Error ? err.message : 'שגיאה'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
