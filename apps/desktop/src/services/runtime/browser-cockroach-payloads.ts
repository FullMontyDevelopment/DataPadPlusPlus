import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { CockroachCapabilityKey } from './cockroach-capabilities'
import {
  cockroachCapability,
  cockroachCapabilityWarning,
  cockroachCapabilityWarnings,
} from './cockroach-capabilities'
import { parseCockroachNodeId, postgresColumns } from './browser-postgres-family-helpers'

export function cockroachInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parseCockroachNodeId(connection, nodeId)
  const database = connection.database || 'defaultdb'
  const normalizedNodeId = nodeId.toLowerCase()
  const base = {
    engine: 'cockroachdb',
    database,
    schema,
    objectName,
  }
  const restrictedPayload = restrictedCockroachPayload(connection, normalizedNodeId, base)
  if (restrictedPayload) {
    return restrictedPayload
  }

  const clusterPayload = {
    nodeCount: 3,
    rangeCount: 184,
    regionCount: 2,
    jobCount: 3,
    nodes: [
      { nodeId: 1, address: 'n1.local:26257', locality: 'region=us-east,az=a', ranges: 68, liveBytes: '1.4 GB', status: 'live' },
      { nodeId: 2, address: 'n2.local:26257', locality: 'region=us-east,az=b', ranges: 61, liveBytes: '1.1 GB', status: 'live' },
      { nodeId: 3, address: 'n3.local:26257', locality: 'region=eu-west,az=a', ranges: 55, liveBytes: '948 MB', status: 'live' },
    ],
    ranges: [
      { rangeId: 42, table: `${schema}.accounts`, replicas: '1,2,3', leaseholder: 1, qps: 18, size: '64 MB' },
      { rangeId: 43, table: `${schema}.orders`, replicas: '1,2,3', leaseholder: 2, qps: 7, size: '91 MB' },
    ],
    regions: [
      { region: 'us-east', locality: 'region=us-east', nodes: 2, survivalGoal: 'zone failure', constraints: '+region=us-east' },
      { region: 'eu-west', locality: 'region=eu-west', nodes: 1, survivalGoal: 'region failure', constraints: '+region=eu-west' },
    ],
    jobs: [
      { id: 101, type: 'SCHEMA CHANGE', status: 'succeeded', fraction: 1, description: 'CREATE INDEX products_sku_idx' },
      { id: 102, type: 'BACKUP', status: 'paused', fraction: 0.42, description: 'BACKUP DATABASE datapadplusplus' },
    ],
    clusterSettings: [
      { name: 'kv.rangefeed.enabled', value: 'true', type: 'b', description: 'rangefeed support' },
      { name: 'sql.defaults.results_buffer.size', value: '16KiB', type: 'z', description: 'SQL result buffering' },
    ],
  }

  const securityPayload = {
    roles: [
      { name: 'root', login: true, superuser: true, inherit: true, memberships: '' },
      { name: 'app_reader', login: false, superuser: false, inherit: true, memberships: '' },
    ],
    permissions: [
      { principal: 'app_reader', privilege: 'SELECT', object: `${schema}.accounts`, state: 'granted', grantor: 'root' },
    ],
    grants: [
      { principal: 'app_reader', privilege: 'SELECT', object: `${database}.${schema}.accounts`, state: 'granted', grantor: 'root' },
    ],
    defaultPrivileges: [
      { principal: 'app_reader', privilege: 'SELECT', object: `${database}.${schema}.*`, state: 'default', grantor: 'root' },
    ],
    certificates: [
      { nodeId: 1, type: 'node', subject: 'CN=node', validUntil: '2027-01-01' },
    ],
  }

  const diagnosticsPayload = {
    activeSessions: 5,
    blockedSessions: 1,
    retryCount: 2,
    sessions: [
      { sessionId: 's1', user: 'app', database, state: 'active', wait: 'CPU', blockedBy: '' },
      { sessionId: 's2', user: 'reporting', database, state: 'idle', wait: 'Client', blockedBy: '' },
    ],
    statements: [
      { query: 'select * from public.accounts', count: 42, meanMs: 12, p99Ms: 44, rows: 128, retries: 1 },
    ],
    transactions: [
      { id: 'txn-01', state: 'active', age: '2.1s', priority: 'normal', retries: 1 },
    ],
    contention: [
      { key: '/Table/104/1', table: `${schema}.accounts`, waiter: 'txn-01', durationMs: 18, blockingTxn: 'txn-00' },
    ],
    locks: [
      { sessionId: 's1', object: `${schema}.accounts`, mode: 'shared', granted: true, blocking: 'No' },
    ],
    statistics: [
      { name: `${schema}.accounts`, rows: 128, scans: 9, ranges: 2, size: '96 KB' },
    ],
  }

  if (normalizedNodeId.includes('jobs')) return { ...base, jobs: clusterPayload.jobs }
  if (normalizedNodeId.includes('ranges')) return { ...base, ranges: clusterPayload.ranges, rangeCount: clusterPayload.rangeCount }
  if (normalizedNodeId.includes('regions') || normalizedNodeId.includes('localities')) return { ...base, regions: clusterPayload.regions, nodes: clusterPayload.nodes, regionCount: clusterPayload.regionCount }
  if (normalizedNodeId.includes('cluster-settings')) return { ...base, clusterSettings: clusterPayload.clusterSettings }
  if (normalizedNodeId.includes('nodes')) return { ...base, nodes: clusterPayload.nodes, nodeCount: clusterPayload.nodeCount }
  if (normalizedNodeId.includes('zone-config')) return { ...base, zoneConfigurations: tableZoneConfigurations(schema) }
  if (normalizedNodeId.includes('certificates')) return { ...base, certificates: securityPayload.certificates }
  if (normalizedNodeId.includes('grants') || normalizedNodeId.includes('roles')) return { ...base, ...securityPayload }
  if (normalizedNodeId.includes('security')) {
    const warnings = cockroachCapabilityWarnings(connection, [
      'inspectRolesAndGrants',
      'inspectCertificates',
    ])
    return {
      ...base,
      ...(cockroachCapability(connection, 'inspectRolesAndGrants')
        ? {
            roles: securityPayload.roles,
            permissions: securityPayload.permissions,
            grants: securityPayload.grants,
            defaultPrivileges: securityPayload.defaultPrivileges,
          }
        : {}),
      ...(cockroachCapability(connection, 'inspectCertificates')
        ? { certificates: securityPayload.certificates }
        : {}),
      ...(warnings.length ? { warnings } : {}),
    }
  }
  if (normalizedNodeId.includes('sessions')) return { ...base, sessions: diagnosticsPayload.sessions, transactions: diagnosticsPayload.transactions, activeSessions: diagnosticsPayload.activeSessions }
  if (normalizedNodeId.includes('statements')) return { ...base, statements: diagnosticsPayload.statements, retryCount: diagnosticsPayload.retryCount }
  if (normalizedNodeId.includes('transactions')) return { ...base, transactions: diagnosticsPayload.transactions }
  if (normalizedNodeId.includes('contention')) return { ...base, contention: diagnosticsPayload.contention, locks: diagnosticsPayload.locks, statements: diagnosticsPayload.statements, blockedSessions: diagnosticsPayload.blockedSessions }
  if (normalizedNodeId.includes('locks')) return { ...base, locks: diagnosticsPayload.locks, blockedSessions: diagnosticsPayload.blockedSessions }
  if (normalizedNodeId.includes('statistics')) return { ...base, statistics: diagnosticsPayload.statistics, statements: diagnosticsPayload.statements }
  if (normalizedNodeId.includes('diagnostics')) return cockroachDiagnosticsPayload(base, diagnosticsPayload, connection)
  if (normalizedNodeId.includes('cluster')) return cockroachClusterPayload(base, clusterPayload, connection)

  if (nodeId.startsWith('table:')) {
    return {
      ...base,
      rowCount: 128,
      size: '96 KB',
      columns: postgresColumns(),
      indexes: [
        { name: `${objectName}_pkey`, type: 'primary', columns: 'id', unique: true, valid: true, size: '16 KB' },
        { name: `${objectName}_updated_at_idx`, type: 'secondary', columns: 'updated_at', unique: false, valid: true, size: '16 KB' },
      ],
      constraints: [
        { name: `${objectName}_pkey`, type: 'PRIMARY KEY', columns: 'id', status: 'validated' },
      ],
      statistics: [
        { name: objectName, rows: 128, scans: 6, lastAnalyze: '2026-05-16', size: '96 KB' },
      ],
      zoneConfigurations: tableZoneConfigurations(schema, objectName),
    }
  }

  if (nodeId.startsWith('schema:') || nodeId.startsWith('cockroach:')) {
    return {
      ...base,
      tableCount: 3,
      indexCount: 8,
      tables: [
        { schema, name: 'accounts', type: 'regional table', rows: 128, size: '96 KB', owner: 'app' },
        { schema, name: 'orders', type: 'regional table', rows: 348, size: '184 KB', owner: 'app' },
        { schema, name: 'products', type: 'global table', rows: 3, size: '48 KB', owner: 'app' },
      ],
      views: [
        { schema, name: 'active_accounts', status: 'valid', definition: 'Visible in view definition.' },
      ],
      sequences: [
        { schema, name: 'accounts_id_seq', dataType: 'INT8', increment: 1, cache: 1, cycles: false },
      ],
      types: [
        { schema, name: 'account_status_t', type: 'enum', owner: 'app' },
      ],
      functions: [
        { schema, name: 'account_status', arguments: 'account_id INT8', returns: 'STRING', language: 'SQL', volatility: 'stable' },
      ],
      zoneConfigurations: tableZoneConfigurations(schema),
    }
  }

  return {
    ...base,
    objects: objectName
      ? [{ schema, name: objectName, type: nodeId.split(':')[0] || 'object', status: 'visible' }]
      : [],
  }
}

