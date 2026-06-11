import type { CosmosObjectViewDescriptor } from './CosmosObjectViewDescriptors'

export type CosmosWorkflowIconName =
  | 'account'
  | 'collection'
  | 'document'
  | 'index'
  | 'throughput'
  | 'security'
  | 'diagnostics'
  | 'region'

export type CosmosWorkflow = {
  label: string
  title: string
  icon: CosmosWorkflowIconName
  action?: 'query'
  targetSection?: string
}

export function cosmosWorkflows(
  kind: string,
  descriptor: CosmosObjectViewDescriptor,
  hasQueryTarget: boolean,
  availableSections?: ReadonlySet<string>,
) {
  const workflows: CosmosWorkflow[] = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: 'Open a bounded Cosmos DB item query for this container.',
      icon: 'document',
      action: 'query',
    })
  }

  if (['account', 'databases', 'database'].includes(kind)) {
    workflows.push(
      { label: 'Databases', title: 'Review database and container inventory.', icon: 'account', targetSection: 'databases' },
      { label: 'Regions', title: 'Review read and write region posture.', icon: 'region', targetSection: 'regions' },
      { label: 'Consistency', title: 'Review default consistency and session behavior.', icon: 'throughput', targetSection: 'consistency' },
    )
  }

  if (['container', 'containers', 'items'].includes(kind)) {
    workflows.push(
      { label: 'Partition Key', title: 'Review partition routing and hot key hints.', icon: 'collection', targetSection: 'partitionKeys' },
      { label: 'Indexing', title: 'Review included, excluded, and composite index paths.', icon: 'index', targetSection: 'indexingPolicy' },
      { label: 'Throughput', title: 'Review RU/s, throttles, and cost-risk hints.', icon: 'throughput', targetSection: 'throughput' },
    )
  }

  if (['stored-procedures', 'triggers', 'udfs'].includes(kind)) {
    workflows.push(
      { label: 'Scripts', title: 'Review server-side JavaScript assets.', icon: 'document', targetSection: 'scripts' },
      { label: 'Guarded Preview', title: 'Create, replace, and delete actions stay preview-first.', icon: 'security', targetSection: 'security' },
    )
  }

  if (['diagnostics', 'throughput', 'regions'].includes(kind)) {
    workflows.push(
      { label: 'RU Usage', title: 'Review request-unit consumption and throttles.', icon: 'throughput', targetSection: 'throughput' },
      { label: 'Latency', title: 'Review region and operation latency signals.', icon: 'diagnostics', targetSection: 'diagnostics' },
    )
  }

  return dedupeWorkflows(workflows)
    .filter((workflow) => isWorkflowAvailable(workflow, availableSections))
    .slice(0, 5)
}

function isWorkflowAvailable(workflow: CosmosWorkflow, availableSections?: ReadonlySet<string>) {
  return !availableSections || workflow.action === 'query' || !workflow.targetSection || availableSections.has(workflow.targetSection)
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
