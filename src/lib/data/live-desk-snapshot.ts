/** A private-server copy of the live ticket desk. Never written in production. */
export type LiveDeskRow = {
  id: string
  number: number | null
  display_number: string | null
  title: string | null
  description: string
  category: string
  priority: string
  status: string
  created_at: string
  updated_at: string | null
  resolved_at: string | null
  sla_respond_by: string | null
  sla_resolve_by: string | null
  store_id: string
  store_code: string
  store_name: string
  store_city: string | null
}

type NodeFs = {
  existsSync: (path: string) => boolean
  readFileSync: (path: string, encoding: 'utf8') => string
}

type NodePath = {
  join: (...parts: string[]) => string
}

/**
 * Node builtins without a static `node:fs` / `node:path` import.
 * A static import is traced into client bundles that reach this module and
 * breaks Turbopack ("chunking context does not support external modules").
 */
function serverBuiltin<T>(id: 'node:fs' | 'node:path'): T | null {
  if (typeof window !== 'undefined') return null
  const load = (
    process as NodeJS.Process & {
      getBuiltinModule?: (specifier: string) => unknown
    }
  ).getBuiltinModule
  if (typeof load !== 'function') return null
  try {
    return load(id) as T
  } catch {
    return null
  }
}

/**
 * Local demo has no Supabase, so the desk is empty.
 * When `.local/live-desk.json` is present, development reads that copy.
 * Tests and production ignore it.
 * Browser bundles must not touch the filesystem; the Node server still does.
 */
export function readLiveDeskSnapshot(): LiveDeskRow[] | null {
  if (typeof window !== 'undefined') return null
  if (process.env.NODE_ENV !== 'development') return null
  if (process.env.VITEST) return null
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  const fs = serverBuiltin<NodeFs>('node:fs')
  const path = serverBuiltin<NodePath>('node:path')
  if (!fs || !path) return null
  const filePath = path.join(process.cwd(), '.local', 'live-desk.json')
  if (!fs.existsSync(filePath)) return null
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed as LiveDeskRow[]
  } catch {
    return null
  }
}