function tableZoneConfigurations(schema: string, objectName = 'accounts') {
  return [
    {
      target: `${schema}.${objectName}`,
      numReplicas: 3,
      constraints: '+region=us-east',
      leasePreferences: '+region=us-east',
      gcTtlSeconds: 90000,
    },
  ]
}

export function cockroachSpecificCapabilityForNode(
  normalizedNodeId: string,
): CockroachCapabilityKey | undefined {
  if (
    normalizedNodeId === 'cockroach:cluster' ||
    normalizedNodeId === 'cockroach:security' ||
    normalizedNodeId === 'cockroach:diagnostics'
  ) {
    return undefined
  }
  if (normalizedNodeId.includes('cluster-settings')) return 'inspectClusterSettings'
  if (normalizedNodeId.includes('jobs')) return 'inspectJobs'
  if (normalizedNodeId.includes('ranges')) return 'inspectRanges'
  if (normalizedNodeId.includes('regions') || normalizedNodeId.includes('localities')) return 'inspectRegions'
  if (normalizedNodeId.includes('nodes') || normalizedNodeId.includes('cluster-status')) return 'inspectClusterStatus'
  if (normalizedNodeId.includes('certificates')) return 'inspectCertificates'
  if (normalizedNodeId.includes('zone-config')) return 'inspectZoneConfigurations'
  if (normalizedNodeId.includes('roles') || normalizedNodeId.includes('grants')) return 'inspectRolesAndGrants'
  if (normalizedNodeId.includes('sessions')) return 'inspectSessions'
  if (
    normalizedNodeId.includes('contention') ||
    normalizedNodeId.includes('transactions') ||
    normalizedNodeId.includes('statements') ||
    normalizedNodeId.includes('locks') ||
    normalizedNodeId.includes('statistics')
  ) {
    return 'inspectContention'
  }
  return undefined
}

