import type { ConnectionProfile, OperationPlanRequest } from '@datapadplusplus/shared-types'
import { defaultQueryTextForConnection } from '../../app/state/helpers'
import {
  cockroachOperationRequest,
  duckDbOperationRequest,
  mysqlOperationRequest,
  postgresOperationRequest,
  sqlServerOperationRequest,
  sqliteOperationRequest,
} from './browser-sql-dialect-operations'
import {
  duckDbImportFileRequest,
  quoteSqlIdentifier,
  suggestedSqlIndexName,
} from './browser-sql-operation-format'

export function sqlOperationRequest(connection: ConnectionProfile, request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const objectName = String(request.objectName ?? parameters.objectName ?? '<schema>.<table>')
  const columnName = String(parameters.columnName ?? 'id')
  const indexName = String(parameters.indexName ?? suggestedSqlIndexName(objectName, columnName))

  if (request.operationId.endsWith('query.explain')) {
    return sqlExplainRequest(connection, objectName)
  }

  if (request.operationId.endsWith('query.profile')) {
    return sqlProfileRequest(connection, objectName)
  }

  if (request.operationId.endsWith('index.create')) {
    return sqlCreateIndexRequest(connection, objectName, indexName, columnName)
  }

  if (request.operationId.endsWith('index.drop')) {
    return sqlDropIndexRequest(connection, objectName, indexName)
  }

  if (request.operationId.endsWith('security.inspect')) {
    return sqlSecurityInspectRequest(connection, objectName)
  }

  if (request.operationId.endsWith('data.import-export')) {
    return sqlImportExportRequest(connection, objectName, parameters)
  }

  if (request.operationId.endsWith('data.backup-restore')) {
    return sqlBackupRestoreRequest(connection, objectName)
  }

  if (connection.engine === 'sqlserver') {
    const sqlServerRequest = sqlServerOperationRequest(connection, request.operationId, objectName, parameters)
    if (sqlServerRequest) {
      return sqlServerRequest
    }
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    const mysqlRequest = mysqlOperationRequest(request.operationId, objectName)
    if (mysqlRequest) {
      return mysqlRequest
    }
  }

  if (connection.engine === 'postgresql') {
    const postgresRequest = postgresOperationRequest(request.operationId, objectName)
    if (postgresRequest) {
      return postgresRequest
    }
  }

  if (connection.engine === 'cockroachdb') {
    const cockroachRequest = cockroachOperationRequest(request.operationId, objectName)
    if (cockroachRequest) {
      return cockroachRequest
    }
  }

  if (connection.engine === 'sqlite') {
    const sqliteRequest = sqliteOperationRequest(request.operationId, objectName)
    if (sqliteRequest) {
      return sqliteRequest
    }
  }

  if (connection.engine === 'duckdb') {
    const duckDbRequest = duckDbOperationRequest(request.operationId, objectName, parameters)
    if (duckDbRequest) {
      return duckDbRequest
    }
  }

  if (request.objectName) {
    return sqlSelectPreview(connection, objectName)
  }

  return defaultQueryTextForConnection(connection)
}

function sqlExplainRequest(connection: ConnectionProfile, objectName: string) {
  if (connection.engine === 'sqlserver') {
    return `set showplan_text on;\nselect top (100) * from ${objectName};\nset showplan_text off;`
  }

  if (connection.engine === 'sqlite') {
    return `explain query plan select * from ${objectName} limit 100;`
  }

  return `explain select * from ${objectName} limit 100;`
}

function sqlProfileRequest(connection: ConnectionProfile, objectName: string) {
  if (connection.engine === 'sqlserver') {
    return `set statistics io on;\nset statistics time on;\nselect top (100) * from ${objectName};\nset statistics io off;\nset statistics time off;`
  }

  if (connection.engine === 'cockroachdb') {
    return `explain analyze (distsql) select * from ${objectName} limit 100;`
  }

  if (connection.engine === 'postgresql' || connection.engine === 'timescaledb') {
    return `explain (analyze, buffers, format text) select * from ${objectName} limit 100;`
  }

  if (connection.engine === 'mariadb') {
    return `analyze format=json select * from ${objectName} limit 100;`
  }

  if (connection.engine === 'sqlite') {
    return `explain select * from ${objectName} limit 100;`
  }

  return `explain analyze select * from ${objectName} limit 100;`
}

