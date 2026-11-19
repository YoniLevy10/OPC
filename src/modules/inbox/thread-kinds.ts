/** OC-22 thread separation on the shared desk WhatsApp number. */

export const INBOX_THREAD_KINDS = [
  'store_manager',
  'pro_coord',
  'ops_broadcast',
] as const

export type InboxThreadKind = (typeof INBOX_THREAD_KINDS)[number]

export const INBOX_BOT_MODES = ['auto', 'paused', 'never'] as const

export type InboxBotMode = (typeof INBOX_BOT_MODES)[number]

export function isInboxThreadKind(value: unknown): value is InboxThreadKind {
  return (
    typeof value === 'string' &&
    (INBOX_THREAD_KINDS as readonly string[]).includes(value)
  )
}

export function isInboxBotMode(value: unknown): value is InboxBotMode {
  return (
    typeof value === 'string' &&
    (INBOX_BOT_MODES as readonly string[]).includes(value)
  )
}

/** Bot must never auto-reply on Midrag / pro coordination threads. */
export function botShouldStaySilent(session: {
  thread_kind?: string | null
  bot_mode?: string | null
}): boolean {
  if (session.thread_kind === 'pro_coord') return true
  if (session.bot_mode === 'never') return true
  return false
}

export function threadKindLabelHe(kind: InboxThreadKind | string | null | undefined): string {
  switch (kind) {
    case 'pro_coord':
      return 'מקצוען'
    case 'ops_broadcast':
      return 'יזום HQ'
    case 'store_manager':
    default:
      return 'מנהל'
  }
}
