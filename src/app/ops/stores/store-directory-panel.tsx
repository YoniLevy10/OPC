'use client'

import { FormEvent, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DirectoryContact } from '@/lib/data/ops-ledger'
import { usePhrase } from '@/components/i18n/locale-provider'
import {
  confirmPhone,
  deactivateContact,
  saveAreaManager,
  saveContact,
  saveStoreCode,
} from './directory-actions'

export function StoreDirectoryPanel({
  storeId,
  code,
  canEdit,
  contacts,
  areaManager,
}: {
  storeId: string
  code: string
  canEdit: boolean
  contacts: DirectoryContact[]
  areaManager: string | null
}) {
  const p = usePhrase()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [nextCode, setNextCode] = useState(code)
  const [manager, setManager] = useState(areaManager ?? '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  function run(work: () => Promise<void>) {
    setError(null)
    start(async () => {
      try {
        await work()
      } catch (err) {
        setError(err instanceof Error ? err.message : p('השמירה נכשלה'))
      }
    })
  }

  function onContact(event: FormEvent) {
    event.preventDefault()
    run(async () => {
      await saveContact({ storeId, fullName: name, phone, roleLabel: 'איש קשר' })
      setName('')
      setPhone('')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="t-meta text-ink-2">
        {p('קוד וטלפון נשמרים כטקסט. שינוי קוד לא מנתק תקלות מהסניף.')}
      </p>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Input
            value={nextCode}
            onChange={(event) => setNextCode(event.target.value)}
            aria-label={p('קוד סניף')}
          />
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              run(() => saveStoreCode(storeId, nextCode).then(() => undefined))
            }
          >
            {p('עדכון קוד')}
          </Button>
        </div>
      ) : null}
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          <Input
            value={manager}
            onChange={(event) => setManager(event.target.value)}
            aria-label={p('מנהל אזור')}
            placeholder={p('מנהל אזור')}
          />
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => run(() => saveAreaManager(storeId, manager))}
          >
            {p('שמירת מנהל אזור')}
          </Button>
        </div>
      ) : (
        <p className="t-body">
          {p('מנהל אזור')}: {areaManager || '—'}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {contacts
          .filter((contact) => contact.isActive)
          .map((contact) => (
            <li key={contact.id} className="flex flex-wrap items-center gap-2">
              <span className="t-body">
                {contact.fullName} · {contact.phone}
              </span>
              {contact.phoneStatus === 'needs_verification' ? (
                <span className="t-meta text-[var(--signal-critical)]">
                  {p('דורש אימות')}
                </span>
              ) : null}
              {canEdit && contact.phoneStatus === 'needs_verification' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() => run(() => confirmPhone(contact.id))}
                >
                  {p('לאשר כמו שזה')}
                </Button>
              ) : null}
              {canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => deactivateContact(contact.id))}
                >
                  {p('השבתה')}
                </Button>
              ) : null}
            </li>
          ))}
      </ul>
      {canEdit ? (
        <form onSubmit={onContact} className="flex flex-wrap gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={p('שם')}
            aria-label={p('שם איש קשר')}
            required
          />
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder={p('טלפון')}
            aria-label={p('טלפון')}
            required
          />
          <Button type="submit" size="sm" disabled={pending}>
            {p('הוספת איש קשר')}
          </Button>
        </form>
      ) : null}
      {error ? <p className="text-[var(--signal-critical)]">{error}</p> : null}
    </div>
  )
}
