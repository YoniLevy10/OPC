/**
 * Formerly blocked dense screens on phones. Mobile is first-class —
 * always render children. `title` kept optional for call-site compatibility.
 */
export function PhoneDesktopOnly({
  children,
}: {
  title?: string
  children: React.ReactNode
}) {
  return <>{children}</>
}
