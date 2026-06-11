import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import type { ObjectViewOperationAction } from '../../ObjectViewOperationStrip'

type JsonRecord = Record<string, unknown>

export function cosmosOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): ObjectViewOperationAction[] {
  const supported = supportedCosmosOperations(connection)
  const scope = cosmosScope(tab, payload)
  const actions: ObjectViewOperationAction[] = []

  if (!scope.objectName) {
    return actions
  }

  const accountLike = ['account', 'databases', 'regions', 'consistency', 'diagnostics'].includes(kind)
  const containerLike = ['container', 'items', 'partition-key', 'indexing-policy', 'throughput', 'change-feed', 'conflicts'].includes(kind)
  const scriptLike = ['stored-procedures', 'triggers', 'udfs'].includes(kind)
  const securityLike = ['account', 'database', 'container', 'security'].includes(kind)

  if ((accountLike || containerLike) && supported.has('metrics')) {
    actions.push(action(connection, 'diagnostics.metrics', 'Metrics', 'Preview RU, latency, throttle, and storage metric collection.', 'metrics', scope))
  }

  if ((containerLike || kind === 'database' || kind === 'throughput') && supported.has('admin')) {
    actions.push(action(connection, 'throughput.update', 'Update RU/s', 'Preview a guarded throughput or autoscale update.', 'job', scope, {
      mode: firstThroughputMode(payload) ?? 'autoscale',
      ruPerSecond: firstThroughputValue(payload) ?? 1000,
      maxRuPerSecond: firstThroughputValue(payload) ?? 4000,
    }))
  }

  if (containerLike && supported.has('profile')) {
    actions.push(action(connection, 'query.profile', 'Profile', 'Preview a query-metrics request for this container.', 'job', scope, {
      query: `select * from c where c.id != null`,
    }))
  }

  if ((containerLike || kind === 'indexing-policy') && supported.has('index')) {
    actions.push(action(connection, 'index.create', 'Indexing', 'Preview an indexing-policy update with validation.', 'index', scope, {
      mode: 'update-indexing-policy',
      path: '/*',
    }))
  }

  if (securityLike && supported.has('access')) {
    actions.push(action(connection, 'security.inspect', 'Access', 'Preview RBAC, keys, and network access checks.', 'security', scope))
  }

  if ((kind === 'account' || kind === 'consistency') && supported.has('admin')) {
    actions.push(action(connection, 'consistency.update', 'Update Consistency', 'Preview an account consistency update.', 'job', scope, {
      consistencyLevel: firstConsistencyLevel(payload) ?? 'Session',
    }))
  }

  if ((kind === 'account' || kind === 'regions') && supported.has('admin')) {
    actions.push(action(connection, 'regions.failover', 'Failover', 'Preview regional failover priority changes.', 'job', scope, {
      writeRegion: firstWriteRegion(payload) ?? 'West Europe',
    }))
  }

  if ((containerLike || accountLike) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Export', 'Preview a bounded Cosmos DB export workflow.', 'document', scope, {
      mode: 'export',
      format: 'json',
    }))
  }

  if ((containerLike || scriptLike) && supported.has('admin')) {
    actions.push(action(connection, 'object.drop', 'Drop', 'Preview a destructive container or script deletion.', 'delete', scope))
  }

  return dedupe(actions).slice(0, 8)
}

function supportedCosmosOperations(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_metrics_collection')) supported.add('metrics')
  if (capabilities.has('supports_query_profile') || capabilities.has('supports_cost_estimation')) supported.add('profile')
  if (capabilities.has('supports_index_management')) supported.add('index')
  if (capabilities.has('supports_permission_inspection') || capabilities.has('supports_cloud_iam')) supported.add('access')
  if (capabilities.has('supports_import_export')) supported.add('importExport')
  if (capabilities.has('supports_admin_operations')) supported.add('admin')

  return supported
}

function action(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: ObjectViewOperationAction['icon'],
  scope: CosmosOperationScope,
  extraParameters: Record<string, unknown> = {},
): ObjectViewOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName: scope.objectName,
    parameters: {
      account: scope.account,
      database: scope.database,
      container: scope.container,
      objectKind: scope.kind,
      ...extraParameters,
    },
  }
}

type CosmosOperationScope = {
  account: string
  database: string
  container?: string
  kind: string
  objectName: string
}

function cosmosScope(tab: QueryTabState, payload: JsonRecord): CosmosOperationScope {
  const nodeId = tab.objectViewState?.nodeId ?? ''
  const parts = nodeId.split(':')
  const databaseFromNode = parts.length >= 3 && parts[0] === 'cosmos'
    ? parts[2]
    : undefined
  const containerFromNode = parts.length >= 4 && parts[0] === 'cosmos'
    ? parts[3]
    : undefined
  const database = stringValue(payload.database) || databaseFromNode || stringValue(tab.objectViewState?.path?.at(-2)) || '<database>'
  const container = stringValue(payload.container) || containerFromNode
  const account = stringValue(payload.accountName) || stringValue(tab.objectViewState?.path?.[0]) || '<account>'
  const kind = normalizeKind(tab.objectViewState?.kind ?? stringValue(payload.objectView) ?? 'account')
  const objectName = container ? `${database}/${container}` : database || account

  return { account, database, container, kind, objectName }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function firstThroughputMode(payload: JsonRecord) {
  const first = firstRecord(payload.throughput)
  return stringValue(first?.mode)
}

function firstThroughputValue(payload: JsonRecord) {
  const first = firstRecord(payload.throughput)
  const value = first?.ruPerSecond
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[^\d.-]/g, ''))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }
  return undefined
}

function firstConsistencyLevel(payload: JsonRecord) {
  const first = records(payload.consistency).find((entry) => /default/i.test(stringValue(entry.setting) ?? ''))
  return stringValue(first?.value)
}

function firstWriteRegion(payload: JsonRecord) {
  const first = records(payload.regions).find((entry) => /write/i.test(stringValue(entry.role) ?? ''))
  return stringValue(first?.name)
}

function firstRecord(value: unknown): JsonRecord | undefined {
  return records(value)[0]
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : []
}

function normalizeKind(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function dedupe(actions: ObjectViewOperationAction[]) {
  const seen = new Set<string>()
  return actions.filter((candidate) => {
    const key = `${candidate.operationId}:${candidate.objectName}:${candidate.label}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
