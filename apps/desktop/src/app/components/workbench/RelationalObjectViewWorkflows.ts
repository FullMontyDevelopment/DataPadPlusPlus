import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { RelationalObjectViewDescriptor } from './RelationalObjectViewWorkspace.helpers'
import type { RelationalSectionIcon } from './RelationalObjectViewSections'

export type RelationalWorkflow = {
  label: string
  title: string
  icon: RelationalSectionIcon
  action?: 'query'
  targetSection?: string
}

export function relationalWorkflows(
  connection: ConnectionProfile,
  kind: string,
  descriptor: RelationalObjectViewDescriptor,
  hasQueryTarget: boolean,
  availableSections?: ReadonlySet<string>,
) {
  const workflows: RelationalWorkflow[] = []

  if (hasQueryTarget) {
    workflows.push({
      label: 'Data',
      title: descriptor.primaryQueryLabel ?? 'Open a bounded data query',
      icon: 'table',
      action: 'query',
    })
  }

  if (['table', 'view', 'materialized-view', 'hypertable'].includes(kind)) {
    workflows.push(
      { label: 'Columns', title: 'Review columns and types', icon: 'table', targetSection: 'columns' },
      { label: 'Indexes', title: 'Review access paths and index health', icon: 'index', targetSection: 'indexes' },
      { label: 'Constraints', title: 'Review keys, constraints, and relationships', icon: 'index', targetSection: 'constraints' },
      { label: 'Triggers', title: 'Review object triggers', icon: 'job', targetSection: 'triggers' },
      { label: 'Grants', title: 'Review object permissions', icon: 'security', targetSection: 'permissions' },
    )
  }

  if (['procedure', 'function', 'stored-procedures', 'functions'].includes(kind)) {
    workflows.push(
      { label: connection.engine === 'sqlserver' ? 'T-SQL' : 'Source', title: 'Review routine source summary', icon: 'table', targetSection: 'source' },
      { label: 'Params', title: 'Review parameters and signatures', icon: 'table', targetSection: 'parameters' },
      { label: 'Grants', title: 'Review execute permissions', icon: 'security', targetSection: 'permissions' },
    )
  }

  if (
    [
      'security',
      'roles',
      'users',
      'permissions',
      'schemas',
      'certificates',
      'certificate',
      'symmetric-keys',
      'symmetric-key',
      'asymmetric-keys',
      'asymmetric-key',
      'credentials',
      'credential',
      'database-scoped-credentials',
      'database-scoped-credential',
      'audits',
      'audit',
    ].includes(kind)
  ) {
    workflows.push(
      { label: 'Users', title: 'Review users and principals', icon: 'security', targetSection: 'users' },
      { label: 'Roles', title: 'Review role membership', icon: 'security', targetSection: 'roles' },
      { label: 'Grants', title: 'Review effective permissions', icon: 'security', targetSection: 'permissions' },
      { label: 'Keys', title: 'Review certificates and key metadata', icon: 'security', targetSection: 'certificates' },
      { label: 'Credentials', title: 'Review scoped credential metadata', icon: 'security', targetSection: 'credentials' },
      { label: 'Audits', title: 'Review database audit specifications', icon: 'security', targetSection: 'audits' },
    )
  }

  if (['storage', 'files', 'file', 'filegroups', 'filegroup', 'partition-schemes', 'partition-scheme', 'partition-functions', 'partition-function'].includes(kind)) {
    workflows.push(
      { label: 'Files', title: 'Review database files and growth settings', icon: 'table', targetSection: 'files' },
      { label: 'Filegroups', title: 'Review filegroup state and allocation', icon: 'table', targetSection: 'filegroups' },
      { label: 'Partitions', title: 'Review partition schemes and functions', icon: 'index', targetSection: 'partitionSchemes' },
      { label: 'Allocation', title: 'Review allocation-unit totals', icon: 'job', targetSection: 'allocationUnits' },
    )
  }

  if (kind === 'cluster' && connection.engine === 'cockroachdb') {
    workflows.push(
      { label: 'Nodes', title: 'Review node health and locality', icon: 'job', targetSection: 'nodes' },
      { label: 'Ranges', title: 'Review range placement and leaseholders', icon: 'job', targetSection: 'ranges' },
      { label: 'Jobs', title: 'Review schema changes and cluster jobs', icon: 'job', targetSection: 'jobs' },
    )
  } else if (connection.engine === 'sqlserver' && ['sql-server-agent', 'agent', 'jobs', 'schedules', 'alerts', 'operators', 'proxies'].includes(kind)) {
    workflows.push(
      { label: 'Jobs', title: 'Review SQL Server Agent jobs', icon: 'job', targetSection: 'jobs' },
      { label: 'Schedules', title: 'Review SQL Server Agent schedules', icon: 'job', targetSection: 'schedules' },
      { label: 'Alerts', title: 'Review SQL Server Agent alerts', icon: 'job', targetSection: 'alerts' },
      { label: 'Operators', title: 'Review Agent notification operators', icon: 'security', targetSection: 'operators' },
      { label: 'Proxies', title: 'Review Agent proxies and credentials', icon: 'security', targetSection: 'proxies' },
    )
  } else if (['diagnostics', 'performance', 'performance-schema', 'query-store', 'query-store-view', 'extended-events', 'xevent-profiler', 'cluster', 'sessions', 'locks', 'waits', 'statements', 'index-health', 'slow-queries', 'metadata-locks', 'optimizer-trace', 'innodb-status', 'status-counters', 'replication'].includes(kind)) {
    if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
      workflows.push(...mysqlDiagnosticWorkflows(kind))
    } else {
      workflows.push(
        ...(kind === 'extended-events' || kind === 'xevent-profiler'
          ? [
              { label: 'Sessions', title: 'Review event sessions', icon: 'job' as const, targetSection: 'eventSessions' },
              { label: 'Events', title: 'Review captured event definitions', icon: 'job' as const, targetSection: 'eventSessionEvents' },
              { label: 'Targets', title: 'Review event session targets', icon: 'job' as const, targetSection: 'eventTargets' },
            ]
          : [
              { label: 'Sessions', title: 'Review active sessions', icon: 'job' as const, targetSection: 'sessions' },
              { label: 'Waits', title: 'Review waits and blocking signals', icon: 'job' as const, targetSection: 'waits' },
              {
                label: connection.engine === 'cockroachdb' ? 'Jobs' : 'Plans',
                title: 'Review workload health signals',
                icon: 'job' as const,
                targetSection: connection.engine === 'cockroachdb' ? 'jobs' : 'queryStore',
              },
            ]),
      )
    }
  }

  if (kind === 'maintenance') {
    workflows.push(
      { label: 'Check', title: 'Run integrity checks', icon: 'job', targetSection: 'checks' },
      { label: 'Analyze', title: 'Refresh planner statistics', icon: 'table', targetSection: 'maintenance' },
      { label: 'Backup', title: 'Prepare a safe backup workflow', icon: 'security', targetSection: 'maintenance' },
    )
  }

  if (['indexes', 'index'].includes(kind)) {
    workflows.push(
      { label: 'Usage', title: 'Review index usage', icon: 'index', targetSection: 'indexes' },
      { label: 'Health', title: 'Review validity and fragmentation hints', icon: 'job', targetSection: 'indexHealth' },
      { label: 'Preview', title: 'Plan guarded index maintenance', icon: 'security', targetSection: 'maintenance' },
    )
  }

  return dedupeWorkflows(workflows)
    .filter((workflow) => isWorkflowAvailable(workflow, availableSections))
    .slice(0, 6)
}

