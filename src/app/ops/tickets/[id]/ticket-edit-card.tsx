'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
import { usePhrase } from '@/components/i18n/locale-provider'
import { Button } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/input'
import { Modal } from '@/components/ui/overlay'
import { ErrorState } from '@/components/ui/primitives'
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS_HE,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS_HE,
  type TicketPriority,
} from '@/modules/tickets/constants'

export function TicketEditCardButton({
  ticketId,
  description,
  priority,
  category,
}: {
  ticketId: string
  description: string
  priority: TicketPriority
  category: string
}) {
  const p = usePhrase()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [desc, setDesc] = useState(description)
  const [prio, setPrio] = useState<TicketPriority>(priority)
  const [cat, setCat] = useState(category)

  function openEditor() {
    setDesc(description)
    setPrio(priority)
    setCat(category)
    setError(null)
    setOpen(true)
  }

  function onSave() {
    setError(null)
    const body: Record<string, string> = {}
    if (desc.trim() && desc.trim() !== description.trim()) {
      body.description = desc.trim()
    }
    if (prio !== priority) body.priority = prio
    if (cat !== category) body.category = cat
    if (Object.keys(body).length === 0) {
      setOpen(false)
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(json.error || p('שמירה נכשלה'))
        }
        setOpen(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : p('שמירה נכשלה'))
      }
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2"
        onClick={openEditor}
        aria-label={p('עריכת תקלה')}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden />
        {p('עריכה')}
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={p('עריכת תקלה')}
        description={p(
          'תיאור, דחיפות וקטגוריה — הסטטוס נשאר דרך פעולות נפרדות.',
        )}
      >
        <div className="grid gap-3">
          <Field label={p('תיאור')} htmlFor="ticket-edit-desc">
            <Textarea
              id="ticket-edit-desc"
              rows={4}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              disabled={pending}
            />
          </Field>
          <Field label={p('דחיפות')} htmlFor="ticket-edit-prio">
            <Select
              id="ticket-edit-prio"
              value={prio}
              onChange={(e) => setPrio(e.target.value as TicketPriority)}
              disabled={pending}
            >
              {TICKET_PRIORITIES.map((key) => (
                <option key={key} value={key}>
                  {TICKET_PRIORITY_LABELS_HE[key]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={p('קטגוריה')} htmlFor="ticket-edit-cat">
            <Select
              id="ticket-edit-cat"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              disabled={pending}
            >
              {TICKET_CATEGORIES.map((key) => (
                <option key={key} value={key}>
                  {TICKET_CATEGORY_LABELS_HE[key] || key}
                </option>
              ))}
            </Select>
          </Field>
          {error ? <ErrorState title={p('שגיאה')} description={error} /> : null}
          <Button type="button" disabled={pending || !desc.trim()} onClick={onSave}>
            {pending ? p('שומר…') : p('שמירה')}
          </Button>
        </div>
      </Modal>
    </>
  )
}
