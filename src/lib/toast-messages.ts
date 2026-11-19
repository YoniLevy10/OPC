/**
 * Hebrew toast copy for copy + CRUD flows.
 * Status icons live in ToastProvider — no ✓/✕ in text.
 */
export const TM = {
  copied: 'הועתק בהצלחה',
  phoneCopied: 'טלפון הועתק בהצלחה',
  linkCopied: 'הקישור הועתק בהצלחה',
  ticketNumberCopied: 'מספר תקלה הועתק בהצלחה',
  copyFailed: 'ההעתקה נכשלה',
  professionalSaved: 'איש המקצוע נשמר בהצלחה',
  professionalUpdated: 'איש המקצוע עודכן בהצלחה',
  professionalDeleted: 'איש המקצוע נמחק בהצלחה',
  professionalBooked: 'איש מקצוע נשמר בספר בהצלחה',
  ticketDeleted: 'התקלה נמחקה בהצלחה',
  techStarted: 'הטיפול התחיל בהצלחה',
  techCompleted: 'נשלח לאישור החנות בהצלחה',
} as const

export type ToastMessageKey = keyof typeof TM
