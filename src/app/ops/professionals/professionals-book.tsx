'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { MessageCircle, Pencil, Phone, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { BottomSheet } from '@/components/ui/overlay'
import { useToast } from '@/components/ui/toast'
import { usePhrase } from '@/components/i18n/locale-provider'
import type { Professional } from '@/modules/professionals/types'
import {
  formatPersonalRating,
  parsePersonalRating,
} from '@/modules/notes/personal-rating'
import { formatIsraeliPhoneDisplay, normalizePhoneDigits } from '@/lib/phone'
import { cn } from '@/lib/utils'

function dialHref(phone: string | null | undefined): string | null {
  const digits = normalizePhoneDigits(phone)
  if (!digits) return null
  return `tel:+${digits}`
}

function whatsAppHref(phone: string | null | undefined): string | null {
  const digits = normalizePhoneDigits(phone)
  if (!digits) return null
  return `https://wa.me/${digits}`
}

function StarRow({
  rating,
  interactive,
  onChange,
  label,
}: {
  rating: number
  interactive?: boolean
  onChange?: (value: number) => void
  label: string
}) {
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[var(--tenant)]"
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={label}
    >
      {[1, 2, 3, 4, 5].map((value) =>
        interactive ? (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={`${value}`}
            onClick={() => onChange?.(rating === value ? 0 : value)}
            className="rounded-md p-0.5"
          >
            <Star
              className="h-5 w-5"
              fill={rating >= value ? 'currentColor' : 'none'}
              aria-hidden
            />
          </button>
        ) : (
          <Star
            key={value}
            className="h-3.5 w-3.5"
            fill={rating >= value ? 'currentColor' : 'none'}
            aria-hidden
          />
        ),
      )}
    </span>
  )
}

