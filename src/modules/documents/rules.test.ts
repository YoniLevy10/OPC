import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_TYPES,
  documentNeedsReminder,
  cleanDocumentTitle,
  documentTypeLabel,
  documentReminders,
  documentReminderStage,
  remindersFor,
  renewDocument,
  isDocumentDueSoon,
  isDocumentOverdue,
  isHearingCalibrationType,
  selectableDocumentTypes,
  type StoreDocument,
} from './rules'

function doc(patch: Partial<StoreDocument> = {}): StoreDocument {
  return {
    id: 'd1',
    storeId: 's',
    storeCode: '6018',
    storeName: 'כרמיאל',
    docType: 'hearing_a',
    sourceUrl: 'https://drive/x',
    extractedExpiry: '2026-11-15T00:00:00.000Z',
    computedNextCheck: null,
    owner: 'ארי',
    intakeStatus: 'ingested',
    intakeReason: null,
    version: 1,
    previousId: null,
    renewed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  }
}

describe('C08 hearing calibrations', () => {
  it('exposes tympanometer, audiometer, and the acoustic booth', () => {
    const keys = selectableDocumentTypes().map((row) => row.key)
    expect(keys).toContain('hearing_a')
    expect(keys).toContain('hearing_b')
    expect(keys).toContain('hearing_c')
    expect(keys).not.toContain('hearing')
    expect(documentTypeLabel('hearing_a')).toBe('טימפנומטר')
    expect(documentTypeLabel('hearing_b')).toBe('אודיומטר')
    expect(documentTypeLabel('hearing_c')).toBe('תא אקוסטי')
    expect(DOCUMENT_TYPES.find((row) => row.key === 'hearing_c')?.cycleMonths).toBe(24)
    expect(DOCUMENT_TYPES.find((row) => row.key === 'hearing_a')?.cycleMonths).toBe(12)
    expect(isHearingCalibrationType('hearing_a')).toBe(true)
    expect(isHearingCalibrationType('fire')).toBe(false)
  })

  it('keeps legacy hearing in DOCUMENT_TYPES for existing rows', () => {
    expect(DOCUMENT_TYPES.some((row) => row.key === 'hearing')).toBe(true)
    expect(documentTypeLabel('hearing')).toMatch(/ישן/)
  })

  it('flags month-ahead due-soon for calibrations (~30 days)', () => {
    const now = new Date('2026-10-20T12:00:00.000Z')
    const soon = doc({ extractedExpiry: '2026-11-10T00:00:00.000Z', docType: 'hearing_b' })
    const far = doc({ extractedExpiry: '2027-06-01T00:00:00.000Z', docType: 'hearing_c' })
    const fireSoon = doc({
      extractedExpiry: '2026-11-10T00:00:00.000Z',
      docType: 'fire',
    })
    expect(isDocumentDueSoon(soon, now)).toBe(true)
    expect(isDocumentOverdue(soon, now)).toBe(false)
    expect(documentNeedsReminder(soon, now)).toBe(true)
    expect(isDocumentDueSoon(far, now)).toBe(false)
    expect(isDocumentDueSoon(fireSoon, now)).toBe(false)
  })

  it('sets a reminder half a year before and another two months before', () => {
    const [half, two] = documentReminders('2027-06-15T00:00:00.000Z')
    expect(half.at.slice(0, 10)).toBe('2026-12-15')
    expect(two.at.slice(0, 10)).toBe('2027-04-15')
    const now = new Date('2027-01-02T00:00:00.000Z')
    expect(documentReminderStage(doc({ extractedExpiry: '2027-06-15T00:00:00.000Z' }), now)).toBe(
      'six',
    )
    expect(
      documentReminderStage(doc({ extractedExpiry: '2027-06-15T00:00:00.000Z' }), new Date('2027-05-01T00:00:00.000Z')),
    ).toBe('two')
    expect(
      documentReminderStage(doc({ extractedExpiry: '2027-06-15T00:00:00.000Z' }), new Date('2026-11-01T00:00:00.000Z')),
    ).toBeNull()
    const edited = doc({
      extractedExpiry: '2027-06-15T00:00:00.000Z',
      reminderSixAt: '2027-02-01T00:00:00.000Z',
    })
    expect(remindersFor(edited).find((row) => row.months === 6)?.at.slice(0, 10)).toBe('2027-02-01')
    expect(remindersFor(edited).find((row) => row.months === 2)?.at.slice(0, 10)).toBe('2027-04-15')
  })

  it('keeps a hand-typed document name and clears a blank one', () => {
    expect(cleanDocumentTitle('  כיול   אודיומטר  ')).toBe('כיול אודיומטר')
    expect(cleanDocumentTitle('   ')).toBeNull()
    expect(() => cleanDocumentTitle('א'.repeat(81))).toThrow('השם ארוך מדי')
  })

  it('does not treat overdue as due-soon', () => {
    const now = new Date('2026-10-20T12:00:00.000Z')
    const overdue = doc({ extractedExpiry: '2026-09-01T00:00:00.000Z' })
    expect(isDocumentOverdue(overdue, now)).toBe(true)
    expect(isDocumentDueSoon(overdue, now)).toBe(false)
    expect(documentNeedsReminder(overdue, now)).toBe(true)
  })
})

