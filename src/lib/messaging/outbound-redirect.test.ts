import { afterEach, describe, expect, it } from 'vitest'
import {
  applyOutboundRedirect,
  outboundRedirectPhoneDigits,
} from './outbound-redirect'

describe('outbound redirect', () => {
  const prev = process.env.MAINTAINOS_OUTBOUND_REDIRECT_PHONE

  afterEach(() => {
    if (prev === undefined) delete process.env.MAINTAINOS_OUTBOUND_REDIRECT_PHONE
    else process.env.MAINTAINOS_OUTBOUND_REDIRECT_PHONE = prev
  })

  it('is off when env unset', () => {
    delete process.env.MAINTAINOS_OUTBOUND_REDIRECT_PHONE
    expect(outboundRedirectPhoneDigits()).toBeNull()
    expect(applyOutboundRedirect('972501112233')).toEqual({
      to: '972501112233',
      redirected: false,
      intended: '972501112233',
    })
  })

  it('rewrites to personal demo phone', () => {
    process.env.MAINTAINOS_OUTBOUND_REDIRECT_PHONE = '972548102688'
    expect(outboundRedirectPhoneDigits()).toBe('972548102688')
    expect(applyOutboundRedirect('+972-50-111-2233')).toEqual({
      to: '972548102688',
      redirected: true,
      intended: '972501112233',
    })
  })
})
