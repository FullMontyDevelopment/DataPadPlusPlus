import type {
  AdapterDiagnostics,
  AdapterDiagnosticsRequest,
  AdapterDiagnosticsResponse,
  PermissionInspectionRequest,
  PermissionInspectionResponse,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { buildOperationManifestsForConnection } from './browser-operation-manifests'
import { findConnection } from './browser-store'
import { mysqlDiagnosticsPreview } from './browser-mysql-diagnostics'

export function inspectPermissionsLocally(
  snapshot: WorkspaceSnapshot,
  request: PermissionInspectionRequest,
): PermissionInspectionResponse {
  const connection = findConnection(snapshot, request.connectionId)

  if (!connection) {
    throw new Error('Connection was not found.')
  }

  const operations = buildOperationManifestsForConnection(connection)
  return {
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    inspection: {
      engine: connection.engine,
      principal: connection.auth.username ?? connection.auth.principal,
      effectiveRoles: connection.readOnly ? ['read-only-profile'] : ['profile-default'],
      effectivePrivileges: connection.readOnly
        ? ['metadata:read', 'query:read']
        : ['metadata:read', 'query:read', 'operation:plan'],
      iamSignals: connection.connectionMode?.startsWith('cloud')
        ? ['cloud-identity-profile']
        : [],
      unavailableActions: operations
        .filter((operation) =>
          connection.readOnly
            ? ['write', 'destructive', 'costly'].includes(operation.risk)
            : operation.previewOnly && operation.risk === 'destructive',
        )
        .map((operation) => ({
          operationId: operation.id,
          reason: connection.readOnly
            ? 'Connection profile is read-only.'
            : 'Destructive beta operations require live permission checks before execution.',
        })),
      warnings: ['Permission inspection is preview-normalized in browser mode.'],
    },
  }
}

export function collectDiagnosticsLocally(
  snapshot: WorkspaceSnapshot,
  request: AdapterDiagnosticsRequest,
): AdapterDiagnosticsResponse {
  const connection = findConnection(snapshot, request.connectionId)

  if (!connection) {
    throw new Error('Connection was not found.')
  }

  if (connection.engine === 'mongodb') {
    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      diagnostics: mongoDiagnosticsPreview(request.scope ?? connection.database ?? 'connection'),
    }
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      diagnostics: mysqlDiagnosticsPreview(connection.engine, request.scope ?? connection.database ?? 'connection'),
    }
  }

  return {
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    diagnostics: {
      engine: connection.engine,
      plans: [
        {
          renderer: 'plan',
          format: 'json',
          value: { engine: connection.engine, scope: request.scope ?? 'connection' },
          summary: 'Preview plan payload.',
        },
      ],
      profiles: [
        {
          renderer: 'profile',
          summary: 'Preview profile payload.',
          stages: [{ name: 'preview', durationMs: 0, rows: 0 }],
        },
      ],
      metrics: [
        {
          renderer: 'metrics',
          metrics: [
            {
              name: 'preview.connections_active',
              value: 3,
              unit: 'connections',
              labels: { engine: connection.engine },
            },
            {
              name: 'preview.query_latency_p95',
              value: 42,
              unit: 'ms',
              labels: { engine: connection.engine },
            },
            {
              name: 'preview.cache_hit_rate',
              value: 98.4,
              unit: '%',
              labels: { engine: connection.engine },
            },
            {
              name: 'preview.storage_used',
              value: 7340032,
              unit: 'bytes',
              labels: { engine: connection.engine },
            },
          ],
        },
        {
          renderer: 'series',
          series: [
            {
              name: 'preview.query_latency_p95',
              unit: 'ms',
              points: [
                { timestamp: new Date(Date.now() - 180000).toISOString(), value: 35 },
                { timestamp: new Date(Date.now() - 120000).toISOString(), value: 48 },
                { timestamp: new Date(Date.now() - 60000).toISOString(), value: 41 },
                { timestamp: new Date().toISOString(), value: 42 },
              ],
            },
          ],
        },
        {
          renderer: 'chart',
          chartType: 'bar',
          xAxis: 'Metric',
          yAxis: 'Value',
          series: [
            {
              name: 'Preview health',
              points: [
                { x: 'latency', y: 42 },
                { x: 'hit rate', y: 98.4 },
                { x: 'sessions', y: 3 },
              ],
            },
          ],
        },
      ],
      queryHistory: [
        {
          renderer: 'json',
          value: { message: 'Preview query history normalizes engine-specific history APIs.' },
        },
      ],
      costEstimates: [
        {
          renderer: 'costEstimate',
          estimatedBytes: 0,
          estimatedCredits: 0,
          estimatedCost: 0,
          details: { dryRunRequired: true },
        },
      ],
      warnings: ['Browser preview diagnostics do not contact live engines.'],
    },
  }
}

