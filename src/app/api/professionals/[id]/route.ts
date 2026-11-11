import { NextResponse } from 'next/server'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError, actorHasHqAccess } from '@/lib/auth/types'
import {
  deleteProfessional,
  updateProfessional,
} from '@/modules/professionals/service'
import { captureError } from '@/lib/monitoring'

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(request)
    if (!actorHasHqAccess(actor)) throw new AuthError('אין הרשאת HQ', 403)
    const { id } = await ctx.params
    const body = (await request.json()) as {
      full_name?: string
      phone?: string | null
      trade?: string | null
      company_name?: string | null
      notes?: string | null
    }
    if (!body.full_name?.trim()) {
      return NextResponse.json({ error: 'שם חובה' }, { status: 400 })
    }
    const { professional, backend } = await updateProfessional(id, {
      full_name: body.full_name,
      phone: body.phone,
      trade: body.trade,
      company_name: body.company_name,
      notes: body.notes,
    })
    if (!professional) {
      return NextResponse.json({ error: 'לא נמצא' }, { status: 404 })
    }
    return NextResponse.json({ professional, backend })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    const message = err instanceof Error ? err.message : 'שגיאה'
    const status =
      message.includes('חובה') || message.includes('כבר שמור') ? 400 : 500
    if (status === 500) {
      captureError(err, { route: 'PATCH /api/professionals/[id]' })
    }
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(request)
    if (!actorHasHqAccess(actor)) throw new AuthError('אין הרשאת HQ', 403)
    const { id } = await ctx.params
    const { professional, backend } = await deleteProfessional(id)
    if (!professional) {
      return NextResponse.json({ error: 'לא נמצא' }, { status: 404 })
    }
    return NextResponse.json({ professional, backend })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'DELETE /api/professionals/[id]' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'שגיאה' },
      { status: 500 },
    )
  }
}
