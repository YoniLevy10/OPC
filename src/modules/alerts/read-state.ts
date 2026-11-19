/**
 * Client-side “seen” tracking for Ops alerts + home-screen badge.
 * Alerts are derived from live ticket/decision state; read state is local only.
 */

const STORAGE_KEY = 'maintainos.alerts.seen.v1'

export function loadSeenAlertIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

export function persistSeenAlertIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
  } catch {
    /* quota / private mode */
  }
}

export function markAlertsSeen(ids: string[]): Set<string> {
  const seen = loadSeenAlertIds()
  for (const id of ids) {
    if (id) seen.add(id)
  }
  persistSeenAlertIds(seen)
  return seen
}

export function countUnseenAlerts(
  openIds: string[],
  seen: Set<string> = loadSeenAlertIds(),
): number {
  let n = 0
  for (const id of openIds) {
    if (id && !seen.has(id)) n += 1
  }
  return n
}

/** Best-effort app icon badge (Chromium / installed PWA). */
export async function syncAppBadge(unreadCount: number): Promise<void> {
  if (typeof navigator === 'undefined') return
  try {
    if (unreadCount > 0 && 'setAppBadge' in navigator) {
      await (
        navigator as Navigator & {
          setAppBadge: (n?: number) => Promise<void>
        }
      ).setAppBadge(unreadCount)
      return
    }
    if ('clearAppBadge' in navigator) {
      await (
        navigator as Navigator & { clearAppBadge: () => Promise<void> }
      ).clearAppBadge()
    }
  } catch {
    /* unsupported or permission */
  }

  // Also ask the service worker (some browsers only allow badge from SW).
  try {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.ready
    reg.active?.postMessage({
      type: 'SET_APP_BADGE',
      count: unreadCount,
    })
  } catch {
    /* ignore */
  }
}
