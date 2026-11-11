import { phonesMatch } from '@/modules/whatsapp/classify'
import { normalizePhoneDigits } from '@/lib/phone'
import { listEngagements, type Engagement } from '@/modules/engagements/service'
import { getById, type TicketDetail } from '@/modules/tickets/service'
import { managerPhoneForStoreCode } from '@/modules/stores/manager-identity'

export type ProJob = {
  engagementId: string
  ticketId: string
  bundledTicketIds: string[]
  storeCode: string
  storeName: string
  managerPhone: string | null
  professionalName: string
  professionalPhone: string
  approvedAmount: number
  approvedAt: string
  status: Engagement['status']
  tickets: Array<{
    id: string
    display: string
    title: string
    description: string
    category: string | null
    status: string
  }>
}

function displayOf(t: TicketDetail): string {
  if (t.display_number?.trim()) return t.display_number
  if (t.number != null) return `OC-${t.number}`
  return t.id.slice(0, 8)
}

export async function listProJobsForPhone(phoneRaw: string): Promise<ProJob[]> {
  const phone = normalizePhoneDigits(phoneRaw)
  if (!phone) return []

  const engagements = await listEngagements()
  const locked = engagements.filter(
    (row) =>
      row.status === 'locked' &&
      phonesMatch(row.professionalPhone, phone),
  )

  const jobs: ProJob[] = []
  for (const row of locked) {
    const ids = [row.ticketId, ...row.bundledTicketIds]
    const tickets: ProJob['tickets'] = []
    for (const id of ids) {
      const t = await getById(id)
      if (!t) continue
      tickets.push({
        id: t.id,
        display: displayOf(t),
        title: t.title || t.description,
        description: t.description,
        category: t.category,
        status: t.status,
      })
    }
    if (tickets.length === 0) continue
    const managerPhone = await managerPhoneForStoreCode(row.storeCode)
    jobs.push({
      engagementId: row.id,
      ticketId: row.ticketId,
      bundledTicketIds: row.bundledTicketIds,
      storeCode: row.storeCode,
      storeName: row.storeName,
      managerPhone,
      professionalName: row.professionalName,
      professionalPhone: row.professionalPhone,
      approvedAmount: row.approvedAmount,
      approvedAt: row.approvedAt,
      status: row.status,
      tickets,
    })
  }

  return jobs.sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1))
}

export async function getProJobForTicket(
  phoneRaw: string,
  ticketId: string,
): Promise<ProJob | null> {
  const jobs = await listProJobsForPhone(phoneRaw)
  return (
    jobs.find(
      (job) =>
        job.ticketId === ticketId || job.bundledTicketIds.includes(ticketId),
    ) ?? null
  )
}
