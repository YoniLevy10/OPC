'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ArrowRight,
  CheckCheck,
  ExternalLink,
  SendHorizontal,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Select, Textarea } from '@/components/ui/input'
import {
  EmptyState,
  ErrorState,
  Notice,
  Panel,
  PanelHeader,
} from '@/components/ui/primitives'
import {
  PriorityText,
  StatusLabel,
  priorityEdgeClass,
  priorityRowClass,
} from '@/components/ui/signal'
import { LiveAge } from '@/components/ui/time'
import { PhoneStack } from '@/components/mobile'
import { cn } from '@/lib/utils'
import { useLocale, usePhrase } from '@/components/i18n/locale-provider'
import { intakeStateLabel } from '@/modules/inbox/display-labels'
import { TICKET_PRIORITY_LABELS_HE } from '@/modules/tickets/constants'
import { HUMAN_PAUSE_WINDOW_MINUTES } from '@/modules/whatsapp/human-pause'

type Session = {
  wa_id: string
  store_code: string | null
  store_id?: string | null
  store_name?: string | null
  customer_name?: string | null
  display_name?: string
  state: string
  human_takeover?: boolean
  /** ISO — private ops window ends at this time for this chat only. */
  human_takeover_until?: string | null
  last_inbound?: string | null
  last_message?: string | null
  unread?: boolean
  priority?: string | null
  inbox_status?: 'waiting' | 'handled'
  /** False when last inbound is older than 24h — free-form reply blocked. */
  care_window_open?: boolean
  updated_at: string
  country_id?: string
}

function formatPauseUntilLabel(untilIso: string | null | undefined): string | null {
  if (!untilIso) return null
  const ms = Date.parse(untilIso)
  if (!Number.isFinite(ms) || ms <= Date.now()) return null
  return new Date(ms).toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

type ThreadMessage = {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  created_at: string
  ticket_id?: string | null
}

type OpenTicket = {
  id: string
  display_number: string | null
  title: string | null
  status: string
  priority: string
  description: string
  store_code: string | null
  store_name: string | null
}

type SessionContext = {
  store_name: string | null
  store_code: string | null
  store_id?: string | null
  customer_name: string | null
  wa_display: string
  openTickets: OpenTicket[]
}

type ThreadItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: ThreadMessage }

function sessionTitle(s: Session): string {
  return s.display_name || s.store_name || s.store_code || s.wa_id
}

function phoneDigitsMatch(left: string, right: string): boolean {
  const norm = (value: string) => {
    const digits = value.replace(/\D/g, '')
    if (digits.startsWith('972')) return digits.slice(3).replace(/^0/, '')
    return digits.replace(/^0/, '')
  }
  const a = norm(left)
  const b = norm(right)
  return Boolean(a) && a === b
}

function isDesktopMq(): boolean {
  if (typeof window === 'undefined') return true
  return window.matchMedia('(min-width: 1024px)').matches
}

