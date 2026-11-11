'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import {
  addCatalogItem,
  addDocument,
  addOutcome,
  addTask,
  addTasksFromTranscript,
  applySpendDecision,
  createSpend,
  getDriveSync,
  ingestFile,
  moveStock,
  recordActualSpend,
  recordClassificationCorrection,
  renewStoredDocument,
  setDocumentExpiry,
  setDocumentReminders,
  setDocumentTitle,
  reviseSpend,
  setTaskStatus,
  toggleTask,
} from '@/lib/data/ops-ledger'
import { ISRAEL_STORES, israelStoreId } from '@/modules/stores/israel-stores'
import {
  correctClassification,
  updatePriority,
} from '@/modules/tickets/service'
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type TicketPriority,
} from '@/modules/tickets/constants'
import { canCorrectTicketClassification } from '@/modules/tickets/classification-auth'
import { importDriveLink } from '@/modules/drive/import'
import { parseDriveLink } from '@/modules/drive/folder'
import { syncDriveFolder } from '@/modules/drive/sync'
import { patchDevDocumentExpiry, patchDevDocumentReminders, patchDevDocumentTitle, persistOpsLedger } from '@/lib/data/ops-db'
import { cleanDocumentTitle } from '@/modules/documents/rules'
import { isTaskStatus } from '@/modules/tasks/status'
import { notifyAri, notifyPhone } from '@/modules/notify/ari'
import { createAdminClient } from '@/lib/supabase/admin'
import { supabaseReady } from '@/lib/data/memory-store'
import { listDocuments, listFiles } from '@/lib/data/ops-ledger'

async function actorName() {
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) throw new Error('נדרשת כניסה')
  return actor?.full_name || 'ארי'
}

async function refresh(path: string) {
  await persistOpsLedger()
  revalidatePath(path)
  revalidatePath('/ops/dashboard')
  revalidatePath('/ops/documents')
}

function storeManagerLabel(storeCode: string) {
  const store = ISRAEL_STORES.find((row) => row.code === storeCode.trim())
  if (!store) return null
  return {
    store,
    label: `${store.managerName} · ${store.name}`,
  }
}

export async function setTicketPriority(ticketId: string, priority: TicketPriority) {
  const actor = await getServerActor()
  if (!canCorrectTicketClassification(actor, shouldAllowDemoEntry())) {
    throw new Error('אין הרשאה לשנות דחיפות')
  }
  if (!TICKET_PRIORITIES.includes(priority)) throw new Error('עדיפות לא חוקית')
  const { getById } = await import('@/modules/tickets/service')
  const before = await getById(ticketId)
  await updatePriority(ticketId, priority, actor?.id ?? null)
  if (before && before.priority !== priority) {
    recordClassificationCorrection(ticketId, before.priority, priority, {
      fromPriority: before.priority,
      toPriority: priority,
      fromCategory: before.category,
      toCategory: before.category,
    })
  }
  await refresh(`/ops/tickets/${ticketId}`)
  revalidatePath('/ops/tickets')
}

