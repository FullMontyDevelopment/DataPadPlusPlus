import type { ConnectionProfile, OperationPlanRequest } from '@datapadplusplus/shared-types'
import { defaultQueryTextForConnection } from '../../app/state/helpers'
import { dynamoAuthEvidence, dynamoCloudDisabledReasons } from './browser-dynamodb-operation-auth'

type JsonRecord = Record<string, unknown>

export function wideColumnOperationRequest(
  connection: ConnectionProfile,
  request: OperationPlanRequest,
) {
  if (connection.engine === 'dynamodb') {
    return dynamoOperationRequest(connection, request)
  }

  if (connection.engine === 'cassandra') {
    return cassandraOperationRequest(connection, request)
  }

  return defaultQueryTextForConnection(connection)
}

function dynamoOperationRequest(connection: ConnectionProfile, request: OperationPlanRequest) {
  const parameters = asRecord(request.parameters)
  const tableName = stringValue(parameters.tableName ?? request.objectName) || '<table>'
  const indexName = stringValue(parameters.indexName) || '<index>'

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return dynamoJson({
      operation: 'CloudWatch.GetMetricData',
      namespace: 'AWS/DynamoDB',
      region: parameters.region ?? connection.database ?? 'local',
      tableName,
      metrics: [
        'ConsumedReadCapacityUnits',
        'ConsumedWriteCapacityUnits',
        'ReadThrottleEvents',
        'WriteThrottleEvents',
        'SuccessfulRequestLatency',
      ],
      period: '5m',
      scope: parameters.objectKind ?? 'table',
      authEvidence: dynamoAuthEvidence(connection),
      requests: [
        { operation: 'DynamoDB.ListTables' },
        { operation: 'DynamoDB.DescribeLimits' },
        { operation: 'DynamoDB.DescribeTable', tableName },
        { operation: 'DynamoDB.DescribeTimeToLive', tableName },
        { operation: 'DynamoDB.DescribeContinuousBackups', tableName },
        { operation: 'CloudWatch.GetMetricData', namespace: 'AWS/DynamoDB' },
      ],
      disabledReasons: dynamoCloudDisabledReasons(connection),
    })
  }

  if (request.operationId.endsWith('security.inspect')) {
    return dynamoJson({
      operation: 'IAM.SimulatePrincipalPolicy',
      tableName,
      resourceArn: `arn:aws:dynamodb:<region>:<account>:table/${tableName}`,
      authEvidence: dynamoAuthEvidence(connection),
      evaluation: 'plan-only-with-disabled-reason',
      actions: [
        'dynamodb:DescribeTable',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
      ],
      disabledReasons: dynamoCloudDisabledReasons(connection),
    })
  }

  if (request.operationId.endsWith('index.create')) {
    return dynamoJson({
      operation: 'DynamoDB.UpdateTable',
      tableName,
      globalSecondaryIndexUpdates: [{
        create: {
          indexName,
          keySchema: dynamoIndexKeySchema(parameters),
          projection: { projectionType: parameters.projection ?? 'ALL' },
          billingMode: 'matches-table',
        },
      }],
    })
  }

  if (request.operationId.endsWith('index.drop')) {
    return dynamoJson({
      operation: 'DynamoDB.UpdateTable',
      tableName,
      globalSecondaryIndexUpdates: [{
        delete: {
          indexName,
        },
      }],
    })
  }

  if (request.operationId.endsWith('capacity.update')) {
    return dynamoJson({
      operation: 'DynamoDB.UpdateTable',
      tableName,
      billingMode: parameters.billingMode ?? 'PAY_PER_REQUEST',
      provisionedThroughput: {
        readCapacityUnits: numberValue(parameters.readCapacityUnits) || 100,
        writeCapacityUnits: numberValue(parameters.writeCapacityUnits) || 50,
      },
      preflight: ['DescribeTable', 'CheckAutoScalingPolicies', 'EstimateCost'],
      authEvidence: dynamoAuthEvidence(connection),
    })
  }

  if (request.operationId.endsWith('ttl.update')) {
    return dynamoJson({
      operation: 'DynamoDB.UpdateTimeToLive',
      tableName,
      timeToLiveSpecification: {
        enabled: booleanValue(parameters.enabled, true),
        attributeName: stringValue(parameters.ttlAttribute) || 'expiresAt',
      },
    })
  }

  if (request.operationId.endsWith('streams.update')) {
    return dynamoJson({
      operation: 'DynamoDB.UpdateTable',
      tableName,
      streamSpecification: {
        streamEnabled: booleanValue(parameters.enabled, true),
        streamViewType: stringValue(parameters.streamViewType) || 'NEW_AND_OLD_IMAGES',
      },
      preflight: ['DescribeTable', 'CheckLambdaEventSourceMappings'],
    })
  }

  if (request.operationId.endsWith('backup.create')) {
    return dynamoJson({
      operation: 'DynamoDB.CreateBackup',
      tableName,
      backupName: stringValue(parameters.backupName) || `${tableName}-manual`,
      preflight: ['DescribeTable', 'ListBackups'],
      authEvidence: dynamoAuthEvidence(connection),
      disabledReasons: dynamoCloudDisabledReasons(connection),
    })
  }

  if (request.operationId.endsWith('backup.restore')) {
    return dynamoJson({
      operation: 'DynamoDB.RestoreTableFromBackup',
      sourceBackupArn: parameters.sourceBackupArn ?? '<selected-backup-arn>',
      targetTableName: stringValue(parameters.targetTableName) || `${tableName}-restore`,
      validation: 'restore-preview',
      authEvidence: dynamoAuthEvidence(connection),
      disabledReasons: dynamoCloudDisabledReasons(connection),
    })
  }

  if (request.operationId.endsWith('data.import-export')) {
    const mode = stringValue(parameters.mode) || 'export'
    return dynamoJson({
      operation: mode === 'import' ? 'DynamoDB.ImportTable' : 'DynamoDB.ExportTableToPointInTime',
      tableName,
      format: parameters.format ?? 'dynamodb-json',
      s3Bucket: parameters.s3Bucket ?? '<selected-bucket>',
      s3Prefix: parameters.s3Prefix ?? tableName,
      validation: mode === 'import' ? 'validate-before-write' : 'point-in-time-export',
      authEvidence: dynamoAuthEvidence(connection),
      disabledReasons: dynamoCloudDisabledReasons(connection),
    })
  }

  if (request.operationId.endsWith('object.drop')) {
    return dynamoJson({
      operation: 'DynamoDB.DeleteTable',
      tableName,
      preflight: ['DescribeTable', 'ListBackups', 'CheckDeletionProtection'],
      authEvidence: dynamoAuthEvidence(connection),
      disabledReasons: dynamoCloudDisabledReasons(connection),
    })
  }

  return defaultQueryTextForConnection(connection)
}

