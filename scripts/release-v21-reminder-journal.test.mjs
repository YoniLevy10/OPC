import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectionOptions, migrateReminderJournal, releaseCliDecision, runReleaseCli, safeFailure } from './release-v21-reminder-journal.mjs'

const releaseEnv = {
  VERCEL: '1', VERCEL_ENV: 'preview',
  NEXT_PUBLIC_SUPABASE_URL: 'https://pfsxuylbnpbcgjehuaqo.supabase.co',
  SUPABASE_DB_PASSWORD: 'test-only-password-with-@:/ characters',
}

test('recognizes the same pinned OPC origin with or without its root slash', () => {
  assert.equal(connectionOptions({ ...releaseEnv, NEXT_PUBLIC_SUPABASE_URL: `${releaseEnv.NEXT_PUBLIC_SUPABASE_URL}/` }, ['--apply']).host,
    'aws-1-eu-west-1.pooler.supabase.com')
  for (const value of [
    'https://another-project.supabase.co/', `${releaseEnv.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`,
    `${releaseEnv.NEXT_PUBLIC_SUPABASE_URL}?token=private`, `${releaseEnv.NEXT_PUBLIC_SUPABASE_URL}#fragment`,
    'https://user:password@pfsxuylbnpbcgjehuaqo.supabase.co/', 'http://pfsxuylbnpbcgjehuaqo.supabase.co/',
  ]) assert.throws(() => connectionOptions({ ...releaseEnv, NEXT_PUBLIC_SUPABASE_URL: value }, ['--apply']), /opc_project_url_required/)
})
const expectedColumns = [
  ['delivery_key','text',true], ['document_client_id','text',true],
  ['document_version','integer',true], ['due_at','timestamp with time zone',false],
  ['stage','text',true], ['recipient','text',true], ['status','text',true],
  ['claim_token','uuid',true], ['lease_until','timestamp with time zone',true],
  ['attempts','integer',true,'1'], ['last_attempt_at','timestamp with time zone',true],
  ['sent_at','timestamp with time zone',false], ['provider_message_id','text',false],
  ['last_error','text',false], ['created_at','timestamp with time zone',true,'now()'],
].map(([name,type,not_null,default_expression=null]) => ({name,type,not_null,default_expression,identity:'',generated:''}))
const constraints = [
  'PRIMARY KEY (delivery_key)',
  "CHECK ((stage = ANY (ARRAY['six'::text, 'two'::text, 'month'::text, 'overdue'::text, 'review'::text])))",
  "CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'failed'::text, 'dry_run'::text])))",
  'CHECK ((attempts > 0))',
  "CHECK (((status <> 'sent'::text) OR ((provider_message_id IS NOT NULL) AND (sent_at IS NOT NULL))))",
].map((definition) => ({ definition, validated:true, deferrable:false, deferred:false }))

function fakeDatabase(overrides={}) {
  const statements = []
  let historyRow = overrides.historyRow
  const client = {
    connection: { stream:{encrypted:true,authorized:true} },
    async connect() { statements.push('CONNECT') },
    async end() { statements.push('END') },
    async query(sql, values) {
      statements.push(sql)
      if (overrides.failAt && sql.includes(overrides.failAt)) throw Object.assign(new Error('SECRET in raw pg error'),{code:'42501'})
      if (sql.includes('current_database()')) return {rows:[{
        database_name:'postgres', user_name:'postgres', journal_exists:Boolean(overrides.exists),
        history_exists: overrides.history !== false, required_roles:3, service_bypass_rls:true,
        ...overrides.preflight,
      }]}
      if (sql.includes('FROM pg_attribute')) {
        if (values[0].startsWith('supabase_migrations.')) return {rows:overrides.historyColumns ?? [
          {name:'version',type:'text',not_null:true,default_expression:null},
          {name:'statements',type:'text[]',not_null:false,default_expression:null},
          {name:'name',type:'text',not_null:false,default_expression:null},
        ]}
        return {rows:overrides.columns ?? expectedColumns}
      }
      if (sql.includes('FROM pg_constraint')) return {rows:overrides.constraints ?? constraints}
      if (sql.includes('FROM pg_class c WHERE')) return {rows:[{
        relkind:'r',rls:true,forced_rls:false,policies:0,triggers:0,rules:0,...overrides.security,
      }]}
      if (sql.includes('has_table_privilege')) return {rows:overrides.privileges ?? [
        {role_name:'anon',any_table_access:false,any_column_access:false},
        {role_name:'authenticated',any_table_access:false,any_column_access:false},
        {role_name:'service_role',can_select:true,can_insert:true,can_update:true,schema_usage:true},
      ]}
      if (sql.includes('SELECT version, statements')) return {rows:historyRow ? [historyRow] : []}
      if (sql.startsWith('INSERT INTO supabase_migrations.')) historyRow = {
        version:values[0],statements:values[1],...(values.length === 3 ? {name:values[2]} : {}),
      }
      return {rows:[]}
    },
  }
  return {client,statements}
}
async function run(database, extra={}) {
  return migrateReminderJournal({env:releaseEnv,args:['--apply'],createClient:() => database.client,...extra})
}
function hasDdl(database) {
  return database.statements.some((sql) => sql.includes('create table public.document_reminder_deliveries'))
}

