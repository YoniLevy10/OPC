import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError } from '@/lib/auth/types'
import { listAssets, deleteAsset, updateAsset } from '@/modules/assets/service'
import { canMutateAssetStore } from '@/lib/auth/store-scope'
import { listStores } from '@/modules/stores/service'
import { captureError } from '@/lib/monitoring'

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  code: z.string().min(1).max(32).optional(),
  asset_type: z.string().max(64).optional(),
  barcode: z.string().max(64).nullable().optional(),
})

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(request)
    const { id } = await ctx.params
    const parsed = patchSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 })
    }
    const { assets } = await listAssets()
    const existing = assets.find((item) => item.id === id)
    const { stores } = await listStores({ includeInactive: true })
    const store = stores.find((item) => item.id === existing?.store_id)
    if (!existing || !store || !canMutateAssetStore(actor, store)) return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 })
    const asset = await updateAsset(id, parsed.data)
    return NextResponse.json({ asset })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'PATCH /api/assets/[id]' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'שגיאה' },
      { status: 400 },
    )
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(_request)
    const { id } = await ctx.params
    const { assets } = await listAssets()
    const existing = assets.find((item) => item.id === id)
    const { stores } = await listStores({ includeInactive: true })
    const store = stores.find((item) => item.id === existing?.store_id)
    if (!existing || !store || !canMutateAssetStore(actor, store)) return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 })
    await deleteAsset(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'DELETE /api/assets/[id]' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'שגיאה' },
      { status: 400 },
    )
  }
}
