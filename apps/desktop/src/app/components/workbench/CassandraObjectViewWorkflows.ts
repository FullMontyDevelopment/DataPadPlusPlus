import type { CassandraObjectViewDescriptor } from './CassandraObjectViewDescriptors'

export type CassandraWorkflowIconName = 'database' | 'table' | 'index' | 'security' | 'job'

export type CassandraWorkflow = {
  label: string
  title: string
  icon: CassandraWorkflowIconName
  action?: 'query'
  targetSection?: string
}

export function cassandraWorkflows(
  kind: string,
  descriptor: CassandraObjectViewDescriptor,
  hasQueryTarget: boolean,
  availableSections?: ReadonlySet<string>,
) {
  const workflows: CassandraWorkflow[] = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: 'Open a CQL partition-key query builder for this object.',
      icon: 'table',
      action: 'query',
    })
  }

  if (['table', 'columns', 'primary-key', 'statistics', 'compaction'].includes(kind)) {
    workflows.push(
      { label: 'Review Keys', title: 'Check partition and clustering key order before querying.', icon: 'index', targetSection: 'primaryKey' },
      { label: 'Indexes', title: 'Review secondary indexes and SAI targets.', icon: 'index', targetSection: 'indexes' },
    )
  }

  if (['keyspace', 'security', 'permissions'].includes(kind)) {
    workflows.push({ label: 'Review Grants', title: 'Inspect roles and grants visible to this connection.', icon: 'security', targetSection: 'permissions' })
  }

  if (['diagnostics', 'cluster', 'tracing', 'repairs'].includes(kind)) {
    workflows.push({ label: 'Check Health', title: 'Inspect latency, repair, and node-level warning signals.', icon: 'job', targetSection: 'diagnostics' })
  }

  return workflows.filter((workflow) => isWorkflowAvailable(workflow, availableSections))
}

function isWorkflowAvailable(workflow: CassandraWorkflow, availableSections?: ReadonlySet<string>) {
  return !availableSections || workflow.action === 'query' || !workflow.targetSection || availableSections.has(workflow.targetSection)
}
