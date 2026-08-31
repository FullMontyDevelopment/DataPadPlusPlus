import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'

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

  const transferFolder = await mkdtemp(join(tmpdir(), 'datapad-oracle-transfer-'))
  const transferPath = join(transferFolder, 'oracle-transfer.csv')
  try {
    expectSuccess(await request('execute', {
      statement: `
        begin execute immediate 'drop table DPP_TRANSFER_TARGET purge'; exception when others then if sqlcode != -942 then raise; end if; end;
        /
        begin execute immediate 'drop table DPP_TRANSFER_SOURCE purge'; exception when others then if sqlcode != -942 then raise; end if; end;
        /
        create table DPP_TRANSFER_SOURCE (
          ID number primary key,
          AMOUNT number(30, 5),
          EVENT_TIME timestamp with time zone,
          PAYLOAD varchar2(200),
          RAW_VALUE raw(16)
        );
        create table DPP_TRANSFER_TARGET (
          ID number primary key,
          AMOUNT number(30, 5),
          EVENT_TIME timestamp with time zone,
          PAYLOAD varchar2(200),
          RAW_VALUE raw(16)
        );
        insert into DPP_TRANSFER_SOURCE values (1, 9007199254740993.12500, timestamp '2026-08-31 12:30:45.123456789 UTC', '室内,"quoted"' || chr(10) || 'line', hextoraw('00112233445566778899AABBCCDDEEFF'));
        insert into DPP_TRANSFER_SOURCE values (2, -0.00001, timestamp '2026-08-31 13:30:45 UTC', null, null);
      `,
      readOnly: false,
    }), 'Oracle transfer setup')

    const exported = expectSuccess(await request('exportCsv', {
      schema: 'DATAPADPLUSPLUS',
      table: 'DPP_TRANSFER_SOURCE',
      transferPath,
      format: 'csv',
    }), 'Oracle CSV export')
    expect(exported.exportedCount === 2, 'Oracle CSV export returned the wrong row count.')
    expect(exported.bytesWritten > 0, 'Oracle CSV export produced an empty artifact.')

    const imported = expectSuccess(await request('importCsv', {
      schema: 'DATAPADPLUSPLUS',
      table: 'DPP_TRANSFER_TARGET',
      transferPath,
      format: 'csv',
      conflictPolicy: 'fail',
      readOnly: false,
    }), 'Oracle CSV import')
    expect(imported.importedCount === 2, 'Oracle CSV array binding returned the wrong row count.')

    const transferred = expectSuccess(await request('execute', {
      statement: `select id, case when amount = 9007199254740993.12500 then 'MATCH' else 'MISMATCH' end, payload, rawtohex(raw_value) from DPP_TRANSFER_TARGET order by id`,
    }), 'Oracle transferred values')
    expect(transferred.sections[0].rows.length === 2, 'Oracle CSV import did not persist both rows.')
    expect(transferred.sections[0].rows[0][1] === 'MATCH', 'Oracle CSV import lost decimal precision.')
    expect(transferred.sections[0].rows[0][2] === '室内,"quoted"\nline', 'Oracle CSV import lost Unicode or multiline text.')
    expect(transferred.sections[0].rows[0][3] === '00112233445566778899AABBCCDDEEFF', 'Oracle CSV import lost binary data.')

    const conflict = await request('importCsv', {
      schema: 'DATAPADPLUSPLUS',
      table: 'DPP_TRANSFER_TARGET',
      transferPath,
      format: 'csv',
      conflictPolicy: 'fail',
      readOnly: false,
    })
    expect(!conflict.ok && conflict.code === 'oracle-import-target-not-empty', 'Oracle CSV import did not refuse a non-empty target.')
  } finally {
    await request('execute', {
      statement: `
        begin execute immediate 'drop table DPP_TRANSFER_TARGET purge'; exception when others then if sqlcode != -942 then raise; end if; end;
        /
        begin execute immediate 'drop table DPP_TRANSFER_SOURCE purge'; exception when others then if sqlcode != -942 then raise; end if; end;
        /
      `,
      readOnly: false,
    })
    await rm(transferFolder, { recursive: true, force: true })
  }

  const dumpFileName = `dpp-transfer-${Date.now()}.dmp`
  let dumpLogFileName
  try {
    expectSuccess(await request('execute', {
      statement: `
        begin execute immediate 'drop table DPP_DATAPUMP_RESTORED purge'; exception when others then if sqlcode != -942 then raise; end if; end;
        /
        begin execute immediate 'drop table DPP_DATAPUMP_SOURCE purge'; exception when others then if sqlcode != -942 then raise; end if; end;
        /
        create table DPP_DATAPUMP_SOURCE (
          ID number primary key,
          AMOUNT number(30, 5),
          EVENT_TIME timestamp with time zone,
          PAYLOAD varchar2(200),
          RAW_VALUE raw(16)
        );
        insert into DPP_DATAPUMP_SOURCE values (1, 9007199254740993.12500, timestamp '2026-08-31 12:30:45.123456789 UTC', 'Data Pump 室内', hextoraw('00112233445566778899AABBCCDDEEFF'));
        insert into DPP_DATAPUMP_SOURCE values (2, -0.00001, timestamp '2026-08-31 13:30:45 UTC', null, null);
      `,
      readOnly: false,
    }), 'Oracle Data Pump setup')

    const backedUp = expectSuccess(await request('dataPumpExport', {
      directoryName: 'DATA_PUMP_DIR',
      dumpFileName,
      dataPumpScope: 'table',
      sourceSchema: 'DATAPADPLUSPLUS',
      table: 'DPP_DATAPUMP_SOURCE',
      format: 'datapump',
      conflictPolicy: 'fail',
      readOnly: false,
      timeoutMs: 120_000,
    }), 'Oracle Data Pump backup')
    expect(backedUp.jobState === 'COMPLETED', 'Oracle Data Pump backup did not complete.')
    expect(backedUp.artifactBytes > 0, 'Oracle Data Pump backup produced an empty dump.')
    dumpLogFileName = backedUp.logFileName

    const duplicateBackup = await request('dataPumpExport', {
      directoryName: 'DATA_PUMP_DIR',
      dumpFileName,
      dataPumpScope: 'table',
      sourceSchema: 'DATAPADPLUSPLUS',
      table: 'DPP_DATAPUMP_SOURCE',
      format: 'datapump',
      conflictPolicy: 'fail',
      readOnly: false,
    })
    expect(!duplicateBackup.ok && duplicateBackup.code === 'oracle-datapump-target-exists', 'Oracle Data Pump backup overwrote an existing dump.')

    const restored = expectSuccess(await request('dataPumpImport', {
      directoryName: 'DATA_PUMP_DIR',
      dumpFileName,
      dataPumpScope: 'table',
      sourceSchema: 'DATAPADPLUSPLUS',
      targetSchema: 'DATAPADPLUSPLUS',
      table: 'DPP_DATAPUMP_SOURCE',
      targetTable: 'DPP_DATAPUMP_RESTORED',
      format: 'datapump',
      conflictPolicy: 'fail',
      readOnly: false,
      timeoutMs: 120_000,
    }), 'Oracle Data Pump restore')
    expect(restored.jobState === 'COMPLETED', 'Oracle Data Pump restore did not complete.')
    expect(restored.importedObjectCount > 0, 'Oracle Data Pump restore did not create the target table.')

    const restoredValues = expectSuccess(await request('execute', {
      statement: `select id, case when amount = 9007199254740993.12500 then 'MATCH' else 'MISMATCH' end, payload, rawtohex(raw_value) from DPP_DATAPUMP_RESTORED order by id`,
    }), 'Oracle Data Pump restored values')
    expect(restoredValues.sections[0].rows.length === 2, 'Oracle Data Pump restore did not preserve both rows.')
    expect(restoredValues.sections[0].rows[0][1] === 'MATCH', 'Oracle Data Pump restore lost decimal precision.')
    expect(restoredValues.sections[0].rows[0][2] === 'Data Pump 室内', 'Oracle Data Pump restore lost Unicode text.')
    expect(restoredValues.sections[0].rows[0][3] === '00112233445566778899AABBCCDDEEFF', 'Oracle Data Pump restore lost binary data.')

    const duplicateRestore = await request('dataPumpImport', {
      directoryName: 'DATA_PUMP_DIR',
      dumpFileName,
      dataPumpScope: 'table',
      sourceSchema: 'DATAPADPLUSPLUS',
      targetSchema: 'DATAPADPLUSPLUS',
      table: 'DPP_DATAPUMP_SOURCE',
      targetTable: 'DPP_DATAPUMP_RESTORED',
      format: 'datapump',
      conflictPolicy: 'fail',
      readOnly: false,
    })
    expect(!duplicateRestore.ok && duplicateRestore.code === 'oracle-datapump-target-not-empty', 'Oracle Data Pump restore did not reject an existing target table.')
  } finally {
    await request('execute', {
      statement: `
        begin execute immediate 'drop table DPP_DATAPUMP_RESTORED purge'; exception when others then if sqlcode != -942 then raise; end if; end;
        /
        begin execute immediate 'drop table DPP_DATAPUMP_SOURCE purge'; exception when others then if sqlcode != -942 then raise; end if; end;
        /
        begin utl_file.fremove('DATA_PUMP_DIR', '${dumpFileName}'); exception when others then null; end;
        /
        ${dumpLogFileName ? `begin utl_file.fremove('DATA_PUMP_DIR', '${dumpLogFileName}'); exception when others then null; end;
        /` : ''}
      `,
      readOnly: false,
    })
  }

  const schemaDumpFileName = `dpp-schema-${Date.now()}.dmp`
  let schemaDumpLogFileName
  try {
    const schemaBackup = expectSuccess(await request('dataPumpExport', {
      directoryName: 'DATA_PUMP_DIR',
      dumpFileName: schemaDumpFileName,
      dataPumpScope: 'schema',
      sourceSchema: 'DATAPAD_PUMP_SOURCE',
      format: 'datapump',
      conflictPolicy: 'fail',
      readOnly: false,
      timeoutMs: 120_000,
    }), 'Oracle Data Pump schema backup')
    schemaDumpLogFileName = schemaBackup.logFileName
    expect(schemaBackup.jobState === 'COMPLETED' && schemaBackup.artifactBytes > 0, 'Oracle Data Pump schema backup did not create a valid dump.')

    const schemaRestore = expectSuccess(await request('dataPumpImport', {
      directoryName: 'DATA_PUMP_DIR',
      dumpFileName: schemaDumpFileName,
      dataPumpScope: 'schema',
      sourceSchema: 'DATAPAD_PUMP_SOURCE',
      targetSchema: 'DATAPAD_RESTORE',
      format: 'datapump',
      conflictPolicy: 'fail',
      readOnly: false,
      timeoutMs: 120_000,
    }), 'Oracle Data Pump schema restore')
    expect(schemaRestore.jobState === 'COMPLETED' && schemaRestore.importedObjectCount > 0, 'Oracle Data Pump schema restore did not create target objects.')

    const restoredSchema = expectSuccess(await request('execute', {
      statement: `select id, payload from datapad_restore.schema_transfer_data order by id`,
    }), 'Oracle Data Pump restored schema values')
    expect(restoredSchema.sections[0].rows[0][1] === 'schema-backup-室内', 'Oracle Data Pump schema remapping lost seeded data.')

    const schemaConflict = await request('dataPumpImport', {
      directoryName: 'DATA_PUMP_DIR',
      dumpFileName: schemaDumpFileName,
      dataPumpScope: 'schema',
      sourceSchema: 'DATAPAD_PUMP_SOURCE',
      targetSchema: 'DATAPAD_RESTORE',
      format: 'datapump',
      conflictPolicy: 'fail',
      readOnly: false,
    })
    expect(!schemaConflict.ok && schemaConflict.code === 'oracle-datapump-target-not-empty', 'Oracle Data Pump schema restore did not reject a non-empty target schema.')
  } finally {
    await request('execute', {
      statement: `
        begin execute immediate 'drop table datapad_restore.schema_transfer_data cascade constraints purge'; exception when others then if sqlcode != -942 then raise; end if; end;
        /
        begin utl_file.fremove('DATA_PUMP_DIR', '${schemaDumpFileName}'); exception when others then null; end;
        /
        ${schemaDumpLogFileName ? `begin utl_file.fremove('DATA_PUMP_DIR', '${schemaDumpLogFileName}'); exception when others then null; end;
        /` : ''}
      `,
      readOnly: false,
    })
  }

  console.log(`Managed Oracle fixture OK: ${tested.containerName}, schema ${tested.currentSchema}, ${tables.length} tables, ${objects.pages.length} object pages, ${fields.pages.length} field pages, legacy PLAN_TABLE explain, child metadata, bounded SQL, PL/SQL output, CSV transfer, Data Pump table/schema backup and restore, and read-only guardrails.`)
} finally {
  child.stdin.end()
  lines.close()
}