export async function correctTicketClassification(input: {
  ticketId: string
  category: string
  priority: TicketPriority
  reason?: string
}) {
  const actor = await getServerActor()
  if (!canCorrectTicketClassification(actor, shouldAllowDemoEntry())) {
    throw new Error('אין הרשאה לתקן סיווג')
  }
  if (!TICKET_PRIORITIES.includes(input.priority)) throw new Error('עדיפות לא חוקית')
  if (!(TICKET_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new Error('קטגוריה לא חוקית')
  }
  const { getById } = await import('@/modules/tickets/service')
  const before = await getById(input.ticketId)
  if (!before) throw new Error('תקלה לא נמצאה')
  await correctClassification(input.ticketId, {
    category: input.category,
    priority: input.priority,
    reason: input.reason?.trim() || null,
    actorId: actor?.id ?? null,
  })
  recordClassificationCorrection(
    input.ticketId,
    before.priority,
    input.priority,
    {
      fromCategory: before.category,
      toCategory: input.category,
      fromPriority: before.priority,
      toPriority: input.priority,
      reason: input.reason?.trim() || null,
    },
  )
  await refresh(`/ops/tickets/${input.ticketId}`)
  revalidatePath('/ops/tickets')
}

export async function requestTicketPayment(formData: FormData) {
  await actorName()
  const storeCode = String(formData.get('storeCode') || '')
  const manager = storeManagerLabel(storeCode)
  const priority = String(formData.get('priority') || '')
  const reason = String(formData.get('reason') || '')
  createSpend({
    storeId: String(formData.get('storeId') || ''),
    storeCode,
    storeName: String(formData.get('storeName') || manager?.store.name || ''),
    ticketId: String(formData.get('ticketId') || '') || null,
    assetId: String(formData.get('assetId') || '') || null,
    reason,
    vendorName: String(formData.get('vendor') || '') || null,
    requestedAmount: Number(formData.get('amount') || 0),
    scope: String(formData.get('scope') || '') || null,
    urgent: formData.get('urgent') === 'on' || priority === 'critical' || priority === 'high',
    actor: manager?.label || 'מנהל סניף',
    requestedBy: manager?.label,
  })
  await notifyAri(
    `בקשת תשלום מטעם ${manager?.label ?? storeCode}: ${reason}. עלתה לאישור.`,
  )
  await refresh('/ops/approvals')
  redirect('/ops/approvals')
}

export async function submitSpend(formData: FormData) {
  const actor = await actorName()
  const storeCode = String(formData.get('storeCode') || '')
  const manager = storeManagerLabel(storeCode)
  createSpend({
    storeId: String(formData.get('storeId') || (manager ? israelStoreId(storeCode) : '')),
    storeCode,
    storeName: String(formData.get('storeName') || manager?.store.name || ''),
    ticketId: String(formData.get('ticketId') || '') || null,
    assetId: String(formData.get('assetId') || '') || null,
    reason: String(formData.get('reason') || ''),
    vendorName: String(formData.get('vendor') || '') || null,
    requestedAmount: Number(formData.get('amount') || 0),
    scope: String(formData.get('scope') || '') || null,
    urgent: formData.get('urgent') === 'on',
    actor,
    requestedBy: manager?.label ?? actor,
  })
  const vendor = String(formData.get('vendor') || '').trim()
  await notifyAri(
    vendor
      ? `בקשת הוצאה חדשה מסניף ${String(formData.get('storeCode') || '')}: ${String(formData.get('reason') || '')}. ממתינה לאישור.`
      : `בקשת הוצאה מסניף ${String(formData.get('storeCode') || '')} בלי שם ספק. נדרשת הצעת מחיר לפני אישור.`,
  )
  await refresh('/ops/approvals')
  const linkedTicket = String(formData.get('ticketId') || '').trim()
  if (linkedTicket) revalidatePath(`/ops/tickets/${linkedTicket}`)
  revalidatePath('/ops/assets')
}

export async function decideSpendAction(formData: FormData) {
  const actor = await actorName()
  if (
    (await getServerActor()) &&
    !(await getServerActor())?.memberships.some((m) => m.role === 'global_admin') &&
    !shouldAllowDemoEntry()
  ) {
    throw new Error('אישור הוצאה שמור למנהל הרשת')
  }
  const decision = String(formData.get('decision'))
  if (decision !== 'approved' && decision !== 'rejected' && decision !== 'needs_info') {
    throw new Error('החלטה לא תקינה')
  }
  const spend = applySpendDecision(String(formData.get('id')), decision, actor)
  const store = ISRAEL_STORES.find((row) => row.code === spend.storeCode)
  const verdict =
    decision === 'approved' ? 'אושרה' : decision === 'rejected' ? 'נדחתה' : 'מחכה למידע נוסף'
  if (store?.managerPhone) {
    await notifyPhone(
      store.managerPhone,
      `סניף ${spend.storeCode}: הבקשה «${spend.reason}» ${verdict}.`,
    )
  }
  await refresh('/ops/approvals')
  redirect(`/ops/approvals?notice=${decision}`)
}

export async function reviseSpendAction(formData: FormData) {
  await actorName()
  reviseSpend(String(formData.get('id')), {
    requestedAmount: Number(formData.get('amount') || 0),
    vendorName: String(formData.get('vendor') || '') || null,
    scope: String(formData.get('scope') || '') || null,
  })
  await refresh('/ops/approvals')
}

export async function actualSpendAction(formData: FormData) {
  const actor = await actorName()
  recordActualSpend(String(formData.get('id')), Number(formData.get('actual') || 0), actor)
  await refresh('/ops/approvals')
}

async function mirrorDrive() {
  const root = getDriveSync().rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID?.trim()
  if (!root) return null
  try {
    return await syncDriveFolder(root)
  } catch {
    return null
  }
}

export async function importDriveAction(formData: FormData) {
  await actorName()
  const link = String(formData.get('link') || '')
  const parsed = parseDriveLink(link)
  if (!parsed || parsed.kind === 'folder') {
    const folderId = parsed?.id || getDriveSync().rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID?.trim()
    if (!folderId) throw new Error('מדביקים קישור לתיקייה של ארי בדרייב.')
    const result = await syncDriveFolder(folderId)
    if (result.pulled > 0 && result.review > 0) {
      await notifyAri(
        `סנכרון דרייב: ${result.pulled} קבצים עודכנו, ${result.review} דורשים בדיקה.`,
      )
    }
    await refresh('/ops/documents')
    return {
      imported: result.pulled,
      pushed: result.pushed,
      review: result.review,
      removed: result.removed,
      writeSkipped: result.writeSkipped,
    }
  }
  const result = await importDriveLink(link)
  if (result.review > 0) {
    await notifyAri(
      `ייבוא דרייב: ${result.files.length} קבצים, ${result.review} דורשים בדיקה.`,
    )
  }
  await refresh('/ops/documents')
  return { imported: result.files.length, pushed: 0, review: result.review, removed: 0, writeSkipped: false }
}

export async function addDocumentAction(formData: FormData) {
  await actorName()
  const expiry = String(formData.get('expiry') || '')
  const sourceUrl = String(formData.get('sourceUrl') || '') || null
  const linked = sourceUrl ? parseDriveLink(sourceUrl) : null
  addDocument({
    storeId: String(formData.get('storeId') || ''),
    storeCode: String(formData.get('storeCode') || ''),
    storeName: String(formData.get('storeName') || ''),
    docType: String(formData.get('docType') || 'fire'),
    sourceUrl: linked?.kind === 'file' ? `https://drive.google.com/file/d/${linked.id}/view` : sourceUrl,
    extractedExpiry: expiry || null,
    computedNextCheck: null,
    owner: String(formData.get('owner') || '') || null,
    intakeStatus: expiry ? 'ingested' : 'needs_review',
    intakeReason: expiry ? null : 'תאריך התוקף לא ברור',
    driveFileId: linked?.kind === 'file' ? linked.id : null,
    fieldsLocked: true,
    localUpdatedAt: new Date().toISOString(),
  })
  await mirrorDrive()
  await refresh('/ops/documents')
}

export async function setDocumentRemindersAction(formData: FormData) {
  await actorName()
  const id = documentIdFrom(formData)
  const sixRaw = String(formData.get('six') || '')
  const twoRaw = String(formData.get('two') || '')
  const six = sixRaw ? expiryInputToIso(sixRaw) : null
  const two = twoRaw ? expiryInputToIso(twoRaw) : null
  if ((sixRaw && !six) || (twoRaw && !two)) throw new Error('תאריך התוקף לא ברור')
  setDocumentReminders(id, { six, two })
  await patchDevDocumentReminders(id, { six, two })
  await refresh('/ops/documents')
}

function documentIdFrom(formData: FormData) {
  return String(formData.get('documentId') || formData.get('id') || '')
}

export async function setDocumentTitleAction(formData: FormData) {
  await actorName()
  const id = documentIdFrom(formData)
  if (!id) throw new Error('מסמך לא נמצא')
  const title = cleanDocumentTitle(String(formData.get('title') || ''))
  setDocumentTitle(id, title)
  await patchDevDocumentTitle(id, title)
  await refresh('/ops/documents')
}

export async function setDocumentExpiryAction(formData: FormData) {
  await actorName()
  const id = documentIdFrom(formData)
  const iso = expiryInputToIso(String(formData.get('expiry') || ''))
  if (!iso) throw new Error('תאריך התוקף לא ברור')
  setDocumentExpiry(id, iso)
  await patchDevDocumentExpiry(id, iso)
  await refresh('/ops/documents')
}

function expiryInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  if (year < 2020 || year > 2036 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const iso = `${value}T00:00:00.000Z`
  const date = new Date(iso)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return iso
}

export async function renewDocumentAction(formData: FormData) {
  await actorName()
  const documentId = documentIdFrom(formData)
  const current = listDocuments().find((doc) => doc.id === documentId)
  if (!current) throw new Error('מסמך לא נמצא')
  const uploaded = formData.get('renewalFile')
  const sourceUrlInput = String(formData.get('sourceUrl') || '').trim()
  let sourceUrl = sourceUrlInput
  let storagePath: string | null = null

  if (uploaded instanceof File && uploaded.size > 0) {
    if (uploaded.size > 15 * 1024 * 1024) throw new Error('הקובץ גדול מדי (מקסימום 15MB)')
    const isPdf = uploaded.type === 'application/pdf' || uploaded.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) throw new Error('אפשר להעלות רק קובץ PDF')
    if (!(await supabaseReady())) {
      throw new Error('העלאת קובץ דורשת חיבור Supabase פעיל. אפשר להשתמש בקישור במצב מקומי.')
    }
    const safeName = uploaded.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100) || 'renewed-document.pdf'
    storagePath = `renewals/${crypto.randomUUID()}-${safeName}`
    const supabase = createAdminClient()
    const bytes = Buffer.from(await uploaded.arrayBuffer())
    const { error } = await supabase.storage.from('store-documents').upload(storagePath, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    })
    if (error) throw new Error(`שמירת הקובץ נכשלה: ${error.message}`)
    sourceUrl = `/api/ops/document-file/${documentId}-v${current.version + 1}`
  }

  if (!sourceUrl) throw new Error('יש להדביק קישור או לצרף מסמך חדש')
  const renewed = renewStoredDocument(documentId, {
    sourceUrl,
    storagePath,
    extractedExpiry: String(formData.get('expiry') || '') || null,
  })
  if (storagePath) await linkRenewalUpload(renewed.next, storagePath, uploaded instanceof File ? uploaded.name : 'מסמך מחודש.pdf')
  await mirrorDrive()
  await refresh('/ops/documents')
}

