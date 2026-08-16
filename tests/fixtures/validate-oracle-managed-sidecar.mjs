import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'

const runtimeNames = {
  'win32-x64': 'datapadplusplus-oracle-runtime-x86_64-pc-windows-msvc.exe',
  'linux-x64': 'datapadplusplus-oracle-runtime-x86_64-unknown-linux-gnu',
  'darwin-arm64': 'datapadplusplus-oracle-runtime-aarch64-apple-darwin',
}
const runtimeName = runtimeNames[`${process.platform}-${process.arch}`]
if (!runtimeName) {
  throw new Error(`Managed Oracle fixture validation is not configured for ${process.platform}-${process.arch}.`)
}

const runtime = process.env.DATAPADPLUSPLUS_ORACLE_RUNTIME
  ? resolve(process.env.DATAPADPLUSPLUS_ORACLE_RUNTIME)
  : resolve('apps', 'desktop', 'src-tauri', 'binaries', runtimeName)
if (!existsSync(runtime)) {
  throw new Error('The bundled Oracle runtime is missing. Run `npm run oracle:sidecar:prepare` first.')
}

const connection = {
  host: '127.0.0.1',
  port: 1522,
  username: 'datapadplusplus',
  password: 'datapadplusplus',
  connectMode: 'service',
  serviceName: 'FREEPDB1',
  applicationName: 'DataPad++ fixture validator',
  connectionTimeoutMs: 15_000,
  useTls: false,
}