describe('document renewal', () => {
  const now = '2026-11-10T12:00:00.000Z'

  it.each([
    { sourceUrl: '', extractedExpiry: '2027-01-01' },
    { sourceUrl: 'not a URL', extractedExpiry: '2027-01-01' },
    { sourceUrl: 'javascript:alert(1)', extractedExpiry: '2027-01-01' },
    { sourceUrl: 'https://user:password@example.com/new.pdf', extractedExpiry: '2027-01-01' },
    { sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/123', extractedExpiry: '2027-01-01' },
    { sourceUrl: 'https://example.com/new.pdf', extractedExpiry: null },
    { sourceUrl: 'https://example.com/new.pdf', extractedExpiry: '2027-02-30' },
    { sourceUrl: 'https://example.com/new.pdf', extractedExpiry: '2026-11-09' },
    { sourceUrl: 'https://example.com/new.pdf', extractedExpiry: '01/02/2027' },
  ])('keeps the original active when the replacement is invalid ($sourceUrl, $extractedExpiry)', (replacement) => {
    const original = doc()
    const previous = { ...original }
    expect(() => renewDocument(original, replacement, now)).toThrow()
    expect(original).toEqual(previous)
    expect(original.renewed).toBe(false)
  })

  it('creates a separate valid version without inheriting the old file or reminder dates', () => {
    const original = doc({
      storagePath: 'old.pdf', driveFileId: 'old-drive-file', computedNextCheck: '2026-11-15T00:00:00Z',
      reminderSixAt: '2026-05-15T00:00:00Z', reminderTwoAt: '2026-09-15T00:00:00Z',
    })
    const result = renewDocument(original, { sourceUrl: ' https://example.com/new.pdf ', extractedExpiry: '2027-11-10' }, now)
    expect(original.renewed).toBe(false)
    expect(result.closed.renewed).toBe(true)
    expect(result.next).toMatchObject({
      sourceUrl: 'https://example.com/new.pdf', extractedExpiry: '2027-11-10T00:00:00.000Z',
      version: 2, previousId: original.id, renewed: false, intakeStatus: 'ingested',
      storagePath: null, driveFileId: null, computedNextCheck: null, reminderSixAt: null, reminderTwoAt: null,
    })
    expect(remindersFor(result.next).map((row) => row.at.slice(0, 10))).toEqual(['2027-05-10', '2027-09-10'])
  })

  it('does not renew an already retired version again', () => {
    expect(() => renewDocument(doc({ renewed: true }), {
      sourceUrl: 'https://example.com/new.pdf', extractedExpiry: '2027-11-10',
    }, now)).toThrow('כבר חודש')
  })
})