test('only explicit preview builds targeting OPC can obtain a connection', async () => {
  for (const env of [
    {...releaseEnv,VERCEL:undefined}, {...releaseEnv,VERCEL_ENV:'production'},
    {...releaseEnv,VERCEL_TARGET_ENV:'production'}, {...releaseEnv,NEXT_PUBLIC_SUPABASE_URL:undefined},
    {...releaseEnv,NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'},
    {...releaseEnv,NEXT_PUBLIC_SUPABASE_URL:releaseEnv.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1'},
    {...releaseEnv,SUPABASE_PROJECT_REF:'other'}, {...releaseEnv,SUPABASE_DB_HOST:'attacker.invalid'},
    {...releaseEnv,SUPABASE_DB_PASSWORD:''}, {...releaseEnv,NODE_TLS_REJECT_UNAUTHORIZED:'0'},
  ]) {
    let connected = false
    await assert.rejects(migrateReminderJournal({env,args:['--apply'],createClient:() => {connected=true}}))
    assert.equal(connected,false)
  }
  assert.throws(() => connectionOptions(releaseEnv,[]),/explicit_apply_required/)
  assert.throws(() => connectionOptions(releaseEnv,['--apply','unreviewed.sql']),/explicit_apply_required/)
})

test('connection pins host, user and verified TLS without URL password interpolation', () => {
  const options=connectionOptions(releaseEnv,['--apply'])
  assert.equal(options.host,'aws-1-eu-west-1.pooler.supabase.com')
  assert.equal(options.user,'postgres.pfsxuylbnpbcgjehuaqo')
  assert.equal(options.port,6543)
  assert.equal(options.password,releaseEnv.SUPABASE_DB_PASSWORD)
  assert.equal(options.ssl.rejectUnauthorized,true)
  assert.equal(options.ssl.servername,options.host)
  assert.equal(options.connectionString,undefined)
})

test('a modified migration fails before database connection', async () => {
  let connected=false
  await assert.rejects(migrateReminderJournal({env:releaseEnv,args:['--apply'],
    loadSql:async () => 'DROP TABLE tickets;',createClient:() => {connected=true}}),/migration_hash_mismatch/)
  assert.equal(connected,false)
})

test('an unverified TLS connection never starts a transaction', async () => {
  const database=fakeDatabase()
  database.client.connection.stream.authorized=false
  await assert.rejects(run(database),/verified_tls_connection_required/)
  assert.deepEqual(database.statements,['CONNECT','END'])
})

test('first application locks before inspecting schema and commits verified DDL + history together', async () => {
  const database=fakeDatabase()
  assert.deepEqual(await run(database),{journal:'created_and_verified',history:'recorded'})
  assert.equal(hasDdl(database),true)
  const lock=database.statements.findIndex((sql) => sql.includes('pg_advisory_xact_lock'))
  const preflight=database.statements.findIndex((sql) => sql.includes('current_database()'))
  const ddl=database.statements.findIndex((sql) => sql.includes('create table public.document_reminder_deliveries'))
  const history=database.statements.findIndex((sql) => sql.startsWith('INSERT INTO supabase_migrations.'))
  assert.ok(database.statements.indexOf('BEGIN') < lock && lock < preflight && preflight < ddl && ddl < history)
  assert.deepEqual(database.statements.slice(-2),['COMMIT','END'])
  assert.equal(database.statements.at(-3),"NOTIFY pgrst, 'reload schema'")
  assert.ok(database.statements.some((sql) => sql === "SET LOCAL statement_timeout = '15s'"))
})

test('a verified existing journal does not execute DDL or replay historical migrations', async () => {
  const database=fakeDatabase({exists:true,history:false})
  assert.deepEqual(await run(database),{journal:'verified_existing',history:'unavailable'})
  assert.equal(hasDdl(database),false)
  assert.equal(database.statements.some((sql) => sql.startsWith('INSERT')),false)
})

test('an unavailable migration history is reported without creating unrelated tables', async () => {
  const database=fakeDatabase({history:false})
  assert.deepEqual(await run(database),{journal:'created_and_verified',history:'unavailable'})
  assert.equal(database.statements.filter((sql) => sql.includes('create table')).length,1)
})

test('unexpected journal shape fails before changing an existing table', async () => {
  for (const overrides of [
    {columns:expectedColumns.slice(1)}, {constraints:constraints.slice(1)},
    {security:{rls:false}}, {security:{policies:1}}, {security:{triggers:1}},
    {privileges:[{role_name:'anon',any_table_access:true}]},
  ]) {
    const database=fakeDatabase({exists:true,...overrides})
    await assert.rejects(run(database),/journal_/)
    assert.equal(hasDdl(database),false)
    assert.deepEqual(database.statements.slice(-2),['ROLLBACK','END'])
  }
})

test('failed post-creation security verification rolls back the migration and does not record history', async () => {
  const database=fakeDatabase({security:{rls:false}})
  await assert.rejects(run(database),/journal_security_definition_mismatch/)
  assert.equal(hasDdl(database),true)
  assert.equal(database.statements.some((sql) => sql.startsWith('INSERT')),false)
  assert.deepEqual(database.statements.slice(-2),['ROLLBACK','END'])
})

test('wrong database identity or missing required roles prevents DDL', async () => {
  for (const preflight of [{database_name:'different'},{user_name:'someone_else'},{required_roles:2},{service_bypass_rls:false}]) {
    const database=fakeDatabase({preflight})
    await assert.rejects(run(database))
    assert.equal(hasDdl(database),false)
    assert.deepEqual(database.statements.slice(-2),['ROLLBACK','END'])
  }
})

test('unknown required history fields fail before DDL, without repairing history schema', async () => {
  const database=fakeDatabase({historyColumns:[
    {name:'version',type:'text',not_null:true}, {name:'statements',type:'text[]',not_null:false},
    {name:'unknown',type:'text',not_null:true,default_expression:null},
  ]})
  await assert.rejects(run(database),/unknown_required_history_column/)
  assert.equal(hasDdl(database),false)
})

test('a recorded migration with a missing table or different contents fails closed', async () => {
  for (const exists of [false,true]) {
    const database=fakeDatabase({exists,historyRow:{version:'20261110120110',name:'document_reminder_deliveries',statements:['unreviewed SQL']}})
    await assert.rejects(run(database),/existing_migration_history_mismatch/)
    assert.equal(hasDdl(database),false)
  }
})

test('pg failures are rolled back and safe reporting does not reveal raw errors', async () => {
  const database=fakeDatabase({failAt:'create table public.document_reminder_deliveries'})
  await assert.rejects(run(database),(error) => {
    assert.equal(safeFailure(error),'postgres_42501')
    return true
  })
  assert.deepEqual(database.statements.slice(-2),['ROLLBACK','END'])
  assert.equal(safeFailure(new Error(releaseEnv.SUPABASE_DB_PASSWORD)),'release_step_failed')
  assert.equal(safeFailure({code:'PASSWORD-leaked'}),'release_step_failed')
})

test('idle pg error events are handled without printing raw errors or committing', async () => {
  const database=fakeDatabase()
  let onError
  database.client.on=(event, listener) => { assert.equal(event,'error'); onError=listener }
  const query=database.client.query
  database.client.query=async (sql,values) => {
    const result=await query(sql,values)
    if (sql.startsWith('NOTIFY')) onError(Object.assign(new Error('sensitive idle database error'),{code:'08006'}))
    return result
  }
  await assert.rejects(run(database),(error) => {
    assert.equal(safeFailure(error),'postgres_08006')
    return true
  })
  assert.equal(database.statements.includes('COMMIT'),false)
  assert.deepEqual(database.statements.slice(-2),['ROLLBACK','END'])
})

const productionEnv={...releaseEnv,VERCEL_ENV:'production',VERCEL_TARGET_ENV:'production'}

test('production schema-only mode requires both production environment and target', async () => {
  const options=connectionOptions(productionEnv,['--production-schema-only'])
  assert.equal(options.ssl.rejectUnauthorized,true)
  assert.equal(options.user,'postgres.pfsxuylbnpbcgjehuaqo')
  for (const env of [
    {...productionEnv,VERCEL:'0'}, {...productionEnv,VERCEL_ENV:'preview'},
    {...productionEnv,VERCEL_TARGET_ENV:undefined}, {...productionEnv,VERCEL_TARGET_ENV:'preview'},
    {...productionEnv,NEXT_PUBLIC_SUPABASE_URL:'https://different.supabase.co'},
    {...productionEnv,SUPABASE_DB_PASSWORD:''}, {...productionEnv,NODE_TLS_REJECT_UNAUTHORIZED:'0'},
  ]) {
    const database=fakeDatabase()
    await assert.rejects(run(database,{env,args:['--production-schema-only']}))
    assert.equal(database.statements.length,0)
  }
  assert.throws(() => connectionOptions(productionEnv,['--apply']),/preview_build_required/)
  assert.throws(() => connectionOptions(releaseEnv,['--production-schema-only']),/production_build_required/)
})

test('production schema-only mode retains the same transactional verified migration', async () => {
  const database=fakeDatabase()
  assert.deepEqual(await run(database,{env:productionEnv,args:['--production-schema-only']}),{
    journal:'created_and_verified',history:'recorded',
  })
  assert.deepEqual(database.statements.slice(-3),["NOTIFY pgrst, 'reload schema'",'COMMIT','END'])
})

test('every verified production carrier result deliberately fails the CLI build', async () => {
  for (const journal of ['created_and_verified','verified_existing']) {
    for (const history of ['recorded','already_recorded','unavailable']) {
      const result={journal,history}
      const decision=releaseCliDecision('production_schema_only',result)
      assert.equal(decision.exitCode,1)
      assert.equal(decision.output.status,'schema_verified_deployment_intentionally_stopped')
      assert.deepEqual(await runReleaseCli({env:productionEnv,args:['--production-schema-only'],migrate:async () => result}),decision)
    }
  }
  assert.equal(releaseCliDecision('preview',{journal:'verified_existing',history:'recorded'}).exitCode,0)
  assert.throws(() => releaseCliDecision('unknown',{}),/unknown_release_mode/)
})

test('production carrier failures also fail the build and sanitize output', async () => {
  let called=false
  const missingTarget=await runReleaseCli({env:{...productionEnv,VERCEL_TARGET_ENV:undefined},args:['--production-schema-only'],migrate:async () => {called=true}})
  assert.equal(missingTarget.exitCode,1)
  assert.equal(missingTarget.output.error,'production_target_required')
  assert.equal(called,false)
  const failed=await runReleaseCli({env:productionEnv,args:['--production-schema-only'],migrate:async () => {throw new Error('SECRET DATABASE PASSWORD')}})
  assert.deepEqual(failed,{exitCode:1,output:{step:'opc_v21_reminder_journal',error:'release_step_failed'}})
})
