/**
 * Demo / pilot safety: when set, every outbound WhatsApp + SMS goes to this
 * number instead of store managers or professionals (who may be real people).
 *
 * Env: MAINTAINOS_OUTBOUND_REDIRECT_PHONE=972548102688
 */
export function outboundRedirectPhoneDigits(): string | null {
  const raw = process.env.MAINTAINOS_OUTBOUND_REDIRECT_PHONE?.trim()
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 9 ? digits : null
}

/** Digits-only recipient after optional redirect. */
export function applyOutboundRedirect(intendedRaw: string): {
  to: string
  redirected: boolean
  intended: string
} {
  const intended = intendedRaw.replace(/\D/g, '') || intendedRaw.trim()
  const redirect = outboundRedirectPhoneDigits()
  if (!redirect || redirect === intended) {
    return { to: intended, redirected: false, intended }
  }
  return { to: redirect, redirected: true, intended }
}