function mongoDiagnosticsPreview(scope: string): AdapterDiagnostics {
  const database = scope.includes(':') ? scope.split(':')[1] ?? 'catalog' : scope

  return {
    engine: 'mongodb',
    plans: [
      {
        renderer: 'plan',
        format: 'json',
        value: {
          engine: 'mongodb',
          scope,
          probes: ['serverStatus', 'dbStats', 'profile:-1', 'system.profile', 'currentOp', 'replSetGetStatus', 'shardingState', '$indexStats'],
        },
        summary: 'MongoDB diagnostics probe plan.',
      },
    ],
    profiles: [
      {
        renderer: 'profile',
        summary: 'MongoDB profiler status',
        stages: [
          {
            name: 'profiler-status',
            details: { database, level: 0, slowMs: 100, sampleRate: 1 },
          },
        ],
      },
      {
        renderer: 'profile',
        summary: 'MongoDB current operations',
        stages: [
          {
            name: 'query',
            rows: 2,
            details: { namespace: `${database}.products`, active: true, secsRunning: 1 },
          },
          {
            name: 'command',
            rows: 0,
            details: { namespace: 'admin.$cmd', active: true, secsRunning: 0 },
          },
        ],
      },
      {
        renderer: 'profile',
        summary: 'MongoDB replica set status',
        stages: [
          {
            name: 'mongo-1:27017',
            rows: 1,
            details: { state: 'PRIMARY', health: 1 },
          },
          {
            name: 'mongo-2:27017',
            rows: 2,
            details: { state: 'SECONDARY', health: 1 },
          },
        ],
      },
      {
        renderer: 'profile',
        summary: 'MongoDB sharding state',
        stages: [
          {
            name: 'sharding-disabled',
            rows: 0,
            details: { enabled: false },
          },
        ],
      },
    ],
    metrics: [
      {
        renderer: 'metrics',
        metrics: [
          { name: 'mongodb.connections_current', value: 12, unit: 'connections', labels: { source: 'serverStatus.connections' } },
          { name: 'mongodb.opcounters_query', value: 1842, unit: 'ops', labels: { source: 'serverStatus.opcounters' } },
          { name: 'mongodb.current_operations', value: 2, unit: 'operations', labels: { source: 'currentOp' } },
          { name: 'mongodb.replica_state', value: 1, unit: 'state', labels: { source: 'replSetGetStatus' } },
          { name: 'mongodb.sharding_enabled', value: 0, unit: 'boolean', labels: { source: 'shardingState' } },
          { name: 'mongodb.index_stats_count', value: 2, unit: 'indexes', labels: { source: '$indexStats', database } },
        ],
      },
      {
        renderer: 'series',
        series: [
          {
            name: 'mongodb.current_operations',
            unit: 'operations',
            points: [
              { timestamp: new Date(Date.now() - 120000).toISOString(), value: 1 },
              { timestamp: new Date(Date.now() - 60000).toISOString(), value: 3 },
              { timestamp: new Date().toISOString(), value: 2 },
            ],
          },
        ],
      },
      {
        renderer: 'chart',
        chartType: 'bar',
        xAxis: 'Metric',
        yAxis: 'Value',
        series: [
          {
            name: 'MongoDB diagnostics',
            points: [
              { x: 'connections', y: 12 },
              { x: 'currentOps', y: 2 },
              { x: 'indexes', y: 2 },
            ],
          },
        ],
      },
    ],
    queryHistory: [
      {
        renderer: 'json',
        value: {
          kind: 'currentOp',
          command: { currentOp: 1, $all: true },
          resultShape: { inprog: 'array' },
        },
      },
      {
        renderer: 'json',
        value: {
          kind: 'replSetGetStatus',
          command: { replSetGetStatus: 1 },
          resultShape: { members: 'array' },
        },
      },
    ],
    costEstimates: [],
    warnings: ['Browser preview diagnostics do not contact MongoDB; desktop diagnostics run the native probes live.'],
  }
}
