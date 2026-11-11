'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

/**
 * When a new service worker is waiting, offer an explicit reload.
 * Does not cache HTML/API — only surfaces SW activate for static assets.
 */
export function SwUpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return
    }

    let cancelled = false

    void navigator.serviceWorker.ready.then((reg) => {
      if (cancelled) return
      if (reg.waiting) setWaiting(reg.waiting)

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing
        if (!worker) return
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(reg.waiting)
          }
        })
      })
    })

    const onControllerChange = () => {
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener(
        'controllerchange',
        onControllerChange,
      )
    }
  }, [])

  if (!waiting) return null

  return (
    <div
      role="status"
      className="phone-toast fixed bottom-[calc(var(--phone-tab-h)+var(--bottomnav-gap)+var(--safe-b)+0.75rem)] z-50 mx-auto flex max-w-md items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-surface px-4 py-3 shadow-[var(--shadow-pop)] md:bottom-6"
    >
      <p className="t-body flex-1 text-ink">יש גרסה חדשה של האפליקציה</p>
      <Button
        type="button"
        size="sm"
        variant="primary"
        onClick={() => {
          waiting.postMessage({ type: 'SKIP_WAITING' })
          waiting.addEventListener('statechange', () => {
            if (waiting.state === 'activated') window.location.reload()
          })
          // Fallback if message is ignored
          window.setTimeout(() => window.location.reload(), 400)
        }}
      >
        רענון
      </Button>
    </div>
  )
}