function cassandraOperationRequest(connection: ConnectionProfile, request: OperationPlanRequest) {
  const parameters = asRecord(request.parameters)
  const keyspace = stringValue(parameters.keyspace) || cassandraKeyspaceFromObjectName(request.objectName) || connection.database || 'app'
  const tableName = stringValue(parameters.tableName) || cassandraTableFromObjectName(request.objectName) || '<table>'
  const objectName = request.objectName || `"${keyspace}"."${tableName}"`
  const indexName = stringValue(parameters.indexName) || '<index>'
  const columnName = stringValue(parameters.columnName) || 'column_name'

  if (request.operationId.endsWith('query.profile')) {
    return [
      'tracing on;',
      `select * from "${keyspace}"."${tableName}" limit 100;`,
      'tracing off;',
      'select * from system_traces.sessions limit 20;',
      'select * from system_traces.events limit 100;',
    ].join('\n')
  }

  if (request.operationId.endsWith('security.inspect')) {
    return [
      `list all permissions on keyspace "${keyspace}";`,
      'list roles;',
    ].join('\n')
  }

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return [
      'select * from system.local;',
      'select * from system.peers;',
      `select * from system_schema.tables where keyspace_name = '${escapeCqlLiteral(keyspace)}';`,
      '-- Add nodetool/JMX-backed compaction, repair, and latency metrics when the adapter has live access.',
    ].join('\n')
  }

  if (request.operationId.endsWith('data.import-export')) {
    const mode = stringValue(parameters.mode) || 'export'
    const format = stringValue(parameters.format) || 'csv'
    const direction = mode === 'import' ? 'from' : 'to'
    const withClause = format.toLowerCase() === 'json'
      ? "with header = true and null = '<null>'"
      : 'with header = true'

    return [
      `-- Cassandra ${mode} plan for ${keyspace}.${tableName}.`,
      '-- cqlsh COPY is contract-only here; use live execution only after driver/tooling validation.',
      `copy "${escapeCqlIdentifier(keyspace)}"."${escapeCqlIdentifier(tableName)}" ${direction} '<selected-file>.${format}' ${withClause};`,
    ].join('\n')
  }

  if (request.operationId.endsWith('data.backup-restore')) {
    const mode = stringValue(parameters.mode) || 'backup'
    const snapshotName = stringValue(parameters.snapshotName) || 'datapad_snapshot'

    if (mode === 'restore') {
      return [
        `-- Cassandra restore plan for ${keyspace}.${tableName}.`,
        '-- Stop writes, clear target SSTables only after backup verification, then stream validated SSTables.',
        `sstableloader -d <contact-points> '<snapshot-dir>/${escapeCqlIdentifier(keyspace)}.${escapeCqlIdentifier(tableName)}/${escapeCqlLiteral(snapshotName)}';`,
      ].join('\n')
    }

    return [
      `-- Cassandra backup plan for ${keyspace}.${tableName}.`,
      `nodetool snapshot --tag ${escapeCqlLiteral(snapshotName)} --table "${escapeCqlIdentifier(tableName)}" "${escapeCqlIdentifier(keyspace)}";`,
      `-- Record schema with: describe table "${escapeCqlIdentifier(keyspace)}"."${escapeCqlIdentifier(tableName)}";`,
    ].join('\n')
  }

  if (request.operationId.endsWith('index.create')) {
    return `create custom index if not exists "${indexName}" on "${keyspace}"."${tableName}" ("${columnName}") using 'StorageAttachedIndex';`
  }

  if (request.operationId.endsWith('index.drop')) {
    return `drop index if exists "${keyspace}"."${indexName}";`
  }

  if (request.operationId.endsWith('object.drop')) {
    return `-- Review dependencies before running.\ndrop ${cassandraObjectKind(parameters)} if exists ${objectName};`
  }

  return defaultQueryTextForConnection(connection)
}

