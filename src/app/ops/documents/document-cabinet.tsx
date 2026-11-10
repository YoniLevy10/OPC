import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { ListFinder } from '@/components/ops/list-finder'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { IngestedFile } from '@/modules/ingestion/pipeline'
import {
  documentClock,
  documentReminderStage,
  remindersFor,
  documentTypeLabel,
  isDocumentDueSoon,
  isDocumentOverdue,
  type StoreDocument,
} from '@/modules/documents/rules'
import { renewDocumentAction, setDocumentExpiryAction, setDocumentRemindersAction, setDocumentTitleAction } from '../work-actions'
import { PhoneFold } from '@/components/layout/phone-fold'
import { ChevronDown, FileText, Pencil } from 'lucide-react'

const FILE_STATUS = {
  ingested: 'נקלט',
  needs_review: 'דורש בדיקה',
  failed: 'נכשל',
} as const

const CLOCK = {
  extracted: 'תוקף מהמסמך',
  computed: 'מועד מחושב',
  missing: 'אין תאריך',
} as const

type Folder = {
  key: string
  code: string
  name: string
  docs: StoreDocument[]
}

export function DocumentCabinet({
  documents,
  files,
}: {
  documents: StoreDocument[]
  files: IngestedFile[]
}) {
  const byId = new Map(files.map((file) => [file.id, file]))
  const filesOnDisk = certificateIds()
  const folders = groupByStore(preferStoredFiles(documents))

  return (
    <ListFinder
      placeholder="חיפוש סניף או מסמך"
      one="תיקייה אחת"
      many="תיקיות"
      className="grid gap-2"
    >
      {folders.map((folder) => {
        const current = folder.docs.filter((doc) => !doc.renewed)
        const overdue = current.filter((doc) => isDocumentOverdue(doc)).length
        const dueSoon = current.filter((doc) => isDocumentDueSoon(doc) && !isDocumentOverdue(doc)).length
        const dated = current.filter((doc) => doc.extractedExpiry)
        const next = dated
          .map((doc) => doc.extractedExpiry as string)
          .sort()[0]
        return (
          <details
            key={folder.key}
            className="group overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface"
            data-find-group
            data-find-key={folder.key}
            data-find={`סניף ${folder.name} ${folder.code} ${folder.docs.map((doc) => paperTitle(doc, fileFor(doc, byId))).join(' ')}`}
          >
            <summary className="flex min-h-20 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <FileText className="h-5 w-5 shrink-0 text-ink-3" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="t-body-strong block text-ink">{folder.name}</span>
                <span className="t-caption mt-1 block text-ink-2">
                  {folder.code ? `#${folder.code} · ` : ''}{folder.docs.length === 1 ? 'מסמך אחד' : `${folder.docs.length} מסמכים`}
                  {next ? ` · תוקף ${formatDay(next)}` : ' · חסר תאריך תוקף'}
                </span>
              </span>
              <span className={`t-caption shrink-0 font-semibold ${overdue ? 'text-[var(--signal-critical)]' : dueSoon ? 'text-[var(--signal-warning)]' : 'text-ink-3'}`}>
                {overdue ? `${overdue} פגי תוקף` : dueSoon ? `${dueSoon} לחידוש בקרוב` : 'לצפייה'}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ol className="grid gap-3 border-t border-border bg-canvas p-3 lg:grid-cols-2">
              {folder.docs.map((doc) => (
                <Paper
                  key={doc.id}
                  doc={doc}
                  file={fileFor(doc, byId)}
                  fileHref={documentFileHref(doc, filesOnDisk)}
                />
              ))}
            </ol>
          </details>
        )
      })}
    </ListFinder>
  )
}

