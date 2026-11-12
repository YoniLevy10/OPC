'use client'

import { TechShell } from '@/components/layout/tech-shell'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/primitives'
import { OpsPageHero } from '@/components/ops/ops-page-hero'

export default function TechError({ reset }: { reset: () => void }) {
  return (
    <TechShell>
      <div className="flex flex-col gap-5">
        <OpsPageHero
          eyebrow="Optical Center · טכנאי"
          title="שגיאה"
          status="לא ניתן לטעון את המסך"
        />
        <ErrorState
          title="לא ניתן לטעון"
          description="בדקו את החיבור לרשת ונסו שוב."
          action={
            <Button variant="primary" size="touch" onClick={reset}>
              ניסיון חוזר
            </Button>
          }
        />
      </div>
    </TechShell>
  )
}