function dynamoIndexKeySchema(parameters: JsonRecord) {
  const partitionKey = stringValue(parameters.partitionKey) || 'pk'
  const sortKey = stringValue(parameters.sortKey)
  const schema = [{ attributeName: partitionKey, keyType: 'HASH' }]

  return sortKey
    ? [...schema, { attributeName: sortKey, keyType: 'RANGE' }]
    : schema
}

function dynamoJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function cassandraObjectKind(parameters: JsonRecord) {
  const kind = stringValue(parameters.objectKind).replace(/-/g, ' ')

  if (['materialized view', 'type', 'function', 'aggregate'].includes(kind)) {
    return kind
  }

  return 'table'
}

function cassandraKeyspaceFromObjectName(objectName: string | undefined) {
  const match = objectName?.match(/^"?([^".]+)"?\."?([^".]+)"?$/)

  return match?.[1]
}

function cassandraTableFromObjectName(objectName: string | undefined) {
  const match = objectName?.match(/^"?([^".]+)"?\."?([^".]+)"?$/)

  return match?.[2]
}

function escapeCqlLiteral(value: string) {
  return value.replace(/'/g, "''")
}

function escapeCqlIdentifier(value: string) {
  return value.replace(/"/g, '""')
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''))
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    if (/^(true|yes|enabled|1)$/i.test(value)) {
      return true
    }
    if (/^(false|no|disabled|0)$/i.test(value)) {
      return false
    }
  }

  return fallback
}
