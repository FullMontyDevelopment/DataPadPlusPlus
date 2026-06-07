import { spawnSync } from 'node:child_process'

const container = 'datapadplusplus-postgres'
const database = 'datapadplusplus'
const defaultUser = 'datapadplusplus'
const defaultPassword = 'datapadplusplus'
const readonlyUser = 'fixture_postgres_readonly'
const readonlyPassword = 'datapad-readonly-fixture'

const checks = []
const notes = []

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    input: options.input,
    stdio: 'pipe',
    shell: false,
  })
}

function containerRunning(name) {
  const result = docker(['inspect', '-f', '{{.State.Running}}', name])
  return result.status === 0 && result.stdout.trim() === 'true'
}

function commandOutput(result) {
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
}

function psqlResult(script, options = {}) {
  const args = ['exec', '-i']
  if (options.password !== false) {
    args.push('-e', `PGPASSWORD=${options.password ?? defaultPassword}`)
  }
  args.push(
    container,
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    options.user ?? defaultUser,
    '-d',
    options.database ?? database,
    '-q',
  )
  if (options.tuplesOnly) {
    args.push('-t', '-A')
  }

  return docker(args, { input: script })
}

function psql(script, options = {}) {
  const result = psqlResult(script, options)
  if (result.status !== 0) {
    throw new Error(commandOutput(result))
  }
  return result.stdout.trim()
}

function psqlJson(script, options = {}) {
  const stdout = psql(script, { ...options, tuplesOnly: true })
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .reverse()
    .find((value) => value.startsWith('{') || value.startsWith('['))

  if (!line) {
    throw new Error(`PostgreSQL fixture check did not print JSON. Output: ${stdout}`)
  }

  return JSON.parse(line)
}

async function record(name, action) {
  try {
    await action()
    checks.push({ name, ok: true })
  } catch (error) {
    checks.push({ name, ok: false, error })
  }
}

function expect(value, message) {
  if (!value) {
    throw new Error(message)
  }
}

function expectIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label} expected to include ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`)
  }
}

function expectAtLeast(value, expected, label) {
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue) || numericValue < expected) {
    throw new Error(`${label} expected at least ${expected}, got ${JSON.stringify(value)}`)
  }
}

function resetTransientPostgresFixtures() {
  psql(`
drop procedure if exists public.fixture_postgres_refresh_rollups(integer);
drop function if exists public.fixture_postgres_discount(numeric);
drop table if exists public.fixture_postgres_row_edit;
drop table if exists public.fixture_postgres_file_workflow;
do $$
begin
  if exists (select 1 from pg_roles where rolname = '${readonlyUser}') then
    revoke all privileges on database ${database} from ${readonlyUser};
    revoke all privileges on schema public from ${readonlyUser};
    revoke all privileges on all tables in schema public from ${readonlyUser};
    drop role ${readonlyUser};
  end if;
end $$;
`)
}

if (!containerRunning(container)) {
  throw new Error('PostgreSQL fixture is not running. Run `npm run fixtures:up && npm run fixtures:seed` first.')
}

resetTransientPostgresFixtures()

await record('PostgreSQL: seeded relational and volume fixtures', () => {
  const result = psqlJson(`
select jsonb_build_object(
  'accounts', (select count(*) from public.accounts),
  'products', (select count(*) from public.products),
  'orders', (select count(*) from public.orders),
  'orderItems', (select count(*) from public.order_items),
  'auditLog', (select count(*) from observability.audit_log),
  'perfEvents', (select count(*) from observability.perf_events),
  'activeAccountsView', to_regclass('public.active_accounts') is not null,
  'fulfillmentSummaryView', to_regclass('public.order_fulfillment_summary') is not null,
  'ordersAccountStatusIndex', exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'orders'
      and indexname = 'orders_account_status_idx'
  )
)::text;
`)

  expectAtLeast(result.accounts, 500, 'PostgreSQL accounts')
  expectAtLeast(result.products, 1000, 'PostgreSQL products')
  expectAtLeast(result.orders, 25000, 'PostgreSQL orders')
  expectAtLeast(result.orderItems, 75000, 'PostgreSQL order_items')
  expectAtLeast(result.auditLog, 100000, 'PostgreSQL observability.audit_log')
  expectAtLeast(result.perfEvents, 100000, 'PostgreSQL observability.perf_events')
  expect(result.activeAccountsView, 'PostgreSQL active_accounts view is missing')
  expect(result.fulfillmentSummaryView, 'PostgreSQL order_fulfillment_summary view is missing')
  expect(result.ordersAccountStatusIndex, 'PostgreSQL orders_account_status_idx is missing')
})

await record('PostgreSQL: catalog, security, and extension surfaces', () => {
  const result = psqlJson(`
