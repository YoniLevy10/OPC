import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'עבודות — Optical Center',
  robots: { index: false, follow: false },
}

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ops-atmosphere min-h-dvh bg-surface text-ink" dir="rtl" lang="he">
      <header className="border-b border-border/80 bg-[color-mix(in_srgb,var(--surface)_92%,var(--tenant-soft))] px-4 py-3.5">
        <p className="t-caption font-semibold tracking-wide text-[var(--tenant)]">
          Optical Center
        </p>
        <p className="t-meta text-ink-2">עבודה משויכת · אחרי אישור ארי</p>
      </header>
      <main className="mx-auto w-full max-w-lg px-4 py-5">{children}</main>
    </div>
  )
}
