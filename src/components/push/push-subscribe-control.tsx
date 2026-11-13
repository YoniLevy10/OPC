'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

type Variant = 'ops' | 'tech'

/**
 * Web Push subscribe/unsubscribe when VAPID public key is configured.
 * Shared by Ops settings and /tech portal.
 */
export function PushSubscribeControl({
  variant = 'ops',
  className,
}: {
  variant?: Variant
  className?: string
}) {
  const [vapid, setVapid] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [subscribed, setSubscribed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/push/subscribe')
      const json = await res.json()
      const key =
        json.vapidPublicKey ||
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
        null
      setVapid(typeof key === 'string' && key.length > 20 ? key : null)
      const hasSubs =
        Array.isArray(json.subscriptions) && json.subscriptions.length > 0
      setSubscribed(hasSubs)
    } catch {
      setVapid(null)
      setSubscribed(false)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function subscribe() {
    setBusy(true)
    setStatus(null)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('הדפדפן לא תומך ב־Push')
      }
      if (!vapid) throw new Error('התראות Push לא מוגדרות בסביבה')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error('נדרשת הרשאת התראות מהדפדפן')
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      })
      const json = sub.toJSON()
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: json.keys,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'הרשמה נכשלה')
      setSubscribed(true)
      setStatus('התראות Push הופעלו')
      await refresh()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'הרשמה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  async function unsubscribe() {
    setBusy(true)
    setStatus(null)
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('הדפדפן לא תומך ב־Push')
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const endpoint = sub.endpoint
        await sub.unsubscribe()
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        })
      }
      setSubscribed(false)
      setStatus('התראות Push כובו במכשיר זה')
      await refresh()
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'כיבוי נכשל')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) {
    return (
      <p className={`t-caption text-ink-3 ${className ?? ''}`.trim()}>
        בודקים תמיכה בהתראות…
      </p>
    )
  }

  if (!vapid) {
    if (variant === 'tech') {
      return (
        <p className={`t-caption text-ink-3 ${className ?? ''}`.trim()}>
          תקבלו עדכון ב־SMS או WhatsApp כשמשייכים לכם עבודה.
        </p>
      )
    }
    return (
      <div className={`space-y-1 ${className ?? ''}`.trim()}>
        <p className="t-body text-ink-2">התראות Push לא מוגדרות בסביבה</p>
        <p className="t-caption text-ink-3">
          נדרשים VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
          NEXT_PUBLIC_VAPID_PUBLIC_KEY.
        </p>
      </div>
    )
  }

  return (
    <div className={`space-y-2 ${className ?? ''}`.trim()}>
      {variant === 'ops' ? (
        <p className="t-caption text-ink-2">
          התראות גם כשהמערכת סגורה (דפדפן או אפליקציה). באייפון — רק אחרי «הוסף
          למסך הבית».
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={subscribed ? 'secondary' : 'primary'}
          size="touch"
          className="md:h-9 md:min-h-0"
          disabled={busy}
          onClick={() => void (subscribed ? unsubscribe() : subscribe())}
        >
          {busy
            ? subscribed
              ? 'מכבים…'
              : 'מפעיל…'
            : subscribed
              ? 'כיבוי התראות Push'
              : 'הפעלת התראות Push'}
        </Button>
        {subscribed ? (
          <span className="t-caption text-ink-2">פעיל במכשיר זה</span>
        ) : null}
      </div>
      {status ? <p className="t-caption text-ink-2">{status}</p> : null}
    </div>
  )
}
