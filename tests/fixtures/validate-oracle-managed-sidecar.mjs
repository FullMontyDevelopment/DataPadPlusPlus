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

const runtime = resolve('apps', 'desktop', 'src-tauri', 'binaries', runtimeName)
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

try {
  const tested = expectSuccess(await request('test'), 'Connection test')
  expect(tested.authenticatedSchema === 'DATAPADPLUSPLUS', 'Connection test returned the wrong schema.')
  expect(tested.sessionUser === 'DATAPADPLUSPLUS', 'Connection test returned the wrong session user.')
  expect(tested.currentSchema === 'DATAPADPLUSPLUS', 'Connection test returned the wrong current schema.')
  expect(tested.containerName === 'FREEPDB1', 'Connection test did not resolve the connected PDB.')
  expect(tested.databaseName === 'FREE', 'Connection test did not resolve the database name.')
  expect(tested.databaseUniqueName, 'Connection test did not return the database unique name.')
  expect(Number(tested.containerId) > 0, 'Connection test did not return the container ID.')
  expect(tested.serviceName?.toUpperCase().startsWith('FREEPDB1'), 'Connection test returned the wrong service.')

  const metadata = expectSuccess(await request('execute', {
    statement: `select table_name from all_tables where owner = 'DATAPADPLUSPLUS' order by table_name`,
  }), 'Table metadata')
  const tables = metadata.sections[0].rows.map((row) => row[0])
  for (const table of ['ACCOUNTS', 'ORDERS', 'ORDER_ITEMS', 'SUPPORT_TICKETS']) {
    expect(tables.includes(table), `Live metadata did not include ${table}.`)
  }

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

  console.log(`Managed Oracle fixture OK: ${tested.containerName}, schema ${tested.currentSchema}, ${tables.length} tables, child metadata, bounded SQL, PL/SQL output, and read-only guardrails.`)
} finally {
  child.stdin.end()
  lines.close()
}
