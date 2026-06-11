import type { OpenTsdbObjectViewDescriptor } from './OpenTsdbObjectViewDescriptors'

export type OpenTsdbWorkflowIconName = 'metric' | 'tag' | 'aggregation' | 'uid' | 'tree' | 'stats'

export type OpenTsdbWorkflow = {
  label: string
  title: string
  icon: OpenTsdbWorkflowIconName
  action?: 'query'
  targetSection?: string
}

export function openTsdbWorkflows(
  kind: string,
  descriptor: OpenTsdbObjectViewDescriptor,
  hasQueryTarget: boolean,
  availableSections?: ReadonlySet<string>,
) {
  const workflows: OpenTsdbWorkflow[] = []

  if (hasQueryTarget && descriptor.primaryQueryLabel) {
    workflows.push({
      label: descriptor.primaryQueryLabel,
      title: 'Open a bounded OpenTSDB query seeded from this metric.',
      icon: 'metric',
      action: 'query',
    })
  }

  if (['metric', 'metrics'].includes(kind)) {
    workflows.push(
      { label: 'Tags', title: 'Review tag keys and cardinality before querying.', icon: 'tag', targetSection: 'tags' },
      { label: 'UID Metadata', title: 'Review descriptions and metadata completeness.', icon: 'uid', targetSection: 'uidMetadata' },
    )
  }

  if (['tags', 'tag'].includes(kind)) {
    workflows.push(
      { label: 'Values', title: 'Review common values and related metrics.', icon: 'tag', targetSection: 'tagValues' },
      { label: 'Cardinality', title: 'Check query risk before broad tag scans.', icon: 'stats', targetSection: 'diagnostics' },
    )
  }

  if (['aggregators', 'aggregator', 'downsampling', 'downsampler'].includes(kind)) {
    workflows.push(
      { label: 'Query Shape', title: 'Choose an aggregation and downsampling window together.', icon: 'aggregation', targetSection: 'aggregators' },
      { label: 'Fill Policy', title: 'Review interpolation and missing-point behavior.', icon: 'stats', targetSection: 'downsampling' },
    )
  }

  if (['uid-metadata', 'uid', 'trees', 'tree', 'stats', 'diagnostics'].includes(kind)) {
    workflows.push(
      { label: 'Health', title: 'Review metadata consistency and backend health signals.', icon: 'stats', targetSection: 'diagnostics' },
      { label: 'Storage', title: 'Review TSDB writes, compaction, and UID pressure.', icon: 'tree', targetSection: 'stats' },
    )
  }

  return workflows.filter((workflow) => isWorkflowAvailable(workflow, availableSections))
}

function isWorkflowAvailable(workflow: OpenTsdbWorkflow, availableSections?: ReadonlySet<string>) {
  return !availableSections || workflow.action === 'query' || !workflow.targetSection || availableSections.has(workflow.targetSection)
}
