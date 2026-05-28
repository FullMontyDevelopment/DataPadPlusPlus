import type { DynamoObjectViewDescriptor } from './DynamoObjectViewDescriptors'

export type DynamoWorkflowIconName = 'table' | 'index' | 'security' | 'job'

export type DynamoWorkflow = {
  label: string
  title: string
  icon: DynamoWorkflowIconName
  action?: 'query'
  targetSection?: string
  alternateTargetSections?: string[]
}

export function dynamoWorkflows(
  kind: string,
  descriptor: DynamoObjectViewDescriptor,
  hasQueryTarget: boolean,
  availableSections?: ReadonlySet<string>,
) {
  const workflows: DynamoWorkflow[] = []

  if (hasQueryTarget) {
    workflows.push({
      label: 'Items',
      title: descriptor.primaryQueryLabel ?? 'Open a key-condition query',
      icon: 'table',
      action: 'query',
    })
  }

  if (['table', 'tables', 'items'].includes(kind)) {
    workflows.push(
      { label: 'Keys', title: 'Review partition and sort keys', icon: 'table', targetSection: 'keys' },
      {
        label: 'Indexes',
        title: 'Review GSIs and LSIs',
        icon: 'index',
        targetSection: 'globalSecondaryIndexes',
        alternateTargetSections: ['localSecondaryIndexes'],
      },
      { label: 'Capacity', title: 'Review consumed capacity and throttles', icon: 'job', targetSection: 'capacity' },
    )
  }

  if (['indexes', 'global-secondary-indexes', 'local-secondary-indexes'].includes(kind)) {
    workflows.push(
      {
        label: 'Projection',
        title: 'Review projected attributes',
        icon: 'index',
        targetSection: 'globalSecondaryIndexes',
        alternateTargetSections: ['localSecondaryIndexes'],
      },
      { label: 'Capacity', title: 'Review index capacity and backfill state', icon: 'job', targetSection: 'capacity' },
    )
  }

  if (['diagnostics', 'capacity', 'hot-partitions', 'alarms'].includes(kind)) {
    workflows.push(
      { label: 'Capacity', title: 'Review read/write usage and throttles', icon: 'job', targetSection: 'capacity' },
      { label: 'Hot Keys', title: 'Review high-traffic partition keys', icon: 'job', targetSection: 'hotPartitions' },
      { label: 'Alarms', title: 'Review configured alarms', icon: 'job', targetSection: 'alarms' },
    )
  }

  if (['security', 'permissions'].includes(kind)) {
    workflows.push(
      { label: 'Policies', title: 'Review IAM-style policies', icon: 'security', targetSection: 'permissions' },
      { label: 'Principals', title: 'Review principals and access scope', icon: 'security', targetSection: 'permissions' },
    )
  }

  return dedupeWorkflows(workflows)
    .filter((workflow) => isWorkflowAvailable(workflow, availableSections))
    .map((workflow) => ({
      ...workflow,
      targetSection: firstAvailableTargetSection(workflow, availableSections),
    }))
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

function isWorkflowAvailable(workflow: DynamoWorkflow, availableSections?: ReadonlySet<string>) {
  if (!availableSections || workflow.action === 'query' || !workflow.targetSection) {
    return true
  }

  return Boolean(firstAvailableTargetSection(workflow, availableSections))
}

function firstAvailableTargetSection(workflow: DynamoWorkflow, availableSections?: ReadonlySet<string>) {
  const candidates = [
    workflow.targetSection,
    ...(workflow.alternateTargetSections ?? []),
  ].filter((candidate): candidate is string => Boolean(candidate))

  return availableSections
    ? candidates.find((candidate) => availableSections.has(candidate))
    : candidates[0]
}
