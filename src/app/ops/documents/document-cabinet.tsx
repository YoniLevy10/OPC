import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { ListFinder } from '@/components/ops/list-finder'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { IngestedFile } from '@/modules/ingestion/pipeline'
import {
  canonicalizeDocumentType,
  documentClock,
  documentReminderStage,
  documentTypeLabel,
  hearingCalibrationSlots,
  isDocumentDueSoon,
  isDocumentOverdue,
  isHearingCalibrationType,
  isRawCertificateTitle,
  remindersFor,
  type StoreDocument,
} from '@/modules/documents/rules'
import { renewDocumentAction, setDocumentExpiryAction, setDocumentRemindersAction, setDocumentTitleAction } from '../work-actions'
import { PhoneFold } from '@/components/layout/phone-fold'
import { Pencil } from 'lucide-react'
import { phrase } from '@/lib/i18n/phrases'
import type { Locale } from '@/lib/i18n/locale'
type PhraseFn = (text: string, vars?: Record<string, string | number>) => string

function fileStatus(p: PhraseFn, status: StoreDocument['intakeStatus']): string {
  const map = {
    ingested: 'נקלט',
    needs_review: 'דורש בדיקה',
    failed: 'נכשל',
  } as const
  return p(map[status])
}

function clockLabel(
  p: PhraseFn,
  clock: ReturnType<typeof documentClock>,
): string {
  const map = {
    extracted: 'תוקף מהמסמך',
    computed: 'מועד מחושב',
    missing: 'אין תאריך',
  } as const
  return p(map[clock])
}

type Folder = {
  key: string
  code: string
  name: string
  docs: StoreDocument[]
}

