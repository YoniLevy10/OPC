'use client'

import { FormEvent, useState } from 'react'
import { StickyNote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/input'
import { Modal } from '@/components/ui/overlay'
import { usePhrase } from '@/components/i18n/locale-provider'

export function TicketQueueNoteButton({
  ticketId,
  ticketTitle,
}: {
  ticketId: string
  ticketTitle: string
}) {
  const p = usePhrase()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function onSave(e: FormEvent) {
    e.preventDefault()
    const text = note.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: text }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error || p('שמירת ההערה נכשלה'))
      setSaved(true)
      setNote('')
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : p('שמירת ההערה נכשלה'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="shrink-0"
        aria-label={p('הערה על התקלה')}
        title={saved ? p('ההערה נשמרה') : p('הערה על התקלה')}
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
      >
        <StickyNote className="h-3.5 w-3.5" aria-hidden />
        <span className="max-md:sr-only">{p('הערה')}</span>
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="הערה על התקלה"
        description={ticketTitle}
      >
        <form onSubmit={(e) => void onSave(e)} className="space-y-3">
          <Field label={p('הערה אישית שלי')} htmlFor={`queue-note-${ticketId}`}>
            <Textarea
              id={`queue-note-${ticketId}`}
              rows={4}
              value={note}
              disabled={busy}
              onChange={(e) => setNote(e.target.value)}
              placeholder={p('רשמו הערה אישית על התקלה…')}
              autoFocus
            />
          </Field>
          {error ? (
            <p role="alert" className="t-meta text-[var(--signal-critical)]">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {p('ביטול')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !note.trim()}
            >
              {busy ? p('שומר…') : p('שמור הערה')}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
