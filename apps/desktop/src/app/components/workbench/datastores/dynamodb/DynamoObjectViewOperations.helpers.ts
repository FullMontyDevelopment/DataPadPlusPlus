import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import type { WideColumnOperationAction, WideColumnOperationIconName } from '../common/widecolumn/WideColumnObjectViewOperations'

type JsonRecord = Record<string, unknown>

export function dynamoOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): WideColumnOperationAction[] {
  const supported = supportedDynamoOperations(connection)
  const tableName = dynamoOperationObjectName(tab, payload)
  const actions: WideColumnOperationAction[] = []

  if (!tableName) {
    return actions
  }

  const normalizedKind = normalizeKind(kind)
  const tableLike = ['table', 'items', 'keys', 'streams', 'ttl', 'capacity', 'hot-partitions', 'alarms', 'backups'].includes(normalizedKind)
  const diagnosticLike = ['diagnostics', 'capacity', 'hot-partitions', 'alarms', 'backups', 'streams'].includes(normalizedKind)
  const securityLike = ['security', 'permissions'].includes(normalizedKind)
  const indexLike = ['indexes', 'global-secondary-indexes', 'local-secondary-indexes'].includes(normalizedKind)
  const baseParameters = dynamoOperationParameters(tab, payload, tableName)

  if ((tableLike || diagnosticLike) && supported.has('metrics')) {
    actions.push(action(connection, 'diagnostics.metrics', 'Metrics', 'Collect capacity, throttling, and table-health metrics', 'job', tableName, baseParameters))
  }

  if ((normalizedKind === 'table' || normalizedKind === 'capacity') && supported.has('admin')) {
    actions.push(action(connection, 'capacity.update', 'Update Capacity', 'Prepare a guarded capacity mode or throughput update plan', 'job', tableName, {
      ...baseParameters,
      billingMode: stringValue(payload.billingMode) || 'PAY_PER_REQUEST',
      readCapacityUnits: numberValue(payload.readCapacity) || 100,
      writeCapacityUnits: numberValue(payload.writeCapacity) || 50,
    }))
  }

  if ((tableLike || indexLike) && supported.has('index')) {
    actions.push(action(connection, 'index.create', 'Create GSI', 'Prepare a guarded global secondary index creation plan', 'index', tableName, {
      ...baseParameters,
      indexName: firstIndexName(payload) ?? 'new-gsi',
      partitionKey: firstKeyName(payload) ?? 'pk',
      sortKey: undefined,
      projection: 'ALL',
    }))
  }

  if (indexLike && supported.has('index')) {
    const indexName = firstIndexName(payload)
    if (indexName) {
      actions.push(action(connection, 'index.drop', 'Delete Index', 'Prepare a guarded secondary index deletion plan', 'index', tableName, {
        ...baseParameters,
        indexName,
      }))
    }
  }

  if ((normalizedKind === 'table' || normalizedKind === 'ttl') && supported.has('admin')) {
    actions.push(action(connection, 'ttl.update', 'Update TTL', 'Prepare a guarded TTL enable or attribute update plan', 'job', tableName, {
      ...baseParameters,
      enabled: true,
      ttlAttribute: firstTtlAttribute(payload) || 'expiresAt',
    }))
  }

  if ((normalizedKind === 'table' || normalizedKind === 'streams') && supported.has('admin')) {
    actions.push(action(connection, 'streams.update', 'Update Streams', 'Prepare a guarded stream enable or view-type update plan', 'job', tableName, {
      ...baseParameters,
      enabled: true,
      streamViewType: firstStreamViewType(payload) || 'NEW_AND_OLD_IMAGES',
    }))
  }

  if ((securityLike || tableLike) && supported.has('permissions')) {
    actions.push(action(connection, 'security.inspect', 'Access', 'Review IAM-style permissions and disabled action reasons', 'security', tableName, baseParameters))
  }

  if ((tableLike || indexLike) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Export', 'Prepare a table export or import mapping workflow', 'table', tableName, {
      ...baseParameters,
      mode: 'export',
      format: 'dynamodb-json',
    }))
  }

  if ((normalizedKind === 'table' || normalizedKind === 'backups') && supported.has('admin')) {
    actions.push(action(connection, 'backup.create', 'Create Backup', 'Prepare an on-demand table backup plan', 'job', tableName, {
      ...baseParameters,
      backupName: `${tableName}-manual`,
    }))
  }

  if (normalizedKind === 'table' && supported.has('admin')) {
    actions.push(action(connection, 'object.drop', 'Delete Table', 'Prepare a guarded table deletion plan', 'table', tableName, baseParameters))
  }

  return dedupeActions(actions).slice(0, 9)
}

export function dynamoOperationObjectName(tab: QueryTabState, payload: JsonRecord) {
  return stringValue(
    payload.tableName ??
      payload.objectName ??
      payload.name ??
      tab.objectViewState?.label,
  )
}

function supportedDynamoOperations(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_metrics_collection')) {
    supported.add('metrics')
  }
  if (capabilities.has('supports_index_management')) {
    supported.add('index')
  }
  if (capabilities.has('supports_permission_inspection')) {
    supported.add('permissions')
  }
  if (capabilities.has('supports_import_export')) {
    supported.add('importExport')
  }
  if (capabilities.has('supports_admin_operations')) {
    supported.add('admin')
  }

  return supported
}

function dynamoOperationParameters(
  tab: QueryTabState,
  payload: JsonRecord,
  tableName: string,
) {
  return {
    tableName,
    objectKind: tab.objectViewState?.kind,
    region: payload.region,
    keySchema: payload.keys,
  }
}

function action(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: WideColumnOperationIconName,
  objectName: string,
  parameters: Record<string, unknown>,
): WideColumnOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName,
    parameters,
  }
}

function firstIndexName(payload: JsonRecord) {
  const firstGlobal = firstRecord(payload.globalSecondaryIndexes)
  const firstLocal = firstRecord(payload.localSecondaryIndexes)

  return stringValue(firstGlobal?.name ?? firstLocal?.name)
}

function firstTtlAttribute(payload: JsonRecord) {
  return stringValue(firstRecord(payload.ttl)?.attribute)
}

function firstStreamViewType(payload: JsonRecord) {
  return stringValue(firstRecord(payload.streams)?.viewType)
}

function firstKeyName(payload: JsonRecord) {
  const firstKey = firstRecord(payload.keys)

  return stringValue(firstKey?.attribute)
}

function firstRecord(value: unknown): JsonRecord | undefined {
  return Array.isArray(value)
    ? value.find((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : undefined
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

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function dedupeActions(actions: WideColumnOperationAction[]) {
  const seen = new Set<string>()
  return actions.filter((candidate) => {
    const key = `${candidate.operationId}:${candidate.objectName}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
