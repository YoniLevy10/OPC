#!/usr/bin/env node
/**
 * One-off OPC release step. Opt in through one preview build override:
 *   node scripts/release-v21-reminder-journal.mjs --apply && npm run build
 * Or a production schema-only carrier whose ONLY build command is:
 *   node scripts/release-v21-reminder-journal.mjs --production-schema-only
 * That mode always exits 1, including verified success, so it cannot publish.
 * Uses existing build credentials; never retrieves/prints them. No HTTP endpoint,
 * cron invocation, historical migration replay, or default project selection.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const REF = 'pfsxuylbnpbcgjehuaqo'
const HOST = 'aws-1-eu-west-1.pooler.supabase.com'
const VERSION = '20261110120110'
const NAME = 'document_reminder_deliveries'
const TABLE = `public.${NAME}`
const HASH = '957e4d5344a118e9603ac471b3ccfa2b00316c9704d102ca2c52a6317892847f'
const MIGRATION = new URL(`../supabase/migrations/${VERSION}_${NAME}.sql`, import.meta.url)

class ReleaseError extends Error {
  constructor(code) { super(code); this.name = 'ReleaseError'; this.code = code }
}
function requireCondition(condition, code) {
  if (!condition) throw new ReleaseError(code)
}

export function releaseMode(env, args) {
  requireCondition(args.length === 1 && ['--apply','--production-schema-only'].includes(args[0]), 'explicit_apply_required')
  if (args[0] === '--production-schema-only') {
    requireCondition(env.VERCEL === '1' && env.VERCEL_ENV === 'production', 'production_build_required')
    requireCondition(env.VERCEL_TARGET_ENV === 'production', 'production_target_required')
    return 'production_schema_only'
  }
  requireCondition(env.VERCEL === '1' && env.VERCEL_ENV === 'preview', 'preview_build_required')
  requireCondition(!env.VERCEL_TARGET_ENV || env.VERCEL_TARGET_ENV === 'preview', 'preview_target_required')
  return 'preview'
}

export function connectionOptions(env, args) {
  releaseMode(env, args)
  requireCondition(env.NEXT_PUBLIC_SUPABASE_URL === `https://${REF}.supabase.co`, 'opc_project_url_required')
  requireCondition(!env.SUPABASE_PROJECT_REF || env.SUPABASE_PROJECT_REF === REF, 'project_ref_mismatch')
  requireCondition(!env.SUPABASE_DB_HOST || env.SUPABASE_DB_HOST === HOST, 'pooler_host_mismatch')
  requireCondition(typeof env.SUPABASE_DB_PASSWORD === 'string' && env.SUPABASE_DB_PASSWORD.trim().length > 0, 'database_password_unavailable')
  requireCondition(env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'tls_verification_required')
  return {
    host: HOST, port: 6543, database: 'postgres', user: `postgres.${REF}`,
    password: env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: true, servername: HOST },
    connectionTimeoutMillis: 10000, query_timeout: 20000,
    application_name: 'opc-v21-reminder-journal-release',
  }
}

const expectedColumns = [
  ['delivery_key', 'text', true, null], ['document_client_id', 'text', true, null],
  ['document_version', 'integer', true, null], ['due_at', 'timestamp with time zone', false, null],
  ['stage', 'text', true, null], ['recipient', 'text', true, null],
  ['status', 'text', true, null], ['claim_token', 'uuid', true, null],
  ['lease_until', 'timestamp with time zone', true, null], ['attempts', 'integer', true, '1'],
  ['last_attempt_at', 'timestamp with time zone', true, null],
  ['sent_at', 'timestamp with time zone', false, null], ['provider_message_id', 'text', false, null],
  ['last_error', 'text', false, null], ['created_at', 'timestamp with time zone', true, 'now()'],
]
const compact = (text) => text.replace(/\s+/g, '').replace(/::text/g, '')
const expectedConstraints = [
  'PRIMARY KEY (delivery_key)',
  "CHECK ((stage = ANY (ARRAY['six'::text, 'two'::text, 'month'::text, 'overdue'::text, 'review'::text])))",
  "CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'failed'::text, 'dry_run'::text])))",
  'CHECK ((attempts > 0))',
  "CHECK (((status <> 'sent'::text) OR ((provider_message_id IS NOT NULL) AND (sent_at IS NOT NULL))))",
].map(compact).sort()

async function columns(client, table) {
  return (await client.query(`
    SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
      a.attnotnull AS not_null, pg_get_expr(d.adbin,d.adrelid) AS default_expression,
      a.attidentity AS identity, a.attgenerated AS generated
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum
  `, [table])).rows
}

async function preflight(client) {
  const { rows: [row] } = await client.query(`
    SELECT current_database() AS database_name, current_user AS user_name,
      to_regclass('public.document_reminder_deliveries') IS NOT NULL AS journal_exists,
      to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS history_exists,
      (SELECT count(*)::int FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) AS required_roles,
      (SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role') AS service_bypass_rls
  `)
  requireCondition(row?.database_name === 'postgres' && row?.user_name === 'postgres', 'unexpected_database_identity')
  requireCondition(row.required_roles === 3 && row.service_bypass_rls === true, 'required_database_roles_missing')
  return row
}

async function readHistory(client, exists) {
  if (!exists) return { kind: 'absent' }
  const fields = await columns(client, 'supabase_migrations.schema_migrations')
  const version = fields.find((column) => column.name === 'version')
  const statements = fields.find((column) => column.name === 'statements')
  const name = fields.find((column) => column.name === 'name')
  requireCondition(version?.type === 'text' && version.not_null && statements?.type === 'text[]' && (!name || name.type === 'text'), 'unknown_migration_history_schema')
  requireCondition(fields.every((column) => ['version','statements','name'].includes(column.name) || !column.not_null || column.default_expression !== null || column.identity), 'unknown_required_history_column')
  const { rows } = await client.query(`SELECT version, statements${name ? ', name' : ''} FROM supabase_migrations.schema_migrations WHERE version=$1`, [VERSION])
  requireCondition(rows.length < 2, 'duplicate_migration_history')
  return { kind: 'known', hasName: Boolean(name), existing: rows[0] }
}

export async function verifyJournal(client) {
  const actualColumns = await columns(client, TABLE)
  requireCondition(actualColumns.length === expectedColumns.length && expectedColumns.every(([name,type,notNull,defaultExpression], index) => {
    const actual = actualColumns[index]
    return actual.name === name && actual.type === type && actual.not_null === notNull &&
      actual.default_expression === defaultExpression && !actual.identity && !actual.generated
  }), 'journal_column_definition_mismatch')
  const { rows: constraints } = await client.query(`
    SELECT pg_get_constraintdef(oid) AS definition, convalidated AS validated,
      condeferrable AS deferrable, condeferred AS deferred
    FROM pg_constraint WHERE conrelid=to_regclass($1) AND contype <> 'n'
  `, [TABLE])
  requireCondition(constraints.every((row) => row.validated && !row.deferrable && !row.deferred) &&
    JSON.stringify(constraints.map((row) => compact(row.definition)).sort()) === JSON.stringify(expectedConstraints), 'journal_constraints_mismatch')
  const { rows: [security] } = await client.query(`
    SELECT c.relkind, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced_rls,
      (SELECT count(*)::int FROM pg_policy WHERE polrelid=c.oid) AS policies,
      (SELECT count(*)::int FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal) AS triggers,
      (SELECT count(*)::int FROM pg_rewrite WHERE ev_class=c.oid) AS rules
    FROM pg_class c WHERE c.oid=to_regclass($1)
  `, [TABLE])
  requireCondition(security?.relkind === 'r' && security.rls && !security.forced_rls &&
    security.policies === 0 && security.triggers === 0 && security.rules === 0, 'journal_security_definition_mismatch')
  const { rows: privileges } = await client.query(`
    SELECT role_name,
      has_table_privilege(role_name::name,$1,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS any_table_access,
      has_any_column_privilege(role_name::name,$1,'SELECT,INSERT,UPDATE,REFERENCES') AS any_column_access,
      has_table_privilege(role_name::name,$1,'SELECT') AS can_select,
      has_table_privilege(role_name::name,$1,'INSERT') AS can_insert,
      has_table_privilege(role_name::name,$1,'UPDATE') AS can_update,
      has_schema_privilege(role_name::name,'public','USAGE') AS schema_usage
    FROM (VALUES ('anon'),('authenticated'),('service_role')) AS roles(role_name)
  `, [TABLE])
  requireCondition(['anon','authenticated'].every((name) => privileges.some((row) => row.role_name === name && !row.any_table_access && !row.any_column_access)) &&
    privileges.some((row) => row.role_name === 'service_role' && row.can_select && row.can_insert && row.can_update && row.schema_usage), 'journal_grants_mismatch')
}

function normalizedSql(text) {
  return text.replace(/--[^\n]*/g, '').replace(/[\s;]/g, '')
}

