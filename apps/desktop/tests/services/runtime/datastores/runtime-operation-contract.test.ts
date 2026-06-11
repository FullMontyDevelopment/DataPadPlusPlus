import {
  DATASTORE_FEATURE_BACKLOG,
  type ConnectionProfile,
  type DatastoreEngine,
  type DatastoreFamily,
  type DatastoreOperationManifest,
  type WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  buildOperationManifestsForConnection,
  planOperationLocally,
} from '../../../../src/services/runtime/browser-operations'

const riskyOperationKinds = new Set(['write', 'destructive', 'costly'])

describe('datastore runtime operation contracts', () => {
  it('keeps every advertised operation manifest internally consistent', () => {
    for (const entry of DATASTORE_FEATURE_BACKLOG) {
      const connection = connectionFor(entry.engine, entry.family, entry.defaultPort)
      const operations = buildOperationManifestsForConnection(connection)
      const operationIds = operations.map((operation) => operation.id)

      expect(new Set(operationIds).size, `${entry.engine} duplicate operation ids`).toBe(operationIds.length)

      for (const operation of operations) {
        expect(operation.engine, operation.id).toBe(entry.engine)
        expect(operation.family, operation.id).toBe(entry.family)
        expect(operation.id.startsWith(`${entry.engine}.`), operation.id).toBe(true)
        expect(operation.label.trim(), `${operation.id} label`).not.toBe('')
        expect(operation.description.trim(), `${operation.id} description`).not.toBe('')
        expect(operation.scope.trim(), `${operation.id} scope`).not.toBe('')
        expect(operation.risk.trim(), `${operation.id} risk`).not.toBe('')
        expect(operation.supportedRenderers.length, `${operation.id} renderers`).toBeGreaterThan(0)
        expect(operation.executionSupport, `${operation.id} execution support`).toMatch(/^(live|plan-only|unsupported)$/)

        if (riskyOperationKinds.has(operation.risk)) {
          expect(operation.requiresConfirmation, `${operation.id} risky operations require confirmation`).toBe(true)
        }

        if (operation.executionSupport !== 'live') {
          expect(operation.disabledReason?.trim(), `${operation.id} non-live operation explains why`).toBeTruthy()
        }
      }
    }
  })

  it('can prepare a guarded plan for every advertised operation', () => {
    for (const entry of DATASTORE_FEATURE_BACKLOG) {
      const connection = connectionFor(entry.engine, entry.family, entry.defaultPort)
      const snapshot = snapshotWith(connection)
      const operations = buildOperationManifestsForConnection(connection)

      for (const operation of operations) {
        const response = planOperationLocally(snapshot, {
          connectionId: connection.id,
          environmentId: 'env-local',
          operationId: operation.id,
          objectName: objectNameForOperation(operation),
          parameters: parametersForOperation(operation),
        })

        expect(response.connectionId, operation.id).toBe(connection.id)
        expect(response.environmentId, operation.id).toBe('env-local')
        expect(response.plan.operationId, operation.id).toBe(operation.id)
        expect(response.plan.engine, operation.id).toBe(entry.engine)
        expect(response.plan.summary.trim(), `${operation.id} plan summary`).not.toBe('')
        expect(typeof response.plan.generatedRequest, `${operation.id} generated request`).toBe('string')
        expect(response.plan.requestLanguage.trim(), `${operation.id} request language`).not.toBe('')
        expect(response.plan.warnings.length, `${operation.id} warnings`).toBeGreaterThan(0)
      }
    }
  })
})

function connectionFor(
  engine: DatastoreEngine,
  family: DatastoreFamily,
  defaultPort?: number,
): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: `${engine} smoke connection`,
    engine,
    family,
    host: 'localhost',
    port: defaultPort,
    database: family === 'keyvalue' ? '0' : 'catalog',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function snapshotWith(connection: ConnectionProfile): WorkspaceSnapshot {
  return {
    connections: [connection],
    environments: [
      {
        id: 'env-local',
        name: 'Local',
        label: 'Local',
        risk: 'low',
        variables: {},
        sensitiveKeys: [],
        requiresConfirmation: false,
        safeMode: false,
        exportable: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    activeEnvironmentId: 'env-local',
    preferences: {
      theme: 'dark',
      telemetry: 'opt-in',
      lockAfterMinutes: 15,
      safeModeEnabled: false,
    },
  } as unknown as WorkspaceSnapshot
}

function objectNameForOperation(operation: DatastoreOperationManifest) {
  if (operation.id.includes('.key.')) {
    return 'session:1'
  }
  if (operation.id.includes('.index.')) {
    return 'idx_orders_status'
  }
  if (operation.id.includes('.user.')) {
    return 'app_reader'
  }
  if (operation.id.includes('.role.')) {
    return 'reporting'
  }
  if (operation.id.includes('.database.')) {
    return 'catalog'
  }
  if (operation.id.includes('.collection.') || operation.family === 'document') {
    return 'products'
  }
  if (operation.family === 'graph') {
    return 'orders_graph'
  }
  if (operation.family === 'timeseries') {
    return 'http_requests_total'
  }
  return 'public.orders'
}

function parametersForOperation(operation: DatastoreOperationManifest) {
  return {
    action: 'preview',
    aggregateName: 'orders_hourly',
    aliasName: 'products_current',
    backupName: 'catalog_backup',
    bucket: 'datapadplusplus-fixtures',
    collection: 'products',
    database: 'catalog',
    dataset: 'analytics',
    destination: 'catalog_copy',
    filePath: 'catalog.db',
    format: 'json',
    graphName: 'orders_graph',
    indexName: 'idx_orders_status',
    key: 'session:1',
    keyspace: 'catalog',
    metric: 'http_requests_total',
    namespace: 'default',
    objectKind: operation.scope,
    pipelineName: 'normalize-products',
    policyName: 'autogen',
    region: 'us-east-1',
    retentionPolicy: 'autogen',
    roleName: 'reporting',
    schema: 'public',
    snapshotName: 'snapshot-2026-01-01',
    table: 'orders',
    tableName: 'orders',
    taskId: 'task-1',
    userName: 'app_reader',
  }
}
