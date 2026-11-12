import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getActorFromRequest } from '@/lib/auth/request-actor'
import { shouldAllowDemoEntry } from '@/lib/auth/home-path'
import { internalLiveCursor } from '@/lib/data/live-cursor'
import { supabaseReady } from '@/lib/data/memory-store'
import { createSystemClient } from '@/lib/supabase/system'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Avoid hammering Postgres / CPU when many HQ tabs poll at once. */
const STAMP_TTL_MS = 1500
let remoteCache: { at: number; value: string } | null = null
let remoteInflight: Promise<string> | null = null
let cursorCache: { at: number; value: string } | null = null
let cursorInflight: Promise<string> | null = null

function digest(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}

async function latest(
  table: 'tickets' | 'ticket_events' | 'ticket_messages' | 'inbox_messages',
  column: 'updated_at' | 'created_at',
): Promise<string> {
  const supabase = createSystemClient('live_stamp')
  // Latest timestamp only — exact COUNT on ticket_events (~14k+) was stalling
  // every open desk tab and stacking into multi‑minute page loads.
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .order(column, { ascending: false })
    .limit(1)
  if (error) return 'err'
  const row = data?.[0] as Record<string, string | null> | undefined
  return row?.[column] ?? ''
}

async function remoteStamp(): Promise<string> {
  const now = Date.now()
  if (remoteCache && now - remoteCache.at < STAMP_TTL_MS) {
    return remoteCache.value
  }
  if (remoteInflight) return remoteInflight

  remoteInflight = (async () => {
    const parts = await Promise.all([
      latest('tickets', 'updated_at'),
      latest('ticket_events', 'created_at'),
      latest('ticket_messages', 'created_at'),
      latest('inbox_messages', 'created_at'),
    ])
    const value = parts.join('|')
    remoteCache = { at: Date.now(), value }
    return value
  })().finally(() => {
    remoteInflight = null
  })

  return remoteInflight
}

async function buildCursor(): Promise<string> {
  const now = Date.now()
  if (cursorCache && now - cursorCache.at < STAMP_TTL_MS) {
    return cursorCache.value
  }
  if (cursorInflight) return cursorInflight

  cursorInflight = (async () => {
    let remote = 'off'
    if (await supabaseReady()) {
      try {
        remote = await remoteStamp()
      } catch {
        remote = 'err'
      }
    }
    const value = digest(`${internalLiveCursor()}#${remote}`)
    cursorCache = { at: Date.now(), value }
    return value
  })().finally(() => {
    cursorInflight = null
  })

  return cursorInflight
}

/**
 * Cursor for every open HQ, store, and tech screen.
 * The internal server is the memory store plus the ops ledger. Supabase is
 * folded in when it is the system of record.
 */
export async function GET(request: Request) {
  // Local/demo: skip auth round-trips on a poll. Production still gates.
  if (!shouldAllowDemoEntry()) {
    const actor = await getActorFromRequest(request)
    if (!actor) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const cursor = await buildCursor()
  return NextResponse.json(
    { cursor },
    { headers: { 'cache-control': 'no-store' } },
  )
}
