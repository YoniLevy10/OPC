import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  authErrorResponse,
  requireActor,
} from '@/lib/auth/request-actor'
import { AuthError } from '@/lib/auth/types'
import { listStores, requireStoresMutate, updateStore } from '@/modules/stores/service'
import { replaceStoreManager } from '@/modules/stores/replace-manager'
import { canManageStore } from '@/lib/auth/store-scope'
import { captureError } from '@/lib/monitoring'

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  city: z.string().max(120).nullable().optional(),
  address: z.string().max(200).nullable().optional(),
  region_id: z.string().max(64).optional(),
  is_active: z.boolean().optional(),
  manager_name: z.string().min(2).max(80).optional(),
  manager_name_en: z.string().max(80).nullable().optional(),
  manager_phone: z.string().min(9).max(20).optional(),
  area_manager: z.string().max(80).nullable().optional(),
  /** When true with manager_name+manager_phone — sync store_phones identity. */
  replace_manager: z.boolean().optional(),
})

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireActor(request)
    requireStoresMutate(actor)
    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: 'חסר מזהה חנות' }, { status: 400 })
    }
    const body = await request.json()
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'בקשה לא תקינה', details: parsed.error.flatten() },
        { status: 400 },
      )
    }
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: 'אין שדות לעדכון' }, { status: 400 })
    }
    const { stores } = await listStores({ includeInactive: true })
    const target = stores.find((s) => s.id === id)
    if (!target) return NextResponse.json({ error: 'חנות לא נמצאה' }, { status: 404 })
    if (!canManageStore(actor, target)) return NextResponse.json({ error: 'אין הרשאה' }, { status: 403 })
    const {
      replace_manager: replaceManager,
      manager_name: managerName,
      manager_phone: managerPhone,
      manager_name_en: managerNameEn,
      ...rest
    } = parsed.data
    if (replaceManager) {
      if (!managerName || !managerPhone) {
        return NextResponse.json(
          { error: 'החלפת מנהל דורשת שם וטלפון' },
          { status: 400 },
        )
      }
      const store = await replaceStoreManager({
        storeId: id,
        managerName,
        managerPhone,
        managerNameEn,
      })
      if (Object.keys(rest).length > 0) {
        const merged = await updateStore(id, rest)
        return NextResponse.json({ store: merged })
      }
      return NextResponse.json({ store })
    }
    const store = await updateStore(id, parsed.data)
    return NextResponse.json({ store })
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err)
    captureError(err, { route: 'PATCH /api/stores/[id]' })
    const message = err instanceof Error ? err.message : 'שגיאה בעדכון חנות'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
