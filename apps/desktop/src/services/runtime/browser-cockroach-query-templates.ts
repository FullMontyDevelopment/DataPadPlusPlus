import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { CockroachCapabilityKey } from './cockroach-capabilities'
import { cockroachCapability } from './cockroach-capabilities'
import { parseCockroachNodeId } from './browser-postgres-family-helpers'
import { cockroachSpecificCapabilityForNode } from './browser-cockroach-payloads'

export function cockroachInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parseCockroachNodeId(connection, nodeId)
  const normalizedNodeId = nodeId.toLowerCase()

  if (['table:', 'view:'].some((prefix) => nodeId.startsWith(prefix)) && objectName) {
    return `select * from "${schema}"."${objectName}" limit 100;`
  }

  if (normalizedNodeId === 'cockroach:cluster') {
    return firstCockroachTemplate(connection, [
      ['inspectClusterStatus', 'select * from crdb_internal.gossip_nodes limit 100;'],
      ['inspectRanges', 'select * from crdb_internal.ranges_no_leases limit 100;'],
      ['inspectRegions', 'show regions;\nshow localities;'],
      ['inspectJobs', 'show jobs;'],
      ['inspectClusterSettings', 'show cluster settings;'],
    ])
  }

  if (normalizedNodeId === 'cockroach:security') {
    return firstCockroachTemplate(connection, [
      ['inspectRolesAndGrants', 'show roles;'],
      ['inspectCertificates', 'select * from crdb_internal.cluster_certificates limit 100;'],
    ])
  }

  if (normalizedNodeId === 'cockroach:diagnostics') {
    return firstCockroachTemplate(connection, [
      ['inspectSessions', 'show sessions;'],
      ['inspectContention', 'select * from crdb_internal.cluster_locks limit 100;'],
    ])
  }

  const blockedCapability = cockroachSpecificCapabilityForNode(normalizedNodeId)
  if (blockedCapability && !cockroachCapability(connection, blockedCapability)) {
    return undefined
  }

  if (normalizedNodeId.includes('cluster-settings')) {
    return 'show cluster settings;'
  }

  if (normalizedNodeId.includes('jobs')) {
    return 'show jobs;'
  }

  if (normalizedNodeId.includes('ranges')) {
    return 'select * from crdb_internal.ranges_no_leases limit 100;'
  }

  if (normalizedNodeId.includes('regions') || normalizedNodeId.includes('localities')) {
    return 'show regions;\nshow localities;'
  }

  if (normalizedNodeId.includes('nodes') || normalizedNodeId.includes('cluster')) {
    return 'select * from crdb_internal.gossip_nodes limit 100;'
  }

  if (normalizedNodeId.includes('contention')) {
    return 'show sessions;\nselect * from crdb_internal.cluster_locks limit 100;\nselect * from crdb_internal.cluster_contention_events limit 100;'
  }

  if (normalizedNodeId.includes('transactions')) {
    return 'select * from crdb_internal.cluster_transactions limit 100;'
  }

  if (normalizedNodeId.includes('statements')) {
    return 'select * from crdb_internal.node_statement_statistics limit 100;'
  }

  if (normalizedNodeId.includes('locks')) {
    return 'select * from crdb_internal.cluster_locks limit 100;'
  }

  if (normalizedNodeId.includes('statistics')) {
    return 'select * from crdb_internal.table_spans limit 100;'
  }

  if (normalizedNodeId.includes('certificates')) {
    return 'select * from crdb_internal.cluster_certificates limit 100;'
  }

  if (normalizedNodeId.includes('zone-config')) {
    return 'show zone configurations;'
  }

  if (normalizedNodeId.includes('security') || normalizedNodeId.includes('roles') || normalizedNodeId.includes('grants')) {
    return 'show roles;'
  }

  if (normalizedNodeId.includes('diagnostics') || normalizedNodeId.includes('sessions')) {
    return 'show sessions;'
  }

  return `show tables from "${schema}";`
}

function firstCockroachTemplate(
  connection: ConnectionProfile,
  templates: Array<[CockroachCapabilityKey, string]>,
) {
  return templates.find(([capability]) => cockroachCapability(connection, capability))?.[1]
}