function sqlCreateIndexRequest(
  connection: ConnectionProfile,
  objectName: string,
  indexName: string,
  columnName: string,
) {
  const quotedIndexName = quoteSqlIdentifier(connection, indexName)
  const quotedColumnName = quoteSqlIdentifier(connection, columnName)

  return `create index ${quotedIndexName} on ${objectName} (${quotedColumnName});`
}

function sqlDropIndexRequest(connection: ConnectionProfile, objectName: string, indexName: string) {
  const quotedIndexName = quoteSqlIdentifier(connection, indexName)

  if (connection.engine === 'sqlserver' || connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `-- Review before running.\ndrop index ${quotedIndexName} on ${objectName};`
  }

  return `-- Review before running.\ndrop index ${quotedIndexName};`
}

function sqlSecurityInspectRequest(connection: ConnectionProfile, objectName: string) {
  if (connection.engine === 'sqlserver') {
    return [
      'select name, type_desc, authentication_type_desc from sys.database_principals order by name;',
      'select class_desc, permission_name, state_desc, grantee_principal_id from sys.database_permissions order by class_desc, permission_name;',
    ].join('\n')
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return 'show grants;\nselect user, host, account_locked from mysql.user order by user, host;'
  }

  if (connection.engine === 'sqlite' || connection.engine === 'duckdb') {
    return `-- ${connection.engine} has no server role catalog for ${objectName}.\nselect current_user;`
  }

  return [
    'select rolname, rolsuper, rolcreaterole, rolcreatedb from pg_roles order by rolname;',
    'select grantee, privilege_type, table_schema, table_name from information_schema.role_table_grants order by table_schema, table_name, grantee;',
  ].join('\n')
}

function sqlImportExportRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const format = String(parameters.format ?? 'csv')

  if (connection.engine === 'duckdb') {
    if (parameters.mode === 'import') {
      return duckDbImportFileRequest(objectName, parameters)
    }
    return `copy (select * from ${objectName}) to '<selected-file>.${format === 'parquet' ? 'parquet' : 'csv'}' (format ${format});`
  }

  if (connection.engine === 'postgresql' || connection.engine === 'timescaledb' || connection.engine === 'cockroachdb') {
    return `copy (select * from ${objectName}) to '<selected-file>.csv' with (format csv, header true);`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `select * from ${objectName}\ninto outfile '<selected-file>.csv'\nfields terminated by ',' enclosed by '"'\nlines terminated by '\\n';`
  }

  if (connection.engine === 'sqlite') {
    return `.headers on\n.mode csv\n.output <selected-file>.csv\nselect * from ${objectName};\n.output stdout`
  }

  if (connection.engine === 'sqlserver') {
    return `-- Export with bcp/sqlcmd or the DataPad++ file workflow.\nselect top (1000) * from ${objectName};`
  }

  return `select * from ${objectName} limit 1000;`
}

function sqlBackupRestoreRequest(connection: ConnectionProfile, objectName: string) {
  if (connection.engine === 'sqlserver') {
    return `backup database [database_name]\nto disk = '<selected-folder>\\database_name.bak'\nwith compression, checksum;`
  }

  if (connection.engine === 'sqlite') {
    return "vacuum into '<selected-file>.sqlite';"
  }

  if (connection.engine === 'duckdb') {
    return "export database '<selected-folder>' (format parquet);"
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `-- Backup with mysqldump or mariadb-dump.\n-- Scope: ${objectName}`
  }

  if (connection.engine === 'cockroachdb') {
    return "backup database <database_name> into 'external://backup-location';"
  }

  return `-- Backup with pg_dump or the DataPad++ file workflow.\n-- Scope: ${objectName}`
}

function sqlSelectPreview(connection: ConnectionProfile, objectName: string) {
  if (connection.engine === 'sqlserver') {
    return `select top (100) * from ${objectName};`
  }

  return `select * from ${objectName} limit 100;`
}