select jsonb_build_object(
  'schemas', (
    select count(*)
    from information_schema.schemata
    where schema_name in ('public', 'observability')
  ),
  'roles', (select count(*) from pg_roles),
  'tableGrantRows', (
    select count(*)
    from information_schema.table_privileges
    where table_schema = 'public'
      and table_name = 'accounts'
  ),
  'defaultPrivilegeRows', (select count(*) from pg_default_acl),
  'installedExtensions', (
    select coalesce(jsonb_agg(extname order by extname), '[]'::jsonb)
    from pg_extension
  ),
  'availableExtensions', (select count(*) from pg_available_extensions),
  'extensionVersionHints', exists (
    select 1
    from pg_extension installed
    join pg_available_extensions available on available.name = installed.extname
    where available.default_version is not null
  )
)::text;
`)

  expectAtLeast(result.schemas, 2, 'PostgreSQL schemas')
  expectAtLeast(result.roles, 1, 'PostgreSQL roles')
  expectAtLeast(result.tableGrantRows, 1, 'PostgreSQL table privilege rows')
  expect(Array.isArray(result.installedExtensions), 'PostgreSQL installed extensions payload is not an array')
  expect(result.installedExtensions.includes('plpgsql'), 'PostgreSQL plpgsql extension is not visible')
  expectAtLeast(result.availableExtensions, 1, 'PostgreSQL available extensions')
  expect(result.extensionVersionHints, 'PostgreSQL extension version hints are not visible')
})

await record('PostgreSQL: diagnostics, locks, and session action primitives', () => {
  const result = psqlJson(`
select jsonb_build_object(
  'backendPid', pg_backend_pid(),
  'activityRows', (
    select count(*)
    from pg_stat_activity
    where pid = pg_backend_pid()
  ),
  'lockRows', (
    select count(*)
    from pg_locks
    where pid = pg_backend_pid()
  ),
  'databaseMetricsRows', (
    select count(*)
    from pg_stat_database
    where datname = current_database()
  ),
  'userTableStatsRows', (
    select count(*)
    from pg_stat_user_tables
    where schemaname in ('public', 'observability')
  ),
  'cancelFunction', exists (
    select 1
    from pg_proc
    where proname = 'pg_cancel_backend'
  ),
  'terminateFunction', exists (
    select 1
    from pg_proc
    where proname = 'pg_terminate_backend'
  ),
  'currentBackendGuard', pg_backend_pid() = pg_backend_pid(),
  'pgStatStatementsExtensionInstalled', exists (
    select 1
    from pg_extension
    where extname = 'pg_stat_statements'
  )
)::text;
`)

  expectAtLeast(result.backendPid, 1, 'PostgreSQL backend pid')
  expectAtLeast(result.activityRows, 1, 'PostgreSQL pg_stat_activity rows')
  expectAtLeast(result.lockRows, 1, 'PostgreSQL pg_locks rows')
  expectAtLeast(result.databaseMetricsRows, 1, 'PostgreSQL pg_stat_database rows')
  expectAtLeast(result.userTableStatsRows, 1, 'PostgreSQL pg_stat_user_tables rows')
  expect(result.cancelFunction, 'PostgreSQL pg_cancel_backend is not visible')
  expect(result.terminateFunction, 'PostgreSQL pg_terminate_backend is not visible')
  expect(result.currentBackendGuard, 'PostgreSQL current-backend guard primitive is not true')
  if (!result.pgStatStatementsExtensionInstalled) {
    notes.push('PostgreSQL pg_stat_statements is not installed in the default fixture; top-query evidence remains optional for this fixture.')
  }
})

await record('PostgreSQL: rendered profile and routine primitives', () => {
  psql(`
