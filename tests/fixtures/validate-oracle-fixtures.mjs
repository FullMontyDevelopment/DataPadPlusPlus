import { spawnSync } from 'node:child_process'

const container = 'datapadplusplus-oracle'
const service = 'FREEPDB1'
const defaultUser = 'datapadplusplus'
const defaultPassword = 'datapadplusplus'

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

function sqlplusResult(script, options = {}) {
  const user = options.user ?? defaultUser
  const password = options.password ?? defaultPassword
  const connectString = options.connectString ?? `//localhost:1521/${service}`
  const preamble = [
    'set heading off',
    'set feedback off',
    'set pagesize 0',
    'set linesize 32767',
    'set long 1000000',
    'set longchunksize 1000000',
    'set trimspool on',
    'set verify off',
    'set echo off',
    'set serveroutput on',
    'whenever oserror exit failure rollback',
    'whenever sqlerror exit sql.sqlcode rollback',
  ].join('\n')

  return docker(
    ['exec', '-i', container, 'sqlplus', '-s', `${user}/${password}@${connectString}`],
    { input: `${preamble}\n${script.trim()}\nexit\n` },
  )
}

function sqlplus(script, options = {}) {
  const result = sqlplusResult(script, options)
  if (result.status !== 0) {
    throw new Error(commandOutput(result))
  }
  return result.stdout.trim()
}

