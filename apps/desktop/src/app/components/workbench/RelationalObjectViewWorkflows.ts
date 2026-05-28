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

  if (['security', 'roles', 'users', 'permissions', 'schemas'].includes(kind)) {
    workflows.push(
      { label: 'Users', title: 'Review users and principals', icon: 'security', targetSection: 'users' },
      { label: 'Roles', title: 'Review role membership', icon: 'security', targetSection: 'roles' },
      { label: 'Grants', title: 'Review effective permissions', icon: 'security', targetSection: 'permissions' },
    )
  }

  if (kind === 'cluster' && connection.engine === 'cockroachdb') {
    workflows.push(
      { label: 'Nodes', title: 'Review node health and locality', icon: 'job', targetSection: 'nodes' },
      { label: 'Ranges', title: 'Review range placement and leaseholders', icon: 'job', targetSection: 'ranges' },
      { label: 'Jobs', title: 'Review schema changes and cluster jobs', icon: 'job', targetSection: 'jobs' },
    )
  } else if (['diagnostics', 'performance', 'query-store', 'query-store-view', 'cluster', 'sessions', 'locks', 'waits', 'statements', 'index-health', 'slow-queries', 'innodb-status', 'status-counters', 'replication'].includes(kind)) {
    workflows.push(
      { label: 'Sessions', title: 'Review active sessions', icon: 'job', targetSection: 'sessions' },
      { label: 'Waits', title: 'Review waits and blocking signals', icon: 'job', targetSection: 'waits' },
      {
        label: connection.engine === 'cockroachdb' ? 'Jobs' : 'Plans',
        title: 'Review workload health signals',
        icon: 'job',
        targetSection: connection.engine === 'cockroachdb' ? 'jobs' : 'queryStore',
      },
    )
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
