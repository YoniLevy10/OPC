'use client'

import {
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import Link from 'next/link'
import { ChevronDown, MessageCircle, Phone, Plus, Pencil, Star, Trash2 } from 'lucide-react'
import { formatIsraeliPhoneDisplay, normalizePhoneDigits } from '@/lib/phone'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import {
  EmptyState,
  ErrorState,
  Notice,
  Panel,
} from '@/components/ui/primitives'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { AdminRow, AdminRowList } from '@/components/ui/admin-row'
import { Modal } from '@/components/ui/overlay'
import { TICKET_CATEGORY_LABELS_HE, TICKET_CATEGORIES } from '@/modules/tickets/constants'
import {
  formatPersonalRating,
  parsePersonalRating,
} from '@/modules/notes/personal-rating'
import { cn } from '@/lib/utils'
import { usePhrase } from '@/components/i18n/locale-provider'

export type VendorDispatchHint = {
  ticket_id: string
  ticket_display: string | null
  created_at: string
  status?: string
}

export type VendorRow = {
  id: string
  name: string
  contact_phone: string | null
  contact_email: string | null
  specialties: string
  active: boolean
  webhook_url: string | null
  has_hmac: boolean
  preferred?: boolean
  coverage_regions?: string[]
  notes?: string | null
  open_tickets: number
  avg_response_label: string
  recent: VendorDispatchHint[]
}

function specialtyLabel(raw: string) {
  const key = raw.trim().toLowerCase()
  return TICKET_CATEGORY_LABELS_HE[key] ?? raw
}

function reachLinks(phone: string | null) {
  const digits = normalizePhoneDigits(phone)
  if (!digits) return null
  return {
    tel: `tel:+${digits}`,
    wa: `https://wa.me/${digits}`,
    label: formatIsraeliPhoneDisplay(phone || digits),
  }
}

function VendorReach({ vendor }: { vendor: VendorRow }) {
  const p = usePhrase()
  const links = reachLinks(vendor.contact_phone)
  if (!links) {
    return <span className="t-caption text-ink-3">{p('אין טלפון')}</span>
  }
  const icon =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-ink hover:bg-surface-sunken'
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span dir="ltr" className="t-meta text-ink">{links.label}</span>
      <a href={links.wa} target="_blank" rel="noreferrer" aria-label={p('וואטסאפ אל {name}', { name: vendor.name })} className={icon}>
        <MessageCircle className="h-4 w-4" aria-hidden />
      </a>
      <a href={links.tel} aria-label={p('התקשר אל {name}', { name: vendor.name })} className={icon}>
        <Phone className="h-4 w-4" aria-hidden />
      </a>
    </span>
  )
}

