import { TechShell } from '@/components/layout/tech-shell'
import { Panel, Skeleton } from '@/components/ui/primitives'

export default function TechLoading() {
  return (
    <TechShell>
      <div className="flex flex-col gap-5">
        <div className="space-y-2 py-1">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Panel flush elevated className="overflow-hidden">
          <div className="divide-y divide-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2 px-4 py-4">
                <div className="flex justify-between">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </TechShell>
  )
}