async function linkRenewalUpload(doc: ReturnType<typeof renewStoredDocument>['next'], storagePath: string, name: string) {
  const file = {
    client_id: `file-${doc.id}`, name, mime: 'application/pdf', source_url: doc.sourceUrl,
    doc_type: doc.docType, store_code: doc.storeCode, status: doc.intakeStatus, reason: doc.intakeReason,
    version_of: doc.previousId, deleted_in_source: false, extracted_text: null, stage: 'validate',
    drive_file_id: null, storage_path: storagePath, drive_modified_time: null, origin: 'maintainos',
    local_updated_at: new Date().toISOString(),
  }
  const ingested = {
    id: `file-${doc.id}`, name, mime: 'application/pdf', sourceUrl: doc.sourceUrl, storagePath,
    stage: 'validate' as const, docType: doc.docType, storeCode: doc.storeCode || null, extractedText: null,
    status: doc.intakeStatus, reason: doc.intakeReason, versionOf: doc.previousId, deletedInSource: false,
    driveFileId: null, driveModifiedTime: null, origin: 'maintainos' as const, localUpdatedAt: new Date().toISOString(),
  }
  const currentFiles = listFiles()
  const existingIndex = currentFiles.findIndex((row) => row.id === ingested.id)
  if (existingIndex >= 0) currentFiles[existingIndex] = ingested
  else currentFiles.unshift(ingested)
  if (!(await supabaseReady())) return
  const supabase = createAdminClient()
  const { error: fileError } = await supabase.from('ingested_files').upsert(file, { onConflict: 'client_id' })
  if (fileError) throw new Error(`הקובץ הועלה אך רישומו נכשל: ${fileError.message}`)
  const { error: docError } = await supabase.from('store_documents').update({ storage_path: storagePath, source_url: doc.sourceUrl }).eq('client_id', doc.id)
  if (docError) throw new Error(`הקובץ הועלה אך קישורו למסמך נכשל: ${docError.message}`)
}