create or replace function public.fixture_postgres_discount(input_amount numeric)
returns numeric
language sql
stable
as $$
  select round(input_amount * 0.9, 2)
$$;

create or replace procedure public.fixture_postgres_refresh_rollups(input_account_id integer)
language plpgsql
as $$
begin
  perform input_account_id;
end
$$;
`)

  const routineResult = psqlJson(`
select jsonb_build_object(
  'routineCount', (
    select count(*)
    from information_schema.routines
    where specific_schema = 'public'
      and routine_name like 'fixture_postgres_%'
  ),
  'functionResult', public.fixture_postgres_discount(10.00)
)::text;
`)
  const planOutput = psql(`
explain (analyze, buffers, verbose, format json)
select *
from public.accounts
where id = 1;
`, { tuplesOnly: true })
  psql('call public.fixture_postgres_refresh_rollups(1);')

  expectAtLeast(routineResult.routineCount, 2, 'PostgreSQL fixture routines')
  expect(String(routineResult.functionResult) === '9.00' || Number(routineResult.functionResult) === 9, 'PostgreSQL function result was unexpected')
  expectIncludes(planOutput, '"Plan"', 'PostgreSQL JSON EXPLAIN ANALYZE output')
  expectIncludes(planOutput, '"Execution Time"', 'PostgreSQL JSON EXPLAIN ANALYZE output')
})

await record('PostgreSQL: row-edit before/after evidence primitives', () => {
  const result = psqlJson(`
drop table if exists public.fixture_postgres_row_edit;
create table public.fixture_postgres_row_edit (
  id integer primary key,
  name text not null,
  status text not null,
  updated_at timestamptz not null default now()
);
insert into public.fixture_postgres_row_edit (id, name, status)
values
  (1, 'before-row', 'active'),
  (2, 'delete-row', 'active');

with before_row as (
  select to_jsonb(target) as row
  from public.fixture_postgres_row_edit target
  where id = 1
),
updated_row as (
  update public.fixture_postgres_row_edit
  set name = 'after-row', updated_at = now()
  where id = 1
  returning to_jsonb(fixture_postgres_row_edit) as row
),
deleted_row as (
  delete from public.fixture_postgres_row_edit
  where id = 2
  returning to_jsonb(fixture_postgres_row_edit) as row
),
inserted_row as (
  insert into public.fixture_postgres_row_edit (id, name, status)
  values (3, 'insert-row', 'active')
  returning to_jsonb(fixture_postgres_row_edit) as row
)
select jsonb_build_object(
  'beforeName', (select row->>'name' from before_row),
  'afterName', (select row->>'name' from updated_row),
  'deletedName', (select row->>'name' from deleted_row),
  'insertedName', (select row->>'name' from inserted_row),
  'remainingRows', (select count(*) from public.fixture_postgres_row_edit)
)::text;
`)

  expect(result.beforeName === 'before-row', 'PostgreSQL before-row evidence missing')
  expect(result.afterName === 'after-row', 'PostgreSQL after-row evidence missing')
  expect(result.deletedName === 'delete-row', 'PostgreSQL delete RETURNING evidence missing')
  expect(result.insertedName === 'insert-row', 'PostgreSQL insert RETURNING evidence missing')
  expect(result.remainingRows === 2, 'PostgreSQL row-edit primitive left an unexpected row count')
})

await record('PostgreSQL: table import/export and bounded backup primitives', () => {
  psql(`
