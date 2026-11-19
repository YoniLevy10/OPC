import { redirect } from 'next/navigation'
import { OpsAppShell } from '@/components/layout/ops-app-shell'
import { OpsPageHero } from '@/components/ops/ops-page-hero'
import { EmptyState, Panel } from '@/components/ui/primitives'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { getServerActor } from '@/lib/auth/server-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { listDocuments, listFiles, getDriveSync } from '@/lib/data/ops-ledger'
import { hydrateOpsLedger } from '@/lib/data/ops-db'
import { selectableDocumentTypes } from '@/modules/documents/rules'
import { driveCanWrite, driveFolderUrl } from '@/modules/drive/folder'
import { addDocumentAction, ingestFileAction } from '../work-actions'
import { DocumentCabinet, preferStoredFiles } from './document-cabinet'
import { DocumentAddButton } from './document-add-button'
import { DriveImportForm } from './drive-import-form'
import { PhoneFold, PhoneFoldStack } from '@/components/layout/phone-fold'
import { getLocale } from '@/lib/i18n/server'
import { phrase } from '@/lib/i18n/phrases'

export const dynamic = 'force-dynamic'

export default async function DocumentsPage() {
  const locale = await getLocale()
  const p = (text: string, vars?: Record<string, string | number>) =>
    phrase(locale, text, vars)
  const actor = await getServerActor()
  if (!actor && !shouldAllowDemoEntry()) redirect('/login')
  await hydrateOpsLedger()
  const documents = preferStoredFiles(listDocuments())
  const files = listFiles()
  const review = files.filter((file) => file.status !== 'ingested').length
  const folderCount = new Set(documents.map((doc) => doc.storeCode?.trim() || `unassigned:${doc.storeName}`)).size
  const withExpiry = documents.filter((doc) => doc.extractedExpiry).length
  const sync = getDriveSync()
  const folderId = sync.rootFolderId || process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || null
  const statusLine = sync.lastSyncAt
    ? p('סונכרן לאחרונה {when} · {pulled} מהדרייב · {pushed} לדרייב{error}', {
        when: new Date(sync.lastSyncAt).toLocaleString(
          locale === 'fr' ? 'fr-FR' : 'he-IL',
        ),
        pulled: sync.lastPulled,
        pushed: sync.lastPushed,
        error: sync.lastError
          ? p(' · שגיאה: {msg}', { msg: sync.lastError })
          : '',
      })
    : null

  return (
    <OpsAppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 overflow-x-clip lg:max-w-6xl">
        <OpsPageHero
          title={p('מסמכים ותוקף')}
          status={
            documents.length
              ? p(
                  '{folders} תיקיות · {docs} מסמכים · {withExpiry} עם תאריך תוקף',
                  { folders: folderCount, docs: documents.length, withExpiry },
                )
              : review
                ? p('{review} קבצים דורשים בדיקה', { review })
                : p('תוקף מהמסמך נשמר בנפרד ממועד שחושב')
          }
          actions={<DocumentAddButton />}
        />
        {documents.length === 0 ? (
          <Panel elevated>
            <EmptyState
              title={p('אין מסמכים במעקב')}
              description={p(
                'חברו את תיקיית הדרייב של ארי, או שמרו מסמך עם קישור למקור.',
              )}
            />
          </Panel>
        ) : (
          <DocumentCabinet documents={documents} files={files} locale={locale} />
        )}
        <PhoneFoldStack>
        <PhoneFold title={p('סנכרון עם גוגל דרייב')} summary={statusLine ?? p('לא סונכרן')}>
        <Panel elevated>
          <h2 className="t-section mb-1 text-ink">{p('סנכרון עם גוגל דרייב')}</h2>
          <p className="t-body mb-4 text-ink-2">
            {p(
              'ארי ממשיך לעבוד בתיקיות. קובץ חדש או עדכון אצלו נכנס לכאן, ומסמך שנשמר כאן נכתב לתיקיית הסניף. עריכה שלו גוברת, וקובץ שלו לא נמחק ולא נדרס. מה שלא ברור נשאר לבדיקה.',
            )}
          </p>
          <DriveImportForm
            connectedFolder={folderId ? driveFolderUrl(folderId) : null}
            statusLine={statusLine}
            canWrite={driveCanWrite()}
          />
        </Panel>
        </PhoneFold>
        <PhoneFold title={p('מסמך ידני')} summary={p('לא לשימוש יומיומי')}>
          <form action={addDocumentAction} className="grid gap-3">
            <Field label={p('קוד סניף')} htmlFor="doc-store">
              <Input id="doc-store" name="storeCode" placeholder="6018" required />
            </Field>
            <Field label={p('שם סניף')} htmlFor="doc-store-name">
              <Input id="doc-store-name" name="storeName" required />
            </Field>
            <Field label={p('אחראי חידוש')} htmlFor="doc-owner">
              <Input id="doc-owner" name="owner" />
            </Field>
            <Field label={p('קישור לקובץ המקור')} htmlFor="doc-url">
              <Input id="doc-url" name="sourceUrl" dir="ltr" />
            </Field>
            <Field label={p('תוקף שמופיע במסמך')} htmlFor="doc-expiry">
              <Input id="doc-expiry" name="expiry" type="date" />
            </Field>
            <Field label={p('סוג מסמך')} htmlFor="doc-type">
              <select id="doc-type" name="docType" className="h-11 rounded-md border border-border bg-surface px-2">
                {selectableDocumentTypes().map((type) => (
                  <option key={type.key} value={type.key}>
                    {type.label}
                    {type.hearingCalibration ? p(' · כיול שמיעה') : ''}
                  </option>
                ))}
              </select>
            </Field>
            <p className="t-meta text-ink-2">
              {p(
                'כיולי שמיעה: טימפנומטר ואודיומטר כל שנה, תא אקוסטי כל שנתיים. אישור שמכסה כמה כיולים נשמר בנפרד לכל כיול. תזכורת חודש לפני תוקף.',
              )}
            </p>
            <Button type="submit">{p('שמירת מסמך')}</Button>
          </form>
        </PhoneFold>
        <PhoneFold title={p('קליטה ידנית של קובץ')} summary={p('לא לשימוש יומיומי')}>
          <form action={ingestFileAction} className="grid gap-3">
            <Field label={p('שם קובץ')} htmlFor="file-name">
              <Input id="file-name" name="name" required />
            </Field>
            <Field label={p('קוד סניף')} htmlFor="file-store">
              <Input id="file-store" name="storeCode" />
            </Field>
            <Field label={p('קישור לדרייב')} htmlFor="file-url">
              <Input id="file-url" name="sourceUrl" dir="ltr" />
            </Field>
            <Field label={p('טקסט שחולץ')} htmlFor="file-text">
              <Input id="file-text" name="text" />
            </Field>
            <input type="hidden" name="mime" value="application/pdf" />
            <Button type="submit">{p('קליטה')}</Button>
          </form>
        </PhoneFold>
        </PhoneFoldStack>
      </div>
    </OpsAppShell>
  )
}
