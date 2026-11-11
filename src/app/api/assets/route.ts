import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError } from '@/lib/auth/types'
import { createAsset, listAssets } from '@/modules/assets/service'
import { canMutateAssetStore, canReadAssetStore } from '@/lib/auth/store-scope'
import { listStores } from '@/modules/stores/service'
import { captureError } from '@/lib/monitoring'

const createSchema = z.object({
  store_id: z.string().min(1),
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  asset_type: z.string().max(64).optional(),
  barcode: z.string().max(64).nullable().optional(),
})

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request)
    const url = new URL(request.url)
    const storeId = url.searchParams.get('store') || undefined
    const { stores } = await listStores({ includeInactive: true })
    const allowedStores = stores.filter((store) => canReadAssetStore(actor, store))
    if (storeId && !allowedStores.some((store) => store.id === storeId)) {
      return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 })
    }
    const { assets, backend } = await listAssets({ storeId: storeId ?? undefined })
    return NextResponse.json({ assets: storeId ? assets : assets.filter((asset) => allowedStores.some((store) => store.id === asset.store_id)), backend })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'GET /api/assets' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'שגיאה' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireActor(request)
    const parsed = createSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'בקשה לא תקינה' }, { status: 400 })
    }
    const { stores } = await listStores({ includeInactive: true })
    const store = stores.find((item) => item.id === parsed.data.store_id)
    if (!store || !canMutateAssetStore(actor, store)) return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 })
    const asset = await createAsset(parsed.data)
    return NextResponse.json({ asset }, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'POST /api/assets' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'שגיאה' },
      { status: 400 },
    )
  }
}
