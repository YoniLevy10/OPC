import {
  getById,
  listTickets,
  updateStatus,
  assign,
  type TicketDetail,
} from '@/modules/tickets/service'
import type { TicketStatus } from '@/modules/tickets/constants'
import {
  TECH_LIST_STATUSES,
  canTechTransition,
  type TechTicketDetail,
  type TechTicketRow,
} from '@/modules/tickets/tech'
import { DEMO_TECH_ID, memGet, memUpdateStatus, supabaseReady } from '@/lib/data/memory-store'

export { DEMO_TECH_ID }

/** Open field jobs for the technician PWA (assigned / in progress / waiting parts + resolved). */
export async function listTechTickets(opts?: {
  techId?: string | null
}): Promise<{ tickets: TechTicketRow[]; backend: 'supabase' | 'memory' }> {
  const { tickets, backend } = await listTickets(500)
  const openish = new Set(TECH_LIST_STATUSES)
  let filtered = tickets.filter((t) => openish.has(t.status as TicketStatus))

  const techId = opts?.techId?.trim() || null
  if (techId) {
    filtered = filtered.filter(
      (t) =>
        t.assigned_to === techId ||
        (!t.assigned_to && t.status === 'assigned'),
    )
  }

  return {
    backend,
    tickets: filtered.map((t) => ({
      id: t.id,
      number: t.number,
      display_number: t.display_number,
      status: t.status,
      priority: t.priority,
      category: t.category,
      description: t.description,
      title: t.title ?? null,
      assigned_to: t.assigned_to ?? null,
      created_at: t.created_at,
      updated_at: t.updated_at ?? t.created_at,
      store_id: t.store_id,
      stores: t.stores
        ? {
            code: t.stores.code,
            name: t.stores.name,
            city: t.stores.city,
            address: t.stores.address ?? null,
            // List payload has no manager fields — filled on ticket detail.
            manager_name: null,
            manager_phone: null,
          }
        : null,
    })),
  }
}

export async function getTechTicket(id: string): Promise<TechTicketDetail | null> {
  const detail = await getById(id)
  if (!detail) return null
  return detailToTech(detail)
}

function detailToTech(detail: TicketDetail): TechTicketDetail {
  return {
    id: detail.id,
    number: detail.number,
    display_number: detail.display_number,
    status: detail.status,
    priority: detail.priority,
    category: detail.category,
    description: detail.description,
    title: detail.title,
    assigned_to: detail.assigned_to,
    created_at: detail.created_at,
    updated_at: detail.updated_at,
    store_id: detail.store_id,
    stores: detail.stores
      ? {
          code: detail.stores.code,
          name: detail.stores.name,
          city: detail.stores.city,
          address: detail.stores.address,
          manager_name: detail.stores.manager_name ?? null,
          manager_phone: detail.stores.manager_phone ?? null,
        }
      : null,
    events: detail.events.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      payload: e.payload,
      created_at: e.created_at,
      actor_id: e.actor_id ?? null,
    })),
    attachments: [],
  }
}

async function attachTechProofMedia(opts: {
  ticketId: string
  techId: string
  url: string
  proofRole?: 'before' | 'after' | null
  note?: string | null
}): Promise<void> {
  const photoUrl = opts.url.trim()
  if (!photoUrl) return
  const { appendEvent } = await import('@/modules/tickets/service')
  const kind =
    /\.(mp4|webm)(\?|$)/i.test(photoUrl) || photoUrl.startsWith('data:video/')
      ? 'video'
      : opts.proofRole === 'before' || opts.proofRole === 'after'
        ? opts.proofRole
        : 'image'
  await appendEvent(opts.ticketId, 'tech_photo', opts.techId, {
    photo_url: photoUrl,
    kind,
    proof_role: opts.proofRole ?? null,
  })
  if (!(await supabaseReady())) {
    const { memAddMessage } = await import('@/lib/data/memory-store')
    memAddMessage(opts.ticketId, {
      channel: 'tech',
      direction: 'inbound',
      body: opts.proofRole ?? opts.note ?? null,
      media_url: photoUrl,
      proof_role: opts.proofRole ?? null,
    })
  } else {
    const { createSystemClient } = await import('@/lib/supabase/system')
    const supabase = createSystemClient('tech_attachment_insert')
    await supabase.from('ticket_attachments').insert({
      ticket_id: opts.ticketId,
      url: photoUrl,
      kind,
      proof_role: opts.proofRole ?? null,
    })
  }
}