export function DocumentCabinet({
  documents,
  files,
  locale = 'he',
}: {
  documents: StoreDocument[]
  files: IngestedFile[]
  locale?: Locale
}) {
  const p: PhraseFn = (text, vars) => phrase(locale, text, vars)
  const byId = new Map(files.map((file) => [file.id, file]))
  const filesOnDisk = certificateIds()
  const folders = groupByStore(preferStoredFiles(documents), locale)

  return (
    <ListFinder
      placeholder={p('חיפוש סניף או מסמך')}
      one={p('תיקייה אחת')}
      many={p('תיקיות')}
      className="doc-cabinet"
    >
      {folders.map((folder) => {
        const split = splitStoreDocs(folder.docs)
        const dated = split.activeBySlot
          .flatMap((slot) => slot.docs)
          .filter((doc) => doc.extractedExpiry)
        const next = dated
          .map((doc) => doc.extractedExpiry as string)
          .sort()[0]
        return (
          <details
            key={folder.key}
            className="doc-folder"
            data-find-group
            data-find-key={folder.key}
            data-find={`סניף ${folder.name} ${folder.code} ${folder.docs.map((doc) => paperTitle(doc, fileFor(doc, byId))).join(' ')}`}
          >
            <summary>
              <span className="doc-folder-tab">{p('סניף {name}', { name: folder.name })}</span>
              <span className="doc-peek" aria-hidden>
                {folder.docs.slice(0, 3).map((doc) => (
                  <span key={doc.id} className="doc-peek-sheet">
                    {paperTitle(doc, fileFor(doc, byId))}
                  </span>
                ))}
              </span>
              <span className="doc-folder-face">
                <span className="doc-folder-meta">
                  {folder.code ? `#${folder.code}` : p('בלי קוד')}
                  {next
                    ? ` · ${p('הקרוב {day}', { day: formatDay(next) })}`
                    : ''}
                </span>
              </span>
            </summary>
            <div className="doc-store-body">
              <div className="doc-slot-grid" role="list">
                {split.activeBySlot.map((slot) => {
                  const hot = slot.docs.some(
                    (doc) => isDocumentOverdue(doc) || isDocumentDueSoon(doc),
                  )
                  return (
                    <section
                      key={slot.key}
                      className={
                        slot.docs.length === 0
                          ? 'doc-slot is-empty'
                          : hot
                            ? 'doc-slot is-hot'
                            : 'doc-slot'
                      }
                      data-find-item
                      data-find={`${slot.label} ${folder.name}`}
                      role="listitem"
                    >
                      <header className="doc-slot-head">
                        <h3 className="doc-slot-title">{slot.label}</h3>
                        <span
                          className={
                            slot.docs.length === 0
                              ? 'doc-slot-count is-empty'
                              : 'doc-slot-count'
                          }
                        >
                          {slot.docs.length === 0
                            ? p('ריק')
                            : slot.docs.length === 1
                              ? p('מסמך אחד')
                              : p('{count} מסמכים', { count: slot.docs.length })}
                        </span>
                      </header>
                      {slot.docs.length === 0 ? (
                        <p className="doc-slot-empty">
                          {p('אין מסמך פעיל')}
                        </p>
                      ) : (
                        <ol className="doc-slot-papers">
                          {slot.docs.map((doc) => (
                            <Paper
                              key={doc.id}
                              doc={doc}
                              file={fileFor(doc, byId)}
                              fileHref={documentFileHref(doc, filesOnDisk)}
                              p={p}
                            />
                          ))}
                        </ol>
                      )}
                    </section>
                  )
                })}
              </div>

              {split.otherActive.length > 0 ? (
                <section
                  className="doc-slot doc-slot-other"
                  data-find-item
                  data-find={`אחר ${folder.name}`}
                >
                  <header className="doc-slot-head">
                    <h3 className="doc-slot-title">{p('מסמכים אחרים')}</h3>
                    <span className="doc-slot-count">
                      {split.otherActive.length}
                    </span>
                  </header>
                  <ol className="doc-slot-papers">
                    {split.otherActive.map((doc) => (
                      <Paper
                        key={doc.id}
                        doc={doc}
                        file={fileFor(doc, byId)}
                        fileHref={documentFileHref(doc, filesOnDisk)}
                        p={p}
                      />
                    ))}
                  </ol>
                </section>
              ) : null}

              <details
                className="doc-archive"
                data-find-item
                data-find="מסמכים ישנים ארכיון"
              >
                <summary className="doc-archive-summary">
                  <span className="doc-archive-label">{p('מסמכים ישנים')}</span>
                  <span className="doc-slot-count is-muted">
                    {split.archived.length === 0
                      ? p('ריק')
                      : String(split.archived.length)}
                  </span>
                </summary>
                {split.archived.length === 0 ? (
                  <p className="doc-slot-empty">
                    {p('מסמכים שפג תוקפם או שהוחלפו יופיעו כאן')}
                  </p>
                ) : (
                  <ol className="doc-slot-papers doc-archive-list">
                    {split.archived.map((doc) => (
                      <Paper
                        key={doc.id}
                        doc={doc}
                        file={fileFor(doc, byId)}
                        fileHref={documentFileHref(doc, filesOnDisk)}
                        p={p}
                      />
                    ))}
                  </ol>
                )}
              </details>
            </div>
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
  p,
}: {
  doc: StoreDocument
  file: IngestedFile | null
  fileHref: string | null
  p: PhraseFn
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
      <div className="doc-file-head">
        <form action={setDocumentTitleAction} className="doc-name-form">
          <input type="hidden" name="documentId" value={doc.id} />
          <input
            className="doc-name-input"
            name="title"
            defaultValue={doc.title?.trim() || title}
            maxLength={80}
            aria-label={p('שם המסמך {title}', { title })}
            placeholder={p('שם שנוח לארי')}
          />
          <Button
            type="submit"
            size="sm"
            className="w-8 px-0"
            aria-label={p('שמור שם {title}', { title })}
            title={p('שמור שם')}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </Button>
        </form>
        {fileHref ? (
          <Button asChild size="sm">
            <a href={fileHref} target="_blank" rel="noreferrer">
              {p('פתח את המסמך')}
              <span className="sr-only">{p(', נפתח בלשונית חדשה')}</span>
            </a>
          </Button>
        ) : null}
      </div>
      <p className="doc-page-kicker">
        {expiry
          ? p('תוקף {date}', { date: formatDay(expiry) })
          : clockLabel(p, documentClock(doc))}
        {typeLabel !== title ? ` · ${typeLabel}` : ''}
      </p>
      <PhoneFold
        title={p('פרטים')}
        summary={expiry ? formatDay(expiry) : p('תוקף ותזכורת')}
      >
      {expiry ? (
        <p className="doc-page-stamp">
          {p('תוקף {date}', { date: formatDay(expiry) })}
        </p>
      ) : null}
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
        <form action={setDocumentExpiryAction} className={expiry ? 'doc-expiry-quick' : 'doc-expiry-quick is-open'}>
          <input type="hidden" name="documentId" value={doc.id} />
          <label className={expiry ? 'sr-only' : 'doc-expiry-label'} htmlFor={expiryId}>
            {expiry ? p('תוקף {date}', { date: title }) : p('תוקף')}
          </label>
          <input
            id={expiryId}
            className="doc-expiry-date"
            type="date"
            name="expiry"
            required
            defaultValue={expiry ? expiry.slice(0, 10) : undefined}
          />
          <Button type="submit" size="sm" aria-label={p('שמור תוקף {title}', { title })} className="max-md:w-full">
            {p('שמור')}
          </Button>
        </form>
      ) : null}
      <ReminderMenu doc={doc} title={title} p={p} />
      <p className="doc-page-foot">
        {fileStatus(p, doc.intakeStatus)}
        {doc.intakeReason ? ` · ${doc.intakeReason}` : ''} ·{' '}
        {clockLabel(p, documentClock(doc))}
        {overdue && expiry ? p(' · באיחור') : ''}
        {dueSoon ? p(' · תזכורת חודש מראש') : ''}
        {doc.renewed ? p(' · הוחלף') : ''}
      </p>
      {!doc.renewed ? (
        <details className="doc-renew">
          <summary>{p('חידוש')}</summary>
          <form action={renewDocumentAction} className="mt-2 grid gap-2">
            <input type="hidden" name="documentId" value={doc.id} />
            <div className="grid gap-2 sm:grid-cols-2 sm:items-end">
              <label className="grid min-w-0 gap-1">
                <span className="t-caption text-ink-2">{p('העלאת PDF')}</span>
                <input
                  className="field-text w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-foreground"
                  type="file"
                  name="renewalFile"
                  accept="application/pdf,.pdf"
                  aria-label={p('העלה מסמך מחודש')}
                />
              </label>
              <label className="grid min-w-0 gap-1">
                <span className="t-caption text-ink-2">{p('או קישור למסמך')}</span>
                <Input name="sourceUrl" placeholder={p('הדביקו קישור מעודכן')} aria-label={p('קישור למסמך המעודכן')} dir="ltr" />
              </label>
            </div>
            <p className="t-caption text-ink-3">
              {p('אפשר לבחור או לגרור PDF, או להדביק קישור למסמך המעודכן.')}
            </p>
            <Input name="expiry" type="date" aria-label={p('תוקף חדש')} />
            <Button type="submit" size="sm">
              {p('חידוש ושמירה בתיקיית המסמכים')}
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
  if (doc.storagePath) return `/api/ops/document-file/${doc.id}`
  const url = doc.sourceUrl?.trim() ?? ''
  if (url.startsWith('/') && !url.includes('..')) return url
  if (/^https?:\/\//i.test(url) && !/mail\.google\.com|google\.com\/mail/i.test(url)) return url
  if (/^ari-cert-[a-f0-9]{24}$/.test(doc.id) && (doc.storagePath || filesOnDisk.has(doc.id))) {
    return `/api/ops/document-file/${doc.id}`
  }
  return null
}

function ReminderMenu({
  doc,
  title,
  p,
}: {
  doc: StoreDocument
  title: string
  p: PhraseFn
}) {
  const reminders = remindersFor(doc)
  const month = reminders.find((row) => row.months === 1)?.at
  const stage = documentReminderStage(doc)
  return (
    <details className="doc-reminders">
      <summary>
        {stage === 'month' ? p('תזכורת חודש מראש') : p('תזכורת')}
      </summary>
      <form action={setDocumentRemindersAction} className="doc-reminder-form">
        <input type="hidden" name="documentId" value={doc.id} />
        <ReminderField
          id={doc.id}
          label={p('חודש לפני')}
          name="month"
          value={month}
          title={title}
          p={p}
        />
        {doc.extractedExpiry ? (
          <p className="doc-reminder-empty">{p('שדה ריק חוזר לחישוב לפי תאריך התוקף (חודש לפני).')}</p>
        ) : null}
        <Button type="submit" size="sm" aria-label={p('שמור תזכורות {title}', { title })} className="max-md:w-full">
          {p('שמור')}
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
  p,
}: {
  id: string
  label: string
  name: string
  value: string | undefined
  title: string
  p: PhraseFn
}) {
  const reached = value ? new Date(value).getTime() <= Date.now() : false
  const fieldId = `${name}-${id}`
  return (
    <div className="doc-reminder-row">
      <label htmlFor={fieldId}>
        {label}
        {reached ? <span className="doc-reminder-flag">{p('· הגיעה')}</span> : null}
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

function groupByStore(documents: StoreDocument[], locale: Locale): Folder[] {
  const map = new Map<string, Folder>()
  for (const doc of documents) {
    const code = doc.storeCode?.trim() ?? ''
    const name = doc.storeName?.trim() || phrase(locale, 'בלי סניף')
    const key = code || `unassigned:${name}`
    const normalized: StoreDocument = {
      ...doc,
      docType: canonicalizeDocumentType(doc.docType),
    }
    const folder = map.get(key)
    if (folder) folder.docs.push(normalized)
    else map.set(key, { key, code, name, docs: [normalized] })
  }
  return [...map.values()]
    .map((folder) => ({
      ...folder,
      docs: [...folder.docs].sort((a, b) =>
        paperTitle(a, null).localeCompare(paperTitle(b, null), 'he'),
      ),
    }))
    .sort((a, b) => {
      if (!a.code) return 1
      if (!b.code) return -1
      return a.code.localeCompare(b.code, 'en', { numeric: true })
    })
}

/** Active calibrations by Ari's three slots + archive (renewed or overdue). */
function splitStoreDocs(docs: StoreDocument[]): {
  activeBySlot: { key: string; label: string; docs: StoreDocument[] }[]
  otherActive: StoreDocument[]
  archived: StoreDocument[]
} {
  const archived: StoreDocument[] = []
  const active: StoreDocument[] = []
  for (const doc of docs) {
    if (doc.renewed || isDocumentOverdue(doc)) archived.push(doc)
    else active.push(doc)
  }

  const slots = hearingCalibrationSlots().map((slot) => ({
    key: slot.key,
    label: slot.label,
    docs: active.filter(
      (doc) => canonicalizeDocumentType(doc.docType) === slot.key,
    ),
  }))
  const slotKeys = new Set(slots.map((slot) => slot.key))
  const otherActive = active.filter(
    (doc) => !slotKeys.has(canonicalizeDocumentType(doc.docType)),
  )

  return { activeBySlot: slots, otherActive, archived }
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
  const type = canonicalizeDocumentType(doc.docType)
  // Hearing calibrations always show Ari's three category names in the list.
  if (isHearingCalibrationType(type)) {
    const hand = doc.title?.trim()
    if (hand && !isRawCertificateTitle(hand)) return hand
    return documentTypeLabel(type)
  }
  const named = doc.title?.trim()
  if (named) return named
  const fromFile = file?.name?.replace(/\.pdf$/i, '').trim()
  if (fromFile) return fromFile
  return documentTypeLabel(type)
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
