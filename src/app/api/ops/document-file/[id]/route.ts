import { readFile } from 'fs/promises'
import { join, sep } from 'path'
import { NextResponse } from 'next/server'
import { authErrorResponse, requireActor } from '@/lib/auth/request-actor'
import { listDocuments } from '@/lib/data/ops-ledger'
import { createAdminClient } from '@/lib/supabase/admin'
import { canReadStoreDocument } from '@/modules/documents/store-document-access'

const ID = /^ari-cert-[a-f0-9]{24}$/
const BUCKET = 'store-documents'

type IndexEntry = { path?: string; name?: string }

/** The certificate file stored for this document, not the email that carried it. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const docs = listDocuments()
  const listed = docs.find((doc) => doc.id === id) ?? null
  const baseId = listed?.previousId ? docs.find((doc) => doc.id === listed.previousId)?.id : id.replace(/-v\d+$/, '')
  const baseDoc = listed ?? docs.find((doc) => doc.id === baseId) ?? null
  const fileDoc = listed?.storagePath ? listed : baseDoc
  if (!listed && !ID.test(id) && !baseDoc) return new NextResponse(null, { status: 404 })
  let actor
  try {
    actor = await requireActor(request)
  } catch (err) {
    return authErrorResponse(err)
  }
  const storeId = baseDoc?.storeId || (await documentStoreId(id))
  if (!canReadStoreDocument(actor.memberships, storeId || null, storeId ? await documentStoreScope(storeId) : null)) {
    return new NextResponse(null, { status: 403 })
  }
  if (!fileDoc?.storagePath && !ID.test(id)) return new NextResponse(null, { status: 404 })

  const stored = fileDoc?.storagePath
    ? await fileFromStoragePath(fileDoc.storagePath, fileDoc.id)
    : await fileFromBucket(id)
  if (stored) return stored
  if (process.env.NODE_ENV === 'production') return new NextResponse(null, { status: 404 })
  return fileFromDisk(id)
}

async function documentStoreScope(id: string) {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase.from('stores').select('id, organization_id, country_id, region_id').eq('id', id).maybeSingle()
    return data ? { id: data.id, organization_id: data.organization_id, country_id: data.country_id, region_id: data.region_id } : null
  } catch { return null }
}

async function documentStoreId(id: string): Promise<string | null> {
  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from('store_documents')
      .select('store_id')
      .eq('client_id', id)
      .maybeSingle()
    return data?.store_id ? String(data.store_id) : null
  } catch {
    return null
  }
}

async function fileFromBucket(id: string): Promise<NextResponse | null> {
  try {
    const supabase = createAdminClient()
    const { data: row, error } = await supabase
      .from('store_documents')
      .select('storage_path')
      .eq('client_id', id)
      .maybeSingle()
    const storagePath = row?.storage_path ? String(row.storage_path) : ''
    if (error || !storagePath || storagePath.includes('..')) return null
    return await fileFromStoragePath(storagePath, id, supabase)
  } catch {
    return null
  }
}

async function fileFromStoragePath(storagePath: string, id: string, client = createAdminClient()): Promise<NextResponse | null> {
  try {
    const { data, error } = await client.storage.from(BUCKET).download(storagePath)
    if (error || !data) return null
    const { data: named } = await client.from('ingested_files').select('name').eq('storage_path', storagePath).limit(1)
    const name = named?.[0]?.name ? String(named[0].name) : `${id}.pdf`
    return pdfResponse(Buffer.from(await data.arrayBuffer()), name)
  } catch { return null }
}

async function fileFromDisk(id: string): Promise<NextResponse> {
  const root = join(process.cwd(), '.local', 'certificates')
  try {
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as Record<string, IndexEntry>
    const entry = index[id]
    const rel = entry?.path
    if (!rel || rel.includes('..') || rel.startsWith('/') || rel.startsWith('\\')) {
      return new NextResponse(null, { status: 404 })
    }
    const full = join(root, rel)
    if (!full.startsWith(root + sep)) return new NextResponse(null, { status: 404 })
    const bytes = await readFile(full)
    return pdfResponse(bytes, entry.name || 'certificate.pdf')
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}

function pdfResponse(bytes: Uint8Array, name: string) {
  const body = new Uint8Array(bytes.byteLength)
  body.set(bytes)
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'private, max-age=3600',
    },
  })
}
