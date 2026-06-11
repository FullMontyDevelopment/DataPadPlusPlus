import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { WarehouseObjectViewDescriptor } from './WarehouseObjectViewDescriptors'

export type WarehouseWorkflowIconName =
  | 'database'
  | 'table'
  | 'stage'
  | 'warehouse'
  | 'job'
  | 'security'
  | 'diagnostics'

export type WarehouseWorkflow = {
  label: string
  title: string
  icon: WarehouseWorkflowIconName
  action?: 'query'
  targetSection?: string
}

export function warehouseWorkflows(
  kind: string,
  descriptor: WarehouseObjectViewDescriptor,
  hasQueryTarget: boolean,
  engine: ConnectionProfile['engine'],
  availableSections?: ReadonlySet<string>,
) {
  const dialect = engine === 'bigquery' ? 'BigQuery SQL' : engine === 'snowflake' ? 'Snowflake SQL' : engine === 'clickhouse' ? 'ClickHouse SQL' : 'SQL'
  const workflows: WarehouseWorkflow[] = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: `Open a scoped ${dialect} query for this warehouse object.`,
      icon: 'table',
      action: 'query',
    })
  }

  if (['database', 'databases', 'dataset', 'datasets', 'schema', 'schemas'].includes(kind)) {
    workflows.push(
      { label: 'Objects', title: 'Review tables, views, materialized views, stages, and jobs.', icon: 'database', targetSection: 'tables' },
      { label: 'Access', title: 'Review role, grant, or IAM coverage.', icon: 'security', targetSection: 'security' },
      { label: 'Cost', title: 'Review scanned bytes, queues, and failed jobs.', icon: 'diagnostics', targetSection: 'diagnostics' },
    )
  }

  if (['table', 'tables', 'view', 'views', 'materialized-view', 'materialized-views'].includes(kind)) {
    workflows.push(
      { label: 'Columns', title: 'Review column types, clustering, partitions, and freshness.', icon: 'table', targetSection: 'columns' },
      { label: 'Dry Run', title: 'Estimate scan cost before running broad queries.', icon: 'diagnostics', targetSection: 'diagnostics' },
    )
  }

  if (['warehouse', 'warehouses', 'jobs', 'job', 'tasks', 'task', 'diagnostics'].includes(kind)) {
    workflows.push(
      { label: 'Utilization', title: 'Review queueing, runtime, credits, slots, and bytes scanned.', icon: 'warehouse', targetSection: 'warehouses' },
      { label: 'Failures', title: 'Review failed jobs and actionable warnings.', icon: 'job', targetSection: 'jobs' },
    )
  }

  if (['stages', 'stage', 'security'].includes(kind)) {
    workflows.push(
      {
        label: kind === 'security' ? 'Grants' : 'Files',
        title: kind === 'security' ? 'Review roles, grants, and policies.' : 'Review staged files and load readiness.',
        icon: kind === 'security' ? 'security' : 'stage',
        targetSection: kind === 'security' ? 'security' : 'stages',
      },
      { label: 'Preview Changes', title: 'Generate guarded import, export, or access-change previews.', icon: 'diagnostics', targetSection: 'diagnostics' },
    )
  }

  return dedupeWorkflows(workflows)
    .filter((workflow) => isWorkflowAvailable(workflow, availableSections))
    .slice(0, 5)
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

function isWorkflowAvailable(workflow: WarehouseWorkflow, availableSections?: ReadonlySet<string>) {
  return !availableSections || workflow.action === 'query' || !workflow.targetSection || availableSections.has(workflow.targetSection)
}
