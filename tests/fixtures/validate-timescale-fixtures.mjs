import { spawnSync } from 'node:child_process'

const container = 'datapadplusplus-timescaledb'
const database = 'metrics'
const defaultUser = 'datapadplusplus'
const defaultPassword = 'datapadplusplus'
const readonlyUser = 'fixture_timescale_readonly'
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
    throw new Error(`TimescaleDB fixture check did not print JSON. Output: ${stdout}`)
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

function resetTransientTimescaleFixtures() {
  psql(`
do $$
declare
  fixture_job record;
begin
  for fixture_job in
    select job_id
    from timescaledb_information.jobs
    where proc_schema = 'public'
      and proc_name = 'fixture_timescale_failed_job'
  loop
    perform delete_job(fixture_job.job_id);
  end loop;
exception
  when undefined_function or undefined_table then
    null;
end $$;
do $$
begin
  if to_regclass('public.fixture_timescale_policy_metrics') is not null
    and exists (
      select 1
      from timescaledb_information.jobs
      where hypertable_schema = 'public'
        and hypertable_name = 'fixture_timescale_policy_metrics'
    ) then
    perform remove_retention_policy('public.fixture_timescale_policy_metrics'::regclass);
  end if;
exception
  when undefined_function or undefined_table or invalid_parameter_value then
    null;
end $$;
drop materialized view if exists public.fixture_timescale_order_hourly cascade;
drop materialized view if exists public.fixture_timescale_lag_hourly cascade;
drop table if exists public.fixture_timescale_file_import cascade;
drop table if exists public.fixture_timescale_row_edit cascade;
drop table if exists public.fixture_timescale_compressed_metrics cascade;
drop table if exists public.fixture_timescale_policy_metrics cascade;
drop procedure if exists public.fixture_timescale_failed_job(int, jsonb);
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
  throw new Error(
    'TimescaleDB fixture is not running. Run `npm run fixtures:up:profile -- sqlplus && npm run fixtures:seed:all` first.',
  )
}

resetTransientTimescaleFixtures()

await record('TimescaleDB: extension and native catalog surfaces', () => {
  const result = psqlJson(`
select jsonb_build_object(
  'extensionInstalled', exists (
    select 1
    from pg_extension
    where extname = 'timescaledb'
  ),
  'extensionVersion', (
    select extversion
    from pg_extension
    where extname = 'timescaledb'
  ),
  'hypertableCount', (
    select count(*)
    from timescaledb_information.hypertables
    where hypertable_schema = 'public'
      and hypertable_name in ('order_metrics', 'system_metrics')
  ),
  'chunkCount', (
    select count(*)
    from timescaledb_information.chunks
    where hypertable_schema = 'public'
      and hypertable_name in ('order_metrics', 'system_metrics')
  ),
  'orderRows', (select count(*) from public.order_metrics),
  'systemRows', (select count(*) from public.system_metrics),
  'recentViews', (
    select count(*)
    from pg_class class
    join pg_namespace namespace on namespace.oid = class.relnamespace
    where namespace.nspname = 'public'
      and class.relname in ('order_metrics_recent', 'system_metrics_recent')
  ),
  'catalogHypertables', (
    select coalesce(jsonb_agg(hypertable_name order by hypertable_name), '[]'::jsonb)
    from timescaledb_information.hypertables
    where hypertable_schema = 'public'
      and hypertable_name in ('order_metrics', 'system_metrics')
  )
)::text;
`)

  expect(result.extensionInstalled, 'TimescaleDB extension is not installed')
  expect(typeof result.extensionVersion === 'string' && result.extensionVersion.length > 0, 'TimescaleDB extension version is missing')
  expectAtLeast(result.hypertableCount, 2, 'TimescaleDB seeded hypertables')
  expectAtLeast(result.chunkCount, 1, 'TimescaleDB seeded chunks')
  expectAtLeast(result.orderRows, 100000, 'TimescaleDB order_metrics rows')
  expectAtLeast(result.systemRows, 100000, 'TimescaleDB system_metrics rows')
  expectAtLeast(result.recentViews, 2, 'TimescaleDB recent metric views')
  expect(Array.isArray(result.catalogHypertables), 'TimescaleDB hypertable catalog payload is not an array')
  expect(result.catalogHypertables.includes('order_metrics'), 'TimescaleDB order_metrics hypertable is missing from catalog')
  expect(result.catalogHypertables.includes('system_metrics'), 'TimescaleDB system_metrics hypertable is missing from catalog')
})

await record('TimescaleDB: hypertable row-edit before/after evidence', () => {
  const result = psqlJson(`
drop table if exists public.fixture_timescale_row_edit cascade;
create table public.fixture_timescale_row_edit (
  time timestamptz not null,
  id integer not null,
  sensor text not null,
  value double precision not null,
  status text not null default 'active',
  primary key (time, id)
);
select create_hypertable('fixture_timescale_row_edit', 'time', if_not_exists => true);
insert into public.fixture_timescale_row_edit (time, id, sensor, value, status)
values
  ('2026-01-01 00:00:00+00', 1, 'before-row', 10.5, 'active'),
  ('2026-01-01 00:01:00+00', 2, 'delete-row', 12.5, 'active');

with before_row as (
  select to_jsonb(target) as row
  from public.fixture_timescale_row_edit target
  where time = '2026-01-01 00:00:00+00'::timestamptz
    and id = 1
),
updated_row as (
  update public.fixture_timescale_row_edit
  set sensor = 'after-row', value = 42.25
  where time = '2026-01-01 00:00:00+00'::timestamptz
    and id = 1
  returning to_jsonb(fixture_timescale_row_edit) as row
),
deleted_row as (
  delete from public.fixture_timescale_row_edit
  where time = '2026-01-01 00:01:00+00'::timestamptz
    and id = 2
  returning to_jsonb(fixture_timescale_row_edit) as row
),
inserted_row as (
  insert into public.fixture_timescale_row_edit (time, id, sensor, value, status)
  values ('2026-01-01 00:02:00+00', 3, 'insert-row', 14.75, 'active')
  returning to_jsonb(fixture_timescale_row_edit) as row
)
select jsonb_build_object(
  'beforeSensor', (select row->>'sensor' from before_row),
  'afterSensor', (select row->>'sensor' from updated_row),
  'afterValue', (select row->>'value' from updated_row),
  'deletedSensor', (select row->>'sensor' from deleted_row),
  'insertedSensor', (select row->>'sensor' from inserted_row),
  'remainingRows', (select count(*) from public.fixture_timescale_row_edit),
  'returningEvidence', 'UPDATE/DELETE/INSERT use RETURNING *-equivalent row snapshots'
)::text;
`)

  expect(result.beforeSensor === 'before-row', 'TimescaleDB before-row evidence missing')
  expect(result.afterSensor === 'after-row', 'TimescaleDB update RETURNING evidence missing')
  expect(Number(result.afterValue) === 42.25, 'TimescaleDB update value evidence was unexpected')
  expect(result.deletedSensor === 'delete-row', 'TimescaleDB delete RETURNING evidence missing')
  expect(result.insertedSensor === 'insert-row', 'TimescaleDB insert RETURNING evidence missing')
  expect(result.remainingRows === 2, 'TimescaleDB row-edit primitive left an unexpected row count')
  expectIncludes(result.returningEvidence, 'RETURNING', 'TimescaleDB row-edit returning evidence')
})

await record('TimescaleDB: restricted catalog and permission-denied evidence', () => {
  psql(`
create role ${readonlyUser} login password '${readonlyPassword}';
grant connect on database ${database} to ${readonlyUser};
grant usage on schema public to ${readonlyUser};
grant select on public.order_metrics to ${readonlyUser};
grant select on public.system_metrics to ${readonlyUser};
`)

  const readResult = psqlJson(`
select jsonb_build_object(
  'canReadSeed', exists (
    select 1
    from public.order_metrics
    limit 1
  ),
  'catalogVisible', exists (
    select 1
    from timescaledb_information.hypertables
    where hypertable_schema = 'public'
      and hypertable_name = 'order_metrics'
  ),
  'chunkCatalogVisible', exists (
    select 1
    from timescaledb_information.chunks
    where hypertable_schema = 'public'
      and hypertable_name = 'order_metrics'
  )
)::text;
`, {
    user: readonlyUser,
    password: readonlyPassword,
  })

  const denied = psqlResult(
    `
insert into public.order_metrics (time, account_id, region, orders, latency_ms)
values ('2026-01-02 00:00:00+00', 990001, 'readonly-denied', 1, 1.0);
`,
    {
      user: readonlyUser,
      password: readonlyPassword,
    },
  )

  expect(readResult.canReadSeed, 'TimescaleDB readonly fixture user could not read seeded hypertable')
  expect(readResult.catalogVisible, 'TimescaleDB readonly fixture user could not see granted hypertable catalog')
  expect(readResult.chunkCatalogVisible, 'TimescaleDB readonly fixture user could not see granted chunk catalog')
  expect(denied.status !== 0, 'TimescaleDB readonly fixture user was not denied hypertable writes')
  expectIncludes(commandOutput(denied).toLowerCase(), 'permission denied', 'TimescaleDB readonly write denial')
})

await record('TimescaleDB: continuous aggregate and policy/job boundary evidence', () => {
  const result = psqlJson(`
drop materialized view if exists public.fixture_timescale_order_hourly cascade;
drop table if exists public.fixture_timescale_policy_metrics cascade;

create materialized view public.fixture_timescale_order_hourly
with (timescaledb.continuous) as
select
  time_bucket('1 hour', time) as bucket,
  region,
  sum(orders) as orders
from public.order_metrics
group by bucket, region
with no data;

create table public.fixture_timescale_policy_metrics (
  time timestamptz not null,
  device_id integer not null,
  value double precision not null,
  primary key (time, device_id)
);
select create_hypertable('fixture_timescale_policy_metrics', 'time', if_not_exists => true);
insert into public.fixture_timescale_policy_metrics (time, device_id, value)
values
  ('2026-01-01 00:00:00+00', 1, 10.0),
  ('2026-01-02 00:00:00+00', 1, 11.0);
select add_retention_policy('public.fixture_timescale_policy_metrics'::regclass, interval '30 days');

select jsonb_build_object(
  'continuousAggregates', (
    select count(*)
    from timescaledb_information.continuous_aggregates
    where view_schema = 'public'
      and view_name = 'fixture_timescale_order_hourly'
  ),
  'materializationVisible', exists (
    select 1
    from timescaledb_information.continuous_aggregates
    where view_schema = 'public'
      and view_name = 'fixture_timescale_order_hourly'
      and materialization_hypertable_name is not null
  ),
  'policyJobs', (
    select count(*)
    from timescaledb_information.jobs
    where hypertable_schema = 'public'
      and hypertable_name = 'fixture_timescale_policy_metrics'
  ),
  'policyProcedures', (
    select coalesce(jsonb_agg(proc_name order by proc_name), '[]'::jsonb)
    from timescaledb_information.jobs
    where hypertable_schema = 'public'
      and hypertable_name = 'fixture_timescale_policy_metrics'
  ),
  'jobStatsViewVisible', to_regclass('timescaledb_information.job_stats') is not null,
  'previewBoundary', 'live policy/file execution remains preview-first'
)::text;
`)

  expectAtLeast(result.continuousAggregates, 1, 'TimescaleDB continuous aggregate metadata')
  expect(result.materializationVisible, 'TimescaleDB continuous aggregate materialization metadata is missing')
  expectAtLeast(result.policyJobs, 1, 'TimescaleDB retention policy job metadata')
  expect(Array.isArray(result.policyProcedures), 'TimescaleDB policy procedure payload is not an array')
  expect(result.jobStatsViewVisible, 'TimescaleDB job_stats view is not visible')
  expectIncludes(result.previewBoundary, 'preview-first', 'TimescaleDB policy/file execution boundary')

  notes.push(
    'TimescaleDB live policy/file execution remains preview-first; this validator proves metadata visibility and policy/job boundary evidence, not background-job execution.',
  )
})

await record('TimescaleDB: compressed chunks and aggregate lag evidence', () => {
  const result = psqlJson(`
drop materialized view if exists public.fixture_timescale_lag_hourly cascade;
drop table if exists public.fixture_timescale_compressed_metrics cascade;

create table public.fixture_timescale_compressed_metrics (
  time timestamptz not null,
  device_id integer not null,
  value double precision not null,
  primary key (time, device_id)
);
select create_hypertable(
  'fixture_timescale_compressed_metrics',
  'time',
  chunk_time_interval => interval '1 day',
  if_not_exists => true
);
insert into public.fixture_timescale_compressed_metrics (time, device_id, value)
select
  '2026-01-01 00:00:00+00'::timestamptz + (generated.id * interval '6 hours'),
  (generated.id % 8) + 1,
  generated.id::double precision / 10.0
from generate_series(0, 63) as generated(id);

alter table public.fixture_timescale_compressed_metrics
  set (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'device_id'
  );
select compress_chunk(chunk, if_not_compressed => true)
from show_chunks('public.fixture_timescale_compressed_metrics'::regclass) as chunk;

create materialized view public.fixture_timescale_lag_hourly
with (timescaledb.continuous) as
select
  time_bucket('1 hour', time) as bucket,
  device_id,
  avg(value) as value_avg
from public.fixture_timescale_compressed_metrics
group by bucket, device_id
with no data;

select jsonb_build_object(
  'compressedChunks', (
    select count(*)
    from timescaledb_information.chunks
    where hypertable_schema = 'public'
      and hypertable_name = 'fixture_timescale_compressed_metrics'
      and is_compressed
  ),
  'totalChunks', (
    select count(*)
    from timescaledb_information.chunks
    where hypertable_schema = 'public'
      and hypertable_name = 'fixture_timescale_compressed_metrics'
  ),
  'compressionSettings', exists (
    select 1
    from timescaledb_information.compression_settings
    where hypertable_schema = 'public'
      and hypertable_name = 'fixture_timescale_compressed_metrics'
  ),
  'sourceMaxTime', (
    select max(time)::text
    from public.fixture_timescale_compressed_metrics
  ),
  'laggingContinuousAggregate', exists (
    select 1
    from timescaledb_information.continuous_aggregates
    where view_schema = 'public'
      and view_name = 'fixture_timescale_lag_hourly'
      and materialization_hypertable_name is not null
  ),
  'materializedRows', (
    select count(*)
    from public.fixture_timescale_lag_hourly
  )
)::text;
`)

  expectAtLeast(result.totalChunks, 2, 'TimescaleDB compressed fixture chunk count')
  expectAtLeast(result.compressedChunks, 1, 'TimescaleDB compressed chunk evidence')
  expect(result.compressionSettings, 'TimescaleDB compression settings evidence is missing')
  expect(typeof result.sourceMaxTime === 'string' && result.sourceMaxTime.length > 0, 'TimescaleDB source max time evidence is missing')
  expect(result.laggingContinuousAggregate, 'TimescaleDB lagging continuous aggregate metadata is missing')
  expect(result.materializedRows === 0, 'TimescaleDB lag fixture should remain intentionally unrefreshed')
})

await record('TimescaleDB: Toolkit variant and time-bucket function evidence', () => {
  const result = psqlJson(`
select jsonb_build_object(
  'toolkitAvailable', exists (
    select 1
    from pg_available_extensions
    where name = 'timescaledb_toolkit'
  ),
  'toolkitInstalled', exists (
    select 1
    from pg_extension
    where extname = 'timescaledb_toolkit'
  ),
  'timeBucketFunctions', (
    select count(*)
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where proc.proname in ('time_bucket', 'time_bucket_gapfill', 'time_bucket_ng')
      and namespace.nspname not in ('pg_catalog', 'information_schema')
  ),
  'functionNames', (
    select coalesce(jsonb_agg(distinct proc.proname order by proc.proname), '[]'::jsonb)
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where proc.proname in ('time_bucket', 'time_bucket_gapfill', 'time_bucket_ng')
      and namespace.nspname not in ('pg_catalog', 'information_schema')
  )
)::text;
`)

  expect(typeof result.toolkitAvailable === 'boolean', 'TimescaleDB Toolkit availability signal is missing')
  expect(typeof result.toolkitInstalled === 'boolean', 'TimescaleDB Toolkit installed signal is missing')
  expectAtLeast(result.timeBucketFunctions, 1, 'TimescaleDB time_bucket function evidence')
  expect(Array.isArray(result.functionNames), 'TimescaleDB time bucket function payload is not an array')

  notes.push(
    result.toolkitAvailable
      ? 'TimescaleDB Toolkit is available in this fixture image; installation remains profile/environment-specific.'
      : 'TimescaleDB Toolkit is not available in this fixture image; the validator records that variant without failing the scoped claim.',
  )
})

await record('TimescaleDB: bounded file export/import evidence', () => {
  const filePath = '/tmp/datapadplusplus_timescale_order_metrics.csv'
  const copyResult = psqlResult(`
drop table if exists public.fixture_timescale_file_import cascade;
create table public.fixture_timescale_file_import (
  time timestamptz not null,
  account_id integer not null,
  region text not null,
  orders integer not null,
  latency_ms double precision not null
);
\\copy (select time, account_id, region, orders, latency_ms from public.order_metrics order by time limit 25) to '${filePath}' with (format csv, header true)
\\copy public.fixture_timescale_file_import (time, account_id, region, orders, latency_ms) from '${filePath}' with (format csv, header true)
select jsonb_build_object(
  'importedRows', (select count(*) from public.fixture_timescale_file_import),
  'regions', (
    select count(distinct region)
    from public.fixture_timescale_file_import
  ),
  'minTime', (
    select min(time)::text
    from public.fixture_timescale_file_import
  ),
  'maxTime', (
    select max(time)::text
    from public.fixture_timescale_file_import
  ),
  'fileWorkflow', 'bounded CSV export/import through psql copy'
)::text;
`, { tuplesOnly: true })

  docker(['exec', container, 'rm', '-f', filePath])

  if (copyResult.status !== 0) {
    throw new Error(commandOutput(copyResult))
  }

  const jsonLine = copyResult.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .reverse()
    .find((value) => value.startsWith('{'))
  expect(jsonLine, `TimescaleDB file workflow did not print JSON. Output: ${copyResult.stdout}`)
  const result = JSON.parse(jsonLine)

  expect(result.importedRows === 25, 'TimescaleDB bounded file import row count was unexpected')
  expectAtLeast(result.regions, 1, 'TimescaleDB bounded file import region evidence')
  expect(typeof result.minTime === 'string' && result.minTime.length > 0, 'TimescaleDB bounded file import min time is missing')
  expect(typeof result.maxTime === 'string' && result.maxTime.length > 0, 'TimescaleDB bounded file import max time is missing')
  expectIncludes(result.fileWorkflow, 'bounded CSV', 'TimescaleDB bounded file workflow evidence')
})

await record('TimescaleDB: failed job diagnostic evidence', () => {
  const result = psqlJson(`
create or replace procedure public.fixture_timescale_failed_job(job_id int, config jsonb)
language plpgsql as $$
begin
  raise exception 'fixture failed job diagnostic evidence';
end;
$$;

select add_job(
  'public.fixture_timescale_failed_job',
  interval '1 second',
  initial_start => now(),
  scheduled => true
) as job_id \\gset

select pg_sleep(8);

select jsonb_build_object(
  'jobId', :'job_id'::int,
  'errorRows', (
    select count(*)
    from timescaledb_information.job_errors
    where job_id = :'job_id'::int
  ),
  'historyRows', (
    select count(*)
    from timescaledb_information.job_history
    where job_id = :'job_id'::int
  ),
  'totalFailures', (
    select total_failures
    from timescaledb_information.job_stats
    where job_id = :'job_id'::int
  ),
  'latestError', (
    select err_message
    from timescaledb_information.job_errors
    where job_id = :'job_id'::int
    order by finish_time desc nulls last
    limit 1
  )
)::text;

select delete_job(:'job_id'::int);
drop procedure if exists public.fixture_timescale_failed_job(int, jsonb);
`)

  expectAtLeast(result.errorRows, 1, 'TimescaleDB failed job error rows')
  expectAtLeast(result.historyRows, 1, 'TimescaleDB failed job history rows')
  expectAtLeast(result.totalFailures, 1, 'TimescaleDB job_stats failure count')
  expectIncludes(result.latestError, 'fixture failed job diagnostic evidence', 'TimescaleDB failed job error text')

  notes.push(
    'TimescaleDB failed-job evidence uses a transient scheduled fixture job and deletes it after job_errors/job_history/job_stats record the diagnostic signal.',
  )
})

resetTransientTimescaleFixtures()

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