export async function patchTechTicket(opts: {
  ticketId: string
  techId: string
  status?: TicketStatus
  resolution_note?: string
  note?: string
  claim?: boolean
  photoUrl?: string
  beforePhotoUrl?: string
  afterPhotoUrl?: string
}): Promise<TechTicketDetail> {
  const note = (opts.resolution_note ?? opts.note)?.trim()
  const current = await getById(opts.ticketId)
  if (!current) throw new Error('תקלה לא נמצאה')

  if (opts.claim || (!current.assigned_to && opts.status)) {
    if (current.assigned_to && current.assigned_to !== opts.techId) {
      throw new Error('התקלה כבר משויכת לטכנאי אחר')
    }
    if (!current.assigned_to || current.assigned_to !== opts.techId) {
      await assign(opts.ticketId, opts.techId, opts.techId)
    }
  } else if (current.assigned_to && current.assigned_to !== opts.techId) {
    throw new Error('אין הרשאה לעדכן תקלה של טכנאי אחר')
  }

  const beforeUrl = opts.beforePhotoUrl?.trim()
  const afterUrl = opts.afterPhotoUrl?.trim()
  const photoUrl = opts.photoUrl?.trim()
  let attachedProof = false

  if (beforeUrl) {
    await attachTechProofMedia({
      ticketId: opts.ticketId,
      techId: opts.techId,
      url: beforeUrl,
      proofRole: 'before',
      note,
    })
  }
  if (afterUrl) {
    await attachTechProofMedia({
      ticketId: opts.ticketId,
      techId: opts.techId,
      url: afterUrl,
      proofRole: 'after',
      note,
    })
  }
  if (beforeUrl && afterUrl) {
    attachedProof = true
  } else if (photoUrl) {
    await attachTechProofMedia({
      ticketId: opts.ticketId,
      techId: opts.techId,
      url: photoUrl,
      note,
    })
    // Legacy single photo — still mark attached so older clients can resolve;
    // B02 UI path uploads a before/after pair via /attachments instead.
    attachedProof = true
  }

  if (opts.status && opts.status !== current.status) {
    if (!canTechTransition(current.status, opts.status)) {
      throw new Error(`מעבר מ-${current.status} ל-${opts.status} אינו מותר`)
    }

    if (opts.status === 'resolved' && !attachedProof && !photoUrl) {
      // Fall through to updateStatus proof gate (may still have prior attachments).
    }

    if (!(await supabaseReady()) && memGet(opts.ticketId)) {
      if (opts.status === 'resolved') {
        await updateStatus(opts.ticketId, opts.status, opts.techId, {
          proofAlreadyAttached: attachedProof,
        })
      } else {
        memUpdateStatus(opts.ticketId, opts.status, note ?? null, opts.techId)
      }
      if (note) {
        const { appendEvent } = await import('@/modules/tickets/service')
        await appendEvent(opts.ticketId, 'tech_note', opts.techId, {
          note,
          resolution_note: note,
          to_status: opts.status,
        })
      }
    } else {
      await updateStatus(opts.ticketId, opts.status, opts.techId, {
        proofAlreadyAttached: attachedProof,
      })
      if (note) {
        const { appendEvent } = await import('@/modules/tickets/service')
        await appendEvent(opts.ticketId, 'tech_note', opts.techId, {
          note,
          resolution_note: note,
          to_status: opts.status,
        })
      }
    }
  } else if (note) {
    const { appendEvent } = await import('@/modules/tickets/service')
    await appendEvent(opts.ticketId, 'tech_note', opts.techId, { note })
  }

  const refreshed = await getTechTicket(opts.ticketId)
  if (!refreshed) throw new Error('תקלה לא נמצאה אחרי עדכון')
  return refreshed
}