function dedupeWorkflows<T extends { label: string }>(workflows: T[]) {
  const seen = new Set<string>()
  return workflows.filter((workflow) => {
    if (seen.has(workflow.label)) {
      return false
    }
    seen.add(workflow.label)
    return true
  })
}

function isWorkflowAvailable(workflow: RelationalWorkflow, availableSections?: ReadonlySet<string>) {
  if (!availableSections || workflow.action === 'query' || !workflow.targetSection) {
    return true
  }

  if (availableSections.has(workflow.targetSection)) {
    return true
  }

  if (workflow.targetSection === 'permissions') {
    return availableSections.has('grants')
  }

  return false
}

function mysqlDiagnosticWorkflows(kind: string): RelationalWorkflow[] {
  const mysqlWorkflows = {
    sessions: { label: 'Sessions', title: 'Review processlist sessions and waits', icon: 'job', targetSection: 'sessions' },
    status: { label: 'Status', title: 'Review SHOW GLOBAL STATUS counters', icon: 'job', targetSection: 'statistics' },
    slow: { label: 'Slow SQL', title: 'Review slow-query digest rows', icon: 'job', targetSection: 'slowQueries' },
    digests: { label: 'Digests', title: 'Review performance_schema statement digests', icon: 'job', targetSection: 'statementDigests' },
    io: { label: 'I/O', title: 'Review table and index I/O waits', icon: 'job', targetSection: 'tableIo' },
    locks: { label: 'Locks', title: 'Review metadata lock posture', icon: 'job', targetSection: 'metadataLocks' },
    optimizer: { label: 'Optimizer', title: 'Review optimizer trace settings', icon: 'job', targetSection: 'optimizerTrace' },
    innodb: { label: 'InnoDB', title: 'Review InnoDB health counters', icon: 'job', targetSection: 'innodbStatus' },
    replication: { label: 'Replication', title: 'Review source and replica channel health', icon: 'job', targetSection: 'replication' },
  } satisfies Record<string, RelationalWorkflow>

  switch (kind) {
    case 'performance-schema':
      return [mysqlWorkflows.digests, mysqlWorkflows.io, mysqlWorkflows.locks, mysqlWorkflows.optimizer]
    case 'slow-queries':
      return [mysqlWorkflows.slow, mysqlWorkflows.digests]
    case 'metadata-locks':
      return [mysqlWorkflows.locks, mysqlWorkflows.sessions]
    case 'optimizer-trace':
      return [mysqlWorkflows.optimizer, mysqlWorkflows.digests]
    case 'innodb-status':
      return [mysqlWorkflows.innodb, mysqlWorkflows.status]
    case 'status-counters':
    case 'statistics':
      return [mysqlWorkflows.status, mysqlWorkflows.sessions]
    case 'replication':
      return [mysqlWorkflows.replication]
    default:
      return [
        mysqlWorkflows.sessions,
        mysqlWorkflows.status,
        mysqlWorkflows.digests,
        mysqlWorkflows.io,
        mysqlWorkflows.locks,
        mysqlWorkflows.optimizer,
        mysqlWorkflows.innodb,
        mysqlWorkflows.replication,
      ]
  }
}