export async function ingestFileAction(formData: FormData) {
  await actorName()
  ingestFile({
    name: String(formData.get('name') || ''),
    mime: String(formData.get('mime') || 'application/octet-stream'),
    sourceUrl: String(formData.get('sourceUrl') || '') || null,
    storeCodeHint: String(formData.get('storeCode') || '') || null,
    extractedText: String(formData.get('text') || '') || null,
    knownStoreCodes: ISRAEL_STORES.map((store) => store.code),
  })
  await refresh('/ops/documents')
}

export async function addTaskAction(formData: FormData) {
  await actorName()
  addTask({
    title: String(formData.get('title') || ''),
    storeId: null,
    storeCode: String(formData.get('storeCode') || '') || null,
    assignee: String(formData.get('assignee') || '') || null,
    dueAt: String(formData.get('due') || '') || null,
    ticketId: String(formData.get('ticketId') || '') || null,
    documentId: null,
    spendId: null,
    needsClarification: !formData.get('assignee') || !formData.get('due'),
    clarification:
      !formData.get('assignee') || !formData.get('due')
        ? 'חסר אחראי או מועד'
        : null,
    repeatDays: Number(formData.get('repeatDays')) > 0 ? Number(formData.get('repeatDays')) : null,
  })
  await refresh('/ops/tasks')
}