function Paper({
  doc,
  file,
  fileHref,
}: {
  doc: StoreDocument
  file: IngestedFile | null
  fileHref: string | null
}) {
  const title = paperTitle(doc, file)
  const typeLabel = documentTypeLabel(doc.docType)
  const excerpt = excerptOf(file?.extractedText)
  const preview = hasPreview(doc.id)
  const expiry = doc.extractedExpiry
  const overdue = isDocumentOverdue(doc)
  const dueSoon = isDocumentDueSoon(doc)
  const expiryId = `expiry-${doc.id}`
  return (
    <li
      className={`${overdue ? 'doc-page edge edge-overdue' : 'doc-page'} doc-file-row`}
      data-find-item
      data-find={`${title} ${typeLabel} ${expiry ? formatDay(expiry) : ''} ${expiry?.slice(0, 10) ?? ''}`}
    >
      <div className="doc-file-head max-md:!flex-col max-md:!items-stretch">
        <form action={setDocumentTitleAction} className="doc-name-form max-md:w-full">
          <input type="hidden" name="documentId" value={doc.id} />
          <input
            className="doc-name-input min-h-11"
            name="title"
            defaultValue={doc.title?.trim() || title}
            maxLength={80}
            aria-label={`שם המסמך ${title}`}
            placeholder="שם שנוח לארי"
          />
          <Button
            type="submit"
            size="sm"
            className="min-h-11 min-w-11 px-0"
            aria-label={`שמור שם ${title}`}
            title="שמור שם"
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
        </form>
        {fileHref ? (
          <Button asChild size="sm">
            <a href={fileHref} target="_blank" rel="noreferrer">
              פתח את המסמך
              <span className="sr-only">, נפתח בלשונית חדשה</span>
            </a>
          </Button>
        ) : null}
      </div>
      <p className="doc-page-kicker">
        {expiry ? `תוקף ${formatDay(expiry)}` : CLOCK[documentClock(doc)]}
        {typeLabel !== title ? ` · ${typeLabel}` : ''}
      </p>
      <PhoneFold title="פרטים" summary={expiry ? formatDay(expiry) : 'תוקף ותזכורת'}>
      {expiry ? <p className="doc-page-stamp">תוקף {formatDay(expiry)}</p> : null}
      <div className="doc-page-body">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="doc-page-scan"
            alt=""
            src={`/api/ops/document-preview/${doc.id}`}
          />
        ) : excerpt ? (
          <p className="doc-page-excerpt">{excerpt}</p>
        ) : (
          <div className="doc-page-lines" aria-hidden>
            <span />
            <span />
            <span />
            <span />
          </div>
        )}
      </div>
      {!doc.renewed ? (
        <form action={setDocumentExpiryAction} className={`${expiry ? 'doc-expiry-quick' : 'doc-expiry-quick is-open'} max-md:!flex-col max-md:!items-stretch`}>
          <input type="hidden" name="documentId" value={doc.id} />
          <label className={expiry ? 'sr-only' : 'doc-expiry-label'} htmlFor={expiryId}>
            {expiry ? `תוקף ${title}` : 'תוקף'}
          </label>
          <input
            id={expiryId}
            className="doc-expiry-date min-h-11 w-full"
            type="date"
            name="expiry"
            required
            defaultValue={expiry ? expiry.slice(0, 10) : undefined}
          />
          <Button type="submit" size="sm" aria-label={`שמור תוקף ${title}`} className="max-md:w-full">
            שמור
          </Button>
        </form>
      ) : null}
      <ReminderMenu doc={doc} title={title} />
      <p className="doc-page-foot">
        {FILE_STATUS[doc.intakeStatus]}
        {doc.intakeReason ? ` · ${doc.intakeReason}` : ''} · {CLOCK[documentClock(doc)]}
        {overdue && expiry ? ' · באיחור' : ''}
        {dueSoon ? ' · תזכורת חודש מראש' : ''}
        {doc.renewed ? ' · הוחלף' : ''}
      </p>
      {!doc.renewed ? (
        <details className="doc-renew">
          <summary>חידוש</summary>
          <form action={renewDocumentAction} className="mt-2 grid gap-2">
            <input type="hidden" name="documentId" value={doc.id} />
            <Input name="sourceUrl" placeholder="קישור למסמך המעודכן" aria-label="קישור למסמך המעודכן" required />
            <Input name="expiry" type="date" aria-label="תוקף חדש" />
            <Button type="submit" size="sm">
              חידוש
            </Button>
          </form>
        </details>
      ) : null}
      </PhoneFold>
    </li>
  )
}

function fileFor(doc: StoreDocument, byId: Map<string, IngestedFile>): IngestedFile | null {
  return (
    byId.get(`file-${doc.id}`) ??
    byId.get(doc.id.replace(/^ari-cert-/, 'ari-file-')) ??
    (doc.sourceUrl ? [...byId.values()].find((file) => file.sourceUrl === doc.sourceUrl) ?? null : null)
  )
}