function fmtShort(iso: string) {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function VendorsAdmin({
  initialVendors,
}: {
  initialVendors?: VendorRow[]
}) {
  const p = usePhrase()
  const [vendors, setVendors] = useState<VendorRow[]>(initialVendors ?? [])
  const [loading, setLoading] = useState(!initialVendors)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingVendor, setEditingVendor] = useState<VendorRow | null>(null)
  const [rating, setRating] = useState(0)
  const [personalNote, setPersonalNote] = useState('')
  const [dispatchOpen, setDispatchOpen] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [specialties, setSpecialties] = useState('hvac')
  const [notes, setNotes] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')

  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  function editVendor(v: VendorRow) {
    setEditingVendor(v)
    const parsed = parsePersonalRating(v.notes)
    setRating(parsed.rating)
    setPersonalNote(parsed.note)
  }

  async function saveVendorEdit() {
    if (!editingVendor) return
    setBusy(true)
    try {
      const notes = formatPersonalRating(rating, personalNote)
      const response = await fetch(`/api/vendors/${editingVendor.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || p('השמירה נכשלה'))
      setEditingVendor(null)
      setNotice(p('פרטי הספק נשמרו'))
      await load()
    } catch {
      setError(p('השמירה נכשלה'))
    } finally {
      setBusy(false)
    }
  }

  async function saveVendorDetails(vendor: VendorRow, nextRating: number, nextNote: string) {
    setBusy(true)
    setError(null)
    try {
      const notes = formatPersonalRating(nextRating, nextNote)
      const response = await fetch(`/api/vendors/${vendor.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || p('השמירה נכשלה'))
      setNotice(p('הדירוג וההערה נשמרו'))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : p('השמירה נכשלה'))
    } finally {
      setBusy(false)
    }
  }

  async function deleteVendor() {
    if (
      !editingVendor ||
      !window.confirm(p('למחוק את {name}?', { name: editingVendor.name }))
    )
      return
    setBusy(true)
    try {
      const response = await fetch(`/api/vendors/${editingVendor.id}`, { method: 'DELETE' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || p('המחיקה נכשלה'))
      setEditingVendor(null)
      setNotice(p('הספק נמחק'))
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : p('המחיקה נכשלה')) } finally { setBusy(false) }
  }

  const [dispatchTicketId, setDispatchTicketId] = useState('')
  const [dispatchVendorId, setDispatchVendorId] = useState(
    initialVendors?.find((v) => v.active)?.id ?? '',
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/vendors')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('טעינה נכשלה'))
      const next = (json.vendors ?? []) as VendorRow[]
      setVendors((prev) => {
        const statsById = new Map(prev.map((v) => [v.id, v]))
        return next.map((v) => {
          const prevRow = statsById.get(v.id)
          return {
            ...v,
            open_tickets: prevRow?.open_tickets ?? v.open_tickets ?? 0,
            avg_response_label: prevRow?.avg_response_label ?? v.avg_response_label ?? '—',
            recent: prevRow?.recent ?? v.recent ?? [],
          }
        })
      })
      if (!dispatchVendorId && next[0]?.id) {
        setDispatchVendorId(next.find((v) => v.active)?.id ?? next[0].id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : p('טעינה נכשלה'))
    } finally {
      setLoading(false)
    }
  }, [dispatchVendorId, p])

  useEffect(() => {
    if (initialVendors) return
    void load()
  }, [initialVendors, load])

  const categories = useMemo(() => {
    const set = new Set(vendors.map((v) => v.specialties.trim()).filter(Boolean))
    return Array.from(set).sort((a, b) =>
      specialtyLabel(a).localeCompare(specialtyLabel(b), 'he'),
    )
  }, [vendors])

  const filtered = useMemo(() => {
    return vendors.filter((v) => {
      if (categoryFilter && v.specialties.trim() !== categoryFilter) return false
      if (statusFilter === 'active' && !v.active) return false
      if (statusFilter === 'inactive' && v.active) return false
      return true
    })
  }, [vendors, categoryFilter, statusFilter])

  function resetCreate() {
    setName('')
    setPhone('')
    setEmail('')
    setSpecialties('hvac')
    setNotes('')
    setWebhookUrl('')
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          contact_phone: phone || null,
          contact_email: email || null,
          specialties,
          webhook_url: webhookUrl || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('יצירה נכשלה'))
      resetCreate()
      setCreateOpen(false)
      setNotice(p('הספק נוסף'))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : p('יצירה נכשלה'))
    } finally {
      setBusy(false)
    }
  }


  async function onDispatch(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const idempotencyKey = `hq-${dispatchTicketId}-${dispatchVendorId}-${Date.now()}`
      const res = await fetch('/api/partner/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId: dispatchTicketId.trim(),
          vendorId: dispatchVendorId,
          idempotencyKey,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('שליחה נכשלה'))
      setNotice(
        p('שיגור לספק בוצע · סטטוס {status}', {
          status: String(json.dispatch?.status ?? 'ok'),
        }),
      )
      setDispatchTicketId('')
      setDispatchOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : p('שליחה נכשלה'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-full max-w-full flex-col gap-4 overflow-x-clip">
      {notice ? <Notice tone="progress">{notice}</Notice> : null}
      {error ? <ErrorState title={error} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={p('תחום')} htmlFor="vendor-cat-filter">
            <Select
              id="vendor-cat-filter"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="min-w-[9rem]"
            >
              <option value="">{p('כל התחומים')}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {specialtyLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={p('סטטוס')} htmlFor="vendor-status-filter">
            <Select
              id="vendor-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-w-[8rem]"
            >
              <option value="">{p('הכל')}</option>
              <option value="active">{p('פעיל')}</option>
              <option value="inactive">{p('לא פעיל')}</option>
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setDispatchOpen((o) => !o)}
          >
            {p('שיגור לשותף')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="touch"
            className="md:h-9 md:px-3.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" aria-hidden />
            {p('ספק חדש')}
          </Button>
        </div>
      </div>

      <p className="t-meta t-num text-ink-3">
        {p('{n} ספקים', { n: filtered.length })}
      </p>

      {dispatchOpen ? (
        <Panel elevated className="!p-4">
          <p className="t-caption mb-3 text-ink-3">
            {p('כלי מתקדם · שיגור תקלה לספק חיצוני')}
          </p>
          <form onSubmit={onDispatch} className="grid gap-3 sm:grid-cols-2">
            <Field label={p('מזהה תקלה')} htmlFor="dispatch-ticket">
              <Input
                id="dispatch-ticket"
                value={dispatchTicketId}
                onChange={(e) => setDispatchTicketId(e.target.value)}
                placeholder="uuid"
                dir="ltr"
                required
              />
            </Field>
            <Field label={p('ספק')} htmlFor="dispatch-vendor">
              <Select
                id="dispatch-vendor"
                value={dispatchVendorId}
                onChange={(e) => setDispatchVendorId(e.target.value)}
              >
                {vendors
                  .filter((v) => v.active)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <Button type="submit" variant="secondary" size="sm" disabled={busy || !dispatchTicketId}>
                {p('שיגור')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDispatchOpen(false)}
              >
                {p('סגירה')}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      <Modal open={editingVendor != null} onOpenChange={(open) => { if (!open) setEditingVendor(null) }} title={p('עריכת ספק')} description={p('דירוג אישי והערה פנימית')} className="w-[min(92vw,520px)]">
        <div className="grid gap-4">
          <div>
            <p className="t-meta mb-2 text-ink-2">{p('דירוג אישי')}</p>
            <div className="flex gap-2" role="radiogroup" aria-label={p('דירוג ספק')}>
              {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={p('{n} כוכבים', { n: value })} onClick={() => setRating(value)} className="rounded-md p-1 text-[var(--tenant)]"><Star className="h-7 w-7" fill={rating >= value ? 'currentColor' : 'none'} aria-hidden /></button>)}
            </div>
          </div>
          <Field label={p('הערה אישית שלי')} htmlFor="vendor-personal-note"><Textarea id="vendor-personal-note" rows={4} value={personalNote} onChange={(event) => setPersonalNote(event.target.value)} placeholder={p('רשמו הערה פנימית על העבודה עם הספק…')} /></Field>
          <Button type="button" variant="primary" disabled={busy} onClick={() => void saveVendorEdit()}>{p('שמירת העריכה')}</Button>
          <Button type="button" variant="critical" disabled={busy} onClick={() => void deleteVendor()}><Trash2 className="h-4 w-4" aria-hidden />{p('מחיקת ספק')}</Button>
        </div>
      </Modal>

      <Modal
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next)
          if (!next) resetCreate()
        }}
        title={p('ספק חדש')}
        description={p('פרטי ספק · יצירת קשר · הערות')}
        className="w-[min(92vw,520px)]"
      >
        <form onSubmit={onCreate} className="space-y-5">
          <section className="space-y-3">
            <h3 className="t-caption text-ink-3">{p('פרטי ספק')}</h3>
            <Field label={p('שם')} htmlFor="vendor-name">
              <Input
                id="vendor-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label={p('תחום / התמחות')} htmlFor="vendor-spec">
              <Select
                id="vendor-spec"
                value={specialties}
                onChange={(e) => setSpecialties(e.target.value)}
              >
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {TICKET_CATEGORY_LABELS_HE[c] ?? c}
                  </option>
                ))}
              </Select>
            </Field>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <h3 className="t-caption text-ink-3">{p('יצירת קשר')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={p('טלפון')} htmlFor="vendor-phone">
                <Input
                  id="vendor-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  dir="ltr"
                />
              </Field>
              <Field label={p('אימייל')} htmlFor="vendor-email">
                <Input
                  id="vendor-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  dir="ltr"
                />
              </Field>
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-4">
            <h3 className="t-caption text-ink-3">{p('הערות')}</h3>
            <Field label={p('הערות פנימיות')} htmlFor="vendor-notes" hint={p('אופציונלי')}>
              <Textarea
                id="vendor-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder={p('הערות לצוות התפעול…')}
              />
            </Field>
            <Field
              label={p('כתובת Webhook')}
              htmlFor="vendor-webhook"
              hint={p('אופציונלי · לשיגור אוטומטי')}
            >
              <Input
                id="vendor-webhook"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                dir="ltr"
                placeholder="https://…"
              />
            </Field>
          </section>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setCreateOpen(false)
                resetCreate()
              }}
            >
              {p('ביטול')}
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={busy || !name.trim()}>
              {busy ? p('שומר…') : p('הוספה')}
            </Button>
          </div>
        </form>
      </Modal>

      <Panel flush elevated className="overflow-hidden">
        {loading ? (
          <p className="t-body p-4 text-ink-3">{p('טוען…')}</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={p('אין ספקים')}
            description={
              categoryFilter || statusFilter
                ? p('נסו לשנות את הסינון.')
                : p('הוסיפו ספק חיצוני לשיגור תקלות.')
            }
          />
        ) : (
          <>
            <AdminRowList>
              {filtered.map((v) => {
                const open = expandedId === v.id
                return (
                  <div key={v.id}>
                    <AdminRow
                      title={
                        <button
                          type="button"
                          className="flex items-center gap-1.5 text-start"
                          onClick={() => setExpandedId(open ? null : v.id)}
                        >
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform',
                              open && 'rotate-180',
                            )}
                            aria-hidden
                          />
                          <span>
                            {v.name}
                            {v.preferred ? (
                              <span className="t-caption ms-2 text-[var(--signal-resolved)]">
                                {p('מועדף')}
                              </span>
                            ) : null}
                            {!v.active ? (
                              <span className="t-caption ms-2 text-ink-3">{p('לא פעיל')}</span>
                            ) : null}
                          </span>
                        </button>
                      }
                      subtitle={
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="min-w-0 flex-1 truncate">{specialtyLabel(v.specialties)}</span>
                          <VendorReach vendor={v} />
                        </span>
                      }
                    />
                    {open ? (
                      <div className="space-y-3 border-b border-border px-4 py-3">
                        <p className="t-meta text-ink-2">
                          {v.coverage_regions?.length
                            ? v.coverage_regions.join(', ')
                            : p('בלי כיסוי')}
                          {' · '}
                          {v.open_tickets} {p('פתוחות')}
                        </p>
                        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => editVendor(v)}><Pencil className="h-4 w-4" aria-hidden />{p('עריכה')}</Button>
                        <VendorExpand v={v} onSave={saveVendorDetails} busy={busy} />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </AdminRowList>

            <div className="hidden overflow-x-auto md:block">
              <Table>
                <THead>
                  <TH>{p('שם')}</TH>
                  <TH>{p('תחום')}</TH>
                  <TH>{p('יצירת קשר')}</TH>
                  <TH>{p('פתוחות')}</TH>
                  <TH className="w-[120px]">{p('פעולות')}</TH>
                </THead>
                <TBody>
                  {filtered.map((v) => {
                    const open = expandedId === v.id
                    return (
                      <Fragment key={v.id}>
                        <TR>
                          <TD className="whitespace-nowrap">
                            <button
                              type="button"
                              className="flex items-center gap-1.5 text-start"
                              onClick={() => setExpandedId(open ? null : v.id)}
                            >
                              <ChevronDown
                                className={cn(
                                  'h-3.5 w-3.5 shrink-0 text-ink-3 transition-transform',
                                  open && 'rotate-180',
                                )}
                                aria-hidden
                              />
                              <span className="t-body-strong text-ink">{v.name}</span>
                              {!v.active ? (
                                <span className="t-caption text-ink-3">{p('לא פעיל')}</span>
                              ) : null}
                            </button>
                          </TD>
                          <TD>
                            <span className="t-meta text-ink-2">
                              {specialtyLabel(v.specialties)}
                            </span>
                          </TD>
                          <TD className="whitespace-nowrap">
                            <VendorReach vendor={v} />
                          </TD>
                          <TD>
                            <span className="t-body-strong t-num text-ink">
                              {v.open_tickets}
                            </span>
                          </TD>
                          <TD>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => editVendor(v)}
                            >
                              {p('עריכה')}
                            </Button>
                          </TD>
                        </TR>
                        {open ? (
                          <TR>
                            <td
                              colSpan={5}
                              className="bg-surface-sunken/40 px-0 align-middle"
                            >
                              <VendorExpand v={v} onSave={saveVendorDetails} busy={busy} />
                            </td>
                          </TR>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </TBody>
              </Table>
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}

function VendorExpand({
  v,
  onSave,
  busy,
}: {
  v: VendorRow
  onSave: (vendor: VendorRow, rating: number, note: string) => Promise<void>
  busy: boolean
}) {
  const p = usePhrase()
  const parsed = parsePersonalRating(v.notes)
  const [rating, setRating] = useState(parsed.rating)
  const [note, setNote] = useState(parsed.note)

  return (
    <div className="grid gap-4 px-4 py-3 lg:grid-cols-[minmax(18rem,1fr)_minmax(20rem,1.4fr)_minmax(14rem,1fr)]">
      <section className="grid gap-2">
        <p className="t-caption text-ink-3">{p('דירוג והערה אישית')}</p>
        <div className="flex gap-2" role="radiogroup" aria-label={p('דירוג ספק {name}', { name: v.name })}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rating === value}
              aria-label={p('{n} כוכבים', { n: value })}
              onClick={() => setRating(rating === value ? 0 : value)}
              className="rounded-md p-1 text-[var(--tenant)] hover:bg-surface"
            >
              <Star className="h-6 w-6" fill={rating >= value ? 'currentColor' : 'none'} aria-hidden />
            </button>
          ))}
        </div>
        <Textarea
          aria-label={p('הערה אישית על {name}', { name: v.name })}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={p('הערה פנימית על העבודה עם הספק…')}
        />
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void onSave(v, rating, note)}>
          {p('שמירת דירוג והערה')}
        </Button>
      </section>

      <section className="grid gap-2">
        <p className="t-caption text-ink-3">{p('היסטוריית שיגורים אחרונה')}</p>
        {v.recent.length === 0 ? (
          <p className="t-meta text-ink-3">{p('אין שיגורים עדיין')}</p>
        ) : (
          <ul className="space-y-1.5">
            {v.recent.slice(0, 5).map((r) => (
              <li key={`${r.ticket_id}-${r.created_at}`} className="t-meta text-ink-2">
                <Link href={`/ops/tickets/${r.ticket_id}`} className="text-[var(--tenant)] hover:underline">
                  {r.ticket_display || r.ticket_id.slice(0, 8)}
                </Link>
                <span className="t-caption t-num text-ink-3"> · {fmtShort(r.created_at)}</span>
                {r.status ? <span className="t-caption text-ink-3"> · {r.status}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="t-caption self-start text-ink-3">
        <summary className="cursor-pointer hover:text-ink-2">{p('פרטים טכניים')}</summary>
        <dl className="mt-2 grid gap-1">
          <div>
            <dt className="text-ink-3">HMAC</dt>
            <dd className="t-meta text-ink-2">{v.has_hmac ? p('מוגדר') : p('לא הוגדר')}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Webhook</dt>
            <dd className="t-meta truncate text-ink-2" dir="ltr">{v.webhook_url || '—'}</dd>
          </div>
        </dl>
      </details>
    </div>
  )
}