/** Injectable only for local tests; the CLI always uses the fixed file and pg. */
export async function migrateReminderJournal({ env = process.env, args = process.argv.slice(2), createClient, loadSql = () => readFile(MIGRATION, 'utf8') } = {}) {
  const options = connectionOptions(env, args)
  const sql = await loadSql()
  requireCondition(typeof sql === 'string' && createHash('sha256').update(sql).digest('hex') === HASH, 'migration_hash_mismatch')
  if (!createClient) {
    let pg
    try { pg = await import('pg') } catch { throw new ReleaseError('postgres_driver_unavailable') }
    createClient = (config) => new pg.default.Client(config)
  }
  const client = createClient(options)
  let transaction = false
  let asynchronousFailure
  // pg may emit idle connection errors outside query promises. Do not let Node
  // print an unhandled error event containing raw database details.
  client.on?.('error', (error) => { asynchronousFailure = error })
  try {
    await client.connect()
    const stream = client.connection?.stream
    requireCondition(stream?.encrypted === true && stream.authorized === true, 'verified_tls_connection_required')
    await client.query('BEGIN')
    transaction = true
    await client.query("SET LOCAL lock_timeout = '5s'")
    await client.query("SET LOCAL statement_timeout = '15s'")
    await client.query('SELECT pg_advisory_xact_lock(181101, 120110)')
    const before = await preflight(client)
    const history = await readHistory(client, before.history_exists)
    if (history.existing) {
      requireCondition(before.journal_exists && (!history.hasName || history.existing.name === NAME) &&
        Array.isArray(history.existing.statements) &&
        normalizedSql(history.existing.statements.join('\n')) === normalizedSql(sql), 'existing_migration_history_mismatch')
    }
    if (before.journal_exists) await verifyJournal(client)
    else await client.query(sql)
    await verifyJournal(client)
    let historyStatus = history.kind === 'absent' ? 'unavailable' : 'already_recorded'
    if (history.kind === 'known' && !history.existing) {
      await client.query(`INSERT INTO supabase_migrations.schema_migrations (version,statements${history.hasName ? ',name' : ''}) VALUES ($1,$2${history.hasName ? ',$3' : ''})`,
        history.hasName ? [VERSION,[sql],NAME] : [VERSION,[sql]])
      const recorded = await readHistory(client, true)
      requireCondition(recorded.existing?.version === VERSION &&
        normalizedSql(recorded.existing.statements?.join('\n') ?? '') === normalizedSql(sql), 'migration_history_verification_failed')
      historyStatus = 'recorded'
    }
    await client.query("NOTIFY pgrst, 'reload schema'")
    if (asynchronousFailure) throw asynchronousFailure
    await client.query('COMMIT')
    transaction = false
    return { journal: before.journal_exists ? 'verified_existing' : 'created_and_verified', history: historyStatus }
  } catch (error) {
    if (transaction) { try { await client.query('ROLLBACK') } catch { /* Never print DB errors or credentials. */ } }
    throw error
  } finally {
    try { await client.end() } catch { /* Never print DB errors or credentials. */ }
  }
}