function restrictedCockroachPayload(
  connection: ConnectionProfile,
  normalizedNodeId: string,
  base: Record<string, unknown>,
) {
  const capability = cockroachSpecificCapabilityForNode(normalizedNodeId)
  if (!capability) {
    return undefined
  }
  const warning = cockroachCapabilityWarning(connection, capability)
  if (!warning) {
    return undefined
  }
  return {
    ...base,
    objectView: 'restricted',
    disabledReason: warning,
    warnings: [warning],
    objects: [],
  }
}

function cockroachClusterPayload(
  base: Record<string, unknown>,
  clusterPayload: {
    nodeCount: number
    rangeCount: number
    regionCount: number
    jobCount: number
    nodes: unknown[]
    ranges: unknown[]
    regions: unknown[]
    jobs: unknown[]
    clusterSettings: unknown[]
  },
  connection: ConnectionProfile,
) {
  const warnings = cockroachCapabilityWarnings(connection, [
    'inspectClusterStatus',
    'inspectRanges',
    'inspectRegions',
    'inspectJobs',
    'inspectClusterSettings',
  ])
  return {
    ...base,
    ...(cockroachCapability(connection, 'inspectClusterStatus')
      ? { nodeCount: clusterPayload.nodeCount, nodes: clusterPayload.nodes }
      : {}),
    ...(cockroachCapability(connection, 'inspectRanges')
      ? { rangeCount: clusterPayload.rangeCount, ranges: clusterPayload.ranges }
      : {}),
    ...(cockroachCapability(connection, 'inspectRegions')
      ? { regionCount: clusterPayload.regionCount, regions: clusterPayload.regions }
      : {}),
    ...(cockroachCapability(connection, 'inspectJobs')
      ? { jobCount: clusterPayload.jobCount, jobs: clusterPayload.jobs }
      : {}),
    ...(cockroachCapability(connection, 'inspectClusterSettings')
      ? { clusterSettings: clusterPayload.clusterSettings }
      : {}),
    ...(warnings.length ? { warnings } : {}),
  }
}

function cockroachDiagnosticsPayload(
  base: Record<string, unknown>,
  diagnosticsPayload: {
    activeSessions: number
    blockedSessions: number
    retryCount: number
    sessions: unknown[]
    statements: unknown[]
    transactions: unknown[]
    contention: unknown[]
    locks: unknown[]
    statistics: unknown[]
  },
  connection: ConnectionProfile,
) {
  const warnings = cockroachCapabilityWarnings(connection, [
    'inspectSessions',
    'inspectContention',
  ])
  return {
    ...base,
    ...(cockroachCapability(connection, 'inspectSessions')
      ? {
          activeSessions: diagnosticsPayload.activeSessions,
          sessions: diagnosticsPayload.sessions,
        }
      : {}),
    ...(cockroachCapability(connection, 'inspectContention')
      ? {
          blockedSessions: diagnosticsPayload.blockedSessions,
          retryCount: diagnosticsPayload.retryCount,
          statements: diagnosticsPayload.statements,
          transactions: diagnosticsPayload.transactions,
          contention: diagnosticsPayload.contention,
          locks: diagnosticsPayload.locks,
          statistics: diagnosticsPayload.statistics,
        }
      : {}),
    ...(warnings.length ? { warnings } : {}),
  }
}
