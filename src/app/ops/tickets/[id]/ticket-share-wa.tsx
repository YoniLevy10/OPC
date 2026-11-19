'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Share2 } from 'lucide-react'
import { usePhrase } from '@/components/i18n/locale-provider'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/overlay'
import { ErrorState, Notice } from '@/components/ui/primitives'

/**
 * Share ticket pack to an external WhatsApp number (pro_coord, no engagement lock).
 */
export function TicketShareWaButton({ ticketId }: { ticketId: string }) {
  const p = usePhrase()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function onShare() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      try {
        const res = await fetch('/api/inbox/forward-external', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticketId,
            phone: phone.trim(),
            name: name.trim() || null,
          }),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error || p('שיתוף נכשל'))
        setNotice(
          json.dryRun
            ? p('חבילת תקלה נשמרה לשיחת מקצוען במצב הדגמה')
            : p('חבילת תקלה נשלחה'),
        )
        setOpen(false)
        setPhone('')
        setName('')
        if (json.sessionWaId) {
          router.push(
            `/ops/inbox?wa=${encodeURIComponent(String(json.sessionWaId))}`,
          )
        } else {
          router.refresh()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : p('שיתוף נכשל'))
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
        onClick={() => {
          setError(null)
          setNotice(null)
          setOpen(true)
        }}
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden />
        {p('שתף בוואטסאפ')}
      </Button>

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={p('שתף תקלה בוואטסאפ')}
        description={p('מספר חיצוני — חבילת תקלה ומדיה בשיחת תיאום, בלי נעילת מחיר.')}
      >
        <div className="grid gap-3">
          <Field label={p('טלפון')} htmlFor="share-wa-phone">
            <Input
              id="share-wa-phone"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="050…"
              disabled={pending}
            />
          </Field>
          <Field label={p('שם (רשות)')} htmlFor="share-wa-name">
            <Input
              id="share-wa-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </Field>
          {error ? <ErrorState title={p('שגיאה')} description={error} /> : null}
          {notice ? <Notice tone="progress">{notice}</Notice> : null}
          <Button
            type="button"
            disabled={pending || !phone.trim()}
            onClick={onShare}
          >
            {pending ? p('שולח…') : p('שתף למספר')}
          </Button>
        </div>
      </Modal>
    </>
  )
}