export function ProfessionalsBook({
  professionals,
}: {
  professionals: Professional[]
}) {
  const tx = usePhrase()
  const router = useRouter()
  const toast = useToast()

  function usageLabel(count: number): string {
    if (count === 1) return tx('שימוש אחד')
    return tx('{count} שימושים', { count })
  }
  const [pending, startTransition] = useTransition()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Professional | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editTrade, setEditTrade] = useState('')
  const [editRating, setEditRating] = useState(0)
  const [editNote, setEditNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function openEdit(person: Professional) {
    const parsed = parsePersonalRating(person.notes)
    setEditing(person)
    setEditName(person.full_name)
    setEditPhone(person.phone ?? '')
    setEditTrade(person.trade ?? '')
    setEditRating(parsed.rating)
    setEditNote(parsed.note)
  }

  async function touch(id: string) {
    setBusyId(id)
    try {
      await fetch(`/api/professionals/${id}/touch`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      startTransition(() => router.refresh())
    } catch {
      toast.push({ title: tx('לא עודכן דירוג'), tone: 'critical' })
    } finally {
      setBusyId(null)
    }
  }

  async function saveEdit() {
    if (!editing) return
    if (!editName.trim()) {
      toast.push({ title: tx('הזינו שם איש מקצוע'), tone: 'critical' })
      return
    }
    setSaving(true)
    setBusyId(editing.id)
    try {
      const res = await fetch(`/api/professionals/${editing.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          full_name: editName.trim(),
          phone: editPhone.trim() || null,
          trade: editTrade.trim() || null,
          company_name: editing.company_name,
          notes: formatPersonalRating(editRating, editNote),
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      if (!res.ok) {
        throw new Error(data?.error || tx('העריכה נכשלה'))
      }
      toast.push({ title: tx('איש המקצוע עודכן'), tone: 'success' })
      setEditing(null)
      startTransition(() => router.refresh())
    } catch {
      toast.push({
        title: tx('העריכה נכשלה'),
        tone: 'critical',
      })
    } finally {
      setSaving(false)
      setBusyId(null)
    }
  }

  async function remove(person: Professional) {
    const ok = window.confirm(
      tx('למחוק את {name} מהספר?', { name: person.full_name }),
    )
    if (!ok) return
    setBusyId(person.id)
    try {
      const res = await fetch(`/api/professionals/${person.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const data = (await res.json().catch(() => null)) as {
        error?: string
      } | null
      if (!res.ok) {
        throw new Error(data?.error || tx('המחיקה נכשלה'))
      }
      toast.push({ title: tx('איש המקצוע נמחק'), tone: 'success' })
      startTransition(() => router.refresh())
    } catch {
      toast.push({
        title: tx('המחיקה נכשלה'),
        tone: 'critical',
      })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {professionals.map((person) => {
          const tel = dialHref(person.phone)
          const whatsapp = whatsAppHref(person.phone)
          const busy = pending || busyId === person.id
          const { rating } = parsePersonalRating(person.notes)
          return (
            <li
              key={person.id}
              className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="t-lead font-semibold text-ink">
                    {person.full_name}
                  </p>
                  {rating > 0 ? (
                    <StarRow
                      rating={rating}
                      label={`${tx('דירוג אישי')} ${rating}`}
                    />
                  ) : null}
                </div>
                <p className="t-meta text-ink-2">
                  {[person.trade, person.company_name].filter(Boolean).join(' · ') ||
                    tx('איש מקצוע ממידרג')}
                </p>
                <p className="t-caption text-ink-3">
                  {person.use_count > 0
                    ? usageLabel(person.use_count)
                    : tx('נשמר לאחרונה')}
                  {person.phone
                    ? ` · ${formatIsraeliPhoneDisplay(person.phone)}`
                    : ''}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {whatsapp ? (
                  <Button asChild variant="secondary" size="sm" className="min-h-[44px]">
                    <a
                      href={whatsapp}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`${tx('וואטסאפ')} ${person.full_name}`}
                      onClick={() => void touch(person.id)}
                      className="inline-flex items-center gap-2"
                    >
                      <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                      {tx('וואטסאפ')}
                    </a>
                  </Button>
                ) : null}
                {tel ? (
                  <Button
                    asChild
                    variant="primary"
                    size="sm"
                    className="min-h-[44px]"
                    disabled={busy}
                  >
                    <a
                      href={tel}
                      aria-label={`${tx('התקשר')} ${person.full_name}`}
                      onClick={() => void touch(person.id)}
                      className="inline-flex items-center gap-2"
                    >
                      <Phone className="h-3.5 w-3.5" aria-hidden />
                      {tx('התקשר')}
                    </a>
                  </Button>
                ) : (
                  <span className={cn('t-caption text-ink-3')}>
                    {tx('אין טלפון')}
                  </span>
                )}
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="min-h-[44px] min-w-[44px] px-0"
                    disabled={busy}
                    aria-label={`${tx('ערוך')} ${person.full_name}`}
                    title={tx('ערוך')}
                    onClick={() => openEdit(person)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      <BottomSheet
        open={editing != null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        title={tx('עריכת איש מקצוע')}
        description={tx('שם, טלפון ומקצוע בספר')}
      >
        <div className="grid gap-3 p-4">
          <label className="grid gap-1">
            <span className="t-meta text-ink-2">{tx('שם')}</span>
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder={tx('שם מלא')}
              autoComplete="name"
            />
          </label>
          <label className="grid gap-1">
            <span className="t-meta text-ink-2">{tx('טלפון')}</span>
            <Input
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              placeholder={tx('טלפון')}
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
            />
          </label>
          <label className="grid gap-1">
            <span className="t-meta text-ink-2">{tx('מקצוע')}</span>
            <Input
              value={editTrade}
              onChange={(e) => setEditTrade(e.target.value)}
              placeholder={tx('מקצוע (אופציונלי)')}
            />
          </label>
          <div className="grid gap-1">
            <span className="t-meta text-ink-2">{tx('דירוג אישי')}</span>
            <StarRow
              rating={editRating}
              interactive
              onChange={setEditRating}
              label={tx('דירוג אישי')}
            />
          </div>
          <label className="grid gap-1">
            <span className="t-meta text-ink-2">{tx('הערה אישית')}</span>
            <Textarea
              rows={3}
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder={tx('רשמו הערה פנימית…')}
            />
          </label>
          <Button
            type="button"
            variant="primary"
            size="touch"
            className="w-full"
            disabled={saving}
            onClick={() => void saveEdit()}
          >
            {saving ? tx('שומר…') : tx('שמור שינויים')}
          </Button>
          <Button
            type="button"
            variant="critical"
            size="touch"
            className="w-full"
            disabled={saving || deleting}
            onClick={async () => {
              if (!editing) return
              setDeleting(true)
              await remove(editing)
              setDeleting(false)
              setEditing(null)
            }}
          >
            {deleting ? tx('מוחק…') : tx('מחיקת איש המקצוע')}
          </Button>
        </div>
      </BottomSheet>
    </>
  )
}