// Database errors can include SQL/data/credentials: only log fixed codes or SQLSTATE.
export function safeFailure(error) {
  return error instanceof ReleaseError ? error.code :
    typeof error?.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code) ? `postgres_${error.code}` : 'release_step_failed'
}

export function releaseCliDecision(mode, result) {
  requireCondition(['preview','production_schema_only'].includes(mode), 'unknown_release_mode')
  return {
    exitCode: mode === 'production_schema_only' ? 1 : 0,
    output: {
      step: 'opc_v21_reminder_journal', ...result,
      ...(mode === 'production_schema_only' ? {status:'schema_verified_deployment_intentionally_stopped'} : {}),
    },
  }
}

export async function runReleaseCli({env=process.env,args=process.argv.slice(2),migrate=migrateReminderJournal}={}) {
  try {
    const mode=releaseMode(env,args)
    return releaseCliDecision(mode,await migrate({env,args}))
  } catch (error) {
    return {exitCode:1,output:{step:'opc_v21_reminder_journal',error:safeFailure(error)}}
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const decision=await runReleaseCli()
  // Set before logging: a verified production carrier must NEVER exit zero.
  process.exitCode=decision.exitCode
  const write=decision.output.error ? console.error : console.log
  write(JSON.stringify(decision.output))
}