const child = spawn(runtime, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
const lines = createInterface({ input: child.stdout })
const pending = new Map()
let sequence = 0

lines.on('line', (line) => {
  let response
  try {
    response = JSON.parse(line)
  } catch {
    return
  }
  const request = pending.get(response.requestId)
  if (!request) return
  pending.delete(response.requestId)
  clearTimeout(request.timeout)
  request.resolve(response)
})

child.on('exit', (code) => {
  for (const request of pending.values()) {
    clearTimeout(request.timeout)
    request.reject(new Error(`Bundled Oracle runtime exited unexpectedly with code ${code}.`))
  }
  pending.clear()
})

function request(operation, options = {}) {
  const requestId = `fixture-${++sequence}`
  const payload = {
    protocolVersion: 1,
    requestId,
    operation,
    connection,
    rowLimit: 500,
    timeoutMs: 30_000,
    fetchSize: 100,
    readOnly: true,
    captureDbmsOutput: false,
    ...options,
  }

  return new Promise((resolveRequest, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error(`Managed Oracle request ${requestId} timed out.`))
    }, 35_000)
    pending.set(requestId, { resolve: resolveRequest, reject, timeout })
    child.stdin.write(`${JSON.stringify(payload)}\n`)
  })
}

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function expectSuccess(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed with ${response.code ?? 'oracle-error'}: ${response.message ?? 'Unknown error'}`)
  }
  return response.result
}

async function collectManagedPages(label, pageSize, statementForPage) {
  const pages = []
  let offset = 0

  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const result = expectSuccess(await request('execute', {
      statement: statementForPage(offset, pageSize),
      rowLimit: pageSize + 1,
    }), `${label} page ${pageNumber + 1}`)
    const rows = result.sections[0]?.rows ?? []
    pages.push(rows)
    if (rows.length < pageSize) {
      return { pages, rows: pages.flat() }
    }
    offset += rows.length
  }

  throw new Error(`${label} exceeded 100 continuation pages.`)
}

try {
  const tested = expectSuccess(await request('test'), 'Connection test')
  expect(tested.authenticatedSchema === 'DATAPADPLUSPLUS', 'Connection test returned the wrong schema.')
  expect(tested.sessionUser === 'DATAPADPLUSPLUS', 'Connection test returned the wrong session user.')
  expect(tested.currentSchema === 'DATAPADPLUSPLUS', 'Connection test returned the wrong current schema.')
  expect(tested.containerName === 'FREEPDB1', 'Connection test did not resolve the connected PDB.')
  expect(tested.databaseName, 'Connection test did not resolve the database name.')
  expect(tested.databaseUniqueName === 'FREE', 'Connection test returned the wrong database unique name.')
  expect(Number(tested.containerId) > 0, 'Connection test did not return the container ID.')
  expect(tested.serviceName?.toUpperCase().startsWith('FREEPDB1'), 'Connection test returned the wrong service.')

  const metadata = expectSuccess(await request('execute', {
    statement: `select table_name from all_tables where owner = 'DATAPADPLUSPLUS' order by table_name`,
  }), 'Table metadata')
  const tables = metadata.sections[0].rows.map((row) => row[0])
  for (const table of ['ACCOUNTS', 'ORDERS', 'ORDER_ITEMS', 'SUPPORT_TICKETS']) {
    expect(tables.includes(table), `Live metadata did not include ${table}.`)
  }

  const objects = await collectManagedPages(
    'Managed Oracle completion objects',
    37,
    (offset, pageSize) => `select owner, object_name,
      max(object_type) keep (
        dense_rank first order by case object_type
          when 'MATERIALIZED VIEW' then 1
          when 'VIEW' then 2
          else 3
        end
      ) as object_type
    from all_objects
    where owner = 'DATAPADPLUSPLUS'
      and object_type in ('TABLE', 'VIEW', 'MATERIALIZED VIEW')
    group by owner, object_name
    order by object_name, object_type
    offset ${offset} rows fetch next ${pageSize} rows only`,
  )
  const objectNames = objects.rows.map((row) => String(row[1]))
  expect(objects.pages.length >= 4, 'Managed Oracle object metadata did not require continuation pages.')
  expect(objectNames.length >= 130, `Managed Oracle returned only ${objectNames.length} completion objects.`)
  expect(new Set(objectNames).size === objectNames.length, 'Managed Oracle object pages contained duplicates.')
  for (const table of [
    'DPP_PAGING_TABLE_125',
    'DPP_CASE_TABLE',
    'Dpp_Case_Table',
    'Dpp$Quoted#Table',
    'Dpp_販売_Table',
  ]) {
    expect(objectNames.includes(table), `Managed Oracle paging did not include ${table}.`)
  }

  const fields = await collectManagedPages(
    'Managed Oracle completion fields',
    400,
    (offset, pageSize) => `select c.owner, c.table_name, c.column_name, c.column_id
    from all_tab_columns c
    join (
      select owner, object_name,
        max(object_type) keep (
          dense_rank first order by case object_type
            when 'MATERIALIZED VIEW' then 1
            when 'VIEW' then 2
            else 3
          end
        ) as object_type
      from all_objects
      where object_type in ('TABLE', 'VIEW', 'MATERIALIZED VIEW')
      group by owner, object_name
    ) o on o.owner = c.owner and o.object_name = c.table_name
    where c.owner = 'DATAPADPLUSPLUS'
    order by c.table_name, c.column_id
    offset ${offset} rows fetch next ${pageSize} rows only`,
  )
  const fieldIdentities = fields.rows.map((row) => row.slice(0, 3).map(String).join('|'))
  const finalPagedField = 'DATAPADPLUSPLUS|DPP_PAGING_TABLE_125|PAGING_VALUE_17'
  expect(fields.pages.length >= 6, 'Managed Oracle field metadata did not require continuation pages.')
  expect(fieldIdentities.length >= 2250, `Managed Oracle returned only ${fieldIdentities.length} fields.`)
  expect(new Set(fieldIdentities).size === fieldIdentities.length, 'Managed Oracle field pages contained duplicates.')
  expect(
    fieldIdentities.indexOf(finalPagedField) >= 2000,
    'Managed Oracle did not place the final fixture field beyond the 2,000-row completion boundary.',
  )
  expect(
    fieldIdentities.includes('DATAPADPLUSPLUS|Dpp$Quoted#Table|Mixed$Column#'),
    'Managed Oracle lost the quoted $/# field identity.',
  )
  expect(
    fieldIdentities.includes('DATAPADPLUSPLUS|Dpp_販売_Table|説明'),
    'Managed Oracle lost the Unicode field identity.',
  )

  const objectMetadata = expectSuccess(await request('execute', {
    statement: `select
      (select count(*) from all_tab_columns where owner = sys_context('USERENV', 'CURRENT_SCHEMA') and table_name = 'ORDERS') columns_count,
      (select count(*) from all_constraints where owner = sys_context('USERENV', 'CURRENT_SCHEMA') and table_name = 'ORDERS') constraints_count,
      (select count(*) from all_indexes where owner = sys_context('USERENV', 'CURRENT_SCHEMA') and table_name = 'ORDERS') indexes_count
    from dual`,
  }), 'Child object metadata')
  const [columnsCount, constraintsCount, indexesCount] = objectMetadata.sections[0].rows[0].map(Number)
  expect(columnsCount > 0, 'Live metadata did not return Oracle columns.')
  expect(constraintsCount > 0, 'Live metadata did not return Oracle constraints.')
  expect(indexesCount > 0, 'Live metadata did not return Oracle indexes.')

  const bounded = expectSuccess(await request('execute', {
    statement: 'select id, name from accounts order by id',
    rowLimit: 2,
  }), 'Bounded SELECT')
  expect(bounded.sections[0].rows.length === 2, 'Managed row limiting did not stop at two rows.')
  expect(bounded.sections[0].truncated === true, 'Managed row limiting did not mark the result truncated.')

  const legacyPlanTable = expectSuccess(await request('execute', {
    statement: `select count(*) from user_tab_columns where table_name = 'PLAN_TABLE' and column_name = 'OTHER_TAG'`,
  }), 'Legacy PLAN_TABLE metadata')
  expect(Number(legacyPlanTable.sections[0].rows[0][0]) === 0, 'The fixture PLAN_TABLE still contains OTHER_TAG.')

  const planRowsBefore = expectSuccess(await request('execute', {
    statement: `select count(*) from plan_table where statement_id like 'DPP%'`,
  }), 'Plan row baseline')
  const explained = expectSuccess(await request('execute', {
    statement: 'explain plan for select id, name from accounts where id = 1',
    mode: 'explain',
  }), 'Compatible explain plan')
  expect(explained.sections.length === 1, 'Explain returned intermediate result sections.')
  expect(explained.sections[0].statementKind === 'plan', 'Explain did not return a plan result section.')
  expect(explained.sections[0].rows.length > 0, 'Explain returned no PLAN_TABLE rows.')
  expect(
    explained.sections[0].columns.some((column) => column.name === 'OPERATION'),
    'Explain did not return the core OPERATION column.',
  )
  expect(explained.planRowsCleanedUp === true, 'Explain did not report cleaned-up plan rows.')
  const planRowsAfter = expectSuccess(await request('execute', {
    statement: `select count(*) from plan_table where statement_id like 'DPP%'`,
  }), 'Plan row cleanup')
  expect(
    planRowsAfter.sections[0].rows[0][0] === planRowsBefore.sections[0].rows[0][0],
    `Explain left temporary plan rows behind (${planRowsBefore.sections[0].rows[0][0]} before, ${planRowsAfter.sections[0].rows[0][0]} after).`,
  )

  const output = expectSuccess(await request('execute', {
    statement: `begin dbms_output.put_line('managed-oracle-ok'); end;\n/`,
    readOnly: false,
    captureDbmsOutput: true,
  }), 'PL/SQL DBMS output')
  expect(output.dbmsOutput.includes('managed-oracle-ok'), 'PL/SQL DBMS output was not returned.')

  const blocked = await request('execute', {
    statement: 'update accounts set name = name where id = -1',
  })
  expect(!blocked.ok && blocked.code === 'oracle-read-only-blocked', 'Read-only Oracle execution did not fail closed.')

  console.log(`Managed Oracle fixture OK: ${tested.containerName}, schema ${tested.currentSchema}, ${tables.length} tables, ${objects.pages.length} object pages, ${fields.pages.length} field pages, legacy PLAN_TABLE explain, child metadata, bounded SQL, PL/SQL output, and read-only guardrails.`)
} finally {
  child.stdin.end()
  lines.close()
}
