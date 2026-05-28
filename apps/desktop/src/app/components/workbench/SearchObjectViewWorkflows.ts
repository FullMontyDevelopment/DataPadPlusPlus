import type { SearchObjectViewDescriptor } from './SearchObjectViewDescriptors'

export type SearchWorkflowIconName = 'search' | 'index' | 'security' | 'job'

export type SearchWorkflow = {
  label: string
  title: string
  icon: SearchWorkflowIconName
  action?: 'query'
  targetSection?: string
}

export function searchWorkflows(
  kind: string,
  descriptor: SearchObjectViewDescriptor,
  hasQueryTarget: boolean,
  availableSections?: ReadonlySet<string>,
) {
  const workflows: SearchWorkflow[] = []

  if (hasQueryTarget) {
    workflows.push({
      label: 'Search',
      title: descriptor.primaryQueryLabel ?? 'Open a bounded Query DSL search',
      icon: 'search',
      action: 'query',
    })
  }

  if (['cluster', 'health', 'diagnostics'].includes(kind)) {
    workflows.push(
      { label: 'Health', title: 'Review cluster health and allocation status', icon: 'job', targetSection: 'statistics' },
      { label: 'Nodes', title: 'Review node roles, heap, disk, and load', icon: 'job', targetSection: 'nodes' },
      { label: 'Shards', title: 'Review shard placement and state', icon: 'index', targetSection: 'shards' },
    )
  }

  if (['index', 'indices', 'data-stream', 'data-streams'].includes(kind)) {
    workflows.push(
      { label: 'Mappings', title: 'Review field mappings and analyzers', icon: 'search', targetSection: 'fields' },
      { label: 'Shards', title: 'Review shard placement and health', icon: 'index', targetSection: 'shards' },
      { label: 'Lifecycle', title: 'Review ILM or ISM state', icon: 'job', targetSection: 'lifecyclePolicies' },
    )
  }

  if (['security', 'users', 'roles', 'api-keys'].includes(kind)) {
    workflows.push(
      { label: 'Users', title: 'Review users and realms', icon: 'security', targetSection: 'users' },
      { label: 'Roles', title: 'Review cluster and index privileges', icon: 'security', targetSection: 'roles' },
      { label: 'API Keys', title: 'Review API key state', icon: 'security', targetSection: 'apiKeys' },
    )
  }

  if (['templates', 'index-template', 'component-template', 'pipelines', 'pipeline'].includes(kind)) {
    workflows.push(
      { label: 'Definition', title: 'Review definition summary', icon: 'search', targetSection: kind.includes('pipeline') ? 'pipelines' : 'templates' },
      { label: 'Usage', title: 'Review dependent indices or pipelines', icon: 'index', targetSection: 'indices' },
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

function isWorkflowAvailable(workflow: SearchWorkflow, availableSections?: ReadonlySet<string>) {
  return !availableSections || workflow.action === 'query' || !workflow.targetSection || availableSections.has(workflow.targetSection)
}