export async function voiceTasksAction(formData: FormData) {
  const actor = await actorName()
  const result = addTasksFromTranscript(String(formData.get('transcript') || ''), actor)
  if (result.spends.length) {
    await notifyAri(`הקלטה יצרה ${result.spends.length} בקשות כספיות. הן ממתינות לאישור ולא יצאו לביצוע.`)
  }
  await refresh('/ops/tasks')
}

export async function toggleTaskAction(formData: FormData) {
  await actorName()
  toggleTask(String(formData.get('id')), formData.get('done') === '1')
  await refresh('/ops/tasks')
}

export async function setTaskStatusAction(formData: FormData) {
  await actorName()
  const status = String(formData.get('status') || '')
  if (!isTaskStatus(status)) throw new Error('סטטוס לא תקין')
  setTaskStatus(String(formData.get('id') || ''), status)
  await refresh('/ops/tasks')
}

export async function addItemAction(formData: FormData) {
  await actorName()
  addCatalogItem(String(formData.get('name') || ''), String(formData.get('sku') || ''))
  await refresh('/ops/inventory')
}

export async function moveStockAction(formData: FormData) {
  await actorName()
  const kind = String(formData.get('kind'))
  if (kind !== 'in' && kind !== 'out' && kind !== 'transfer') throw new Error('תנועה לא תקינה')
  moveStock({
    itemId: String(formData.get('itemId') || ''),
    fromLocationId: String(formData.get('from') || '') || null,
    toLocationId: String(formData.get('to') || '') || null,
    quantity: Number(formData.get('quantity') || 0),
    ticketId: String(formData.get('ticketId') || '') || null,
    kind,
  })
  await refresh('/ops/inventory')
}

export async function addOutcomeAction(formData: FormData) {
  await actorName()
  addOutcome({
    vendorId: String(formData.get('vendorId') || crypto.randomUUID()),
    vendorName: String(formData.get('vendorName') || ''),
    category: String(formData.get('category') || 'other'),
    region: String(formData.get('region') || '') || null,
    price: Number(formData.get('price') || 0) || null,
    arrivalMinutes: Number(formData.get('arrival') || 0) || null,
    quality: Number(formData.get('quality') || 0) || null,
    warrantyNote: String(formData.get('warranty') || '') || null,
    success: formData.get('success') === 'on',
  })
  await refresh('/ops/professionals')
}

export async function correctCategoryAction(formData: FormData) {
  const ticketId = String(formData.get('ticketId') || '')
  const from = String(formData.get('from') || '')
  const to = String(formData.get('to') || '')
  const priority = String(formData.get('priority') || '') as TicketPriority
  const reason = String(formData.get('reason') || '')
  if (TICKET_PRIORITIES.includes(priority) && to) {
    await correctTicketClassification({
      ticketId,
      category: to,
      priority,
      reason,
    })
    return
  }
  await actorName()
  recordClassificationCorrection(ticketId, from, to)
}
