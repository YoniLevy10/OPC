import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'עבודות — Optical Center',
  robots: { index: false, follow: false },
}

export default function ProLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-surface text-ink" dir="rtl" lang="he">
      <header className="border-b border-border px-4 py-3">
        <p className="t-caption font-semibold text-ink">Optical Center · אזור אישי</p>
        <p className="t-meta text-ink-muted">עבודות שאישר ארי</p>
      </header>
      <main className="mx-auto w-full max-w-lg px-4 py-4">{children}</main>
    </div>
  )
}
