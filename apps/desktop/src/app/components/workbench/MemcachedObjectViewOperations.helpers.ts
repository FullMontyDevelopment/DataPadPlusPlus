import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import type { ObjectViewOperationAction } from './ObjectViewOperationStrip'

type JsonRecord = Record<string, unknown>

export function memcachedOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): ObjectViewOperationAction[] {
  const supported = supportedMemcachedOperations(connection)
  const scope = memcachedScope(connection, tab, payload)
  const actions: ObjectViewOperationAction[] = []

  const metricsLike = ['server', 'stats', 'slabs', 'slab', 'items', 'item-class', 'connections', 'diagnostics'].includes(kind)

  if (metricsLike && supported.has('metrics')) {
    actions.push(action(connection, 'diagnostics.metrics', 'Stats', 'Preview Memcached stats/slabs/items collection.', 'metrics', scope))
  }

  if (['slabs', 'slab', 'items', 'item-class'].includes(kind) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Dump', 'Preview an LRU crawler metadata dump for this cache scope.', 'memory', scope, {
      mode: 'export',
      command: 'lru_crawler metadump',
    }))
  }

  if (kind === 'settings' && supported.has('metrics')) {
    actions.push(action(connection, 'metadata.refresh', 'Refresh', 'Preview a settings refresh using the native stats command.', 'job', scope, {
      command: 'stats settings',
    }))
  }

  if (['server', 'stats', 'diagnostics'].includes(kind) && supported.has('admin')) {
    actions.push(action(connection, 'stats.reset', 'Reset Stats', 'Preview a guarded stats counter reset.', 'job', scope))
    actions.push(action(connection, 'cache.flush', 'Flush', 'Preview a destructive cache flush operation.', 'delete', scope, {
      delaySeconds: 0,
    }))
  }

  return dedupe(actions).slice(0, 5)
}

function supportedMemcachedOperations(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_metrics_collection')) supported.add('metrics')
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
  scope: MemcachedOperationScope,
  extraParameters: Record<string, unknown> = {},
): ObjectViewOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName: scope.objectName,
    parameters: {
      classId: scope.classId,
      objectKind: scope.kind,
      host: scope.host,
      port: scope.port,
      ...extraParameters,
    },
  }
}

type MemcachedOperationScope = {
  classId?: string
  host: string
  port: number
  kind: string
  objectName: string
}

function memcachedScope(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payload: JsonRecord,
): MemcachedOperationScope {
  const nodeId = tab.objectViewState?.nodeId ?? ''
  const parts = nodeId.split(':')
  const classId = parts[1] === 'slab' || parts[1] === 'item-class'
    ? parts.at(-1)
    : stringValue(payload.classId)
  const host = stringValue(payload.host) || connection.host || connection.name
  const port = typeof payload.port === 'number' ? payload.port : connection.port ?? 11211
  const kind = normalizeKind(tab.objectViewState?.kind ?? stringValue(payload.objectView) ?? 'server')
  const objectName = classId ? `class:${classId}` : kind

  return { classId, host, port, kind, objectName }
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
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
