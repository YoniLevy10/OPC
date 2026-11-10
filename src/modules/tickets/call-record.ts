export type CallEvent = {
  event_type: string
  created_at: string
  payload?: Record<string, unknown> | null
}

const DECISION_LABELS: Record<string, string> = {
  service_visit_planned: 'ביקור תוכנן',
  engagement_locked: 'מחיר ננעל',
  store_handoff: 'הודעה לחנות',
  store_confirmed: 'אישור חנות',
  store_rejected: 'החנות דיווחה שלא תוקן',
  ari_manual_close: 'סגירה ידנית של ארי',
}

export type ServiceCallRecord = {
  store: string
  type: string
  urgent: boolean
  openedAt: string
  decisions: string[]
  visits: number
  professional: string | null
  phone: string | null
  approvedPrice: number | null
  closedAt: string | null
  closeMethod: 'פתוחה' | 'אישור חנות' | 'סגירה ידנית של ארי'
  storeApproved: boolean
}

/** One service call: the fault plus the decisions already written on it. */
export function serviceCallRecord(input: {
  store: string
  type: string
  urgent: boolean
  openedAt: string
  events: CallEvent[]
  professional?: string | null
  phone?: string | null
  approvedPrice?: number | null
  closedAt?: string | null
  storeConfirmedAt?: string | null
}): ServiceCallRecord {
  const ordered = [...input.events].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const decisions = ordered
    .map((event) => DECISION_LABELS[event.event_type])
    .filter((label): label is string => Boolean(label))
  const manual = ordered.some((event) => event.event_type === 'ari_manual_close')
  const storeApproved = Boolean(input.storeConfirmedAt)
  const closeMethod = manual
    ? 'סגירה ידנית של ארי'
    : storeApproved
      ? 'אישור חנות'
      : 'פתוחה'
  return {
    store: input.store,
    type: input.type,
    urgent: input.urgent,
    openedAt: input.openedAt,
    decisions,
    visits: ordered.filter((event) => event.event_type === 'service_visit_planned').length,
    professional: input.professional?.trim() || null,
    phone: input.phone?.trim() || null,
    approvedPrice: input.approvedPrice != null && input.approvedPrice > 0 ? input.approvedPrice : null,
    closedAt: input.closedAt ?? null,
    closeMethod,
    storeApproved,
  }
}