function initialsFrom(label: string): string {
  const parts = label.trim().split(/\\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2)
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`
}

function formatBubbleTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function formatDayLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  if (sameDay(d, today)) return 'היום'
  if (sameDay(d, yesterday)) return 'אתמול'
  return d.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function buildThreadItems(messages: ThreadMessage[]): ThreadItem[] {
  const items: ThreadItem[] = []
  let lastDay: string | null = null
  for (const message of messages) {
    const key = dayKey(message.created_at)
    if (key !== lastDay) {
      items.push({
        kind: 'day',
        key: `day-${key}`,
        label: formatDayLabel(message.created_at),
      })
      lastDay = key
    }
    items.push({ kind: 'message', key: message.id, message })
  }
  return items
}

function safeClientError(
  err: unknown,
  fallback: string,
  p: (hebrew: string) => string,
): string {
  if (!(err instanceof Error) || !err.message) return p(fallback)
  const msg = err.message
  if (
    /supabase|postgres|stack|zod|dryRun|Phone Number|fbtrace|maintainos_|WHATSAPP_|schema|ECONN|fetch failed/i.test(
      msg,
    )
  ) {
    return p(fallback)
  }
  return msg
}

export function InboxClient() {
  const searchParams = useSearchParams()
  const waFromUrl = searchParams.get('wa')
  const p = usePhrase()
  const { locale } = useLocale()

  const [sessions, setSessions] = useState<Session[]>([])
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [ticketIds, setTicketIds] = useState<string[]>([])
  const [openTickets, setOpenTickets] = useState<OpenTicket[]>([])
  const [context, setContext] = useState<SessionContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(waFromUrl)
  const [mobileShowThread, setMobileShowThread] = useState(Boolean(waFromUrl))
  const [reply, setReply] = useState('')
  const [stores, setStores] = useState<
    Array<{
      id: string
      code: string
      name: string
      manager_name?: string | null
      manager_phone?: string | null
    }>
  >([])
  const [editCustomerName, setEditCustomerName] = useState('')
  const [editStoreId, setEditStoreId] = useState('')

  const threadScrollRef = useRef<HTMLDivElement | null>(null)
  /** When true, keep the thread pinned to the latest message. */
  const stickToBottomRef = useRef(true)
  const prevSelectedRef = useRef<string | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const selectedRef = useRef<string | null>(selected)
  const threadLoadSeq = useRef(0)
  const [threadLoading, setThreadLoading] = useState(false)
  selectedRef.current = selected

  const loadSessions = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/inbox/sessions')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('טעינה נכשלה'))
      setSessions(json.sessions ?? [])
      // Auto-pick first chat once — do not re-bind on every selected change
      // (that re-fetched the list and made the context column jump).
      if (!selectedRef.current && json.sessions?.[0] && isDesktopMq()) {
        setSelected(json.sessions[0].wa_id as string)
      }
    } catch (err) {
      setError(safeClientError(err, 'טעינה נכשלה', p))
    }
  }, [p])

  const loadThread = useCallback(async (waId: string) => {
    const seq = ++threadLoadSeq.current
    setThreadLoading(true)
    try {
      const res = await fetch(`/api/inbox/sessions/${encodeURIComponent(waId)}`)
      const json = await res.json()
      if (seq !== threadLoadSeq.current) return
      if (!res.ok) throw new Error(json.error || p('טעינת שיחה נכשלה'))
      setMessages(json.messages ?? [])
      setTicketIds(json.ticketIds ?? [])
      setOpenTickets(json.openTickets ?? json.context?.openTickets ?? [])
      setContext(json.context ?? null)
    } catch (err) {
      if (seq !== threadLoadSeq.current) return
      setError(safeClientError(err, 'טעינת שיחה נכשלה', p))
    } finally {
      if (seq === threadLoadSeq.current) setThreadLoading(false)
    }
  }, [p])

  useEffect(() => {
    void loadSessions()
    void fetch('/api/stores').then(async (res) => {
      const json = await res.json()
      if (res.ok) setStores(json.stores ?? [])
    }).catch(() => undefined)
  }, [loadSessions])

  useEffect(() => {
    if (waFromUrl) {
      setSelected(waFromUrl)
      setMobileShowThread(true)
    }
  }, [waFromUrl])

  useEffect(() => {
    if (!selected) {
      threadLoadSeq.current += 1
      setMessages([])
      setTicketIds([])
      setOpenTickets([])
      setContext(null)
      setThreadLoading(false)
      return
    }
    // Drop previous chat's tickets immediately so the side column does not
    // flash the wrong faults (or fake "חדשה" placeholders) then jump.
    setOpenTickets([])
    setTicketIds([])
    setContext(null)
    setMessages([])
    void loadThread(selected)
  }, [selected, loadThread])

  function threadNearBottom(el: HTMLElement, px = 96): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= px
  }

  function scrollThreadToBottom() {
    const el = threadScrollRef.current
    if (!el) return
    // Instant — smooth + re-renders fought the user and yanked the pane.
    el.scrollTop = el.scrollHeight
  }

  useLayoutEffect(() => {
    const selectedChanged = prevSelectedRef.current !== selected
    prevSelectedRef.current = selected
    if (selectedChanged) {
      stickToBottomRef.current = true
      scrollThreadToBottom()
      return
    }
    if (stickToBottomRef.current) scrollThreadToBottom()
  }, [messages, selected])

  function openConversation(waId: string) {
    stickToBottomRef.current = true
    setSelected(waId)
    setMobileShowThread(true)
    setNotice(null)
  }

  function backToList() {
    setMobileShowThread(false)
    setNotice(null)
  }

  async function setInboxStatus(waId: string, status: 'handled' | 'waiting') {
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/inbox/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wa_id: waId, status }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('עדכון נכשל'))
      setNotice(
        status === 'waiting'
          ? p('הבוט הושהה — השתלטות אנושית')
          : p('הבוט חזר לפעול בשיחה זו'),
      )
      await loadSessions()
      if (selected) await loadThread(selected)
    } catch (err) {
      setError(safeClientError(err, 'עדכון נכשל', p))
    } finally {
      setBusy(false)
    }
  }

  function linkedTicketId(): string | null {
    const rawTicket = ticketIds[0] ?? openTickets[0]?.id ?? null
    return rawTicket &&
      rawTicket !== 'null' &&
      /^[0-9a-f-]{36}$/i.test(rawTicket)
      ? rawTicket
      : null
  }

  async function sendReply() {
    if (!selected || !reply.trim()) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      // Israel-only pilot: do not send countryId (server defaults to IL).
      const res = await fetch(
        `/api/inbox/sessions/${encodeURIComponent(selected)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: reply.trim(),
            ticketId: linkedTicketId(),
          }),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('שליחה נכשלה'))
      if (json.send && json.send.ok === false) {
        throw new Error(p('שליחת ההודעה נכשלה. נסו שוב בעוד רגע.'))
      }
      if (json.send?.dryRun) {
        throw new Error(p('ההודעה לא נשלחה ללקוח כרגע. בדקו את חיבור WhatsApp בהגדרות.'))
      }
      setReply('')
      stickToBottomRef.current = true
      setNotice(
        p(
          'הודעה נשלחה · נפתח חלון שיחה פרטית ל־{minutes} דקות בשיחה זו בלבד (בוט ממשיך בשאר השיחות). לחצו «החזר לבוט» כשתסיימו.',
          { minutes: HUMAN_PAUSE_WINDOW_MINUTES },
        ),
      )
      await Promise.all([loadThread(selected), loadSessions()])
      composerRef.current?.focus()
    } catch (err) {
      setError(safeClientError(err, 'שליחה נכשלה', p))
    } finally {
      setBusy(false)
    }
  }

  async function sendTemplate() {
    if (!selected) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(
        `/api/inbox/sessions/${encodeURIComponent(selected)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template: true,
            ticketId: linkedTicketId(),
          }),
        },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('שליחת הודעת מעקב נכשלה'))
      if (json.send && json.send.ok === false) {
        throw new Error(p('שליחת הודעת מעקב נכשלה'))
      }
      stickToBottomRef.current = true
      setNotice(
        p('הודעת מעקב נשלחה — הלקוח יכול להשיב ולפתוח מחדש את השיחה.'),
      )
      await Promise.all([loadThread(selected), loadSessions()])
    } catch (err) {
      setError(safeClientError(err, 'שליחת הודעת מעקב נכשלה', p))
    } finally {
      setBusy(false)
    }
  }

  async function clearChat() {
    if (!selected) return
    if (
      !window.confirm(
        'למחוק את השיחה מתיבת ה־Ops? ההיסטוריה ב־WhatsApp של הלקוח לא תימחק.',
      )
    ) {
      return
    }
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch(
        `/api/inbox/sessions/${encodeURIComponent(selected)}`,
        { method: 'DELETE' },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('מחיקה נכשלה'))
      setSelected(null)
      setMessages([])
      setMobileShowThread(false)
      setNotice(p('השיחה הוסרה מהתיבה'))
      await loadSessions()
    } catch (err) {
      setError(safeClientError(err, 'מחיקה נכשלה', p))
    } finally {
      setBusy(false)
    }
  }

  const active = sessions.find((s) => s.wa_id === selected) ?? null
  const linkedStore =
    stores.find((store) => store.id === (editStoreId || active?.store_id)) ??
    stores.find((store) =>
      active?.wa_id && store.manager_phone
        ? phoneDigitsMatch(active.wa_id, store.manager_phone)
        : false,
    ) ??
    null
  const managerContactName =
    linkedStore?.manager_phone &&
    active?.wa_id &&
    phoneDigitsMatch(active.wa_id, linkedStore.manager_phone)
      ? linkedStore.manager_name?.trim() || null
      : null
  const contactName =
    context?.customer_name?.trim() ||
    active?.customer_name?.trim() ||
    managerContactName ||
    null

  useEffect(() => {
    if (!active) return
    setEditCustomerName(contactName ?? '')
    setEditStoreId(active.store_id ?? linkedStore?.id ?? '')
  }, [active, contactName, linkedStore?.id])

  async function saveContactDetails() {
    if (!active) return
    setBusy(true)
    setNotice(null)
    setError(null)
    try {
      const res = await fetch('/api/inbox/sessions', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wa_id: active.wa_id, store_id: editStoreId || null, customer_name: editCustomerName.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || p('שמירה נכשלה'))
      setNotice(p('פרטי הלקוח והסניף נשמרו'))
      await Promise.all([loadSessions(), loadThread(active.wa_id)])
    } catch (err) {
      setError(safeClientError(err, 'שמירה נכשלה', p))
    } finally {
      setBusy(false)
    }
  }

  // Only real open-ticket payloads — never invent status="new" from bare ids
  // (that made the side column jump from «חדשה» to «נשלח איש מקצוע…»).
  const linkedTickets = openTickets

  const waiting =
    Boolean(active?.human_takeover) || active?.inbox_status === 'waiting'
  const pauseUntilLabel = waiting
    ? formatPauseUntilLabel(active?.human_takeover_until)
    : null
  const careWindowOpen = active?.care_window_open !== false

  const threadItems = useMemo(() => buildThreadItems(messages), [messages])

  const listPanel = (
    <Panel flush elevated className="flex h-full min-h-0 flex-col overflow-hidden">
      <PanelHeader title="שיחות" meta={`${sessions.length}`} />
      {sessions.length === 0 ? (
        <EmptyState title="אין שיחות פעילות" />
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain">
          {sessions.map((s) => {
            const selectedRow = selected === s.wa_id
            const title = sessionTitle(s)
            return (
              <li key={s.wa_id}>
                <button
                  type="button"
                  onClick={() => openConversation(s.wa_id)}
                  className={cn(
                    'flex min-h-[80px] w-full items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-surface-sunken/40',
                    priorityEdgeClass(s.priority),
                    priorityRowClass(s.priority),
                    selectedRow && 'bg-[var(--tenant-soft)]',
                  )}
                >
                  <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--tenant-soft)] text-sm font-semibold text-[var(--tenant)]"
                  >
                    {initialsFrom(title)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="t-body-strong flex min-w-0 items-center gap-2 text-ink">
                        {s.unread ? (
                          <span
                            aria-label="לא נקרא"
                            className="h-2 w-2 shrink-0 rounded-full bg-[var(--tenant)]"
                          />
                        ) : null}
                        <span className="truncate">{title}</span>
                      </span>
                      <LiveAge createdAt={s.updated_at} className="shrink-0" />
                    </span>
                    <p className="t-body mt-0.5 line-clamp-1 text-ink-2">
                      {s.last_message || s.last_inbound || 'אין הודעות'}
                    </p>
                    <span className="mt-1 flex flex-wrap items-center gap-2">
                      {s.priority ? (
                        <span className="t-caption text-ink-3">
                          {TICKET_PRIORITY_LABELS_HE[
                            s.priority as keyof typeof TICKET_PRIORITY_LABELS_HE
                          ] ?? s.priority}
                        </span>
                      ) : null}
                      <span className="t-caption text-ink-3">
                        {s.human_takeover || s.inbox_status === 'waiting'
                          ? p('שיחה פרטית')
                          : intakeStateLabel(s.state, locale)}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )

  const contextPanel = active ? (
    <Panel flush elevated className="flex h-full min-h-0 flex-col overflow-hidden">
      <PanelHeader title="הקשר" />
      <div className="space-y-4 overflow-y-auto p-4">
        <div>
          <p className="t-caption text-ink-3">
            {managerContactName ? 'מנהל חנות / סניף' : 'לקוח / סניף'}
          </p>
          <p className="t-body-strong mt-1 text-ink">
            {contactName || 'ללא שם לקוח'}
          </p>
          <p className="t-body mt-0.5 text-ink-2">
            {context?.store_name ||
              active.store_name ||
              (active.store_code ? `סניף #${active.store_code}` : 'ללא סניף')}
            {(context?.store_code || active.store_code) &&
            (context?.store_name || active.store_name)
              ? ` · #${context?.store_code || active.store_code}`
              : null}
          </p>
          <p dir="ltr" className="t-caption t-num mt-1 text-ink-3">
            {context?.wa_display || active.wa_id}
          </p>
          <div className="mt-3 space-y-2">
            <label className="t-caption block text-ink-3" htmlFor="inbox-customer-name">
              {managerContactName ? 'שם מנהל חנות' : 'שם לקוח'}
            </label>
            <Input
              id="inbox-customer-name"
              value={editCustomerName}
              onChange={(event) => setEditCustomerName(event.target.value)}
              maxLength={120}
              placeholder={managerContactName || 'שם לקוח'}
              disabled={busy}
            />
            <label className="t-caption block text-ink-3" htmlFor="inbox-store-link">חיבור לסניף</label>
            <Select id="inbox-store-link" value={editStoreId} onChange={(event) => setEditStoreId(event.target.value)} disabled={busy}>
              <option value="">ללא סניף</option>
              {stores.map((store) => <option key={store.id} value={store.id}>#{store.code} · {store.name}</option>)}
            </Select>
            <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void saveContactDetails()}>שמירת פרטים</Button>
          </div>
        </div>

        <div className="min-h-[10rem]">
          <p className="t-caption mb-2 text-ink-3">תקלות פתוחות</p>
          {threadLoading && linkedTickets.length === 0 ? (
            <p className="t-body text-ink-3">טוען תקלות…</p>
          ) : linkedTickets.length === 0 ? (
            <p className="t-body text-ink-3">אין תקלות מקושרות</p>
          ) : (
            <ul className="space-y-2">
              {linkedTickets.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/ops/tickets/${t.id}`}
                    className={cn(
                      'block min-h-[5.5rem] rounded-[var(--radius-md)] border border-border px-3 py-2 transition-colors hover:bg-canvas',
                      priorityEdgeClass(t.priority),
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="t-body-strong t-num text-ink">
                        {t.display_number || `${t.id.slice(0, 8)}…`}
                      </span>
                      <ExternalLink
                        className="h-3.5 w-3.5 shrink-0 text-ink-3"
                        aria-hidden
                      />
                    </div>
                    <p className="t-body mt-0.5 line-clamp-2 text-ink-2">
                      {t.title || t.description || 'תקלה מקושרת'}
                    </p>
                    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2">
                      <PriorityText priority={t.priority} className="t-caption" />
                      <StatusLabel
                        status={t.status}
                        className="t-caption max-w-full truncate"
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  ) : null

  const conversationPanel = (
    <Panel
      flush
      elevated
      className="wa-thread-panel flex h-full min-h-0 flex-col overflow-hidden rounded-none border-0 shadow-none lg:rounded-[var(--radius-lg)] lg:border lg:border-border/80 lg:shadow-[var(--shadow-1)]"
    >
      {!active ? (
        <div className="wa-empty-stage flex flex-1 items-center justify-center">
          <EmptyState title="בחרו שיחה" />
        </div>
      ) : (
        <>
          <header className="wa-thread-header flex shrink-0 items-center gap-3 border-b px-3 py-2.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ms-1 shrink-0 lg:hidden"
              onClick={backToList}
              aria-label="חזרה לרשימה"
            >
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
            <span
              aria-hidden
              className="wa-avatar-chip flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
            >
              {initialsFrom(sessionTitle(active))}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold leading-tight">
                {sessionTitle(active)}
              </h2>
              <p dir="ltr" className="truncate text-[12px] opacity-85">
                {context?.wa_display || active.wa_id}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                variant="ghost"
                aria-label="מחק שיחה מתיבת Ops"
                className="h-8 border-0 px-2 text-ink-2 hover:bg-surface-sunken hover:text-ink"
                onClick={() => void clearChat()}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                variant={waiting ? 'secondary' : 'ghost'}
                className={cn(
                  'h-8 border-0 px-2.5 text-[12px]',
                  waiting
                    ? 'bg-surface-sunken text-ink hover:bg-surface-sunken'
                    : 'text-ink-2 hover:bg-surface-sunken hover:text-ink',
                )}
                onClick={() => void setInboxStatus(active.wa_id, 'waiting')}
              >
                השהה בוט
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                variant={!waiting ? 'resolve' : 'ghost'}
                className={cn(
                  'h-8 border-0 px-2.5 text-[12px]',
                  !waiting
                    ? undefined
                    : 'text-ink-2 hover:bg-surface-sunken hover:text-ink',
                )}
                onClick={() => void setInboxStatus(active.wa_id, 'handled')}
              >
                {waiting ? 'החזר לבוט' : 'טופל'}
              </Button>
            </div>
          </header>

          {waiting ? (
            <div className="shrink-0 border-b border-[var(--signal-warning-line)] bg-[var(--signal-warning-soft)] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="t-caption text-[var(--signal-warning)]">
                  {pauseUntilLabel
                    ? `שיחה פרטית עד ${pauseUntilLabel} — הבוט לא מתערב כאן; בשאר השיחות ממשיך כרגיל.`
                    : 'שיחה פרטית בשיחה זו — הבוט לא מתערב כאן; בשאר השיחות ממשיך כרגיל.'}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="resolve"
                  disabled={busy}
                  onClick={() => void setInboxStatus(active.wa_id, 'handled')}
                >
                  החזר לבוט
                </Button>
              </div>
            </div>
          ) : null}

          {linkedTickets.length > 0 ? (
            <div className="wa-ticket-strip shrink-0 border-b px-3 py-1.5">
              <p className="t-caption">
                מקושר לתקלה:{' '}
                {linkedTickets.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 ? ', ' : ''}
                    <Link
                      href={`/ops/tickets/${t.id}`}
                      className="font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {t.display_number || `${t.id.slice(0, 8)}…`}
                    </Link>
                  </span>
                ))}
              </p>
            </div>
          ) : null}

          <div
            ref={threadScrollRef}
            className="wa-chat-wallpaper relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 py-3 sm:px-4"
            onScroll={(e) => {
              stickToBottomRef.current = threadNearBottom(e.currentTarget)
            }}
          >
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <EmptyState title="אין הודעות" description="השיחה תופיע כאן" />
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-md flex-col gap-1.5">
                {threadItems.map((item) =>
                  item.kind === 'day' ? (
                    <div key={item.key} className="my-2 flex justify-center">
                      <span className="wa-day-pill rounded-full px-3 py-1 text-[11px] font-medium shadow-sm">
                        {item.label}
                      </span>
                    </div>
                  ) : (
                    <div
                      key={item.key}
                      className={cn(
                        'flex',
                        // RTL WhatsApp: outbound (us) on the left, inbound on the right.
                        item.message.direction === 'outbound'
                          ? 'justify-end'
                          : 'justify-start',
                      )}
                    >
                      <div
                        className={cn(
                          'wa-bubble relative max-w-[min(85%,28rem)] px-2.5 pb-1.5 pt-1.5 text-[14.5px] leading-snug shadow-sm',
                          item.message.direction === 'outbound'
                            ? 'wa-bubble-out rounded-2xl rounded-ee-md'
                            : 'wa-bubble-in rounded-2xl rounded-es-md',
                        )}
                      >
                        <p className="whitespace-pre-wrap break-words pe-12">
                          {item.message.body}
                        </p>
                        <div className="mt-0.5 flex items-center justify-end gap-1">
                          {item.message.ticket_id ? (
                            <Link
                              href={`/ops/tickets/${item.message.ticket_id}`}
                              className="me-auto text-[10px] text-ink-2 underline-offset-2 hover:underline"
                            >
                              תקלה {item.message.ticket_id.slice(0, 8)}…
                            </Link>
                          ) : null}
                          <time className="wa-bubble-meta text-[10px] tabular-nums">
                            {formatBubbleTime(item.message.created_at)}
                          </time>
                          {item.message.direction === 'outbound' ? (
                            <CheckCheck
                              className="h-3.5 w-3.5 text-[#53bdeb]"
                              aria-label="נשלח"
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ),
                )}
              </div>
            )}
          </div>

          {!careWindowOpen ? (
            <div className="shrink-0 border-t border-border bg-surface-sunken/50 px-3 py-3">
              <p className="t-caption mb-2 text-ink-2">
                {p(
                  'חלון 24 השעות פג — לא ניתן לשלוח טקסט חופשי. שלחו הודעת מעקב כדי לפתוח מחדש את השיחה.',
                )}
              </p>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => void sendTemplate()}
              >
                {p('שליחת הודעת מעקב')}
              </Button>
            </div>
          ) : (
            <div className="wa-composer-bar flex shrink-0 items-end gap-2 px-2 py-2 sm:px-3">
              <label className="sr-only" htmlFor="inbox-reply">
                הודעה ללקוח
              </label>
              <Textarea
                ref={composerRef}
                id="inbox-reply"
                rows={1}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void sendReply()
                  }
                }}
                placeholder="כתבו הודעה ללקוח…"
                disabled={busy}
                className="wa-composer-input max-h-32 min-h-[42px] flex-1 resize-none rounded-[22px] border-0 px-4 py-2.5 focus:ring-0 focus:outline-none"
              />
              <button
                type="button"
                disabled={busy || !reply.trim()}
                onClick={() => void sendReply()}
                aria-label={busy ? 'שולח' : 'שליחה'}
                className={cn(
                  'wa-send-btn mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-opacity',
                  'shadow-[var(--shadow-1)] disabled:opacity-40',
                )}
              >
                <SendHorizontal className="h-5 w-5 -scale-x-100" aria-hidden />
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-x-hidden md:gap-3">
      {error ? (
        <div className="shrink-0 px-4 md:px-0">
          <ErrorState title="שגיאה" description={error} />
        </div>
      ) : null}
      {notice ? (
        <div className="shrink-0 px-4 md:px-0">
          <Notice tone="progress">{notice}</Notice>
        </div>
      ) : null}

      {/* Mobile: list → conversation via PhoneStack */}
      <div className="flex min-h-0 flex-1 flex-col overflow-x-clip lg:hidden">
        <PhoneStack
          className="min-h-0 flex-1"
          showDetail={mobileShowThread}
          list={
            <div className="min-h-0 h-full overflow-hidden px-3 pb-1 pt-2">
              {listPanel}
            </div>
          }
          detail={
            <div className="min-h-0 h-full overflow-hidden px-0">
              {conversationPanel}
            </div>
          }
        />
      </div>

      {/* Desktop: fill remaining viewport height */}
      <div className="hidden min-h-0 min-w-0 w-full flex-1 gap-3 max-lg:hidden lg:grid lg:grid-cols-[minmax(220px,1fr)_minmax(360px,2fr)_minmax(220px,1fr)]">
        {listPanel}
        {conversationPanel}
        {contextPanel ?? (
          <Panel elevated className="flex h-full items-center justify-center">
            <EmptyState title="הקשר" description="בחרו שיחה להצגת פרטים" />
          </Panel>
        )}
      </div>
    </div>
  )
}
