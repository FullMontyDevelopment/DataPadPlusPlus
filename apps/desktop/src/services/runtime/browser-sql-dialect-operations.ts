import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  duckDbExtensionName,
  duckDbImportFileRequest,
  quoteSqlIdentifier,
} from './browser-sql-operation-format'

export function duckDbOperationRequest(
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  if (operationId.endsWith('table.analyze')) {
    return `analyze ${objectName};`
  }

  if (operationId.endsWith('database.analyze')) {
    return 'analyze;'
  }

  if (operationId.endsWith('database.checkpoint')) {
    return 'checkpoint;'
  }

  if (operationId.endsWith('extension.install')) {
    return `install ${duckDbExtensionName(parameters.extensionName ?? objectName)};`
  }

  if (operationId.endsWith('extension.load')) {
    return `load ${duckDbExtensionName(parameters.extensionName ?? objectName)};`
  }

  if (operationId.endsWith('file.import')) {
    return duckDbImportFileRequest(String(parameters.tableName ?? objectName), parameters)
  }

  return undefined
}

export function mysqlOperationRequest(operationId: string, objectName: string) {
  if (operationId.endsWith('table.analyze')) {
    return `analyze table ${objectName};`
  }

  if (operationId.endsWith('table.optimize')) {
    return `optimize table ${objectName};`
  }

  if (operationId.endsWith('table.check')) {
    return `check table ${objectName};`
  }

  if (operationId.endsWith('table.repair')) {
    return `repair table ${objectName};`
  }

  if (operationId.endsWith('event.enable')) {
    return `alter event ${objectName} enable;`
  }

  if (operationId.endsWith('event.disable')) {
    return `alter event ${objectName} disable;`
  }

  return undefined
}

export function postgresOperationRequest(operationId: string, objectName: string) {
  if (operationId.endsWith('table.analyze')) {
    return `analyze verbose ${objectName};`
  }

  if (operationId.endsWith('table.vacuum')) {
    return `vacuum (verbose, analyze) ${objectName};`
  }

  if (operationId.endsWith('database.analyze')) {
    return 'analyze verbose;'
  }

  if (operationId.endsWith('database.vacuum')) {
    return 'vacuum (verbose, analyze);'
  }

  if (operationId.endsWith('index.reindex')) {
    return `-- REINDEX may take stronger locks; review before running.\nreindex index concurrently ${objectName};`
  }

  return undefined
}

export function cockroachOperationRequest(operationId: string, objectName: string) {
  if (operationId.endsWith('cockroach.jobs')) {
    return 'show jobs;'
  }

  if (operationId.endsWith('cockroach.ranges')) {
    return 'select * from crdb_internal.ranges_no_leases limit 100;'
  }

  if (operationId.endsWith('cockroach.regions')) {
    return 'show regions;\nshow localities;'
  }

  if (operationId.endsWith('cockroach.sessions')) {
    return 'show sessions;'
  }

  if (operationId.endsWith('cockroach.contention')) {
    return 'show sessions;\nselect * from crdb_internal.cluster_locks limit 100;\nselect * from crdb_internal.cluster_contention_events limit 100;'
  }

  if (operationId.endsWith('cockroach.roles-grants')) {
    return 'show roles;\nshow grants;\nshow default privileges;'
  }

  if (operationId.endsWith('cockroach.backup')) {
    return `backup database ${objectName} into 'external://backup-location' with revision_history;`
  }

  if (operationId.endsWith('cockroach.restore')) {
    return `restore database ${objectName} from 'external://backup-location';`
  }

  if (operationId.endsWith('cockroach.import')) {
    return `import into ${objectName} csv data ('external://import-location/data.csv') with skip = '1';`
  }

  if (operationId.endsWith('cockroach.zone-configs')) {
    return `show zone configuration for ${objectName};\n-- ALTER ... CONFIGURE ZONE is guarded and should be previewed with placement intent.`
  }

  return undefined
}

export function sqlServerOperationRequest(
  connection: ConnectionProfile,
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const indexName = quoteSqlIdentifier(connection, String(parameters.indexName ?? 'IX_name'))
  const targetObject = sqlServerTargetObject(connection, objectName, parameters)

  if (operationId.endsWith('statistics.update')) {
    return `update statistics ${targetObject} with fullscan;`
  }

  if (operationId.endsWith('index.reorganize')) {
    return `alter index ${indexName} on ${targetObject} reorganize;`
  }

  if (operationId.endsWith('index.rebuild')) {
    return `alter index ${indexName} on ${targetObject} rebuild with (online = on);`
  }

  if (operationId.endsWith('index.disable')) {
    return `-- Review carefully before disabling an index.\nalter index ${indexName} on ${targetObject} disable;`
  }

  if (operationId.endsWith('index.enable')) {
    return `alter index ${indexName} on ${targetObject} rebuild with (online = on);`
  }

  if (operationId.endsWith('query-store.top-queries')) {
    return [
      'select top (50)',
      '  qsq.query_id,',
      '  qsp.plan_id,',
      '  rs.avg_duration,',
      '  rs.count_executions',
      'from sys.query_store_query qsq',
      'join sys.query_store_plan qsp on qsq.query_id = qsp.query_id',
      'join sys.query_store_runtime_stats rs on qsp.plan_id = rs.plan_id',
      'order by rs.avg_duration desc;',
    ].join('\n')
  }

  return undefined
}

export function sqliteOperationRequest(operationId: string, objectName: string) {
  if (operationId.endsWith('database.integrity-check')) {
    return 'pragma quick_check;\npragma integrity_check;'
  }

  if (operationId.endsWith('database.analyze')) {
    return 'analyze;'
  }

  if (operationId.endsWith('database.optimize')) {
    return 'pragma optimize;'
  }

  if (operationId.endsWith('database.vacuum')) {
    return "-- Review file locks before running.\nvacuum;\n-- Or compact into a new file:\n-- vacuum into '<selected-file>.sqlite';"
  }

  if (operationId.endsWith('table.analyze')) {
    return `analyze ${objectName};`
  }

  if (operationId.endsWith('index.reindex')) {
    return `reindex ${objectName};`
  }

  return undefined
}

function sqlServerTargetObject(
  connection: ConnectionProfile,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const schema = typeof parameters.schema === 'string' ? parameters.schema.trim() : ''
  const table = typeof parameters.table === 'string' ? parameters.table.trim() : ''
  if (table) {
    return schema
      ? `${quoteSqlIdentifier(connection, schema)}.${quoteSqlIdentifier(connection, table)}`
      : quoteSqlIdentifier(connection, table)
  }
  return objectName
}
