'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { usePhrase } from '@/components/i18n/locale-provider'

export function PrintQrClient() {
  const p = usePhrase()
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="primary"
        size="touch"
        className="md:h-9 md:min-h-0 md:px-4"
        onClick={() => window.print()}
      >
        {p('הדפסה / שמירה ל־PDF')}
      </Button>
      <Button asChild variant="secondary" size="sm">
        <Link
          href="/api/stores/qr-batch?format=pdf"
          target="_blank"
          rel="noopener"
        >
          {p('הורדת PDF לכל החנויות')}
        </Link>
      </Button>
      <Button asChild variant="ghost" size="sm">
        <Link href="/api/stores/qr-batch" target="_blank" rel="noopener">
          {p('תצוגת HTML')}
        </Link>
      </Button>
    </div>
  )
}