/** A link that opens the certificate itself. Mail threads are not the file. */
function documentFileHref(doc: StoreDocument, filesOnDisk: Set<string>): string | null {
  const url = doc.sourceUrl?.trim() ?? ''
  if (url.startsWith('/') && !url.includes('..')) return url
  if (/^https?:\/\//i.test(url) && !/mail\.google\.com|google\.com\/mail/i.test(url)) return url
  if (/^ari-cert-[a-f0-9]{24}$/.test(doc.id) && (doc.storagePath || filesOnDisk.has(doc.id))) {
    return `/api/ops/document-file/${doc.id}`
  }
  return null
}

function ReminderMenu({ doc, title }: { doc: StoreDocument; title: string }) {
  const reminders = remindersFor(doc)
  const six = reminders.find((row) => row.months === 6)?.at
  const two = reminders.find((row) => row.months === 2)?.at
  const stage = documentReminderStage(doc)
  return (
    <details className="doc-reminders">
      <summary>
        {stage === 'two' ? 'תזכורת חודשיים' : stage === 'six' ? 'תזכורת חצי שנה' : 'תזכורות'}
      </summary>
      <form action={setDocumentRemindersAction} className="doc-reminder-form">
        <input type="hidden" name="documentId" value={doc.id} />
        <ReminderField id={doc.id} label="חצי שנה לפני" name="six" value={six} title={title} />
        <ReminderField id={doc.id} label="חודשיים לפני" name="two" value={two} title={title} />
        {doc.extractedExpiry ? (
          <p className="doc-reminder-empty">שדה ריק חוזר לחישוב לפי תאריך התוקף.</p>
        ) : null}
        <Button type="submit" size="sm" aria-label={`שמור תזכורות ${title}`} className="max-md:w-full">
          שמור
        </Button>
      </form>
    </details>
  )
}

function ReminderField({
  id,
  label,
  name,
  value,
  title,
}: {
  id: string
  label: string
  name: string
  value: string | undefined
  title: string
}) {
  const reached = value ? new Date(value).getTime() <= Date.now() : false
  const fieldId = `${name}-${id}`
  return (
    <div className="doc-reminder-row">
      <label htmlFor={fieldId}>
        {label}
        {reached ? <span className="doc-reminder-flag"> · הגיעה</span> : null}
      </label>
      <input
        id={fieldId}
        className="doc-expiry-date"
        type="date"
        name={name}
        aria-label={`${label} ${title}`}
        defaultValue={value ? value.slice(0, 10) : undefined}
      />
    </div>
  )
}

/** The uploaded certificate is the file. Catalog copies of the same store stay out of its folder. */
export function preferStoredFiles(documents: StoreDocument[]): StoreDocument[] {
  const storedStores = new Set(
    documents
      .filter((doc) => doc.storagePath || doc.id.startsWith('ari-cert-'))
      .map((doc) => doc.storeCode?.trim() || '')
      .filter(Boolean),
  )
  return documents.filter((doc) => {
    if (!doc.id.startsWith('branch-')) return true
    const code = doc.storeCode?.trim() || ''
    return !code || !storedStores.has(code)
  })
}

function groupByStore(documents: StoreDocument[]): Folder[] {
  const map = new Map<string, Folder>()
  for (const doc of documents) {
    const code = doc.storeCode?.trim() ?? ''
    const name = doc.storeName?.trim() || 'בלי סניף'
    const key = code || `unassigned:${name}`
    const folder = map.get(key)
    if (folder) folder.docs.push(doc)
    else map.set(key, { key, code, name, docs: [doc] })
  }
  return [...map.values()]
    .map((folder) => ({
      ...folder,
      docs: [...folder.docs].sort((a, b) => documentPriority(a) - documentPriority(b) || (a.extractedExpiry || '9999').localeCompare(b.extractedExpiry || '9999') || paperTitle(a, null).localeCompare(paperTitle(b, null), 'he')),
    }))
    .sort((a, b) => {
      const priority = Math.min(...a.docs.map(documentPriority)) - Math.min(...b.docs.map(documentPriority))
      if (priority) return priority
      if (!a.code) return 1
      if (!b.code) return -1
      return a.code.localeCompare(b.code, 'en', { numeric: true })
    })
}

function documentPriority(doc: StoreDocument): number {
  if (doc.renewed) return 4
  if (isDocumentOverdue(doc)) return 0
  if (isDocumentDueSoon(doc)) return 1
  if (!doc.extractedExpiry) return 2
  return 3
}

function certificateIds(): Set<string> {
  const file = join(process.cwd(), '.local', 'certificates', 'index.json')
  if (!existsSync(file)) return new Set()
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  return new Set(Object.keys(parsed))
}

function hasPreview(id: string): boolean {
  if (!/^ari-cert-[a-f0-9]{24}$/.test(id)) return false
  return existsSync(join(process.cwd(), '.local', 'doc-previews', `${id}.png`))
}

function paperTitle(doc: StoreDocument, file: IngestedFile | null | undefined): string {
  const named = doc.title?.trim()
  if (named) return named
  const fromFile = file?.name?.replace(/\.pdf$/i, '').trim()
  if (fromFile) return fromFile
  return documentTypeLabel(doc.docType)
}

function excerptOf(text: string | null | undefined): string | null {
  if (!text) return null
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length < 12) return null
  return clean.slice(0, 280)
}

function formatDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  return date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
