import { TechShell } from '@/components/layout/tech-shell'
import { Panel, Skeleton } from '@/components/ui/primitives'

export default function TechDetailLoading() {
  return (
    <TechShell title="טוען…" backHref="/tech">
      <div className="flex flex-col gap-5">
        <div className="space-y-2 py-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Panel elevated className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-1/2" />
        </Panel>
        <Panel elevated className="space-y-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-20" />
            <Skeleton className="h-9 w-28" />
          </div>
        </Panel>
        {/* Dock height reserve — matches PhoneActionDock while actions hydrate */}
        <div className="phone-pad-dock" aria-hidden />
      </div>
    </TechShell>
  )
}