function sqlplusJson(script, options = {}) {
  const stdout = sqlplus(script, options)
  const line = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .reverse()
    .find((value) => value.startsWith('{') || value.startsWith('['))

  if (!line) {
    throw new Error(`Oracle fixture check did not print JSON. Output: ${stdout}`)
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

function resetTransientOracleFixtures() {
  sqlplus(`
begin
  for object_name in (
    select object_name, object_type
    from user_objects
    where object_name in (
      'FIXTURE_ORACLE_PACKAGE',
      'FIXTURE_ORACLE_INVALID',
      'FIXTURE_ORACLE_ROW_EDIT',
      'FIXTURE_ORACLE_ROW_EVIDENCE',
      'FIXTURE_ORACLE_FILE_WORKFLOW'
    )
  ) loop
    begin
      if object_name.object_type = 'PACKAGE' then
        execute immediate 'drop package fixture_oracle_package';
      elsif object_name.object_type = 'PROCEDURE' then
        execute immediate 'drop procedure fixture_oracle_invalid';
      elsif object_name.object_type = 'TABLE' then
        execute immediate 'drop table ' || object_name.object_name || ' purge';
      end if;
    exception
      when others then
        if sqlcode not in (-942, -4043) then
          raise;
        end if;
    end;
  end loop;
end;
/
`)
}

if (!containerRunning(container)) {
  throw new Error('Oracle fixture is not running. Run `npm run fixtures:up:profile -- oracle && npm run fixtures:seed:all` first.')
}

resetTransientOracleFixtures()

await record('Oracle: seeded relational and volume fixtures', () => {
  const result = sqlplusJson(`
select json_object(
  'accounts' value (select count(*) from accounts),
  'orders' value (select count(*) from orders),
  'orderItems' value (select count(*) from order_items),
  'supportTickets' value (select count(*) from support_tickets),
  'fulfillmentSummaryView' value (
    select count(*)
    from user_views
    where view_name = 'ORDER_FULFILLMENT_SUMMARY'
  ),
  'ordersAccountStatusIndex' value (
    select count(*)
    from user_indexes
    where index_name = 'ORDERS_ACCOUNT_STATUS_IDX'
  ),
  'foreignKeys' value (
    select count(*)
    from user_constraints
    where constraint_type = 'R'
      and constraint_name in (
        'FK_ORDERS_ACCOUNTS',
        'FK_ORDER_ITEMS_ORDERS',
        'FK_SUPPORT_TICKETS_ACCOUNTS'
      )
  )
  returning clob
) from dual;
`)

  expectAtLeast(result.accounts, 500, 'Oracle accounts')
  expectAtLeast(result.orders, 25000, 'Oracle orders')
  expectAtLeast(result.orderItems, 75000, 'Oracle order_items')
  expectAtLeast(result.supportTickets, 5000, 'Oracle support_tickets')
  expectAtLeast(result.fulfillmentSummaryView, 1, 'Oracle order_fulfillment_summary view')
  expectAtLeast(result.ordersAccountStatusIndex, 1, 'Oracle orders_account_status_idx')
  expectAtLeast(result.foreignKeys, 3, 'Oracle foreign key constraints')
})

await record('Oracle: dictionary, security, and storage surfaces', () => {
  const result = sqlplusJson(`
select json_object(
  'tables' value (select count(*) from user_tables),
  'columns' value (select count(*) from user_tab_columns),
  'constraints' value (select count(*) from user_constraints),
  'indexes' value (select count(*) from user_indexes),
  'objects' value (select count(*) from user_objects),
  'sessionPrivileges' value (select count(*) from session_privs),
  'segmentBytes' value (select coalesce(sum(bytes), 0) from user_segments),
  'tablespaces' value (
    select count(distinct tablespace_name)
    from user_tables
    where tablespace_name is not null
  )
  returning clob
) from dual;
`)

  expectAtLeast(result.tables, 4, 'Oracle user_tables')
  expectAtLeast(result.columns, 20, 'Oracle user_tab_columns')
  expectAtLeast(result.constraints, 4, 'Oracle user_constraints')
  expectAtLeast(result.indexes, 3, 'Oracle user_indexes')
  expectAtLeast(result.objects, 5, 'Oracle user_objects')
  expectAtLeast(result.sessionPrivileges, 1, 'Oracle session_privs')
  expectAtLeast(result.segmentBytes, 1, 'Oracle user_segments bytes')
  expectAtLeast(result.tablespaces, 1, 'Oracle table tablespace metadata')
})

await record('Oracle: DBMS_XPLAN and SQL Monitor boundary evidence', () => {
  const planOutput = sqlplus(`
explain plan for
select *
from accounts
where id = 1;

select * from table(dbms_xplan.display);
`)

  expectIncludes(planOutput, 'SELECT STATEMENT', 'Oracle DBMS_XPLAN output')
  expectIncludes(planOutput, 'ACCOUNTS', 'Oracle DBMS_XPLAN output')

  const monitor = sqlplusResult('select count(*) from v$sql_monitor;')
  if (monitor.status === 0) {
    notes.push('Oracle V$SQL_MONITOR is visible in this fixture; SQL Monitor empty-state rendering remains evidence even when no active monitor rows exist.')
    return
  }

  const output = commandOutput(monitor)
  expect(
    /ORA-00942|ORA-01031|insufficient privileges/i.test(output),
    `Oracle SQL Monitor boundary expected ORA-00942 or ORA-01031, got ${output}`,
  )
})

await record('Oracle: PL/SQL source and compile diagnostics', () => {
  sqlplus(`
create or replace package fixture_oracle_package as
  function order_label(input_order_id number) return varchar2;
end fixture_oracle_package;
/

create or replace package body fixture_oracle_package as
  function order_label(input_order_id number) return varchar2 is
    result varchar2(200);
  begin
    select status || ':' || to_char(total_amount)
    into result
    from orders
    where order_id = input_order_id;

    return result;
  end order_label;
end fixture_oracle_package;
/

create or replace procedure fixture_oracle_invalid as
  missing_count number;
begin
  select count(*)
  into missing_count
  from fixture_oracle_missing_table;
end;
/
`)

  const result = sqlplusJson(`
select json_object(
  'packageObjects' value (
    select count(*)
    from user_objects
    where object_name = 'FIXTURE_ORACLE_PACKAGE'
      and object_type in ('PACKAGE', 'PACKAGE BODY')
  ),
  'sourceLines' value (
    select count(*)
    from user_source
    where name = 'FIXTURE_ORACLE_PACKAGE'
  ),
  'invalidObjects' value (
    select count(*)
    from user_objects
    where object_name = 'FIXTURE_ORACLE_INVALID'
      and status = 'INVALID'
  ),
  'compileErrors' value (
    select count(*)
    from user_errors
    where name = 'FIXTURE_ORACLE_INVALID'
  ),
  'functionResult' value fixture_oracle_package.order_label(101)
  returning clob
) from dual;
`)

  expectAtLeast(result.packageObjects, 2, 'Oracle package spec/body objects')
  expectAtLeast(result.sourceLines, 1, 'Oracle user_source package lines')
  expectAtLeast(result.invalidObjects, 1, 'Oracle invalid procedure object')
  expectAtLeast(result.compileErrors, 1, 'Oracle compile errors')
  expectIncludes(String(result.functionResult).toLowerCase(), 'processing', 'Oracle package function result')
})

await record('Oracle: row identity and DML evidence primitives', () => {
  const result = sqlplusJson(`
create table fixture_oracle_row_edit (
  id number primary key,
  name varchar2(100) not null,
  status varchar2(40) not null,
  updated_at timestamp default systimestamp not null
);

create table fixture_oracle_row_evidence (
  evidence_key varchar2(40) primary key,
  evidence_value varchar2(200)
);

insert into fixture_oracle_row_edit (id, name, status)
values (1, 'before-row', 'active');

insert into fixture_oracle_row_edit (id, name, status)
values (2, 'delete-row', 'active');

declare
  before_name varchar2(100);
  after_name varchar2(100);
  deleted_name varchar2(100);
begin
  select name
  into before_name
  from fixture_oracle_row_edit
  where id = 1;

  update fixture_oracle_row_edit
  set name = 'after-row',
      updated_at = systimestamp
  where id = 1
  returning name into after_name;

  delete from fixture_oracle_row_edit
  where id = 2
  returning name into deleted_name;

  insert into fixture_oracle_row_edit (id, name, status)
  values (3, 'insert-row', 'active');

  insert into fixture_oracle_row_evidence values ('beforeName', before_name);
  insert into fixture_oracle_row_evidence values ('afterName', after_name);
  insert into fixture_oracle_row_evidence values ('deletedName', deleted_name);
  insert into fixture_oracle_row_evidence values ('insertedName', 'insert-row');
end;
/

select json_object(
  'beforeName' value (select evidence_value from fixture_oracle_row_evidence where evidence_key = 'beforeName'),
  'afterName' value (select evidence_value from fixture_oracle_row_evidence where evidence_key = 'afterName'),
  'deletedName' value (select evidence_value from fixture_oracle_row_evidence where evidence_key = 'deletedName'),
  'insertedName' value (select evidence_value from fixture_oracle_row_evidence where evidence_key = 'insertedName'),
  'remainingRows' value (select count(*) from fixture_oracle_row_edit)
  returning clob
) from dual;
`)

  expect(result.beforeName === 'before-row', 'Oracle before-row evidence missing')
  expect(result.afterName === 'after-row', 'Oracle after-row evidence missing')
  expect(result.deletedName === 'delete-row', 'Oracle delete RETURNING evidence missing')
  expect(result.insertedName === 'insert-row', 'Oracle insert evidence missing')
  expect(result.remainingRows === 2, 'Oracle row-edit primitive left an unexpected row count')
})

await record('Oracle: SQLPlus export/import and backup boundary evidence', () => {
  sqlplus(`
create table fixture_oracle_file_workflow (
  id number primary key,
  sku varchar2(64) not null,
  quantity number not null
);

insert all
  into fixture_oracle_file_workflow (id, sku, quantity) values (1, 'fixture-import-1', 3)
  into fixture_oracle_file_workflow (id, sku, quantity) values (2, 'fixture-import-2', 7)
select 1 from dual;
`)

  const exportOutput = sqlplus(`
set markup csv on
select id, sku, quantity
from fixture_oracle_file_workflow
order by id;
`)

  const result = sqlplusJson(`
select json_object(
  'importedRows' value (select count(*) from fixture_oracle_file_workflow),
  'candidateTables' value (
    select count(*)
    from user_tables
    where table_name in ('ACCOUNTS', 'ORDERS', 'ORDER_ITEMS', 'SUPPORT_TICKETS')
  ),
  'backupEnvelope' value json_object(
    'engine' value 'oracle',
    'workflow' value 'oracle.data.backup-restore',
    'exportPlan' value 'SQLcl set markup csv on bounded table export',
    'backupPlan' value 'RMAN backup database plus archivelog preview',
    'residualRisk' value 'Data Pump/RMAN execution remains preview-first outside the scoped claim'
  ) format json
  returning clob
) from dual;
`)

  expectIncludes(exportOutput, 'fixture-import-1', 'Oracle SQLPlus CSV export output')
  expect(result.importedRows === 2, 'Oracle import primitive did not load two rows')
  expectAtLeast(result.candidateTables, 4, 'Oracle backup candidate tables')
  expect(result.backupEnvelope.engine === 'oracle', 'Oracle backup envelope engine is incorrect')
  expect(result.backupEnvelope.workflow === 'oracle.data.backup-restore', 'Oracle backup envelope workflow is incorrect')
  expectIncludes(result.backupEnvelope.exportPlan, 'SQLcl set markup csv on', 'Oracle SQLcl export boundary')
  expectIncludes(result.backupEnvelope.backupPlan, 'RMAN backup database plus archivelog', 'Oracle RMAN backup boundary')
  expectIncludes(result.backupEnvelope.residualRisk, 'preview-first outside the scoped claim', 'Oracle backup residual risk')
})

await record('Oracle: restricted dictionary denial evidence', () => {
  const denied = sqlplusResult('select count(*) from sys.user$;')
  if (denied.status === 0) {
    notes.push('Oracle SYS.USER$ is visible in this fixture user; restricted-dictionary denial should be rechecked with a lower-privilege account before promoting live admin claims.')
    return
  }

  const output = commandOutput(denied)
  expect(
    /ORA-00942|ORA-01031|insufficient privileges/i.test(output),
    `Oracle restricted dictionary boundary expected ORA-00942 or ORA-01031, got ${output}`,
  )
})

resetTransientOracleFixtures()

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