drop table if exists public.fixture_postgres_file_workflow;
create table public.fixture_postgres_file_workflow (
  id integer primary key,
  sku text not null,
  quantity integer not null
);
copy public.fixture_postgres_file_workflow (id, sku, quantity)
from stdin with (format csv, header true);
id,sku,quantity
1,fixture-import-1,3
2,fixture-import-2,7
\\.
`)

  const exportOutput = psql(`
copy (
  select id, sku, quantity
  from public.fixture_postgres_file_workflow
  order by id
) to stdout with (format csv, header true);
`, { tuplesOnly: true })

  const result = psqlJson(`
with backup_tables as (
  select table_schema, table_name
  from information_schema.tables
  where table_schema in ('public', 'observability')
    and table_type = 'BASE TABLE'
  order by table_schema, table_name
  limit 5
),
bounded_rows as (
  select coalesce(jsonb_agg(to_jsonb(sample) order by sample.id), '[]'::jsonb) as rows
  from (
    select id, sku, quantity
    from public.fixture_postgres_file_workflow
    order by id
    limit 2
  ) sample
)
select jsonb_build_object(
  'importedRows', (select count(*) from public.fixture_postgres_file_workflow),
  'candidateTables', (select count(*) from backup_tables),
  'backupEnvelope', jsonb_build_object(
    'engine', 'postgresql',
    'workflow', 'postgresql.database.backup',
    'format', 'datapad-postgresql-logical-backup-v1',
    'rowLimit', 2,
    'tables', (
      select coalesce(jsonb_agg(jsonb_build_object('schema', table_schema, 'table', table_name)), '[]'::jsonb)
      from backup_tables
    ),
    'rows', (select rows from bounded_rows),
    'residualRisk', 'bounded logical package; full pg_dump/pg_restore parity remains outside the scoped claim'
  )
)::text;
`)

  expectIncludes(exportOutput, 'fixture-import-1', 'PostgreSQL COPY export output')
  expect(result.importedRows === 2, 'PostgreSQL COPY import did not load two rows')
  expectAtLeast(result.candidateTables, 1, 'PostgreSQL bounded backup table candidates')
  expect(result.backupEnvelope.engine === 'postgresql', 'PostgreSQL backup envelope engine is incorrect')
  expect(result.backupEnvelope.workflow === 'postgresql.database.backup', 'PostgreSQL backup envelope workflow is incorrect')
  expect(result.backupEnvelope.rowLimit === 2, 'PostgreSQL backup envelope row limit is incorrect')
  expectIncludes(result.backupEnvelope.residualRisk, 'full pg_dump/pg_restore parity remains outside the scoped claim', 'PostgreSQL backup boundary')
})

await record('PostgreSQL: permission-denied guard evidence', () => {
  psql(`
create role ${readonlyUser} login password '${readonlyPassword}';
grant connect on database ${database} to ${readonlyUser};
grant usage on schema public to ${readonlyUser};
grant select on public.accounts to ${readonlyUser};
`)

  const readResult = psqlJson(`
select jsonb_build_object(
  'canRead', exists (
    select 1
    from public.accounts
    where id = 1
  )
)::text;
`, {
    user: readonlyUser,
    password: readonlyPassword,
  })

  const denied = psqlResult(
    "insert into public.accounts (id, name, status, tier) values (990001, 'readonly-denied', 'active', 'fixture');",
    {
      user: readonlyUser,
      password: readonlyPassword,
    },
  )

  expect(readResult.canRead, 'PostgreSQL readonly fixture user could not read allowed table')
  expect(denied.status !== 0, 'PostgreSQL readonly fixture user was not denied write access')
  expectIncludes(commandOutput(denied).toLowerCase(), 'permission denied', 'PostgreSQL readonly write denial')
})

resetTransientPostgresFixtures()

const failures = checks.filter((check) => !check.ok)

for (const check of checks) {
  if (check.ok) {
    console.log(`ok - ${check.name}`)
  } else {
    console.error(`not ok - ${check.name}`)
    console.error(check.error.message)
  }
}

for (const note of notes) {
  console.log(`note - ${note}`)
}

if (failures.length > 0) {
  process.exitCode = 1
}
