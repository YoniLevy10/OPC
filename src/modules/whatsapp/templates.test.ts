import { describe, expect, it } from 'vitest'
import {
  META_WA_TEMPLATES,
  FOLLOWUP_ALL_OK_ACK,
  defaultDeskAlertTemplateName,
  defaultSessionTemplateName,
  defaultSessionTemplateLang,
  deskAlertParameter,
  isFollowupAllOkReply,
  isFollowupWantUpdateReply,
} from './templates'

describe('META_WA_TEMPLATES', () => {
  it('defines maintainos_followup for outside-24h reopen', () => {
    expect(META_WA_TEMPLATES.followup.metaName).toBe('maintainos_followup')
    expect(META_WA_TEMPLATES.followup.language).toBe('he')
    expect(META_WA_TEMPLATES.followup.category).toBe('UTILITY')
    expect(META_WA_TEMPLATES.followup.body).toContain('Optical Center')
    expect(META_WA_TEMPLATES.followup.quickReplies.every((t) => t.length <= 25)).toBe(
      true,
    )
  })

  it('matches follow-up quick replies and all-ok ack copy', () => {
    expect(isFollowupWantUpdateReply('אשמח לעדכון')).toBe(true)
    expect(isFollowupWantUpdateReply('  אשמח לעדכון  ')).toBe(true)
    expect(isFollowupWantUpdateReply('הכל בסדר תודה')).toBe(false)
    expect(isFollowupAllOkReply('הכל בסדר תודה')).toBe(true)
    expect(isFollowupAllOkReply('אשמח לעדכון')).toBe(false)
    expect(FOLLOWUP_ALL_OK_ACK).toContain('תגובתך התקבלה')
    expect(FOLLOWUP_ALL_OK_ACK).toContain('Optical Center')
  })

  it('defaults session template from env or maintainos_followup', () => {
    expect(defaultSessionTemplateName()).toMatch(/^[a-z0-9_]+$/)
    expect(defaultSessionTemplateLang()).toBe('he')
  })

  it('defines a one-variable desk alert, separate from the store follow-up', () => {
    expect(META_WA_TEMPLATES.deskAlert.metaName).toBe('maintainos_desk_alert')
    expect(META_WA_TEMPLATES.deskAlert.metaName).not.toBe(
      META_WA_TEMPLATES.followup.metaName,
    )
    expect(META_WA_TEMPLATES.deskAlert.body).toContain('{{1}}')
    const prev = process.env.WHATSAPP_DESK_TEMPLATE
    delete process.env.WHATSAPP_DESK_TEMPLATE
    expect(defaultDeskAlertTemplateName()).toBe('maintainos_desk_alert')
    if (prev === undefined) delete process.env.WHATSAPP_DESK_TEMPLATE
    else process.env.WHATSAPP_DESK_TEMPLATE = prev
    expect(deskAlertParameter('בקשת הוצאה\nסניף 6018')).toBe(
      'בקשת הוצאה סניף 6018',
    )
    expect(deskAlertParameter('   ')).toBe('פריט שמחכה להחלטה')
  })
})
